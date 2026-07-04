#!/usr/bin/env bash
#
# Creates or updates the Claude diagnostic comment on the triggering issue.
# Usage:
#   ./scripts/upsert-issue-comment.sh --body-file - <<'EOF'
#   <!-- claude-issue-diagnosis -->
#   ...markdown body...
#   EOF
#
# The issue number is read from the workflow event payload (never trusted
# from an argument), same security pattern as edit-issue-labels.sh: this
# prevents the model from being tricked into editing comments on some
# other issue. The existing-comment lookup is done by searching for a
# hidden marker string in comment bodies (not "last comment by this bot"),
# because other Claude workflows in this repo (@claude mentions) share the
# same bot identity and may also comment on the same issue.
#

set -euo pipefail

MARKER='<!-- claude-issue-diagnosis -->'

REPO="${GH_REPO:-${GITHUB_REPOSITORY:-}}"
if [[ -z "$REPO" || "$REPO" != */* ]]; then
  echo "Error: GH_REPO or GITHUB_REPOSITORY must be set to owner/repo format" >&2
  exit 1
fi

ISSUE=$(jq -r '.issue.number // empty' "${GITHUB_EVENT_PATH:?GITHUB_EVENT_PATH not set}")
if ! [[ "$ISSUE" =~ ^[0-9]+$ ]]; then
  echo "Error: no issue number in event payload" >&2
  exit 1
fi

BODY_FILE=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --body-file)
      BODY_FILE="${2:?--body-file requires a value}"
      shift 2
      ;;
    *)
      echo "Error: unknown argument (only --body-file is accepted)" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$BODY_FILE" ]]; then
  echo "Error: --body-file is required (use '-' to read from stdin)" >&2
  exit 1
fi

if [[ "$BODY_FILE" == "-" ]]; then
  BODY_CONTENT=$(cat)
else
  BODY_CONTENT=$(cat "$BODY_FILE")
fi

if [[ "$BODY_CONTENT" != *"$MARKER"* ]]; then
  BODY_CONTENT="${MARKER}
${BODY_CONTENT}"
fi

TMP_BODY=$(mktemp)
trap 'rm -f "$TMP_BODY"' EXIT
printf '%s\n' "$BODY_CONTENT" > "$TMP_BODY"

# Find any prior diagnostic comment on THIS issue by scanning for the marker.
# The comments endpoint returns oldest-first, so taking the last match id
# is the most recently created diagnosis comment.
EXISTING_ID=$(gh api "repos/${REPO}/issues/${ISSUE}/comments" --paginate \
  --jq ".[] | select(.body | contains(\"${MARKER}\")) | .id" | tail -n1)

if [[ -n "$EXISTING_ID" ]]; then
  gh api --method PATCH "repos/${REPO}/issues/comments/${EXISTING_ID}" \
    -F body=@"${TMP_BODY}" >/dev/null
  echo "Updated existing diagnostic comment (id ${EXISTING_ID}) on issue #${ISSUE}"
else
  gh issue comment "$ISSUE" --repo "$REPO" --body-file "$TMP_BODY" >/dev/null
  echo "Created new diagnostic comment on issue #${ISSUE}"
fi
