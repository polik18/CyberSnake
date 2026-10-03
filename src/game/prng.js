// Deterministic seeded PRNG (mulberry32).
// Pure function of the seed — identical output in browser, Node, and Worker.
// Replaces Math.random() in the engine so food spawns are reproducible for replay.
//
// Reference: http://patorjk.com/software/taag/#p=display&f=Default&t=mulberry32
// Public domain implementation (via seedrandom-style seeding).

export function createSeededRng(seed) {
  // Convert an arbitrary integer seed into a 32-bit state.
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Derive a stable 32-bit integer seed from an arbitrary string (e.g. runId).
// Uses a small FNV-1a hash so the same runId always yields the same PRNG.
export function hashSeedFromString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
