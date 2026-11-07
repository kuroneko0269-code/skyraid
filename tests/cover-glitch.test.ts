// 10-1c: 幕のロゴのグリッチの計算（src/core/cover-glitch.ts）
import { describe, expect, it } from 'vitest';
import { glitchFrame, glitchLevel, type GlitchClock } from '../src/core/cover-glitch';
import { VIEWPORT_CONFIG } from '../src/data/app';

const C = VIEWPORT_CONFIG.coverLogo;
const G = C.glitch;
const clock = (k: Partial<GlitchClock>): GlitchClock => ({
  pulseAt: null,
  peakAt: null,
  landAt: null,
  landMs: C.landMs,
  ...k,
});

/** 決まった乱数の列（線形合同法） */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('乱れの強さの波', () => {
  it('合間は弱く、測り直しの試みで強く跳ねて pulseMs で戻る', () => {
    expect(glitchLevel(0, clock({}), G)).toBe(G.idle);
    expect(glitchLevel(1000, clock({ pulseAt: 1000 }), G)).toBeCloseTo(G.pulse);
    const mid = glitchLevel(1000 + G.pulseMs / 2, clock({ pulseAt: 1000 }), G);
    expect(mid).toBeGreaterThan(G.idle);
    expect(mid).toBeLessThan(G.pulse);
    expect(glitchLevel(1000 + G.pulseMs, clock({ pulseAt: 1000 }), G)).toBe(G.idle);
    expect(G.pulse).toBeGreaterThan(G.idle * 2);
  });

  it('外すと決めてから移り始めるまでが一番強く、移る間に収まって着く時刻に 0', () => {
    const k = clock({ pulseAt: 0, peakAt: 2000, landAt: 2000 + G.peakMs });
    expect(glitchLevel(2000, k, G)).toBe(G.peak);
    expect(glitchLevel(2000 + G.peakMs - 1, k, G)).toBe(G.peak);
    expect(G.peak).toBeGreaterThanOrEqual(G.pulse);
    let prev = Infinity;
    for (let t = 0; t <= C.landMs; t += 40) {
      const v = glitchLevel(2000 + G.peakMs + t, k, G);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    expect(glitchLevel(2000 + G.peakMs + C.landMs, k, G)).toBe(0);
  });
});

describe('1 歩の乱れ', () => {
  it('強さ 0 なら揺れ・色ずれ・帯・ちらつき・ノイズなし', () => {
    const f = glitchFrame(0, 0, null, seeded(1), G);
    expect([f.dx, f.dy, f.split, f.scanline, f.noise]).toEqual([0, 0, 0, 0, 0]);
    expect(f.alpha).toBe(1);
    expect(f.bands).toEqual([]);
    expect(f.flicker).toBe(false);
  });

  it('揺れ・色ずれ・帯のずれは強さに比例した上限の中、間隔は stepMinMs〜stepMaxMs', () => {
    const rand = seeded(7);
    let banded = 0;
    for (let i = 0; i < 500; i++) {
      const level = (i % 10) / 9;
      const f = glitchFrame(level, i * 50, null, rand, G);
      expect(Math.abs(f.dx)).toBeLessThanOrEqual(G.jitterPx * level + 1e-9);
      expect(Math.abs(f.dy)).toBeLessThanOrEqual(G.jitterPx * level + 1e-9);
      expect(f.split).toBeLessThanOrEqual(G.splitPx * level + 1e-9);
      expect(f.nextMs).toBeGreaterThanOrEqual(G.stepMinMs);
      expect(f.nextMs).toBeLessThanOrEqual(G.stepMaxMs);
      if (f.bands.length > 0) {
        banded++;
        expect(f.bands).toHaveLength(G.bands);
        expect(f.bands[0]?.top).toBe(0);
        expect(f.bands.at(-1)?.bottom).toBe(1);
        for (const b of f.bands) {
          expect(b.bottom).toBeGreaterThanOrEqual(b.top);
          expect(Math.abs(b.offset)).toBeLessThanOrEqual(G.bandPx * level + 1e-9);
        }
      }
    }
    expect(banded).toBeGreaterThan(50);
  });

  it('光過敏への配慮: 一番強い乱れが続いても、ちらつき・欠けは 1 秒に 3 回まで', () => {
    expect(G.flickerGapMs).toBeGreaterThanOrEqual(1000 / 3);
    for (const seed of [1, 2, 3, 4, 5]) {
      const rand = seeded(seed);
      const times: number[] = [];
      let last: number | null = null;
      for (let t = 0; t < 10000;) {
        const f = glitchFrame(1, t, last, rand, G);
        if (f.flicker) {
          times.push(t);
          last = t;
        }
        t += f.nextMs;
      }
      expect(times.length).toBeGreaterThan(5);
      for (let i = 3; i < times.length; i++)
        expect((times[i] ?? 0) - (times[i - 3] ?? 0)).toBeGreaterThan(1000);
      // ちらつきで暗くするのは flickerAlpha まで（真っ暗にはしない）
      expect(G.flickerAlpha).toBeGreaterThan(0.2);
    }
  });
});
