/**
 * LASER CHESS — application shell.
 * Owns the game state, the turn sequence, UI wiring and animation clock.
 */

import {
  SIDES,
  PIECE_TYPES,
  canRotatePiece,
  createGame,
  describePiece,
  endTurn,
  legalMoves,
  markKingDead,
  movePiece,
  pieceAt,
  removePiece,
  rotatePiece,
  shotLength,
  traceLaser,
} from './game.js';
import { Renderer } from './renderer.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id);

const canvas = $('gameCanvas');
const stage = $('boardStage');
const renderer = new Renderer(canvas, stage);
const sound = new Sound();

const els = {
  root: document.documentElement,
  menuOverlay: $('menuOverlay'),
  gameOverOverlay: $('gameOverOverlay'),
  playBtn: $('playBtn'),
  playAgainBtn: $('playAgainBtn'),
  menuFromGameOverBtn: $('menuFromGameOverBtn'),
  menuBtn: $('menuBtn'),
  restartBtn: $('restartBtn'),
  soundBtn: $('soundBtn'),
  soundIcon: $('soundIcon'),
  turnPill: $('turnPill'),
  turnLabel: $('turnLabel'),
  turnName: $('turnName'),
  turnSub: $('turnSub'),
  infoKicker: $('infoKicker'),
  infoText: $('infoText'),
  selectedInfo: $('selectedInfo'),
  rotateBtn: $('rotateBtn'),
  fireBtn: $('fireBtn'),
  fireLabel: document.querySelector('.fire-label'),
  toast: $('toast'),
  winnerTitle: $('winnerTitle'),
  winnerSub: $('winnerSub'),
  winnerEmblem: $('winnerEmblem'),
};

let state = createGame();
let mode = 'menu'; // menu | play | firing | gameover
let actionLockUntil = 0;
let toastTimer = 0;
let lastTurnSoundAt = 0;

const view = {
  selectedId: null,
  legalMoves: [],
  hover: null,
  lastMove: null,
  pieceAnims: new Map(),
  angleAnims: new Map(),
  laser: null,
};

const MOVE_DURATION = 260;
const ROTATE_DURATION = 300;

/* ------------------------------------------------------------------ */
/* Rendering & update loop                                             */
/* ------------------------------------------------------------------ */

let lastNow = performance.now();
let lastCoveredDraw = 0;

function frame(now) {
  lastNow = now;
  update(now);
  // The menu and game-over overlays cover the board; throttling the canvas
  // underneath keeps the first interaction snappy on software-rendered GPUs.
  const covered = mode === 'menu' || mode === 'gameover';
  if (!covered || now - lastCoveredDraw > 320) {
    renderer.draw(state, view, now);
    lastCoveredDraw = now;
  }
  requestAnimationFrame(frame);
}

function update(now) {
  // Clean up completed piece animations so the maps stay small.
  for (const [id, anim] of view.pieceAnims) {
    if (now > anim.start + anim.duration + 50) view.pieceAnims.delete(id);
  }
  for (const [id, anim] of view.angleAnims) {
    if (now > anim.start + anim.duration + 50) view.angleAnims.delete(id);
  }

  if (view.laser) updateLaser(now);
}

/* ------------------------------------------------------------------ */
/* Laser sequence                                                      */
/* ------------------------------------------------------------------ */

function fireLaser(now = performance.now()) {
  if (mode !== 'play' || state.winner) return;
  if (now < actionLockUntil) return;

  const shot = traceLaser(state, state.turn);
  if (!shot.emitterId) return;

  const distance = Math.max(1, shotLength(shot));
  const chargeMs = 430;
  const travelMs = Math.max(320, Math.min(2100, distance * 92));
  const holdMs = 460;
  const fadeMs = 280;

  const eventTimes = [];
  let accumulated = 0;
  let previous = shot.points[0];
  for (let i = 0; i < shot.points.length; i += 1) {
    if (i > 0) {
      accumulated += Math.hypot(shot.points[i].x - previous.x, shot.points[i].y - previous.y);
      previous = shot.points[i];
    }
    eventTimes[i] = chargeMs + (accumulated / distance) * travelMs;
  }

  mode = 'firing';
  view.selectedId = null;
  view.legalMoves = [];
  view.hover = null;
  view.laser = {
    owner: state.turn,
    shot,
    startedAt: now,
    chargeMs,
    travelMs,
    holdMs,
    fadeMs,
    eventTimes,
    nextEvent: 0,
    laserSoundPlayed: false,
    totalDuration: chargeMs + travelMs + holdMs + fadeMs,
  };

  sound.charge();
  showToast(`${SIDES[state.turn].name} EMITTER CHARGING`, false, 1200);
  updateUI();
}

