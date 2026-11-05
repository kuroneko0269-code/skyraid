// リングレース（7-1）のシミュレーション: 道筋を追うボット（Kestrel・未強化）で全コース（9-8 から 6 本）を完走し、
// ゴールドタイムの 1.1〜1.4 倍で走れる（ゴールドタイムはボットのタイム ÷ 1.2 を 0.5 秒に丸めて決めた）。
// ボットの各リングのタイムをベストとして、2 回目は差・スプリットが出る（ゴーストの再生は tests/race-ghost.test.ts）
import { describe, expect, it } from 'vitest';
import { COURSES } from '../src/data/courses';
import { runRaceBot } from './race-bots';

describe('ボットで 6 コースを完走する（9-8 で 2 本足した）', () => {
  for (const course of COURSES) {
    it(`${course.name}: 未通過・墜落なしで完走し、ゴールドタイムの 1.1〜1.4 倍`, () => {
      const { result, crashes, sim } = runRaceBot(course);
      expect(result.outcome).toBe('finished');
      expect(result.missed).toBe(0);
      expect(crashes).toBe(0);
      expect(sim.race.status.every((s) => s === 'passed')).toBe(true);
      const ratio = result.time / course.goldTimeSeconds;
      expect(ratio).toBeGreaterThanOrEqual(1.1);
      expect(ratio).toBeLessThanOrEqual(1.4);
      // ゴールドタイム = ボット ÷ 1.2 を 0.5 秒に丸めた値（データを変えたらここで気づく）
      expect(course.goldTimeSeconds).toBe(Math.round((result.time / 1.2) * 2) / 2);
      // ボットはランク B（ブースト以外のアフターバーナーを使わない・道筋のまま）
      expect(result.rank).toBe('B');
    });
  }

  it('2 回目はベスト（1 回目）と比べた差とスプリットが出る（同じ走りなら ±0）', () => {
    const course = COURSES[1];
    if (!course) throw new Error('コースがない');
    const first = runRaceBot(course).result;
    const { sim } = runRaceBot(course, { ringTimes: first.ringTimes });
    expect(sim.race.ghostDelta).toBeCloseTo(0, 3);
    expect(sim.race.result?.time).toBeCloseTo(first.time, 3);
  });
});
