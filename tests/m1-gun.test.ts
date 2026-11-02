// 8-6b: M1 訓練は、ミサイルを外し切っても機銃で倒せる（敵機の HP ×0.6・撃ち尽くして 8 秒でミサイルを満タンに補充）。
// ボットは ai-sim の初心者役に人の撃ち方（2 秒撃って 0.5 秒休む）とタッチのエイムアシストを足し、戦域外の警告で戻る
import { describe, expect, it } from 'vitest';
import { createCombatInput } from '../src/combat/combat-system';
import { AssistControl } from '../src/core/assist-control';
import { createRandom } from '../src/core/random';
import { FIRST_SORTIE_MISSION, TRAINING_MISSION } from '../src/data/missions';
import type { DifficultySpec } from '../src/data/ai';
import { getGroundHeight } from '../src/render/terrain-height';
import { BEGINNER, PilotBot } from './ai-sim';
import { DT, newPlay, WaypointBot } from './mission-bots';

const CENTER = { x: 0, y: 900, z: 0 };

function runM1(seed: number, skill: DifficultySpec): { status: string; resupplies: number } {
  const play = newPlay(seed);
  const s = play.session;
  const runner = play.startMission(TRAINING_MISSION);
  let resupplies = 0;
  runner.bus.on('mission:resupply', () => {
    resupplies++;
  });
  const wp = new WaypointBot(s);
  const pilot = new PilotBot(s, skill, createRandom(1000 + seed), undefined, getGroundHeight);
  const assist = new AssistControl(s, { aim: true, camera: true, hud: true }, () => 'touch');
  const idle = createCombatInput();
  let back = false;
  for (let i = 0; i < 480 * 60 && runner.running; i++) {
    const ring = runner.activeRings?.next;
    if (ring) {
      wp.fly(ring.position);
      play.step(wp.controls, idle, DT);
      continue;
    }
    const p = s.aircraft.state.position;
    const b = runner.boundary;
    if (b.outside) back = true;
    else if (back && b.distance(p.x, p.z) < b.map.radius - 600) back = false;
    pilot.think(DT);
    if (back) {
      wp.fly(CENTER);
      play.step(wp.controls, idle, DT);
    } else {
      assist.apply(pilot.controls);
      play.step(pilot.controls, pilot.input, DT);
    }
  }
  return { status: runner.status, resupplies };
}

const HUMAN_GUN = { gunBurstSeconds: 2, gunPauseSeconds: 0.5 };

describe('M1 訓練: ミサイルを外し切っても機銃で倒せる（8-6b）', () => {
  it('M1 の敵機は HP ×0.6（120 → 72）、ミサイルは撃ち尽くして 8 秒で補充。ミサイルの補充は M1 だけ', () => {
    const spawn = TRAINING_MISSION.spawns[0];
    expect(spawn?.kind === 'enemyFighter' && spawn.hpScale).toBe(0.6);
    expect(TRAINING_MISSION.missileResupplySeconds).toBe(8);
    expect(FIRST_SORTIE_MISSION.missileResupplySeconds).toBeUndefined();
  });

  it('初心者役が機銃だけ（ミサイルを撃たない）で 8 シード中 6 回以上成功（8-6b の前は 4 回）', () => {
    let ok = 0;
    for (let seed = 1; seed <= 8; seed++)
      if (runM1(seed, { ...BEGINNER, ...HUMAN_GUN, missileChance: 0 }).status === 'success') ok++;
    expect(ok).toBeGreaterThanOrEqual(6);
  }, 120_000);

  it('初心者役がミサイルも使うと 8 シードすべて成功し、外し切った回は補充が入る（8-6b の前は 6 回）', () => {
    let ok = 0;
    let resupplied = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const r = runM1(seed, { ...BEGINNER, ...HUMAN_GUN });
      if (r.status === 'success') ok++;
      if (r.resupplies > 0) resupplied++;
    }
    expect(ok).toBe(8);
    expect(resupplied).toBeGreaterThan(0);
  }, 120_000);
});
