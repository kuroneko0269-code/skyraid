// 8-6c: M2 初陣は 2 本目のミッションとして、初心者役（ミサイルあり）でも 8 回中 5 回以上・平均的は 7 回以上成功する。
// ボットは ai-sim の初心者役・平均的に人の撃ち方（2 秒撃って 0.5 秒休む）とタッチのエイムアシストを足し、戦域外の警告で戻る
import { describe, expect, it } from 'vitest';
import { createCombatInput } from '../src/combat/combat-system';
import { AssistControl } from '../src/core/assist-control';
import { createRandom } from '../src/core/random';
import { FIRST_SORTIE_MISSION } from '../src/data/missions';
import type { DifficultySpec } from '../src/data/ai';
import { getGroundHeight } from '../src/render/terrain-height';
import { AVERAGE, BEGINNER, PilotBot } from './ai-sim';
import { BoundsGuard, DT, newPlay } from './mission-bots';

const HUMAN_GUN = { gunBurstSeconds: 2, gunPauseSeconds: 0.5 };
const IDLE = createCombatInput();

function successes(skill: DifficultySpec): number {
  let ok = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const play = newPlay(seed);
    const s = play.session;
    const runner = play.startMission(FIRST_SORTIE_MISSION);
    const pilot = new PilotBot(s, skill, createRandom(500 + seed), undefined, getGroundHeight);
    const assist = new AssistControl(s, { aim: true, camera: true, hud: true }, () => 'touch');
    const guard = new BoundsGuard(s, runner.boundary);
    for (let i = 0; i < 450 * 60 && runner.running; i++) {
      pilot.think(DT);
      if (guard.check()) play.step(guard.controls, IDLE, DT);
      else {
        assist.apply(pilot.controls);
        play.step(pilot.controls, pilot.input, DT);
      }
    }
    if (runner.status === 'success') ok++;
  }
  return ok;
}

describe('M2 初陣の難易度（8-6c）', () => {
  it('初心者役（ミサイルあり）は 8 回中 5 回以上成功（8-6c の前は 1 回）', () => {
    expect(successes({ ...BEGINNER, ...HUMAN_GUN })).toBeGreaterThanOrEqual(5);
  }, 120_000);

  it('平均的は 8 回中 7 回以上成功', () => {
    expect(successes({ ...AVERAGE, ...HUMAN_GUN })).toBeGreaterThanOrEqual(7);
  }, 120_000);
});
