import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOARD_SIZE,
  DIRECTIONS,
  PIECE_TYPES,
  canRotatePiece,
  createGame,
  endTurn,
  getEmitter,
  getKing,
  isInside,
  isMirrorFront,
  legalMoves,
  movePiece,
  pieceAt,
  reflectDirection,
  rotatePiece,
  traceLaser,
} from '../js/game.js';

/** Build a minimal valid state for focused physics tests. */
function customState(pieces, turn = 'red') {
  return {
    pieces: pieces.map((piece, index) => ({
      id: piece.id ?? `piece-${index}`,
      rot: 0,
      ...piece,
    })),
    turn,
    actionUsed: false,
    winner: null,
    turnNumber: 1,
    lastAction: null,
    moveCount: 0,
  };
}

const emitter = (x, y, rot, owner = 'red') => ({ id: `${owner}-emitter`, type: 'emitter', owner, x, y, rot });
const mirror = (x, y, rot, owner = 'blue', id) => ({ id: id ?? `${owner}-mirror-${x}-${y}`, type: 'mirror', owner, x, y, rot });
const king = (x, y, owner) => ({ id: `${owner}-king`, type: 'king', owner, x, y, rot: 0 });

const endOf = (shot) => shot.events[shot.events.length - 1];
const reflectEvent = (shot) => shot.events.find((event) => event.kind === 'reflect');

test('board setup is complete and point-symmetric', () => {
  const state = createGame();
  assert.equal(state.pieces.length, 12);

  for (const owner of ['red', 'blue']) {
    assert.equal(state.pieces.filter((piece) => piece.owner === owner && piece.type === PIECE_TYPES.KING).length, 1);
    assert.equal(state.pieces.filter((piece) => piece.owner === owner && piece.type === PIECE_TYPES.EMITTER).length, 1);
    assert.equal(state.pieces.filter((piece) => piece.owner === owner && piece.type === PIECE_TYPES.MIRROR).length, 4);
  }

  const occupied = new Set();
  for (const piece of state.pieces) {
    assert.ok(isInside(piece.x, piece.y));
    const key = `${piece.x},${piece.y}`;
    assert.ok(!occupied.has(key), `duplicate piece at ${key}`);
    occupied.add(key);

    // A 180° rotation maps every red piece onto its blue counterpart.
    const counterpart = state.pieces.find((candidate) => (
      candidate.owner !== piece.owner
      && candidate.type === piece.type
      && candidate.x === BOARD_SIZE - 1 - piece.x
      && candidate.y === BOARD_SIZE - 1 - piece.y
    ));
    assert.ok(counterpart, `missing symmetric counterpart for ${piece.id}`);
  }

  assert.equal(state.turn, 'red');
  assert.equal(state.actionUsed, false);
  assert.ok(getKing(state, 'red'));
  assert.ok(getKing(state, 'blue'));
  assert.ok(getEmitter(state, 'red'));
  assert.ok(getEmitter(state, 'blue'));
});

test('initial shots do not instantly hit a king', () => {
  const state = createGame();
  const redShot = traceLaser(state, 'red');
  const blueShot = traceLaser(state, 'blue');
  assert.equal(redShot.winner, null);
  assert.equal(blueShot.winner, null);
  assert.equal(redShot.endReason, 'wall');
  assert.equal(blueShot.endReason, 'wall');
});

test('legal movement is 8-way, bounded, empty-only and limited to the active side', () => {
  const state = customState([king(0, 0, 'red'), king(7, 7, 'blue'), mirror(1, 0, 0, 'red')]);
  const redKing = getKing(state, 'red');
  assert.deepEqual(
    legalMoves(state, redKing).sort((a, b) => a.y - b.y || a.x - b.x),
    [{ x: 0, y: 1 }, { x: 1, y: 1 }].sort((a, b) => a.y - b.y || a.x - b.x),
  );

  const redMirror = pieceAt(state, 1, 0);
  assert.equal(legalMoves(state, redMirror).some((move) => move.x === 0 && move.y === 0), false);
  assert.equal(legalMoves(state, getKing(state, 'blue')).length, 0, 'cannot move the enemy king');
});

