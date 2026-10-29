// 敵機 AI のシミュレーション（乱数のシードを固定）。プレイヤー役はボット（tests/ai-sim.ts）
import { describe, expect, it } from 'vitest';
import { createRandom } from '../src/core/random';
import { FreeFlight } from '../src/missions/free-flight';
import { getGroundHeight } from '../src/render/terrain-height';
import { AVERAGE, BEGINNER, PilotBot, SIM_DT, simulate } from './ai-sim';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

/** seeds の各シードで simulate して、撃墜された・撃墜した割合 */
function rates(results: { playerDowns: number; kills: number }[]): {
  downRate: number;
  killRate: number;
  bothRate: number;
} {
  const n = results.length;
  return {
    downRate: results.filter((r) => r.playerDowns > 0).length / n,
    killRate: results.filter((r) => r.kills > 0).length / n,
    bothRate: results.filter((r) => r.playerDowns > 0 && r.kills > 0).length / n,
  };
}

describe('シミュレーション', () => {
  it('easy の敵 1 機と初心者が 60 秒対峙して、初心者が撃墜される確率は高すぎない（20% 以下）', () => {
    const r = rates(SEEDS.map((s) => simulate(s, 'easy', 1, 60, BEGINNER)));
    expect(r.downRate).toBeLessThanOrEqual(0.2);
    // 初心者でも勝てる（半分以上のシードで撃墜できる）
    expect(r.killRate).toBeGreaterThanOrEqual(0.5);
  }, 30000);

  it('hard は easy より手ごわい（同じ初心者が撃墜される確率が高い）', () => {
    const easy = rates(SEEDS.map((s) => simulate(s, 'easy', 1, 60, BEGINNER)));
    const hard = rates(SEEDS.map((s) => simulate(s, 'hard', 1, 60, BEGINNER)));
    expect(hard.downRate).toBeGreaterThan(easy.downRate + 0.4);
    expect(hard.killRate).toBeLessThan(easy.killRate);
  }, 30000);

  it('normal の敵 2 機と 150 秒戦うと、撃墜も被撃墜も起きる', () => {
    const r = rates(SEEDS.slice(0, 12).map((s) => simulate(s, 'normal', 2, 150, AVERAGE)));
    expect(r.downRate).toBeGreaterThanOrEqual(0.4);
    expect(r.killRate).toBeGreaterThanOrEqual(0.4);
    expect(r.bothRate).toBeGreaterThanOrEqual(0.25);
  }, 60000);

  it('敵は地形に衝突しない（島の上空で 4 機が 3 分戦う）', () => {
    for (const seed of [1, 2]) {
      const ff = new FreeFlight({ rng: createRandom(seed), groundHeight: getGroundHeight });
      ff.configureEnemies(true, 'hard', 4);
      ff.reset();
      const bot = new PilotBot(ff, AVERAGE, createRandom(seed + 100));
      const crashes = ff.enemies.map((e) => e.aircraft.crashCount);
      for (let i = 0; i < 60 * 180; i++) {
        bot.think(SIM_DT);
        ff.step(bot.controls, bot.input, SIM_DT);
      }
      ff.enemies.forEach((e, i) => {
        expect(e.aircraft.crashCount).toBe(crashes[i]);
      });
    }
  }, 60000);
});

describe('性能', () => {
  it('敵 4 機 + 各ミサイルの AI 処理（固定ステップ 1 回）は 1ms 以内（戦闘全体の 1 ステップで測る）', () => {
    const ff = new FreeFlight({ rng: createRandom(7), groundHeight: getGroundHeight });
    ff.configureEnemies(true, 'hard', 4);
    ff.reset();
    const bot = new PilotBot(ff, AVERAGE, createRandom(8));
    // 慣らし（JIT）
    for (let i = 0; i < 600; i++) {
      bot.think(SIM_DT);
      ff.step(bot.controls, bot.input, SIM_DT);
    }
    const steps = 60 * 60;
    let total = 0;
    let missiles = 0;
    for (let i = 0; i < steps; i++) {
      bot.think(SIM_DT);
      const t0 = performance.now();
      ff.step(bot.controls, bot.input, SIM_DT);
      const t = performance.now() - t0;
      total += t;
      missiles = Math.max(missiles, ff.combat.missiles.missiles.count);
    }
    expect(total / steps).toBeLessThan(1);
    // ミサイルが実際に飛んでいる状況で測れている
    expect(missiles).toBeGreaterThan(0);
  }, 30000);
});
