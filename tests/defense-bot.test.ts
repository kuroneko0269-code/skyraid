// 防衛戦（7-2）のシミュレーション: ボット（敵機と同じ AI で操縦。tests/defense-bots.ts）でソロ・通常を通す。
// Kestrel 未強化で 7 波以上、Lv3 強化で 10 波クリア（爆撃機・巡航ミサイルの数値はこの結果で決めた）
import { describe, expect, it } from 'vitest';
import { runDefense, startDefenseSim } from './defense-bots';

describe('ボットでソロ・通常を通す', () => {
  for (const seed of [1, 2]) {
    it(`Kestrel 未強化で 7 波以上（シード ${seed}）`, () => {
      const sim = startDefenseSim({ level: 0, seed });
      runDefense(sim, 3600);
      expect(sim.defense.finished).toBe(true);
      expect(sim.defense.wavesCleared).toBeGreaterThanOrEqual(7);
    }, 120_000);

    it(`Kestrel Lv3 強化で 10 波クリア（シード ${seed}）`, () => {
      const sim = startDefenseSim({ level: 3, seed });
      const d = sim.defense;
      runDefense(sim, 3600);
      expect(d.phase).toBe('cleared');
      expect(d.wavesCleared).toBe(10);
      expect(sim.play.session.combat.kills).toBeGreaterThan(10);
    }, 120_000);
  }
});
