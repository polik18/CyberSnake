// Pure game configuration for CyberSnake (Phase 1: deterministic engine).
// No DOM, no WebGL, no Math.random, no AudioContext, no Date.
// These constants are ported verbatim from index.html to preserve determinism.

export const GAME_CONFIG = {
  GRID_SIZE: 100,
  GRID_STEP: 2,
  BOUNDARY: 50, // GRID_SIZE / 2
  INITIAL_SPEED: 180, // ms per tick
  SPEED_DECREMENT: 4, // ms reduced per crystal eaten
  MIN_SPEED: 70, // fastest tick interval
  MAX_INPUT_QUEUE: 2, // max queued turns (from turnRelative guard)
  COMBO_TICK_MS: 50, // combo timer interval
  COMBO_DECAY: 1.5, // comboTimeLeft decremented per combo tick
  COMBO_MAX: 100, // initial comboTimeLeft when food eaten
  MAX_MULTIPLIER: 5, // cap on currentMultiplier
  SCORE_PER_FOOD: 10, // base score per food (matches score += 10 * multiplier)
};

// Relative direction order: up -> right -> down -> left (clockwise).
// Ported verbatim from the DIRS array in index.html.
export const DIRS = [
  { x: 0, z: -GAME_CONFIG.GRID_STEP }, // Index 0: North
  { x: GAME_CONFIG.GRID_STEP, z: 0 }, // Index 1: East
  { x: 0, z: GAME_CONFIG.GRID_STEP }, // Index 2: South
  { x: -GAME_CONFIG.GRID_STEP, z: 0 }, // Index 3: West
];

// Initial state factory — deterministic starting snake (3 segments, heading North).
export function initialGameState() {
  return {
    snake: [
      { x: 0, z: 0 },
      { x: 0, z: GAME_CONFIG.GRID_STEP },
      { x: 0, z: GAME_CONFIG.GRID_STEP * 2 },
    ],
    direction: { x: 0, z: -GAME_CONFIG.GRID_STEP },
    inputQueue: [],
    food: null,
    score: 0,
    crystalsEaten: 0,
    maxMultiplier: 1,
    currentMultiplier: 1,
    comboTimeLeft: 0,
    gameOver: false,
  };
}
