# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla-JS Tetris. No dependencies, no build step, no framework, no package.json. Three files: `index.html`, `style.css`, `game.js`.

## Running

```bash
open index.html                # macOS, direct file open
python3 -m http.server 8000    # or: npx serve .  /  php -S localhost:8000
```

No install, build, lint, or test commands exist in this repo.

## Architecture

All game logic lives in `game.js` (single file, no modules). State is a set of module-level `let` variables (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropInterval`, etc.) mutated directly by functions — not encapsulated in a class or store.

- **Board**: `ROWS × COLS` matrix, each cell `0` (empty) or a color index `1–7` identifying the piece type.
- **Pieces**: square matrices in `PIECES`, indexed by type (1=I ... 7=L). Colors are parallel-indexed in `COLORS`.
- **Rotation**: `rotateCW` transposes + reverses rows. `tryRotate` applies the rotation then attempts wall kicks at offsets `[0, -1, 1, -2, 2]` via `collide`, discarding the rotation if none succeed.
- **Collision**: `collide(shape, ox, oy)` is the single source of truth for both movement and rotation legality — checks bounds and overlap with locked board cells.
- **Game loop**: `loop(ts)`, driven by `requestAnimationFrame`, accumulates `dt` into `dropAccum` and advances the piece one row (or locks it) once `dropAccum >= dropInterval`.
- **Locking**: `lockPiece` computes `isTSpin()` (piece type T, last successful action was a rotation via `current.rotatedLast`, ≥3 of the 4 corners around the piece center occupied) before `merge` (bake piece into `board`) → `clearLines(tspin)` → `spawn` (promote `next` to `current`, generate new `next`; if the new piece immediately collides, `endGame` fires).
- **Line clears**: `clearLines` scans bottom-up, splices completed rows and unshifts empty ones at the top, re-checking the same index (`r++`) after a splice.
- **Scoring**: `LINE_SCORES = [0,100,300,500,800]` × `level` for line clears; hard drop = 2 pts/cell, soft drop = 1 pt/row. Level = `floor(lines/10)+1`; `dropInterval = max(100, 1000 - (level-1)*90)`.
- **Combo/bonus system**: `combo` (consecutive clearing locks) multiplies the line score (x1, x2, x3...); resets to `0` whenever a lock clears zero lines. `backToBack` tracks whether the previous clear was a Tetris (4 lines) and adds a 50% bonus (`B2B_TETRIS_BONUS`) to a following Tetris; it is overwritten (not just reset) on every clearing lock based on that lock's own `cleared === 4`. T-spins add `TSPIN_SCORES[cleared]` × `level`. Perfect Clear (`board.every(row => row.every(v => v === 0))` after the clear) adds `PERFECT_CLEAR_SCORES[cleared]` × `level`, uncombined with the combo multiplier. `current.rotatedLast` is set `true` only in `tryRotate` and cleared to `false` on any successful translation (arrow keys, soft drop, gravity step) so hard drop after a rotation still registers as a T-spin. Bonus events call `showEffect(text)` (drawn as a fading banner in `draw()`, timed by `effectTimer`/`COMBO_EFFECT_DURATION`) and a matching `play*Sound()` (Web Audio oscillator tones via `getAudioCtx`/`playTone` — no audio assets).
- **Ghost piece**: `ghostY` projects `current` straight down via `collide` until it would hit; drawn at `globalAlpha = 0.2`.
- **Rendering**: immediate-mode Canvas 2D, redrawn in full every frame (`draw()` for the board canvas, `drawNext()` for the preview canvas). No dirty-rect optimization.
- **Input**: single `keydown` listener switches on `e.code` (arrows, `KeyX` for rotate, `Space` for hard drop, `KeyP` for pause), ignored while `paused`/`gameOver` except the pause key itself.

If changing `COLS`, `ROWS`, or `BLOCK` in `game.js`, also update the `<canvas id="board">` `width`/`height` in `index.html` to match (`COLS × BLOCK`, `ROWS × BLOCK`).
