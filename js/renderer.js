/**
 * LASER CHESS — canvas renderer.
 * Draws the board, glowing pieces, animated beams and impact particles.
 * All game state lives in game.js; all view-only animation data lives here or
 * in the `view` object supplied by main.js.
 */

import { BOARD_SIZE, PIECE_TYPES } from './game.js';

const TAU = Math.PI * 2;

const COLORS = {
  red: {
    main: '#ff355e',
    soft: '#ff8da2',
    light: '#fff1f4',
    deep: '#2c0913',
    rgb: '255, 53, 94',
    softRgb: '255, 141, 162',
  },
  blue: {
    main: '#2fa9ff',
    soft: '#82d4ff',
    light: '#eefaff',
    deep: '#061b31',
    rgb: '47, 169, 255',
    softRgb: '130, 212, 255',
  },
  neutral: {
    main: '#78c8ff',
    rgb: '120, 200, 255',
  },
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function polygon(ctx, cx, cy, radius, sides, rotation = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < sides; i += 1) {
    const angle = rotation + (i / sides) * TAU;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function starPath(ctx, cx, cy, outer, inner, points = 4) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i / (points * 2)) * TAU;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export class Renderer {
  constructor(canvas, stage) {
    this.canvas = canvas;
    this.stage = stage;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.board = { x: 0, y: 0, size: 0, cell: 0 };
    this.stars = [];
    this.particles = [];
    this.shockwaves = [];
    this.shakeAmount = 0;
    this.flash = null;
    this.lastFrame = 0;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const margin = clamp(Math.min(width, height) * 0.034, 16, 30);
    const size = Math.floor(Math.min(width - margin * 2, height - margin * 2, 880));
    this.board = {
      x: (width - size) / 2,
      y: (height - size) / 2,
      size,
      cell: size / BOARD_SIZE,
    };

    const random = mulberry32(0x1a5e2c7b);
    const count = Math.round(clamp((width * height) / 10500, 60, 180));
    this.stars = Array.from({ length: count }, () => ({
      x: random() * width,
      y: random() * height,
      r: 0.25 + random() * 1.15,
      phase: random() * TAU,
      speed: 0.4 + random() * 1.2,
      bright: 0.15 + random() * 0.55,
    }));
    this.particles.length = 0;
    this.shockwaves.length = 0;
  }

  cellCenter(x, y) {
    const { x: bx, y: by, cell } = this.board;
    return { x: bx + (x + 0.5) * cell, y: by + (y + 0.5) * cell };
  }

  pointToPixels(point) {
    const { x: bx, y: by, cell } = this.board;
    return { x: bx + point.x * cell, y: by + point.y * cell };
  }

  /** Convert a client-space pointer position to board coordinates. */
  cellAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { x: bx, y: by, cell } = this.board;
    if (x < bx || y < by || x >= bx + cell * BOARD_SIZE || y >= by + cell * BOARD_SIZE) return null;
    return {
      x: Math.floor((x - bx) / cell),
      y: Math.floor((y - by) / cell),
    };
  }

  /** Create an explosion at a grid cell. */
  burst(x, y, owner, { count = 26, power = 1, king = false } = {}) {
    const { x: cx, y: cy } = this.cellCenter(x, y);
    const cell = this.board.cell;
    const palette = COLORS[owner] ?? COLORS.neutral;
    const random = Math.random;
    const total = this.reducedMotion ? Math.round(count * 0.25) : count;
    for (let i = 0; i < total; i += 1) {
      const angle = random() * TAU;
      const speed = (0.6 + random() * 2.2) * power * cell * 2.3;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.35 + random() * 0.7,
        maxLife: 1,
        size: cell * (king ? 0.025 + random() * 0.055 : 0.018 + random() * 0.04),
        color: random() > 0.32 ? palette.soft : '#ffffff',
        drag: 2.8 + random() * 2.5,
      });
    }
    this.shockwaves.push({
      x: cx,
      y: cy,
      life: king ? 1.1 : 0.6,
      maxLife: king ? 1.1 : 0.6,
      radius: cell * (king ? 0.5 : 0.25),
      maxRadius: cell * (king ? 2.5 : 1.05),
      color: palette.main,
      width: king ? 4 : 2,
    });
    if (king) this.shake(1.5);
    else this.shake(0.35 * power);
  }

  /** Small sparks at an exact point in cell coordinates. */
  spark(point, owner, { count = 8, power = 0.55 } = {}) {
    const { x: cx, y: cy } = this.pointToPixels(point);
    const cell = this.board.cell;
    const palette = COLORS[owner] ?? COLORS.neutral;
    const total = this.reducedMotion ? 2 : count;
    for (let i = 0; i < total; i += 1) {
      const angle = Math.random() * TAU;
      const speed = (0.3 + Math.random() * 1.2) * power * cell * 2.3;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.2 + Math.random() * 0.35,
        maxLife: 0.55,
        size: cell * (0.012 + Math.random() * 0.028),
        color: Math.random() > 0.4 ? palette.soft : '#ffffff',
        drag: 3.4,
      });
    }
  }

  shake(amount) {
    if (this.reducedMotion) return;
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  flashScreen(owner, intensity = 0.45) {
    const palette = COLORS[owner] ?? COLORS.neutral;
    this.flash = { rgb: palette.rgb, alpha: intensity };
  }

  clearEffects() {
    this.particles.length = 0;
    this.shockwaves.length = 0;
    this.shakeAmount = 0;
    this.flash = null;
  }

  /* ---------------------------------------------------------------- */
  /* Main draw                                                         */
  /* ---------------------------------------------------------------- */

  draw(state, view, now) {
    const ctx = this.ctx;
    const dt = this.lastFrame ? clamp((now - this.lastFrame) / 1000, 0, 0.05) : 0.016;
    this.lastFrame = now;
    this.updateParticles(dt);

    if (this.shakeAmount > 0.002) {
      this.shakeAmount *= Math.pow(0.0015, dt);
    }

    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackground(now);

    const shake = this.shakeAmount;
    const shakeX = shake > 0.003 ? (Math.random() * 2 - 1) * this.board.cell * 0.06 * shake : 0;
    const shakeY = shake > 0.003 ? (Math.random() * 2 - 1) * this.board.cell * 0.06 * shake : 0;

    ctx.save();
    ctx.translate(shakeX, shakeY);

    this.drawBoard(now, state, view);
    this.drawHighlights(state, view, now);
    this.drawPieces(state, view, now);
    this.drawShockwaves();
    this.drawParticles();
    this.drawLaser(state, view, now);
    this.drawBoardFurniture();

    ctx.restore();

    this.drawFlash();
  }

  updateParticles(dt) {
    if (!this.particles.length && !this.shockwaves.length) return;
    for (const particle of this.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      const damping = Math.exp(-particle.drag * dt);
      particle.vx *= damping;
      particle.vy *= damping;
      particle.life -= dt;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
    for (const wave of this.shockwaves) {
      wave.life -= dt;
      const progress = 1 - clamp(wave.life / wave.maxLife, 0, 1);
      wave.currentRadius = lerp(wave.radius, wave.maxRadius, easeOutCubic(progress));
    }
    this.shockwaves = this.shockwaves.filter((wave) => wave.life > 0);
  }

  drawBackground(now) {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
    gradient.addColorStop(0, '#040814');
    gradient.addColorStop(0.48, '#03050d');
    gradient.addColorStop(1, '#05030a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    const blueGlow = ctx.createRadialGradient(
      this.width * 0.15, -this.height * 0.08, 0,
      this.width * 0.15, -this.height * 0.08, Math.max(this.width, this.height) * 0.62,
    );
    blueGlow.addColorStop(0, 'rgba(35, 91, 180, 0.14)');
    blueGlow.addColorStop(1, 'rgba(35, 91, 180, 0)');
    ctx.fillStyle = blueGlow;
    ctx.fillRect(0, 0, this.width, this.height);

    const redGlow = ctx.createRadialGradient(
      this.width * 0.92, this.height * 1.06, 0,
      this.width * 0.92, this.height * 1.06, Math.max(this.width, this.height) * 0.56,
    );
    redGlow.addColorStop(0, 'rgba(145, 22, 60, 0.12)');
    redGlow.addColorStop(1, 'rgba(145, 22, 60, 0)');
    ctx.fillStyle = redGlow;
    ctx.fillRect(0, 0, this.width, this.height);

    for (const star of this.stars) {
      const twinkle = 0.65 + 0.35 * Math.sin(now * 0.001 * star.speed + star.phase);
      ctx.globalAlpha = star.bright * twinkle;
      ctx.fillStyle = star.r > 1 ? '#cfe8ff' : '#9abde8';
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, TAU);
      ctx.fill();
      if (star.r > 1.1) {
        ctx.globalAlpha *= 0.35;
        ctx.fillRect(star.x - star.r * 2.2, star.y - 0.3, star.r * 4.4, 0.6);
      }
    }
    ctx.globalAlpha = 1;

    // Faint drifting scan-lines.
    ctx.save();
    ctx.globalAlpha = 0.035;
    ctx.strokeStyle = '#7dd2ff';
    ctx.lineWidth = 1;
    const drift = (now * 0.012) % 42;
    for (let y = -42 + drift; y < this.height; y += 42) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBoard(now, state, view) {
    const ctx = this.ctx;
    const { x, y, size, cell } = this.board;

    // Outer halo + frame.
    ctx.save();
    ctx.shadowColor = 'rgba(48, 132, 230, 0.38)';
    ctx.shadowBlur = 36;
    roundedRect(ctx, x - 3, y - 3, size + 6, size + 6, 10);
    ctx.fillStyle = 'rgba(5, 12, 25, 0.9)';
    ctx.fill();
    ctx.restore();

    roundedRect(ctx, x - 1, y - 1, size + 2, size + 2, 9);
    ctx.strokeStyle = 'rgba(93, 173, 255, 0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Cells.
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const alternate = (col + row) % 2 === 0;
        const px = x + col * cell;
        const py = y + row * cell;
        ctx.fillStyle = alternate ? 'rgba(11, 25, 49, 0.76)' : 'rgba(7, 17, 35, 0.8)';
        ctx.fillRect(px, py, cell + 0.5, cell + 0.5);
      }
    }

    // One soft sheen over the whole grid instead of a gradient per cell.
    const sheen = ctx.createLinearGradient(x, y, x + size * 0.35, y + size);
    sheen.addColorStop(0, 'rgba(130, 198, 255, 0.05)');
    sheen.addColorStop(0.45, 'rgba(130, 198, 255, 0)');
    sheen.addColorStop(1, 'rgba(0, 0, 0, 0.07)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x, y, size, size);

    // Mutating sweep of light across the board.
    ctx.save();
    roundedRect(ctx, x, y, size, size, 6);
    ctx.clip();
    const sweepX = ((now * 0.025) % (size * 1.8)) - size * 0.4;
    const sweep = ctx.createLinearGradient(x + sweepX, 0, x + sweepX + size * 0.3, 0);
    sweep.addColorStop(0, 'rgba(105, 190, 255, 0)');
    sweep.addColorStop(0.5, 'rgba(105, 190, 255, 0.035)');
    sweep.addColorStop(1, 'rgba(105, 190, 255, 0)');
    ctx.fillStyle = sweep;
    ctx.fillRect(x, y, size, size);
    ctx.restore();

    // Grid lines.
    ctx.strokeStyle = 'rgba(94, 166, 241, 0.13)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= BOARD_SIZE; i += 1) {
      const offset = i * cell;
      ctx.beginPath();
      ctx.moveTo(x + offset, y);
      ctx.lineTo(x + offset, y + size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y + offset);
      ctx.lineTo(x + size, y + offset);
      ctx.stroke();
    }

    // Army edge accents.
    const topAccent = ctx.createLinearGradient(x, 0, x + size, 0);
    topAccent.addColorStop(0, 'rgba(47, 169, 255, 0)');
    topAccent.addColorStop(0.5, 'rgba(47, 169, 255, 0.8)');
    topAccent.addColorStop(1, 'rgba(47, 169, 255, 0)');
    ctx.fillStyle = topAccent;
    ctx.fillRect(x, y - 1, size, 2);

    const bottomAccent = ctx.createLinearGradient(x, 0, x + size, 0);
    bottomAccent.addColorStop(0, 'rgba(255, 53, 94, 0)');
    bottomAccent.addColorStop(0.5, 'rgba(255, 53, 94, 0.8)');
    bottomAccent.addColorStop(1, 'rgba(255, 53, 94, 0)');
    ctx.fillStyle = bottomAccent;
    ctx.fillRect(x, y + size - 1, size, 2);

    // Corner brackets.
    ctx.strokeStyle = 'rgba(120, 202, 255, 0.52)';
    ctx.lineWidth = 1.5;
    const corner = Math.min(cell * 0.42, 22);
    const corners = [
      [x - 1, y - 1, 1, 1],
      [x + size + 1, y - 1, -1, 1],
      [x - 1, y + size + 1, 1, -1],
      [x + size + 1, y + size + 1, -1, -1],
    ];
    for (const [cx, cy, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + dy * corner);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + dx * corner, cy);
      ctx.stroke();
    }
  }

  drawHighlights(state, view, now) {
    const ctx = this.ctx;
    const { x, y, cell } = this.board;
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.005);

    if (view.lastMove && view.lastMove.type === 'move') {
      const { to } = view.lastMove;
      ctx.save();
      ctx.strokeStyle = 'rgba(140, 210, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      roundedRect(ctx, x + to.x * cell + 3, y + to.y * cell + 3, cell - 6, cell - 6, 5);
      ctx.stroke();
      ctx.restore();
    }

    if (view.selectedId) {
      const piece = state.pieces.find((candidate) => candidate.id === view.selectedId);
      if (piece && !piece.dead) {
        const palette = COLORS[piece.owner];
        const px = x + piece.x * cell;
        const py = y + piece.y * cell;
        const inset = Math.max(2, cell * 0.045);
        const len = cell * 0.23;
        ctx.save();
        ctx.shadowColor = palette.main;
        ctx.shadowBlur = 14;
        ctx.strokeStyle = palette.soft;
        ctx.lineWidth = Math.max(1.4, cell * 0.014);
        ctx.globalAlpha = 0.72 + pulse * 0.28;
        const corners = [
          [px + inset, py + inset, 1, 1],
          [px + cell - inset, py + inset, -1, 1],
          [px + inset, py + cell - inset, 1, -1],
          [px + cell - inset, py + cell - inset, -1, -1],
        ];
        for (const [cx, cy, dx, dy] of corners) {
          ctx.beginPath();
          ctx.moveTo(cx, cy + dy * len);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx + dx * len, cy);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    if (view.hover) {
      const { x: hx, y: hy } = view.hover;
      const isLegal = view.legalMoves.some((move) => move.x === hx && move.y === hy);
      if (isLegal) {
        ctx.save();
        ctx.fillStyle = 'rgba(145, 220, 255, 0.06)';
        ctx.fillRect(x + hx * cell, y + hy * cell, cell, cell);
        ctx.restore();
      } else {
        ctx.save();
        ctx.strokeStyle = 'rgba(140, 195, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + hx * cell + 0.5, y + hy * cell + 0.5, cell - 1, cell - 1);
        ctx.restore();
      }
    }

    for (const move of view.legalMoves) {
      const px = x + (move.x + 0.5) * cell;
      const py = y + (move.y + 0.5) * cell;
      const isHover = view.hover && view.hover.x === move.x && view.hover.y === move.y;
      const radius = cell * (0.125 + pulse * 0.018) * (isHover ? 1.25 : 1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(px, py, 0, px, py, cell * 0.3);
      glow.addColorStop(0, 'rgba(127, 220, 255, 0.22)');
      glow.addColorStop(1, 'rgba(127, 220, 255, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(px - cell * 0.3, py - cell * 0.3, cell * 0.6, cell * 0.6);
      ctx.fillStyle = `rgba(133, 224, 255, ${0.55 + pulse * 0.35})`;
      starPath(ctx, px, py, radius, radius * 0.34, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(180, 238, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  drawPieces(state, view, now) {
    const ctx = this.ctx;
    const ordered = [...state.pieces].sort((a, b) => {
      const rank = { mirror: 0, emitter: 1, king: 2 };
      return rank[a.type] - rank[b.type];
    });
    for (const piece of ordered) {
      if (piece.dead) continue;
      const position = this.visualPosition(piece, view, now);
      const angle = this.visualAngle(piece, view, now);
      const selected = piece.id === view.selectedId;
      this.drawPieceBase(piece, position, now, selected);
      if (piece.type === PIECE_TYPES.KING) this.drawKing(piece, position, now);
      else if (piece.type === PIECE_TYPES.MIRROR) this.drawMirror(piece, position, angle, now);
      else this.drawEmitter(piece, position, angle, now, view);
    }
  }

  visualPosition(piece, view, now) {
    const anim = view.pieceAnims?.get(piece.id);
    if (!anim) return { x: piece.x, y: piece.y };
    const progress = clamp((now - anim.start) / anim.duration, 0, 1);
    if (progress >= 1) return { x: piece.x, y: piece.y };
    const eased = easeInOutCubic(progress);
    return {
      x: lerp(anim.fromX, piece.x, eased),
      y: lerp(anim.fromY, piece.y, eased),
    };
  }

  visualAngle(piece, view, now) {
    const anim = view.angleAnims?.get(piece.id);
    let angle;
    if (anim) {
      const progress = clamp((now - anim.start) / anim.duration, 0, 1);
      angle = lerp(anim.from, anim.to, easeOutCubic(progress));
    } else {
      angle = this.baseAngle(piece);
    }
    return (angle * Math.PI) / 180;
  }

  baseAngle(piece) {
    if (piece.type === PIECE_TYPES.MIRROR) return piece.rot * 90 - 45;
    if (piece.type === PIECE_TYPES.EMITTER) return piece.rot * 90 - 90;
    return 0;
  }

  drawPieceBase(piece, position, now, selected) {
    const ctx = this.ctx;
    const cell = this.board.cell;
    const palette = COLORS[piece.owner];
    const { x: cx, y: cy } = this.cellCenter(position.x, position.y);
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.0027 + piece.x * 0.8 + piece.y * 0.5);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const radius = cell * (selected ? 0.57 : 0.5);
    const glow = ctx.createRadialGradient(cx, cy, cell * 0.06, cx, cy, radius);
    glow.addColorStop(0, `rgba(${palette.rgb}, ${selected ? 0.2 : 0.1 + pulse * 0.035})`);
    glow.addColorStop(0.55, `rgba(${palette.rgb}, ${selected ? 0.055 : 0.025})`);
    glow.addColorStop(1, `rgba(${palette.rgb}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();

    // Faint hex base plate.
    ctx.save();
    ctx.translate(cx, cy);
    polygon(ctx, 0, 0, cell * 0.3, 6, -Math.PI / 2);
    ctx.fillStyle = 'rgba(3, 8, 17, 0.5)';
    ctx.fill();
    ctx.strokeStyle = `rgba(${palette.rgb}, ${selected ? 0.42 : 0.16})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  drawKing(piece, position, now) {
    const ctx = this.ctx;
    const cell = this.board.cell;
    const palette = COLORS[piece.owner];
    const { x: cx, y: cy } = this.cellCenter(position.x, position.y);
    const s = cell;

    ctx.save();
    ctx.translate(cx, cy);

    // Targeting reticle.
    ctx.save();
    ctx.rotate(now * 0.00012);
    ctx.strokeStyle = `rgba(${palette.rgb}, 0.42)`;
    ctx.lineWidth = 1;
    ctx.setLineDash([2.5, 5.5]);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.375, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // Outer hex plate.
    const plate = ctx.createLinearGradient(0, -s * 0.3, 0, s * 0.3);
    plate.addColorStop(0, 'rgba(19, 34, 57, 0.98)');
    plate.addColorStop(1, palette.deep);
    polygon(ctx, 0, 0, s * 0.33, 6, -Math.PI / 2);
    ctx.fillStyle = plate;
    ctx.shadowColor = palette.main;
    ctx.shadowBlur = s * 0.14;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(${palette.softRgb}, 0.9)`;
    ctx.lineWidth = Math.max(1.3, s * 0.014);
    ctx.stroke();

    // Inner ring.
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.245, 0, TAU);
    ctx.strokeStyle = `rgba(${palette.rgb}, 0.28)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Crown.
    const crown = ctx.createLinearGradient(0, -s * 0.2, 0, s * 0.15);
    crown.addColorStop(0, palette.light);
    crown.addColorStop(0.4, palette.soft);
    crown.addColorStop(1, palette.main);
    ctx.save();
    ctx.shadowColor = palette.main;
    ctx.shadowBlur = s * 0.12;
    ctx.beginPath();
    ctx.moveTo(-s * 0.19, s * 0.1);
    ctx.lineTo(-s * 0.155, -s * 0.11);
    ctx.lineTo(-s * 0.06, s * 0.015);
    ctx.lineTo(0, -s * 0.185);
    ctx.lineTo(s * 0.06, s * 0.015);
    ctx.lineTo(s * 0.155, -s * 0.11);
    ctx.lineTo(s * 0.19, s * 0.1);
    ctx.closePath();
    ctx.fillStyle = crown;
    ctx.fill();
    ctx.restore();

    // Crown base + jewels.
    roundedRect(ctx, -s * 0.195, s * 0.085, s * 0.39, s * 0.045, s * 0.012);
    ctx.fillStyle = palette.main;
    ctx.fill();
    ctx.strokeStyle = `rgba(${palette.softRgb}, 0.75)`;
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    for (const [jx, jy] of [[-s * 0.155, -s * 0.115], [0, -s * 0.19], [s * 0.155, -s * 0.115]]) {
      ctx.beginPath();
      ctx.arc(jx, jy, s * 0.018, 0, TAU);
      ctx.fill();
    }

    // Center gem.
    ctx.save();
    ctx.shadowColor = palette.light;
    ctx.shadowBlur = s * 0.1;
    ctx.fillStyle = palette.light;
    ctx.beginPath();
    ctx.arc(0, s * 0.052, s * 0.022, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  drawMirror(piece, position, angle, now) {
    const ctx = this.ctx;
    const cell = this.board.cell;
    const palette = COLORS[piece.owner];
    const { x: cx, y: cy } = this.cellCenter(position.x, position.y);
    const s = cell;
    const half = s * 0.31;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Dark back plate (vulnerable side, local +y).
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(${palette.rgb}, 0.22)`;
    ctx.lineWidth = s * 0.16;
    ctx.beginPath();
    ctx.moveTo(-half, s * 0.02);
    ctx.lineTo(half, s * 0.02);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(2, 6, 13, 0.92)';
    ctx.lineWidth = s * 0.105;
    ctx.beginPath();
    ctx.moveTo(-half * 0.96, s * 0.02);
    ctx.lineTo(half * 0.96, s * 0.02);
    ctx.stroke();
    ctx.restore();

    // Rear hazard stripe.
    ctx.save();
    ctx.strokeStyle = `rgba(${palette.rgb}, 0.58)`;
    ctx.lineWidth = Math.max(1, s * 0.012);
    ctx.setLineDash([s * 0.035, s * 0.042]);
    ctx.beginPath();
    ctx.moveTo(-half * 0.62, s * 0.112);
    ctx.lineTo(half * 0.62, s * 0.112);
    ctx.stroke();
    ctx.restore();

    // Reflective face (local -y), a bright glassy slab.
    ctx.save();
    ctx.shadowColor = palette.soft;
    ctx.shadowBlur = s * 0.14;
    ctx.lineCap = 'round';
    const face = ctx.createLinearGradient(-half, 0, half, 0);
    face.addColorStop(0, palette.main);
    face.addColorStop(0.28, '#ffffff');
    face.addColorStop(0.5, palette.soft);
    face.addColorStop(0.72, '#ffffff');
    face.addColorStop(1, palette.main);
    ctx.strokeStyle = face;
    ctx.lineWidth = s * 0.052;
    ctx.beginPath();
    ctx.moveTo(-half, -s * 0.012);
    ctx.lineTo(half, -s * 0.012);
    ctx.stroke();
    ctx.restore();

    // Front arc, pointing towards the reflective side.
    ctx.save();
    ctx.strokeStyle = `rgba(${palette.softRgb}, 0.66)`;
    ctx.shadowColor = palette.main;
    ctx.shadowBlur = s * 0.1;
    ctx.lineWidth = Math.max(1, s * 0.016);
    ctx.beginPath();
    ctx.arc(0, s * 0.02, s * 0.19, Math.PI * 1.13, Math.PI * 1.87);
    ctx.stroke();
    ctx.restore();

    // End caps.
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.shadowColor = palette.soft;
      ctx.shadowBlur = s * 0.08;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(side * half, -s * 0.012, s * 0.022, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // Subtle pulse on the face.
    const pulse = 0.12 + 0.08 * Math.sin(now * 0.004 + piece.x);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `rgba(${palette.softRgb}, ${pulse})`;
    ctx.lineWidth = s * 0.11;
    ctx.beginPath();
    ctx.moveTo(-half * 0.9, -s * 0.012);
    ctx.lineTo(half * 0.9, -s * 0.012);
    ctx.stroke();

    ctx.restore();
  }

  drawEmitter(piece, position, angle, now, view) {
    const ctx = this.ctx;
    const cell = this.board.cell;
    const palette = COLORS[piece.owner];
    const { x: cx, y: cy } = this.cellCenter(position.x, position.y);
    const s = cell;
    const charging = view.laser
      && view.laser.owner === piece.owner
      && now >= view.laser.startedAt
      && now < view.laser.startedAt + view.laser.chargeMs;
    const chargeProgress = charging
      ? clamp((now - view.laser.startedAt) / view.laser.chargeMs, 0, 1)
      : 0;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Base.
    const base = ctx.createLinearGradient(0, -s * 0.27, 0, s * 0.27);
    base.addColorStop(0, 'rgba(22, 40, 65, 0.98)');
    base.addColorStop(1, palette.deep);
    polygon(ctx, 0, 0, s * 0.29, 8, Math.PI / 8);
    ctx.fillStyle = base;
    ctx.shadowColor = palette.main;
    ctx.shadowBlur = s * (charging ? 0.23 : 0.1);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(${palette.softRgb}, 0.78)`;
    ctx.lineWidth = Math.max(1.2, s * 0.013);
    ctx.stroke();

    // Barrel (local +x).
    const barrelLength = s * 0.33;
    roundedRect(ctx, s * 0.045, -s * 0.075, barrelLength, s * 0.15, s * 0.035);
    const barrel = ctx.createLinearGradient(0, -s * 0.08, 0, s * 0.08);
    barrel.addColorStop(0, palette.soft);
    barrel.addColorStop(0.45, palette.main);
    barrel.addColorStop(1, palette.deep);
    ctx.fillStyle = barrel;
    ctx.fill();
    ctx.strokeStyle = `rgba(${palette.softRgb}, 0.8)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Muzzle ring.
    ctx.beginPath();
    ctx.arc(s * 0.375, 0, s * 0.062, 0, TAU);
    ctx.fillStyle = '#08111f';
    ctx.fill();
    ctx.strokeStyle = palette.light;
    ctx.lineWidth = Math.max(1, s * 0.012);
    ctx.stroke();

    // Core.
    ctx.save();
    ctx.shadowColor = palette.light;
    ctx.shadowBlur = s * (charging ? 0.3 : 0.1);
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.1);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.45, palette.soft);
    core.addColorStop(1, palette.main);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.088, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (charging) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.55 + 0.45 * Math.sin(now * 0.045);
      const glow = ctx.createRadialGradient(s * 0.375, 0, 0, s * 0.375, 0, s * 0.32);
      glow.addColorStop(0, `rgba(255, 255, 255, ${0.4 + chargeProgress * 0.4})`);
      glow.addColorStop(0.3, `rgba(${palette.softRgb}, ${0.32 * pulse})`);
      glow.addColorStop(1, `rgba(${palette.rgb}, 0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(s * 0.05, -s * 0.34, s * 0.7, s * 0.68);
      ctx.strokeStyle = `rgba(${palette.softRgb}, ${0.4 + pulse * 0.2})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(s * 0.375, 0, s * (0.14 + chargeProgress * 0.08), 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    // Direction fletching on the rear.
    ctx.strokeStyle = `rgba(${palette.softRgb}, 0.45)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-s * 0.22, -s * 0.09);
    ctx.lineTo(-s * 0.13, 0);
    ctx.lineTo(-s * 0.22, s * 0.09);
    ctx.stroke();

    ctx.restore();
  }

  drawLaser(state, view, now) {
    const ctx = this.ctx;
    const laser = view.laser;
    if (!laser) return;
    const elapsed = now - laser.startedAt;
    if (elapsed < 0) return;

    const chargeEnd = laser.chargeMs;
    const travelEnd = chargeEnd + laser.travelMs;
    const holdEnd = travelEnd + laser.holdMs;
    const fadeEnd = holdEnd + laser.fadeMs;

    if (elapsed > fadeEnd) return;

    if (elapsed < chargeEnd) {
      this.drawChargeAura(laser, state, now, elapsed / chargeEnd);
      return;
    }

    let progress = 1;
    let alpha = 1;
    if (elapsed < travelEnd) {
      progress = clamp((elapsed - chargeEnd) / laser.travelMs, 0, 1);
    } else if (elapsed >= holdEnd) {
      alpha = 1 - clamp((elapsed - holdEnd) / laser.fadeMs, 0, 1);
    }

    const points = laser.shot.points.map((point) => this.pointToPixels(point));
    if (points.length < 2) return;

    const lengths = [];
    let totalLength = 0;
    for (let i = 1; i < points.length; i += 1) {
      const length = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      lengths.push(length);
      totalLength += length;
    }

    const target = totalLength * progress;
    const partial = [points[0]];
    let walked = 0;
    let head = points[0];
    for (let i = 1; i < points.length; i += 1) {
      const segment = lengths[i - 1];
      if (walked + segment < target) {
        partial.push(points[i]);
        walked += segment;
      } else {
        const t = segment > 0 ? (target - walked) / segment : 0;
        head = {
          x: lerp(points[i - 1].x, points[i].x, t),
          y: lerp(points[i - 1].y, points[i].y, t),
        };
        partial.push(head);
        break;
      }
    }
    if (progress >= 1) head = points[points.length - 1];

    const palette = COLORS[laser.owner];
    const cell = this.board.cell;
    const flicker = 0.85 + 0.15 * Math.sin(now * 0.06);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Broad atmospheric halo.
    ctx.save();
    ctx.strokeStyle = `rgba(${palette.rgb}, 0.1)`;
    ctx.lineWidth = cell * 0.42 * flicker;
    ctx.shadowColor = palette.main;
    ctx.shadowBlur = cell * 0.5;
    this.tracePath(partial);
    ctx.stroke();
    ctx.restore();

    // Coloured beam body.
    ctx.strokeStyle = `rgba(${palette.rgb}, 0.48)`;
    ctx.lineWidth = cell * 0.135 * flicker;
    ctx.shadowColor = palette.main;
    ctx.shadowBlur = cell * 0.32;
    this.tracePath(partial);
    ctx.stroke();

    // White-hot core.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.lineWidth = Math.max(1.4, cell * 0.034);
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = cell * 0.14;
    this.tracePath(partial);
    ctx.stroke();

    // Secondary thin core line for extra bloom.
    ctx.strokeStyle = `rgba(${palette.softRgb}, 0.75)`;
    ctx.lineWidth = Math.max(0.8, cell * 0.012);
    ctx.shadowBlur = 0;
    this.tracePath(partial);
    ctx.stroke();

    // Beam head.
    if (progress < 1) {
      const headGlow = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, cell * 0.35);
      headGlow.addColorStop(0, 'rgba(255, 255, 255, 1)');
      headGlow.addColorStop(0.18, `rgba(${palette.softRgb}, 0.95)`);
      headGlow.addColorStop(0.48, `rgba(${palette.rgb}, 0.32)`);
      headGlow.addColorStop(1, `rgba(${palette.rgb}, 0)`);
      ctx.fillStyle = headGlow;
      ctx.fillRect(head.x - cell * 0.35, head.y - cell * 0.35, cell * 0.7, cell * 0.7);

      // Occasional travelling sparks.
      if (!this.reducedMotion && Math.random() < 0.7) {
        const angle = Math.random() * TAU;
        const speed = cell * (0.5 + Math.random() * 1.3);
        this.particles.push({
          x: head.x,
          y: head.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.12 + Math.random() * 0.2,
          maxLife: 0.32,
          size: cell * (0.01 + Math.random() * 0.022),
          color: Math.random() > 0.45 ? '#ffffff' : palette.soft,
          drag: 3.8,
        });
      }
    }

    // Reflection corner flares.
    if (progress > 0.02) {
      for (const event of laser.shot.events) {
        if (event.kind !== 'reflect' && event.kind !== 'destroy' && event.kind !== 'kingHit') continue;
        const eventPoint = laser.shot.points[event.index];
        if (!eventPoint) continue;
        const reached = this.pathReached(laser.shot.points, event.index, progress, target);
        if (!reached) continue;
        const flare = this.pointToPixels(eventPoint);
        const radius = cell * (event.kind === 'reflect' ? 0.2 : 0.26);
        const flareGradient = ctx.createRadialGradient(flare.x, flare.y, 0, flare.x, flare.y, radius);
        flareGradient.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
        flareGradient.addColorStop(0.25, `rgba(${palette.softRgb}, 0.5)`);
        flareGradient.addColorStop(1, `rgba(${palette.rgb}, 0)`);
        ctx.fillStyle = flareGradient;
        ctx.fillRect(flare.x - radius, flare.y - radius, radius * 2, radius * 2);
      }
    }

    ctx.restore();
  }

  pathReached(points, index, progress, target) {
    if (progress >= 1) return true;
    // Convert the event's point index into a distance and compare with the head.
    let distance = 0;
    for (let i = 1; i <= index; i += 1) {
      distance += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return distance <= target + 0.001;
  }

  tracePath(points) {
    const ctx = this.ctx;
    ctx.beginPath();
    if (!points.length) return;
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  }

  drawChargeAura(laser, state, now, progress) {
    const ctx = this.ctx;
    const emitter = state.pieces.find((piece) => piece.id === laser.shot.emitterId);
    if (!emitter) return;
    const palette = COLORS[laser.owner];
    const cell = this.board.cell;
    const { x: cx, y: cy } = this.cellCenter(emitter.x, emitter.y);
    const pulse = 0.6 + 0.4 * Math.sin(now * 0.05);
    const radius = cell * (0.24 + progress * 0.18);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.6);
    glow.addColorStop(0, `rgba(255, 255, 255, ${0.5 * progress + 0.1})`);
    glow.addColorStop(0.28, `rgba(${palette.softRgb}, ${(0.3 + progress * 0.35) * pulse})`);
    glow.addColorStop(1, `rgba(${palette.rgb}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius * 1.7, cy - radius * 1.7, radius * 3.4, radius * 3.4);

    ctx.strokeStyle = `rgba(${palette.softRgb}, ${0.5 * (1 - progress) + 0.2})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * (0.52 - progress * 0.18), 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  drawBoardFurniture() {
    const ctx = this.ctx;
    const { x, y, size, cell } = this.board;
    const offset = clamp(cell * 0.24, 9, 14);
    const font = Math.max(8, Math.min(10, cell * 0.175));
    ctx.save();
    ctx.fillStyle = 'rgba(135, 178, 224, 0.58)';
    ctx.font = `${font}px ui-monospace, "SFMono-Regular", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Column letters.
    for (let i = 0; i < BOARD_SIZE; i += 1) {
      const label = String.fromCharCode(65 + i);
      ctx.fillText(label, x + (i + 0.5) * cell, y + size + offset);
    }
    // Row numbers.
    ctx.textAlign = 'right';
    for (let i = 0; i < BOARD_SIZE; i += 1) {
      ctx.fillText(String(i + 1), x - offset, y + (i + 0.5) * cell);
    }
    ctx.restore();
  }

  drawShockwaves() {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const wave of this.shockwaves) {
      const alpha = clamp(wave.life / wave.maxLife, 0, 1);
      ctx.strokeStyle = wave.color;
      ctx.globalAlpha = alpha * 0.42;
      ctx.lineWidth = wave.width * alpha;
      ctx.beginPath();
      ctx.arc(wave.x, wave.y, wave.currentRadius ?? wave.radius, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawParticles() {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const particle of this.particles) {
      const alpha = clamp(particle.life / (particle.maxLife || 0.6), 0, 1);
      ctx.fillStyle = particle.color;
      // Cheap two-pass glow: no per-particle shadow blur.
      ctx.globalAlpha = alpha * 0.22;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * 2.8, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawFlash() {
    if (!this.flash) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gradient = ctx.createRadialGradient(
      this.width * 0.5, this.height * 0.5, 0,
      this.width * 0.5, this.height * 0.5, Math.max(this.width, this.height) * 0.7,
    );
    gradient.addColorStop(0, `rgba(${this.flash.rgb}, ${this.flash.alpha * 0.55})`);
    gradient.addColorStop(0.5, `rgba(${this.flash.rgb}, ${this.flash.alpha * 0.1})`);
    gradient.addColorStop(1, `rgba(${this.flash.rgb}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
    this.flash.alpha *= 0.9;
    if (this.flash.alpha < 0.01) this.flash = null;
  }
}

export const BOARD_COLORS = COLORS;
