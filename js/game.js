/**
 * LASER CHESS — rules engine.
 *
 * This module is deliberately free of DOM/rendering code so the rules can be
 * unit-tested in isolation. Coordinates use x = 0..7 (left → right) and
 * y = 0..7 (top → bottom). Red starts at the bottom, blue at the top.
 */

export const BOARD_SIZE = 8;

/** Direction indices: 0 = up, 1 = right, 2 = down, 3 = left. */
export const DIRECTIONS = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: -1, y: 0 }),
]);

export const DIRECTION_NAMES = Object.freeze(['UP', 'RIGHT', 'DOWN', 'LEFT']);

/** Movement is 8-way; lasers still travel only along the four cardinals. */
export const MOVE_DIRECTIONS = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: 1, y: -1 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 1, y: 1 }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: -1, y: 1 }),
  Object.freeze({ x: -1, y: 0 }),
  Object.freeze({ x: -1, y: -1 }),
]);

/**
 * A mirror has four 90° facings (two diagonal silhouettes). `rot` names the
 * side that carries the reflective face:
 *   0 = NW ("/"), 1 = NE ("\\"), 2 = SE ("/"), 3 = SW ("\\").
 * A beam entering through the reflective face is deflected 90°. A beam that
 * enters through the dark back shatters the mirror and stops.
 */
export const MIRROR_FACE_NAMES = Object.freeze(['NORTH-WEST', 'NORTH-EAST', 'SOUTH-EAST', 'SOUTH-WEST']);
export const MIRROR_FACE_SHORT = Object.freeze(['NW', 'NE', 'SE', 'SW']);

/** Outward unit normal of each mirror's reflective face. */
export const MIRROR_FRONT_NORMALS = Object.freeze([
  Object.freeze({ x: -1, y: -1 }),
  Object.freeze({ x: 1, y: -1 }),
  Object.freeze({ x: 1, y: 1 }),
  Object.freeze({ x: -1, y: 1 }),
]);

export const PIECE_TYPES = Object.freeze({
  KING: 'king',
  MIRROR: 'mirror',
  EMITTER: 'emitter',
});

export const SIDES = Object.freeze({
  red: Object.freeze({ name: 'RED', label: "RED'S TURN", color: '#ff355e', soft: '#ff7e97' }),
  blue: Object.freeze({ name: 'BLUE', label: "BLUE'S TURN", color: '#2fa9ff', soft: '#82d4ff' }),
});

export const otherSide = (side) => (side === 'red' ? 'blue' : 'red');

export class RulesError extends Error {}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

/**
 * Starting formation. The armies are point-symmetric (180° rotation), so the
 * opening is perfectly fair. The emitters do not begin aimed at a king, which
 * leaves room for the mirror game to develop.
 */
const STARTING_PIECES = Object.freeze([
  // Blue — top
  { id: 'blue-king', type: 'king', owner: 'blue', x: 3, y: 0, rot: 0 },
  { id: 'blue-emitter', type: 'emitter', owner: 'blue', x: 3, y: 1, rot: 2 },
  { id: 'blue-mirror-1', type: 'mirror', owner: 'blue', x: 2, y: 2, rot: 3 },
  { id: 'blue-mirror-2', type: 'mirror', owner: 'blue', x: 5, y: 2, rot: 2 },
  { id: 'blue-mirror-3', type: 'mirror', owner: 'blue', x: 2, y: 4, rot: 3 },
  { id: 'blue-mirror-4', type: 'mirror', owner: 'blue', x: 5, y: 4, rot: 2 },

  // Red — bottom
  { id: 'red-king', type: 'king', owner: 'red', x: 4, y: 7, rot: 0 },
  { id: 'red-emitter', type: 'emitter', owner: 'red', x: 4, y: 6, rot: 0 },
  { id: 'red-mirror-1', type: 'mirror', owner: 'red', x: 2, y: 5, rot: 0 },
  { id: 'red-mirror-2', type: 'mirror', owner: 'red', x: 5, y: 5, rot: 1 },
  { id: 'red-mirror-3', type: 'mirror', owner: 'red', x: 2, y: 3, rot: 0 },
  { id: 'red-mirror-4', type: 'mirror', owner: 'red', x: 5, y: 3, rot: 1 },
]);