function updateLaser(now) {
  const laser = view.laser;
  if (!laser) return;
  const elapsed = now - laser.startedAt;

  if (!laser.laserSoundPlayed && elapsed >= laser.chargeMs) {
    laser.laserSoundPlayed = true;
    sound.laser();
  }

  while (
    laser.nextEvent < laser.shot.events.length
    && elapsed >= laser.eventTimes[laser.shot.events[laser.nextEvent].index]
  ) {
    const event = laser.shot.events[laser.nextEvent];
    laser.nextEvent += 1;
    applyLaserEvent(event, laser);
  }

  if (elapsed >= laser.totalDuration) finishShot();
}

function applyLaserEvent(event, laser) {
  const point = laser.shot.points[event.index] ?? { x: event.x + 0.5, y: event.y + 0.5 };

  if (event.kind === 'reflect') {
    sound.impact();
    renderer.spark(point, event.owner, { count: 9, power: 0.7 });
    renderer.flashScreen(event.owner, 0.08);
    return;
  }

  if (event.kind === 'destroy') {
    const removed = removePiece(state, event.pieceId);
    if (removed) {
      renderer.burst(event.x, event.y, event.owner, { count: 32, power: 1.1 });
      renderer.flashScreen(event.owner, 0.18);
      sound.destroy();
      showToast('MIRROR SHATTERED', true, 1300);
    }
    return;
  }

  if (event.kind === 'kingHit') {
    const king = markKingDead(state, event.owner);
    if (king) {
      state.winner = laser.owner;
      renderer.burst(event.x, event.y, event.owner, { count: 74, power: 2.15, king: true });
      renderer.flashScreen(laser.owner, 0.7);
      sound.destroy();
      sound.impact();
      showToast(`${SIDES[event.owner].name} KING DESTROYED`, true, 1800);
    }
    return;
  }

  if (event.kind === 'absorb') {
    renderer.spark(point, event.owner, { count: 12, power: 0.8 });
    sound.impact();
    showToast('BEAM ABSORBED', false, 1000);
    return;
  }

  if (event.kind === 'wall') {
    const position = { x: point.x, y: point.y };
    renderer.spark(position, laser.owner, { count: 7, power: 0.55 });
    return;
  }

  if (event.kind === 'loop') {
    renderer.spark(point, laser.owner, { count: 14, power: 0.9 });
    renderer.flashScreen(laser.owner, 0.12);
    showToast('BEAM LOOP STABILISED', false, 1300);
  }
}

function finishShot() {
  const winner = state.winner;
  view.laser = null;

  if (winner) {
    mode = 'gameover';
    showGameOver(winner);
    updateUI();
    return;
  }

  endTurn(state);
  mode = 'play';
  actionLockUntil = 0;
  view.selectedId = null;
  view.legalMoves = [];
  view.hover = null;
  view.lastMove = null;
  updateUI();

  const now = performance.now();
  if (now - lastTurnSoundAt > 250) {
    sound.turn();
    lastTurnSoundAt = now;
  }
  showToast(`${SIDES[state.turn].name}'S TURN`, false, 1300);
}

/* ------------------------------------------------------------------ */
/* Player actions                                                      */
/* ------------------------------------------------------------------ */

function selectPiece(piece) {
  view.selectedId = piece.id;
  view.legalMoves = legalMoves(state, piece);
  updateUI();
  sound.select();
}

function clearSelection() {
  view.selectedId = null;
  view.legalMoves = [];
  updateUI();
}

function tryMove(piece, destination, now) {
  if (now < actionLockUntil || mode !== 'play') return;
  const from = { x: piece.x, y: piece.y };
  try {
    const action = movePiece(state, piece, destination.x, destination.y);
    view.pieceAnims.set(piece.id, {
      fromX: from.x,
      fromY: from.y,
      start: now,
      duration: MOVE_DURATION,
    });
    view.selectedId = null;
    view.legalMoves = [];
    view.hover = null;
    view.lastMove = action;
    actionLockUntil = now + MOVE_DURATION + 20;
    renderer.spark({ x: from.x + 0.5, y: from.y + 0.5 }, piece.owner, { count: 6, power: 0.4 });
    sound.move();
    showToast(`${describePiece(piece).title.split(' //')[0]} MOVED`, false, 900);
    updateUI();
    window.setTimeout(() => {
      if (mode === 'play') updateUI();
    }, MOVE_DURATION + 30);
  } catch {
    sound.deny();
  }
}

