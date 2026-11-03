// 起動時の地形の浸食の時間計測（1-3 の「起動時の浸食は 200ms 以内」。v1.0.1 で tests/terrain-gen.test.ts から移した）。
// テストに時間の判定があると、並列に走るほかのテストの負荷で落ちる（v1.0.1 の計測: 同時に 2 本の npm test で 228〜535ms）ため、単独で走らせる。
// `npm run bench` から scripts/bench.js 経由で読み込む
import { createHeightField } from '../src/render/terrain-height';
import type { BenchResult } from './bench-skins';

/** 3 回作り直して、浸食の最短の時間（1 回目は JIT の温めを含む） */
export function benchTerrain(): BenchResult {
  const times: number[] = [];
  for (let i = 0; i < 3; i++) times.push(createHeightField().erosionMs);
  const best = Math.min(...times);
  return {
    name: '起動時の地形の浸食',
    worstMs: best,
    limitMs: 200,
    detail: `（3 回: ${times.map((t) => t.toFixed(0)).join(' / ')}ms の最短）`,
  };
}
