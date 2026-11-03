// 9-1 操作の診断（scripts/replay-analysis/）: 記録して再生した集計が、飛ばしながらの集計と同じになる・人の手の模擬
import { describe, expect, it } from 'vitest';
import { analyzeData } from '../scripts/replay-analysis/analyze';
import { findRole, flyMission } from '../scripts/replay-analysis/flight';
import { DEFAULT_HANDS, Hands, stickOutput } from '../scripts/replay-analysis/hands';
import { ControlAnalyzer } from '../scripts/replay-analysis/metrics';
import { Totals } from '../scripts/replay-analysis/totals';
import { createRandom } from '../src/core/random';
import { decodeReplay, encodeReplay } from '../src/replay/codec';

const controls = (pitch: number, roll: number, yaw = 0) => ({
  pitch,
  roll,
  yaw,
  throttle: 0,
  afterburner: false,
  throttleTarget: null,
});

describe('操作の診断（9-1）', () => {
  it('ボットの記録を再生して集計すると、飛ばしながらの集計と同じ（記録の手順が本番と同じ）', () => {
    const box: { a: ControlAnalyzer | null } = { a: null };
    const r = flyMission('training', 1, findRole('beginner'), {
      record: true,
      analyzer: (play) => (box.a = new ControlAnalyzer(play, { aspect: 2.16 })),
    });
    expect(r.data).not.toBeNull();
    if (!r.data || !box.a) return;
    const live = box.a.finish();
    const a = analyzeData(decodeReplay(encodeReplay(r.data)), { aspect: 2.16 });
    expect(a.startMatches).toBe(true);
    expect(a.outcomeMatches).toBe(true);
    expect(a.totals.missionStatus).toBe(r.status);
    for (const k of [
      'steps',
      'shots',
      'hits',
      'kills',
      'missiles',
      'engagedSteps',
      'offScreenSteps',
    ] as const)
      expect(a.totals[k]).toBe(live[k]);
    expect(a.totals.steps).toBeGreaterThan(60 * 30);
  }, 60_000);

  it('人の手: ぶれ・遅れなし・ヨーありなら、円の中の入力はそのまま（円の外は円に縮む）', () => {
    const h = new Hands({ ...DEFAULT_HANDS, noise: 0, delay: 0, yaw: true }, createRandom(1));
    const out = controls(0, 0);
    h.apply(controls(0.5, -0.3, 0.2), out);
    expect(out.pitch).toBeCloseTo(0.5, 6);
    expect(out.roll).toBeCloseTo(-0.3, 6);
    expect(out.yaw).toBe(0.2);
    h.apply(controls(1, 1), out);
    expect(Math.hypot(out.pitch, out.roll)).toBeCloseTo(1, 6);
  });

  it('人の手: 遅れの秒数だけ前の入力を出し、ヨーは使わない', () => {
    const h = new Hands({ ...DEFAULT_HANDS, noise: 0, delay: 0.1 }, createRandom(1));
    const out = controls(0, 0);
    for (let i = 0; i < 6; i++) {
      h.apply(controls(0.5, 0, 0.5), out);
      expect(out.pitch).toBe(0);
    }
    h.apply(controls(0.5, 0, 0.5), out);
    expect(out.pitch).toBeCloseTo(0.5, 6);
    expect(out.yaw).toBe(0);
  });

  it('感度のカーブ: 1 は直線、2 は中央付近を小さく、感度で 1 に頭打ち', () => {
    expect(stickOutput(0.5, 1, 1)).toBe(0.5);
    expect(stickOutput(0.5, 2, 1)).toBe(0.25);
    expect(stickOutput(0.9, 1, 1.3)).toBe(1);
  });

  it('集計を足し合わせる', () => {
    const a = new Totals();
    const b = new Totals();
    b.files = 1;
    b.shots = 10;
    b.reversals.roll = 3;
    b.angleBins[2] = 5;
    b.reacquire.push(1.5);
    a.merge(b);
    a.merge(b);
    expect(a.files).toBe(2);
    expect(a.shots).toBe(20);
    expect(a.reversals.roll).toBe(6);
    expect(a.angleBins[2]).toBe(10);
    expect(a.reacquire).toEqual([1.5, 1.5]);
  });
});
