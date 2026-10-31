// リングレース（7-1）のシミュレーション: 道筋を追うボット（Kestrel・未強化）で 4 コースを完走し、
// ゴールドタイムの 1.1〜1.4 倍で走れる（ゴールドタイムはボットのタイム ÷ 1.2 を 0.5 秒に丸めて決めた）。
// ボットのゴーストをベストとして記録し、2 回目は差・スプリットが出る
import { describe, expect, it } from 'vitest';
import { COURSES } from '../src/data/courses';
import { GhostTrack } from '../src/missions/race/ghost';
import { runRaceBot } from './race-bots';

describe('ボットで 4 コースを完走する', () => {
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

  it('ボットの走行のゴーストを再生すると、最後はボットの今の位置（1 サンプル 1/15 秒の分 = 30m 以内）', () => {
    const course = COURSES[0];
    if (!course) throw new Error('コースがない');
    const { sim } = runRaceBot(course);
    const track = GhostTrack.decode(sim.race.recorder.encode());
    if (!track) throw new Error('読めない');
    expect(track.duration).toBeCloseTo(sim.race.elapsed, 0);
    const p = { x: 0, y: 0, z: 0 };
    const q = { x: 0, y: 0, z: 0, w: 1 };
    track.sample(track.duration, p, q);
    const end = sim.play.session.aircraft.state.position;
    expect(Math.hypot(p.x - end.x, p.y - end.y, p.z - end.z)).toBeLessThan(30);
  });

  it('2 回目はベスト（1 回目）と比べた差とスプリットが出る（同じ走りなら ±0）', () => {
    const course = COURSES[1];
    if (!course) throw new Error('コースがない');
    const first = runRaceBot(course).result;
    const { sim } = runRaceBot(course, { ringTimes: first.ringTimes });
    expect(sim.race.ghostDelta).toBeCloseTo(0, 3);
    expect(sim.race.result?.time).toBeCloseTo(first.time, 3);
  });
});