export function createGame() {
  return {
    pieces: STARTING_PIECES.map((piece) => ({ ...piece })),
    turn: 'red',
    actionUsed: false,
    winner: null,
    turnNumber: 1,
    lastAction: null,
    lastShot: null,
    moveCount: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export function isInside(x, y) {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

export function pieceAt(state, x, y) {
  return state.pieces.find((piece) => !piece.dead && piece.x === x && piece.y === y) ?? null;
}

export function pieceById(state, id) {
  return state.pieces.find((piece) => piece.id === id) ?? null;
}

export function getKing(state, owner) {
  return state.pieces.find((piece) => piece.type === PIECE_TYPES.KING && piece.owner === owner && !piece.dead) ?? null;
}

export function getEmitter(state, owner) {
  return state.pieces.find((piece) => piece.type === PIECE_TYPES.EMITTER && piece.owner === owner && !piece.dead) ?? null;
}

export function canRotatePiece(state, piece) {
  return Boolean(
    piece
    && !state.winner
    && !state.actionUsed
    && piece.owner === state.turn
    && (piece.type === PIECE_TYPES.MIRROR || piece.type === PIECE_TYPES.EMITTER),
  );
}

/** All empty, adjacent squares a piece may slide into. Movement is 8-way. */
export function legalMoves(state, piece) {
  if (!piece || state.winner || state.actionUsed || piece.owner !== state.turn) return [];
  const moves = [];
  for (const direction of MOVE_DIRECTIONS) {
    const x = piece.x + direction.x;
    const y = piece.y + direction.y;
    if (isInside(x, y) && !pieceAt(state, x, y)) moves.push({ x, y });
  }
  return moves;
}

export function canSelectPiece(state, piece, { forAction = true } = {}) {
  if (!piece || piece.dead || state.winner) return false;
  if (piece.owner !== state.turn) return false;
  if (!forAction) return true;
  return !state.actionUsed;
}

export function describePiece(piece) {
  if (!piece) return { title: 'NO PIECE SELECTED', text: 'Tap one of your pieces to reveal its moves.' };
  const side = SIDES[piece.owner];
  if (piece.type === PIECE_TYPES.KING) {
    return {
      title: `${side.name} KING`,
      text: 'Move one tile in any direction. One enemy beam hit ends the match.',
    };
  }
  if (piece.type === PIECE_TYPES.EMITTER) {
    return {
      title: `${side.name} EMITTER // ${DIRECTION_NAMES[piece.rot]}`,
      text: 'Fires forward when you press FIRE. Rotate the barrel to aim it.',
    };
  }
  return {
    title: `${side.name} MIRROR // FACE ${MIRROR_FACE_SHORT[piece.rot]}`,
    text: 'Bright face reflects the beam. Dark back shatters. Rotate 90° or move one tile.',
  };
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export function movePiece(state, piece, x, y) {
  const legal = legalMoves(state, piece).some((move) => move.x === x && move.y === y);
  if (!legal) throw new RulesError('That move is not legal.');
  const from = { x: piece.x, y: piece.y };
  piece.x = x;
  piece.y = y;
  state.actionUsed = true;
  state.moveCount += 1;
  state.lastAction = { type: 'move', pieceId: piece.id, owner: piece.owner, from, to: { x, y } };
  return state.lastAction;
}

export function rotatePiece(state, piece) {
  if (!canRotatePiece(state, piece)) throw new RulesError('That piece cannot rotate now.');
  const from = piece.rot;
  piece.rot = (piece.rot + 1) % 4;
  state.actionUsed = true;
  state.lastAction = { type: 'rotate', pieceId: piece.id, owner: piece.owner, from, to: piece.rot, x: piece.x, y: piece.y };
  return state.lastAction;
}

export function endTurn(state) {
  state.turn = otherSide(state.turn);
  state.actionUsed = false;
  if (state.turn === 'red') state.turnNumber += 1;
  return state.turn;
}

export function removePiece(state, id) {
  const index = state.pieces.findIndex((piece) => piece.id === id);
  if (index === -1) return null;
  const [removed] = state.pieces.splice(index, 1);
  return removed;
}

export function markKingDead(state, owner) {
  const king = getKing(state, owner);
  if (!king) return null;
  king.dead = true;
  return king;
}

/* ------------------------------------------------------------------ */
/* Laser physics                                                       */
/* ------------------------------------------------------------------ */

/** True when a beam travelling in `incomingDir` meets the reflective face. */
export function isMirrorFront(rot, incomingDir) {
  const normal = MIRROR_FRONT_NORMALS[rot];
  const direction = DIRECTIONS[incomingDir];
  return direction.x * normal.x + direction.y * normal.y < 0;
}

/**
 * Reflect a cardinal direction off a diagonal mirror.
 * The reflective plane is perpendicular to the mirror's front normal, so a
 * standard vector reflection gives the outgoing direction.
 */
export function reflectDirection(rot, incomingDir) {
  const normal = MIRROR_FRONT_NORMALS[rot];
  const direction = DIRECTIONS[incomingDir];
  const dot = direction.x * normal.x + direction.y * normal.y;
  const out = {
    x: direction.x - dot * normal.x,
    y: direction.y - dot * normal.y,
  };
  const index = DIRECTIONS.findIndex((candidate) => candidate.x === out.x && candidate.y === out.y);
  return index === -1 ? incomingDir : index;
}

const center = (x, y) => ({ x: x + 0.5, y: y + 0.5 });

/**
 * Trace a shot without mutating the game. The returned `points` are in cell
 * coordinates (the board spans 0..8) and the `events` refer to point indices,
 * which lets the renderer synchronise destruction with the travelling beam.
 */
export function traceLaser(state, owner = state.turn) {
  const emitter = getEmitter(state, owner);
  const shot = {
    owner,
    emitterId: emitter?.id ?? null,
    points: [],
    events: [],
    winner: null,
    endReason: 'none',
  };
  if (!emitter) {
    shot.endReason = 'no-emitter';
    return shot;
  }

  let x = emitter.x;
  let y = emitter.y;
  let dir = emitter.rot;
  const points = shot.points;
  const events = shot.events;
  const seenMirrorStates = new Set();
  points.push(center(x, y));

  for (let guard = 0; guard < 256; guard += 1) {
    const direction = DIRECTIONS[dir];
    const nx = x + direction.x;
    const ny = y + direction.y;

    // Board boundary: stop exactly on the edge.
    if (!isInside(nx, ny)) {
      points.push({ x: x + 0.5 + direction.x * 0.5, y: y + 0.5 + direction.y * 0.5 });
      events.push({ kind: 'wall', index: points.length - 1, x: nx, y: ny, dir });
      shot.endReason = 'wall';
      return shot;
    }

    points.push(center(nx, ny));
    const index = points.length - 1;
    const piece = pieceAt(state, nx, ny);

    if (!piece) {
      x = nx;
      y = ny;
      continue;
    }

    if (piece.type === PIECE_TYPES.KING) {
      if (piece.owner !== owner) {
        events.push({ kind: 'kingHit', index, owner: piece.owner, pieceId: piece.id, x: nx, y: ny });
        shot.winner = owner;
        shot.endReason = 'king-hit';
      } else {
        events.push({ kind: 'absorb', index, owner: piece.owner, pieceId: piece.id, x: nx, y: ny });
        shot.endReason = 'own-king';
      }
      return shot;
    }

    if (piece.type === PIECE_TYPES.EMITTER) {
      events.push({ kind: 'absorb', index, owner: piece.owner, pieceId: piece.id, x: nx, y: ny });
      shot.endReason = 'emitter';
      return shot;
    }

    if (piece.type === PIECE_TYPES.MIRROR) {
      const stateKey = `${nx},${ny},${dir}`;
      if (seenMirrorStates.has(stateKey)) {
        events.push({ kind: 'loop', index, x: nx, y: ny, owner: piece.owner });
        shot.endReason = 'loop';
        return shot;
      }

      if (!isMirrorFront(piece.rot, dir)) {
        // The vulnerable back is hit: the mirror shatters and blocks the beam.
        events.push({
          kind: 'destroy',
          index,
          pieceId: piece.id,
          owner: piece.owner,
          x: nx,
          y: ny,
          rot: piece.rot,
          shooter: owner,
        });
        shot.endReason = 'mirror-destroyed';
        return shot;
      }

      seenMirrorStates.add(stateKey);
      const outgoing = reflectDirection(piece.rot, dir);
      events.push({ kind: 'reflect', index, x: nx, y: ny, owner: piece.owner, rot: piece.rot, incoming: dir, outgoing });
      dir = outgoing;
      x = nx;
      y = ny;
      continue;
    }
  }

  events.push({ kind: 'loop', index: points.length - 1, x, y });
  shot.endReason = 'loop';
  return shot;
}

/** Path length in board cells, used by the renderer's timing. */
export function shotLength(shot) {
  let length = 0;
  for (let i = 1; i < shot.points.length; i += 1) {
    length += Math.hypot(shot.points[i].x - shot.points[i - 1].x, shot.points[i].y - shot.points[i - 1].y);
  }
  return length;
}
