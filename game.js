'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];
const TSPIN_SCORES = [0, 800, 1200, 1600];
const PERFECT_CLEAR_SCORES = [0, 800, 1200, 1800, 2000];
const B2B_TETRIS_BONUS = 0.5;
const COMBO_EFFECT_DURATION = 900;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggleBtn = document.getElementById('theme-toggle');
const comboSection = document.getElementById('combo-section');
const comboEl = document.getElementById('combo');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let theme, gridColor;
let combo, backToBack;
let effectMessage, effectTimer;
let audioCtx;

const THEME_STORAGE_KEY = 'tetris-theme';

function setTheme(t) {
  theme = t;
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME_STORAGE_KEY, t);
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid-line').trim();
  themeToggleBtn.textContent = t === 'light' ? '☀️ Light' : '🌙 Dark';
  themeToggleBtn.setAttribute('aria-pressed', String(t === 'light'));
}

setTheme(localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark');

themeToggleBtn.addEventListener('click', () => {
  setTheme(theme === 'light' ? 'dark' : 'light');
  draw();
  drawNext();
});

function getAudioCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(freq, duration, type, volume, delay) {
  const ctxA = getAudioCtx();
  if (!ctxA) return;
  const osc = ctxA.createOscillator();
  const gain = ctxA.createGain();
  osc.type = type || 'sine';
  osc.frequency.value = freq;
  osc.connect(gain).connect(ctxA.destination);
  const startTime = ctxA.currentTime + (delay || 0);
  gain.gain.setValueAtTime(volume ?? 0.2, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

function playComboSound(comboCount) {
  playTone(440 + comboCount * 40, 0.12, 'square', 0.15);
}

function playTSpinSound() {
  playTone(660, 0.1, 'triangle', 0.2);
  playTone(880, 0.12, 'triangle', 0.2, 0.08);
}

function playB2BSound() {
  playTone(523.25, 0.1, 'sawtooth', 0.2);
  playTone(659.25, 0.1, 'sawtooth', 0.2, 0.08);
  playTone(783.99, 0.15, 'sawtooth', 0.2, 0.16);
}

function playPerfectClearSound() {
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => playTone(freq, 0.18, 'sine', 0.25, i * 0.09));
}

function showEffect(text) {
  effectMessage = text;
  effectTimer = COMBO_EFFECT_DURATION;
}

function updateCombo() {
  if (combo > 1) {
    comboSection.classList.remove('hidden');
    comboEl.textContent = `x${combo}`;
  } else {
    comboSection.classList.add('hidden');
  }
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0, rotatedLast: false };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      current.rotatedLast = true;
      return;
    }
  }
}

function isTSpin() {
  if (current.type !== 3 || !current.rotatedLast) return false;
  const cx = current.x + 1;
  const cy = current.y + 1;
  const corners = [
    [cx - 1, cy - 1],
    [cx + 1, cy - 1],
    [cx - 1, cy + 1],
    [cx + 1, cy + 1],
  ];
  let filled = 0;
  for (const [x, y] of corners) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS || board[y][x]) filled++;
  }
  return filled >= 3;
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines(tspin) {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }

  if (!cleared) {
    combo = 0;
    updateCombo();
    return;
  }

  lines += cleared;
  combo++;

  let gained = ((LINE_SCORES[cleared] || 0) + (tspin ? TSPIN_SCORES[cleared] || 0 : 0)) * level;
  gained *= combo;

  const isTetris = cleared === 4;
  const isB2BTetris = isTetris && backToBack;
  if (isB2BTetris) gained += Math.floor(gained * B2B_TETRIS_BONUS);
  backToBack = isTetris;

  const perfectClear = board.every(row => row.every(v => v === 0));
  if (perfectClear) gained += (PERFECT_CLEAR_SCORES[cleared] || 0) * level;

  score += gained;
  level = Math.floor(lines / 10) + 1;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);

  if (perfectClear) {
    showEffect('PERFECT CLEAR!');
    playPerfectClearSound();
  } else if (tspin) {
    showEffect(cleared === 1 ? 'T-SPIN!' : cleared === 2 ? 'T-SPIN DOUBLE!' : 'T-SPIN TRIPLE!');
    playTSpinSound();
  } else if (isB2BTetris) {
    showEffect('B2B TETRIS!');
    playB2BSound();
  } else if (combo > 1) {
    showEffect(`COMBO x${combo}!`);
  }
  if (combo > 1) playComboSound(combo);

  updateCombo();
  updateHUD();
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    current.rotatedLast = false;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  const tspin = isTSpin();
  merge();
  clearLines(tspin);
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);

  // combo/bonus effect banner
  if (effectTimer > 0) {
    const alpha = Math.min(1, effectTimer / 300);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(effectMessage, canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(effectMessage, canvas.width / 2, canvas.height / 2);
    ctx.restore();
  }
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
      current.rotatedLast = false;
    } else {
      lockPiece();
      if (gameOver) return;
    }
  }
  if (effectTimer > 0) effectTimer = Math.max(0, effectTimer - dt);
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  combo = 0;
  backToBack = false;
  effectMessage = '';
  effectTimer = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateCombo();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) {
        current.x--;
        current.rotatedLast = false;
      }
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) {
        current.x++;
        current.rotatedLast = false;
      }
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

init();
