// スキンのテクスチャ生成の時間計測（7-3 の「作り直し 1 回 50ms 以内」。8-1 の事前修正で tests/skins.test.ts から移した）。
// テストに時間の判定があると、並列に走るほかのテストや CI の混み具合で落ちることがあるため、単独で走らせる。
// `npm run bench` から scripts/bench.js 経由で読み込む
import { AIRCRAFT_MODELS } from '../src/data/aircraft';
import { DECAL_IDS, SKIN_CONFIG, SKIN_PATTERN_IDS } from '../src/data/skins';
import type { AircraftShape } from '../src/data/aircraft-shapes';
import { defaultPaint, type Paint } from '../src/progression/paint';
import { clearSkinCache, paintSkinPixels, skinPixelCount } from '../src/render/skin/skin-texture';

export interface BenchResult {
  readonly name: string;
  /** 一番遅かった組み合わせの時間（ミリ秒。組み合わせごとに 3 回の最短） */
  readonly worstMs: number;
  readonly limitMs: number;
  readonly detail: string;
}

function fancyPaint(
  shape: Readonly<AircraftShape>,
  pattern: Paint['pattern'],
  decal: Paint['wing']['decal'],
): Paint {
  return {
    ...defaultPaint(shape, 42),
    pattern,
    base: 9,
    accent: 5,
    marking: 7,
    wing: { decal, x: 30, y: 220, size: 255, rotation: 40 },
    fin: { decal, x: 200, y: 20, size: 0, rotation: 250 },
  };
}

/** 全パターン × 4 機種（デカールあり）を毎回キャッシュなしで作り直し、一番遅い組み合わせを返す */
export function benchSkins(): BenchResult {
  const first = AIRCRAFT_MODELS[0];
  if (!first) throw new Error('機体がありません');
  const out = new Uint8Array(skinPixelCount());
  // JIT の温め（最初の 1 回はコンパイルを含む）
  for (const pattern of SKIN_PATTERN_IDS)
    paintSkinPixels(first.shape, fancyPaint(first.shape, pattern, 'star'), out);
  let worst = 0;
  let worstAt = '';
  for (const m of AIRCRAFT_MODELS) {
    for (const [i, pattern] of SKIN_PATTERN_IDS.entries()) {
      const decal = DECAL_IDS[i % DECAL_IDS.length] ?? null;
      const p = { ...fancyPaint(m.shape, pattern, decal), number: (i * 13) % 100 };
      let best = Infinity;
      for (let k = 0; k < 3; k++) {
        clearSkinCache();
        const t = performance.now();
        paintSkinPixels(m.shape, p, out);
        best = Math.min(best, performance.now() - t);
      }
      if (best > worst) {
        worst = best;
        worstAt = `${m.id} / ${pattern}`;
      }
    }
  }
  return {
    name: 'スキンのテクスチャ生成（7-3）',
    worstMs: worst,
    limitMs: SKIN_CONFIG.maxGenerateMs,
    detail: `最も遅い組み合わせ: ${worstAt}`,
  };
}