test('moving consumes the action and turns alternate after firing', () => {
  const state = createGame();
  const piece = pieceAt(state, 2, 5);
  const before = state.turn;
  movePiece(state, piece, 1, 5);
  assert.equal(piece.x, 1);
  assert.equal(state.actionUsed, true);
  assert.throws(() => movePiece(state, piece, 0, 5), /not legal/i);
  assert.equal(legalMoves(state, piece).length, 0);

  endTurn(state);
  assert.notEqual(state.turn, before);
  assert.equal(state.actionUsed, false);
  assert.equal(legalMoves(state, piece).length, 0, 'old piece belongs to the other side now');
});

test('rotation cycles 90° and is limited to mirrors and emitters', () => {
  const state = createGame();
  const mirror = pieceAt(state, 2, 5);
  assert.equal(canRotatePiece(state, mirror), true);
  rotatePiece(state, mirror);
  assert.equal(mirror.rot, 1);
  assert.equal(state.actionUsed, true);
  assert.equal(canRotatePiece(state, mirror), false);

  // Four rotations return to the start; endTurn/endTurn returns the red turn.
  for (let i = 0; i < 3; i += 1) {
    endTurn(state);
    endTurn(state);
    rotatePiece(state, mirror);
  }
  assert.equal(mirror.rot, 0);

  // Reset action and check a king cannot rotate.
  state.actionUsed = false;
  assert.equal(canRotatePiece(state, getKing(state, 'red')), false);
});

test('direction helpers are internally consistent', () => {
  // Directions that meet each mirror's bright face (0=up, 1=right, 2=down, 3=left).
  const frontDirections = [
    [1, 2], // rot 0, face NW
    [2, 3], // rot 1, face NE
    [0, 3], // rot 2, face SE
    [0, 1], // rot 3, face SW
  ];
  for (let rot = 0; rot < 4; rot += 1) {
    for (let dir = 0; dir < 4; dir += 1) {
      const out = reflectDirection(rot, dir);
      assert.ok(out >= 0 && out < 4);
      // Reflections are always 90° turns across a diagonal mirror.
      assert.ok(out !== dir);
      assert.equal(isMirrorFront(rot, dir), frontDirections[rot].includes(dir));
    }
  }
});

/**
 * Horizontal shots: an emitter on the left/right aims across a single mirror.
 * Expected reflection/destruction was derived from the mirror face definitions.
 */
test('mirror front reflects and vulnerable back shatters (horizontal)', () => {
  const cases = [
    // Emitter on the left shooting right.
    { side: 'left', rot: 0, reflected: true, outgoing: 0 },
    { side: 'left', rot: 1, reflected: false },
    { side: 'left', rot: 2, reflected: false },
    { side: 'left', rot: 3, reflected: true, outgoing: 2 },
    // Emitter on the right shooting left.
    { side: 'right', rot: 0, reflected: false },
    { side: 'right', rot: 1, reflected: true, outgoing: 0 },
    { side: 'right', rot: 2, reflected: true, outgoing: 2 },
    { side: 'right', rot: 3, reflected: false },
  ];

  for (const entry of cases) {
    const left = entry.side === 'left';
    const state = customState([
      emitter(left ? 0 : 7, 4, left ? 1 : 3),
      mirror(3, 4, entry.rot),
      king(7, 7, 'red'),
      king(0, 0, 'blue'),
    ]);
    const shot = traceLaser(state, 'red');
    const reflected = reflectEvent(shot);
    const last = endOf(shot);
    if (entry.reflected) {
      assert.ok(reflected, `${entry.side} rot ${entry.rot} should reflect`);
      assert.equal(reflected.outgoing, entry.outgoing, `${entry.side} rot ${entry.rot} outgoing`);
      assert.equal(shot.endReason, 'wall');
    } else {
      assert.equal(last.kind, 'destroy', `${entry.side} rot ${entry.rot}`);
      assert.equal(shot.endReason, 'mirror-destroyed');
    }
  }
});

