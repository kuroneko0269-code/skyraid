// 防衛戦（7-C の事前修正）: 戦闘機の撤退を 60 / 100 秒にした結果、Lv3 強化のボットのクリア時間が 13〜16 分に入る
import { describe, expect, it } from 'vitest';
import { replayOutcome } from '../src/replay/outcome';
import { runDefense, startDefenseSim } from './defense-bots';

describe('防衛戦のクリア時間', () => {
  for (const seed of [1, 2]) {
    it(`Kestrel Lv3 強化で 13〜16 分（シード ${seed}）`, () => {
      const sim = startDefenseSim({ level: 3, seed });
      const d = sim.defense;
      runDefense(sim, 3600);
      console.log(`seed ${seed}: ${(d.elapsed / 60).toFixed(2)} 分 phase=${d.phase}`);
      expect(d.phase).toBe('cleared');
      expect(d.elapsed).toBeGreaterThanOrEqual(13 * 60);
      expect(d.elapsed).toBeLessThanOrEqual(16 * 60);
    }, 120_000);
  }
});

describe('リプレイの結果（中断した防衛戦）', () => {
  it('中断で防衛戦が捨てられても、直前の防衛戦から「中断（○ 波）」を出す', () => {
    const sim = startDefenseSim({ level: 3, seed: 1 });
    const d = sim.defense;
    d.wavesCleared = 2;
    sim.play.abortMission();
    expect(sim.play.defense).toBeNull();
    expect(replayOutcome(sim.play, 'defense').label).toBe('中断');
    expect(replayOutcome(sim.play, 'defense', d)).toEqual({
      label: '中断（2 波）',
      success: false,
    });
  });
});
