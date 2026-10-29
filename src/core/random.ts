// シード付き乱数（Three.js 非依存）。地形のノイズ・AI・テストのシミュレーションで共通に使う

/** 32bit のシードから [0, 1) の乱数列を作る（mulberry32） */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