/** Vertical shots: emitter above shooting down, or below shooting up. */
test('mirror front reflects and vulnerable back shatters (vertical)', () => {
  const cases = [
    // Emitter above shooting down.
    { side: 'top', rot: 0, reflected: true, outgoing: 3 },
    { side: 'top', rot: 1, reflected: true, outgoing: 1 },
    { side: 'top', rot: 2, reflected: false },
    { side: 'top', rot: 3, reflected: false },
    // Emitter below shooting up.
    { side: 'bottom', rot: 0, reflected: false },
    { side: 'bottom', rot: 1, reflected: false },
    { side: 'bottom', rot: 2, reflected: true, outgoing: 1 },
    { side: 'bottom', rot: 3, reflected: true, outgoing: 3 },
  ];

  for (const entry of cases) {
    const top = entry.side === 'top';
    const state = customState([
      emitter(4, top ? 0 : 7, top ? 2 : 0),
      mirror(4, 4, entry.rot),
      king(7, 7, 'red'),
      king(0, 0, 'blue'),
    ]);
    const shot = traceLaser(state, 'red');
    const reflected = reflectEvent(shot);
    const last = endOf(shot);
    if (entry.reflected) {
      assert.ok(reflected, `${entry.side} rot ${entry.rot} should reflect`);
      assert.equal(reflected.outgoing, entry.outgoing, `${entry.side} rot ${entry.rot} outgoing`);
    } else {
      assert.equal(last.kind, 'destroy', `${entry.side} rot ${entry.rot}`);
      assert.equal(shot.endReason, 'mirror-destroyed');
    }
  }
});

test('beam follows a closed mirror circuit and terminates instead of looping forever', () => {
  const state = customState([
    // Emitter is on the circuit edge; its beam joins a four-mirror circuit and
    // returns to the emitter, where it is safely absorbed after four reflections.
    emitter(4, 2, 1),
    mirror(5, 2, 3, 'blue', 'd'),
    mirror(5, 4, 0, 'blue', 'c'),
    mirror(3, 4, 1, 'blue', 'b'),
    mirror(3, 2, 2, 'blue', 'a'),
    king(7, 7, 'red'),
    king(0, 0, 'blue'),
  ]);
  const shot = traceLaser(state, 'red');
  assert.equal(shot.endReason, 'emitter');
  assert.equal(endOf(shot).kind, 'absorb');
  const reflections = shot.events.filter((event) => event.kind === 'reflect');
  assert.equal(reflections.length, 4);
  assert.ok(shot.points.length < 256);
});

test('enemy king hit wins, own king blocks harmlessly, emitters absorb', () => {
  const winning = customState([
    emitter(0, 0, 1),
    king(7, 7, 'red'),
    king(3, 0, 'blue'),
  ]);
  let shot = traceLaser(winning, 'red');
  assert.equal(shot.winner, 'red');
  assert.equal(shot.endReason, 'king-hit');
  assert.equal(endOf(shot).kind, 'kingHit');

  const ownKing = customState([
    emitter(0, 0, 1),
    king(2, 0, 'red'),
    king(5, 0, 'blue'),
  ]);
  shot = traceLaser(ownKing, 'red');
  assert.equal(shot.winner, null);
  assert.equal(shot.endReason, 'own-king');
  assert.equal(endOf(shot).kind, 'absorb');

  const blocker = customState([
    emitter(0, 0, 1),
    { id: 'blue-emitter', type: 'emitter', owner: 'blue', x: 2, y: 0, rot: 2 },
    king(7, 7, 'red'),
    king(5, 0, 'blue'),
  ]);
  shot = traceLaser(blocker, 'red');
  assert.equal(shot.winner, null);
  assert.equal(shot.endReason, 'emitter');
  assert.equal(endOf(shot).kind, 'absorb');
});

test('beam cannot pass through any blocking piece', () => {
  const state = customState([
    emitter(0, 0, 1),
    mirror(2, 0, 2, 'blue'), // hit from the left: back side shatters
    king(5, 0, 'blue'),
    king(7, 7, 'red'),
  ]);
  const shot = traceLaser(state, 'red');
  const lastPoint = shot.points[shot.points.length - 1];
  assert.deepEqual(lastPoint, { x: 2.5, y: 0.5 });
  assert.equal(shot.endReason, 'mirror-destroyed');
});

test('shots at the board edge stop on the boundary', () => {
  const state = customState([emitter(0, 0, 0), king(7, 7, 'red'), king(7, 0, 'blue')]);
  const shot = traceLaser(state, 'red');
  assert.deepEqual(shot.points[shot.points.length - 1], { x: 0.5, y: 0 });
  assert.equal(shot.endReason, 'wall');
  assert.equal(shot.events[0].kind, 'wall');
});

test('large open board paths terminate (no infinite travel)', () => {
  const state = customState([emitter(7, 7, 3), king(0, 0, 'red'), king(7, 0, 'blue')]);
  const shot = traceLaser(state, 'red');
  assert.ok(shot.points.length < 20);
  assert.ok(DIRECTIONS.length === 4);
});
