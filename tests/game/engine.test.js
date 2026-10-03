import { describe, it, expect } from 'vitest';
import {
  step,
  turn,
  spawnFood,
  resetGame,
  currentSpeed,
  advanceComboTimer,
} from '../../src/game/engine.js';
import { createSeededRng, hashSeedFromString } from '../../src/game/prng.js';
import { initialGameState } from '../../src/config/game-config.js';

function deterministicRun(seed, turns) {
  const rng = createSeededRng(seed);
  let state = resetGame(initialGameState(), rng);
  for (const t of turns) {
    state = turn(state, t);
    const { state: next } = step(state);
    if (next.gameOver) break;
    state = next;
  }
  return state;
}

describe('determinism', () => {
  const turns = ['LEFT', 'RIGHT', 'LEFT', 'RIGHT', 'LEFT', 'RIGHT', 'LEFT', 'RIGHT'];

  it('same seed + same turns yields identical snapshot', () => {
    const a = deterministicRun(12345, turns);
    const b = deterministicRun(12345, turns);
    expect(a).toEqual(b);
  });

  it('different seed yields different food position', () => {
    const a = deterministicRun(12345, []);
    const b = deterministicRun(99999, []);
    expect(a.food).not.toEqual(b.food);
  });

  it('hashSeedFromString is stable for the same string', () => {
    expect(hashSeedFromString('run-abc')).toBe(hashSeedFromString('run-abc'));
    expect(hashSeedFromString('run-abc')).not.toBe(hashSeedFromString('run-xyz'));
  });
});

describe('food spawn', () => {
  it('never spawns on the snake body', () => {
    const rng = createSeededRng(2024);
    const state = resetGame(initialGameState(), rng);
    const onSnake = state.snake.some((s) => s.x === state.food.x && s.z === state.food.z);
    expect(onSnake).toBe(false);
  });

  it('stays within the playable boundary', () => {
    const rng = createSeededRng(2024);
    const state = resetGame(initialGameState(), rng);
    expect(Math.abs(state.food.x)).toBeLessThanOrEqual(48);
    expect(Math.abs(state.food.z)).toBeLessThanOrEqual(48);
  });
});

describe('movement and collision', () => {
  it('advances the snake head one GRID_STEP in the current direction', () => {
    const rng = createSeededRng(7);
    let state = resetGame(initialGameState(), rng);
    const { state: next } = step(state);
    expect(next.snake[0].x).toBe(0);
    expect(next.snake[0].z).toBe(-2);
  });

  it('applies relative LEFT/RIGHT turns', () => {
    const rng = createSeededRng(7);
    let state = resetGame(initialGameState(), rng);
    state = turn(state, 'LEFT');
    const { state: next } = step(state);
    // North + LEFT (CCW) => West (-2, 0)
    expect(next.direction).toEqual({ x: -2, z: 0 });
  });

  it('ends the game on wall collision', () => {
    // Drive the snake straight up into the wall.
    const rng = createSeededRng(7);
    let state = resetGame(initialGameState(), rng);
    let gameOver = false;
    for (let i = 0; i < 60 && !gameOver; i++) {
      const { state: n, events } = step(state);
      state = n;
      if (events.includes('gameOver')) gameOver = true;
    }
    expect(gameOver).toBe(true);
  });

  it('does not grow when food is not eaten', () => {
    const rng = createSeededRng(7);
    let state = resetGame(initialGameState(), rng);
    const { state: next } = step(state);
    expect(next.snake.length).toBe(3);
  });
});

describe('scoring and combo', () => {
  it('scales score by current multiplier', () => {
    const rng = createSeededRng(7);
    let state = resetGame(initialGameState(), rng);
    state.currentMultiplier = 3;
    state.comboTimeLeft = 100;
    // eat food by moving onto it
    state.food = { x: 0, z: -2 };
    const { state: next, events } = step(state);
    expect(events).toContain('ate');
    expect(next.score).toBe(10 * 3);
    expect(next.currentMultiplier).toBe(4); // +1 for eating (matches index.html currentMultiplier++)
    expect(next.maxMultiplier).toBe(4);
  });

  it('resets multiplier when combo timer expires', () => {
    let state = initialGameState();
    state.currentMultiplier = 3;
    state.comboTimeLeft = 100;
    for (let i = 0; i < 70; i++) {
      state = advanceComboTimer(state);
    }
    expect(state.comboTimeLeft).toBe(0);
    expect(state.currentMultiplier).toBe(1);
  });

  it('caps the multiplier at five', () => {
    let state = initialGameState();
    state.currentMultiplier = 5;
    state.comboTimeLeft = 100;
    state.food = { x: 0, z: -2 };
    const { state: next } = step(state);
    expect(next.currentMultiplier).toBe(5);
  });
});

describe('speed', () => {
  it('decreases tick interval as crystals are eaten', () => {
    let state = initialGameState();
    expect(currentSpeed(state)).toBe(180);
    state.crystalsEaten = 5;
    expect(currentSpeed(state)).toBe(160);
    state.crystalsEaten = 100;
    expect(currentSpeed(state)).toBe(70); // clamped to MIN_SPEED
  });
});

describe('replay integrity', () => {
  it('a single extra turn changes the resulting snapshot', () => {
    const turns1 = ['LEFT', 'RIGHT'];
    const turns2 = ['LEFT', 'RIGHT', 'LEFT'];
    const a = deterministicRun(42, turns1);
    const b = deterministicRun(42, turns2);
    expect(a).not.toEqual(b);
  });

  it('an empty turn list still produces a valid deterministic state', () => {
    const a = deterministicRun(1, []);
    const b = deterministicRun(1, []);
    expect(a).toEqual(b);
    expect(a.snake.length).toBe(3);
  });
});