function tryRotate(piece, now) {
  if (now < actionLockUntil || mode !== 'play') return;
  if (!piece || !canRotatePiece(state, piece)) {
    sound.deny();
    return;
  }
  const fromAngle = renderer.baseAngle(piece);
  try {
    const action = rotatePiece(state, piece);
    view.angleAnims.set(piece.id, {
      from: fromAngle,
      to: fromAngle + 90,
      start: now,
      duration: ROTATE_DURATION,
    });
    view.selectedId = piece.id;
    view.legalMoves = [];
    view.hover = null;
    view.lastMove = action;
    actionLockUntil = now + ROTATE_DURATION + 20;
    renderer.spark({ x: piece.x + 0.5, y: piece.y + 0.5 }, piece.owner, { count: 8, power: 0.45 });
    sound.rotate();
    const label = piece.type === PIECE_TYPES.MIRROR ? 'MIRROR' : 'EMITTER';
    showToast(`${label} ROTATED 90°`, false, 900);
    updateUI();
    window.setTimeout(() => {
      if (mode === 'play') updateUI();
    }, ROTATE_DURATION + 30);
  } catch {
    sound.deny();
  }
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

function handleBoardTap(cell, now) {
  if (mode !== 'play' || now < actionLockUntil) return;

  const clicked = pieceAt(state, cell.x, cell.y);

  if (clicked && clicked.owner === state.turn && !state.actionUsed) {
    if (view.selectedId === clicked.id && canRotatePiece(state, clicked)) {
      tryRotate(clicked, now);
      return;
    }
    selectPiece(clicked);
    return;
  }

  if (clicked && clicked.owner === state.turn && state.actionUsed) {
    view.selectedId = null;
    view.legalMoves = [];
    updateUI();
    showToast('ACTION USED — PRESS FIRE', false, 1100);
    sound.deny();
    return;
  }

  if (view.selectedId) {
    const selected = state.pieces.find((piece) => piece.id === view.selectedId);
    if (selected && selected.owner === state.turn) {
      const legal = legalMoves(state, selected).some((move) => move.x === cell.x && move.y === cell.y);
      if (legal) {
        tryMove(selected, cell, now);
        return;
      }
    }
  }

  if (clicked) {
    showToast('ENEMY UNIT', false, 700);
    sound.deny();
  }
  view.selectedId = null;
  view.legalMoves = [];
  updateUI();
}

canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  void sound.init();
  const cell = renderer.cellAt(event.clientX, event.clientY);
  if (!cell) return;
  handleBoardTap(cell, performance.now());
});

canvas.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'touch') return;
  const cell = renderer.cellAt(event.clientX, event.clientY);
  if (!cell) {
    view.hover = null;
    return;
  }
  if (!view.hover || view.hover.x !== cell.x || view.hover.y !== cell.y) view.hover = cell;
});

canvas.addEventListener('pointerleave', () => {
  view.hover = null;
});

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

window.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if (key === 'f' && mode === 'play') {
    event.preventDefault();
    fireLaser();
  } else if (key === 'r' && mode === 'play') {
    event.preventDefault();
    const selected = state.pieces.find((piece) => piece.id === view.selectedId);
    if (selected) tryRotate(selected, performance.now());
  } else if (event.key === 'Escape' && mode === 'play') {
    clearSelection();
  }
});

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

els.rotateBtn.addEventListener('click', () => {
  void sound.init();
  const selected = state.pieces.find((piece) => piece.id === view.selectedId);
  tryRotate(selected, performance.now());
});

els.fireBtn.addEventListener('click', () => {
  void sound.init();
  sound.ui();
  fireLaser();
});

els.playBtn.addEventListener('click', () => {
  void sound.init();
  sound.ui();
  startGame();
});

els.playAgainBtn.addEventListener('click', () => {
  void sound.init();
  sound.ui();
  startGame();
});

els.menuFromGameOverBtn.addEventListener('click', () => {
  void sound.init();
  sound.ui();
  goToMenu();
});

els.menuBtn.addEventListener('click', () => {
  void sound.init();
  sound.ui();
  goToMenu();
});

els.restartBtn.addEventListener('click', () => {
  void sound.init();
  sound.ui();
  if (mode === 'menu') return;
  startGame();
});

els.soundBtn.addEventListener('click', () => {
  const nextMuted = !sound.muted;
  sound.setMuted(nextMuted);
  if (!nextMuted) {
    void sound.init().then(() => sound.ui());
  }
  updateSoundButton();
});

