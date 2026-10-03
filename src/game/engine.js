// Pure, deterministic CyberSnake engine.
//
// This module reads NO DOM, NO WebGL, NO localStorage, NO AudioContext,
// NO Date, and NO Math.random(). It is the single source of truth for
// score, combo, crystals, speed, and collision, so the same (seed, turns)
// pair always produces the same snapshot — in the browser, in Node, and in
// the Cloudflare Worker replay.
//
// The engine exposes a small event stream ({ ate, turned, gameOver }) so the
// renderer/UI only observes and reacts; it never mutates game rules.

import { GAME_CONFIG, DIRS, initialGameState } from '../config/game-config.js';

const {
  BOUNDARY,
  GRID_STEP,
  INITIAL_SPEED,
  SPEED_DECREMENT,
  MIN_SPEED,
  MAX_INPUT_QUEUE,
  COMBO_TICK_MS,
  COMBO_DECAY,
  COMBO_MAX,
  MAX_MULTIPLIER,
  SCORE_PER_FOOD,
} = GAME_CONFIG;

// Advance the combo timer by one combo tick. Returns a new state object.
// comboTimeLeft starts at COMBO_MAX (100) and decays by COMBO_DECAY (1.5)
// per COMBO_TICK_MS (50); when it reaches <= 0 the multiplier resets to 1.
function advanceCombo(state) {
  if (state.comboTimeLeft <= 0) return state;
  const next = { ...state };
  next.comboTimeLeft = state.comboTimeLeft - COMBO_DECAY;
  if (next.comboTimeLeft <= 0) {
    next.comboTimeLeft = 0;
    next.currentMultiplier = 1;
  }
  return next;
}

// Ported verbatim from spawnFood() in index.html. Consumes the PRNG the same
// way (two draws per attempt, retry until off-snake) so food positions are
// reproducible for a given seed.
export function spawnFood(state, rng) {
  let valid = false;
  let rx = 0;
  let rz = 0;
  const maxRangeFactor = Math.floor((BOUNDARY - 4) / GRID_STEP);

  while (!valid) {
    const factorX = Math.floor(rng() * (maxRangeFactor * 2 + 1)) - maxRangeFactor;
    const factorZ = Math.floor(rng() * (maxRangeFactor * 2 + 1)) - maxRangeFactor;
    rx = factorX * GRID_STEP;
    rz = factorZ * GRID_STEP;
    valid = !state.snake.some((s) => s.x === rx && s.z === rz);
  }

  return { ...state, food: { x: rx, z: rz } };
}

// Ported verbatim from turnRelative() in index.html.
// Applies a relative turn against the last queued direction (or current
// direction when the queue is empty), respecting the queue-length guard.
// Returns a new state with the updated inputQueue.
export function turn(state, turnType) {
  if (state.gameOver) return state;

  const lastDir =
    state.inputQueue.length > 0
      ? state.inputQueue[state.inputQueue.length - 1]
      : state.direction;

  const currentIndex = DIRS.findIndex((d) => d.x === lastDir.x && d.z === lastDir.z);
  const baseIndex = currentIndex === -1 ? 0 : currentIndex;

  let nextIndex;
  if (turnType === 'LEFT') {
    nextIndex = (baseIndex - 1 + 4) % 4;
  } else if (turnType === 'RIGHT') {
    nextIndex = (baseIndex + 1) % 4;
  } else {
    return state;
  }

  const nextDir = DIRS[nextIndex];

  if (state.inputQueue.length < MAX_INPUT_QUEUE) {
    return { ...state, inputQueue: [...state.inputQueue, nextDir] };
  }
  return state;
}

// The deterministic game step (ported from gameTick()). Advances the snake by
// one tick, resolves wall/self collision, food, scoring, combo, and speed.
// Returns { state, events } where events is an array of event names.
export function step(state) {
  const events = [];

  if (state.inputQueue.length > 0) {
    state = { ...state, direction: state.inputQueue[0], inputQueue: state.inputQueue.slice(1) };
  }

  const oldHead = state.snake[0];
  const newHead = {
    x: oldHead.x + state.direction.x,
    z: oldHead.z + state.direction.z,
  };

  if (Math.abs(newHead.x) > BOUNDARY || Math.abs(newHead.z) > BOUNDARY) {
    return { state: { ...state, gameOver: true }, events: [...events, 'gameOver'] };
  }

  for (let i = 0; i < state.snake.length - 1; i++) {
    if (state.snake[i].x === newHead.x && state.snake[i].z === newHead.z) {
      return { state: { ...state, gameOver: true }, events: [...events, 'gameOver'] };
    }
  }

  const newState = { ...state, snake: [newHead, ...state.snake] };

  if (newHead.x === state.food.x && newHead.z === state.food.z) {
    newState.crystalsEaten = state.crystalsEaten + 1;
    newState.score = state.score + SCORE_PER_FOOD * state.currentMultiplier;
    newState.currentMultiplier = Math.min(state.currentMultiplier + 1, MAX_MULTIPLIER);
    if (newState.currentMultiplier > newState.maxMultiplier) {
      newState.maxMultiplier = newState.currentMultiplier;
    }
    newState.comboTimeLeft = COMBO_MAX;
    newState.food = null; // will be repopulated by spawnFood()
    events.push('ate');
  } else {
    newState.snake = newState.snake.slice(0, -1); // pop tail (no growth)
  }

  return { state: newState, events };
}

// Advance the combo timer by one combo tick (ported from startComboTimer's
// interval body). Returns a new state object.
export function advanceComboTimer(state) {
  return advanceCombo(state);
}

// Compute the tick interval (ms) for the current crystal count.
// Ported from the setInterval(gameTick, gameSpeed) re-scheduling.
export function currentSpeed(state) {
  return Math.max(MIN_SPEED, INITIAL_SPEED - state.crystalsEaten * SPEED_DECREMENT);
}

// Reset a game to its deterministic initial state, then spawn the first food
// using the provided PRNG (so the seed drives the first food position).
export function resetGame(state, rng) {
  const fresh = initialGameState();
  return spawnFood(fresh, rng);
}