function updateSoundButton() {
  const muted = sound.muted;
  els.soundIcon.textContent = muted ? '✕' : '♪';
  els.soundBtn.title = muted ? 'Sound off — tap to enable' : 'Sound on — tap to mute';
  els.soundBtn.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
  els.soundBtn.classList.toggle('muted', muted);
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

function resetView() {
  view.selectedId = null;
  view.legalMoves = [];
  view.hover = null;
  view.lastMove = null;
  view.pieceAnims.clear();
  view.angleAnims.clear();
  view.laser = null;
}

function startGame() {
  state = createGame();
  mode = 'play';
  actionLockUntil = 0;
  resetView();
  renderer.clearEffects();
  els.menuOverlay.hidden = true;
  els.gameOverOverlay.hidden = true;
  updateUI();
  updateSoundButton();
  sound.gameStart();
  showToast('RED DEPLOYS FIRST', false, 1500);
}

function goToMenu() {
  state = createGame();
  mode = 'menu';
  actionLockUntil = 0;
  resetView();
  renderer.clearEffects();
  els.gameOverOverlay.hidden = true;
  els.menuOverlay.hidden = false;
  updateUI();
  updateSoundButton();
}

function showGameOver(winner) {
  const side = SIDES[winner];
  const loser = SIDES[winner === 'red' ? 'blue' : 'red'];
  els.winnerTitle.textContent = `${side.name} WINS`;
  els.winnerSub.textContent = `The ${loser.name.toLowerCase()} king was consumed by the beam on turn ${state.turnNumber}.`;
  els.winnerEmblem.textContent = '♔';
  els.gameOverOverlay.hidden = false;
  sound.win();
  window.setTimeout(() => {
    try { els.playAgainBtn.focus({ preventScroll: true }); } catch { /* ignore */ }
  }, 120);
}

/* ------------------------------------------------------------------ */
/* UI sync                                                             */
/* ------------------------------------------------------------------ */

function updateUI() {
  const displaySide = state.winner ?? state.turn;
  const side = SIDES[displaySide];
  els.root.dataset.turn = displaySide;
  els.turnPill.dataset.turn = displaySide;

  if (mode === 'firing') {
    els.turnLabel.textContent = `${side.name} // FIRING`;
  } else if (mode === 'gameover') {
    els.turnLabel.textContent = `${side.name} WINS`;
  } else {
    els.turnLabel.textContent = side.label;
  }

  els.turnName.textContent = side.name;
  els.turnName.style.color = '';
  els.turnName.style.textShadow = '';

  if (mode === 'firing') {
    els.turnSub.textContent = 'Weapon discharging…';
  } else if (mode === 'gameover') {
    els.turnSub.textContent = 'Match complete.';
  } else if (state.actionUsed) {
    els.turnSub.textContent = 'Action committed · fire to finish';
  } else {
    els.turnSub.textContent = 'One move or rotation, then fire.';
  }

  const selected = state.pieces.find((piece) => piece.id === view.selectedId && !piece.dead) ?? null;

  if (mode === 'firing') {
    els.infoKicker.textContent = 'WEAPON DISCHARGE';
    els.infoText.textContent = 'Laser in flight. Tracking reflections…';
    els.selectedInfo.classList.add('active');
  } else if (mode === 'gameover') {
    els.infoKicker.textContent = 'MATCH COMPLETE';
    els.infoText.textContent = `${side.name} controls the light.`;
    els.selectedInfo.classList.add('active');
  } else if (selected) {
    const description = describePiece(selected);
    els.infoKicker.textContent = description.title;
    els.infoText.textContent = description.text;
    els.selectedInfo.classList.add('active');
  } else {
    els.infoKicker.textContent = 'NO PIECE SELECTED';
    els.infoText.textContent = state.actionUsed
      ? 'Action committed. Press FIRE to end the turn.'
      : 'Tap one of your pieces to reveal its moves.';
    els.selectedInfo.classList.remove('active');
  }

  const now = performance.now();
  const locked = mode !== 'play' || now < actionLockUntil;
  const rotateAllowed = mode === 'play' && !locked && canRotatePiece(state, selected);
  els.rotateBtn.disabled = !rotateAllowed;
  els.fireBtn.disabled = locked;
  els.fireBtn.classList.toggle('ready', mode === 'play' && !locked);
  els.fireBtn.setAttribute('aria-label', mode === 'firing' ? 'Laser firing' : 'Fire laser');

  if (els.fireLabel) {
    els.fireLabel.textContent = mode === 'firing' ? 'FIRING' : 'FIRE';
  }

  if (mode === 'menu') {
    els.fireBtn.classList.remove('ready');
  }
}

function showToast(message, danger = false, duration = 1500) {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle('danger', danger);
  els.toast.classList.add('show');
  toastTimer = window.setTimeout(() => {
    els.toast.classList.remove('show');
  }, duration);
}

/* ------------------------------------------------------------------ */
/* Resize + boot                                                       */
/* ------------------------------------------------------------------ */

const resizeObserver = new ResizeObserver(() => {
  renderer.resize();
});
resizeObserver.observe(stage);

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('orientationchange', () => {
  window.setTimeout(() => renderer.resize(), 120);
});

updateSoundButton();
updateUI();
requestAnimationFrame(frame);
