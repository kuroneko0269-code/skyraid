// M1 訓練（2-4 の仮ミッション）を本番と同じ FlightSession + MissionRunner で、シード固定のボットに飛ばす
import { describe, expect, it } from 'vitest';
import { createCombatInput } from '../src/combat/combat-system';
import { createRandom } from '../src/core/random';
import { ISLAND_MAP } from '../src/data/maps';
import { TRAINING_MISSION } from '../src/data/missions';
import { RING_CONFIG } from '../src/data/rings';
import type { Vec3 } from '../src/flight/math';
import type { RingObjective } from '../src/missions/types';
import { getGroundHeight } from '../src/render/terrain-height';
import { PilotBot, VETERAN } from './ai-sim';
import { DT, newPlay, WaypointBot } from './mission-bots';

const rings = (TRAINING_MISSION.objectives.find((o) => o.type === 'rings') as RingObjective).rings;

describe('M1 訓練のデータ', () => {
  it('リング 10 個 → 敵機 2 機（easy）の順。リングは地表から 300m 以上・戦域の中', () => {
    expect(rings.length).toBe(10);
    const kill = TRAINING_MISSION.objectives[1];
    expect(kill?.type === 'kill' && kill.start === 'afterPrevious' && kill.count === 2).toBe(true);
    const spawn = TRAINING_MISSION.spawns[0];
    expect(spawn?.kind === 'enemyFighter' && spawn.difficulty === 'easy' && spawn.count === 2).toBe(
      true,
    );
    for (const r of rings) {
      expect(r.y - getGroundHeight(r.x, r.z)).toBeGreaterThan(300);
      expect(Math.hypot(r.x, r.z) + RING_CONFIG.radius).toBeLessThan(ISLAND_MAP.radius);
    }
  });
});

describe('M1 訓練のシミュレーション（シード固定）', () => {
  it('リングを順に通り、敵機 2 機を倒せば成功（ランクと報酬が付く）', () => {
    const play = newPlay(11);
    const session = play.session;
    const runner = play.startMission(TRAINING_MISSION);
    const rewards: number[] = [];
    runner.bus.on('mission:reward', ({ credits }) => rewards.push(credits));
    const waypoint = new WaypointBot(session);
    const pilot = new PilotBot(session, VETERAN, createRandom(1011));
    const idle = createCombatInput();
    let ringsDoneAt = -1;
    for (let i = 0; i < 480 * 60 && runner.running; i++) {
      const ring = runner.activeRings?.next;
      if (ring) {
        waypoint.fly(ring.position);
        play.step(waypoint.controls, idle, DT);
      } else {
        if (ringsDoneAt < 0) ringsDoneAt = runner.elapsed;
        pilot.think(DT);
        play.step(pilot.controls, pilot.input, DT);
      }
    }
    expect(ringsDoneAt).toBeGreaterThan(60);
    expect(ringsDoneAt).toBeLessThan(160);
    expect(runner.status).toBe('success');
    expect(session.destroyedCount('enemyFighter', 'training-bandits')).toBe(2);
    expect(runner.result?.rank).not.toBeNull();
    expect(rewards.length).toBe(1);
    expect(rewards[0]).toBeGreaterThanOrEqual(1000);
    // 敵機は再出現しない
    for (let i = 0; i < 30 * 60; i++) play.step(pilot.controls, idle, DT);
    expect(session.enemies.filter((e) => e.active).length).toBe(0);
  });

  it('リングを通らず戦域の中を回っていると、敵機は出ず時間切れで失敗', () => {
    const play = newPlay(12);
    const runner = play.startMission(TRAINING_MISSION);
    const bot = new WaypointBot(play.session);
    const idle = createCombatInput();
    const circle: Vec3 = { x: 0, y: 1500, z: 0 };
    let maxDistance = 0;
    for (let i = 0; i < 500 * 60 && runner.running; i++) {
      // 島の上空、半径 2000m の円の先の点を追う
      const p = play.session.aircraft.state.position;
      const a = Math.atan2(p.z, p.x) + 0.6;
      circle.x = 2000 * Math.cos(a);
      circle.z = 2000 * Math.sin(a);
      bot.fly(circle);
      play.step(bot.controls, idle, DT);
      maxDistance = Math.max(maxDistance, Math.hypot(p.x, p.z));
    }
    expect(runner.status).toBe('failed');
    expect(runner.failReason).toBe('timeUp');
    expect(runner.elapsed).toBeCloseTo(480, 1);
    expect(runner.objectives[0]?.current).toBe(0);
    expect(play.session.enemies.some((e) => e.deployed)).toBe(false);
    expect(maxDistance).toBeLessThan(ISLAND_MAP.radius);
  });

  it('戦域の外へ飛び続けると 10 秒で失敗', () => {
    const play = newPlay(13);
    const runner = play.startMission(TRAINING_MISSION);
    const bot = new WaypointBot(play.session);
    const idle = createCombatInput();
    let leftAt = -1;
    for (let i = 0; i < 120 * 60 && runner.running; i++) {
      bot.fly({ x: 0, y: 800, z: 20000 });
      play.step(bot.controls, idle, DT);
      if (leftAt < 0 && runner.boundary.outside) leftAt = runner.elapsed;
    }
    expect(runner.failReason).toBe('outOfBounds');
    expect(runner.elapsed - leftAt).toBeCloseTo(10, 1);
  });

  it('地面・海面への墜落は撃墜と同じ（HP 0）。ミッションは失敗', () => {
    const play = newPlay(14);
    const runner = play.startMission(TRAINING_MISSION);
    const bot = new WaypointBot(play.session);
    const idle = createCombatInput();
    for (let i = 0; i < 60 * 60 && runner.running; i++) {
      bot.fly({ x: 0, y: -2000, z: 3000 });
      play.step(bot.controls, idle, DT);
    }
    expect(runner.failReason).toBe('playerDown');
    expect(play.session.player.hp).toBe(0);
    // 残骸は墜落の直前の位置（上空へ戻さない）
    const p = play.session.aircraft.state.position;
    expect(p.y - getGroundHeight(p.x, p.z)).toBeLessThan(30);
  });
});

describe('フリーフライト', () => {
  it('墜落は撃墜と同じ扱い: 3 秒後に墜落地点の 300m 上空へ戻る（4-6 の事前修正）', () => {
    const play = newPlay(15);
    play.startFree();
    const s = play.session;
    s.configureEnemies(false, 'easy');
    const bot = new WaypointBot(s);
    const idle = createCombatInput();
    let steps = 0;
    while (s.player.downCount === 0 && steps < 60 * 60) {
      bot.fly({ x: 0, y: -2000, z: 3000 });
      play.step(bot.controls, idle, DT);
      steps++;
    }
    expect(s.player.downCount).toBe(1);
    expect(s.player.active).toBe(false);
    const wreck = { ...s.aircraft.state.position };
    for (let i = 0; i < 3 * 60 + 2 && !s.player.active; i++) play.step(bot.controls, idle, DT);
    expect(s.player.active).toBe(true);
    const p = s.aircraft.state.position;
    expect([p.x, p.z]).toEqual([wreck.x, wreck.z]);
    expect(p.y).toBeCloseTo(getGroundHeight(wreck.x, wreck.z) + 300, 6);
  });

  it('戦域の外は警告だけで失敗しない。的・ドローン・敵機はフリーフライトの設定どおり', () => {
    const play = newPlay(16);
    play.startFree();
    const s = play.session;
    expect(s.combat.targets.balloons.every((b) => b.active)).toBe(true);
    expect(s.combat.drones.every((d) => d.active)).toBe(true);
    expect(s.enemies.filter((e) => e.active).length).toBe(2);
    expect(play.boundary.failOnExpire).toBe(false);
    s.aircraft.respawn({ x: 0, y: 800, z: 7000 });
    const idle = createCombatInput();
    const bot = new WaypointBot(s);
    for (let i = 0; i < 15 * 60; i++) {
      bot.fly({ x: 0, y: 800, z: 20000 });
      play.step(bot.controls, idle, DT);
    }
    expect(play.boundary.outside).toBe(true);
    expect(play.boundary.expired).toBe(false);
    expect(s.player.active).toBe(true);
  });

  it('ミッションのあとフリーフライトに戻すと、的・ドローン・敵機が戻る。ミッション中の敵の設定変更は次に効く', () => {
    const play = newPlay(17);
    play.startMission(TRAINING_MISSION);
    const s = play.session;
    expect(s.combat.targets.balloons.some((b) => b.active)).toBe(false);
    expect(s.combat.drones.some((d) => d.active)).toBe(false);
    expect(s.enemies.some((e) => e.active)).toBe(false);
    s.configureEnemies(true, 'hard', 1);
    expect(s.enemies.some((e) => e.active)).toBe(false);
    play.startFree();
    expect(play.runner).toBeNull();
    expect(s.combat.targets.balloons.every((b) => b.active)).toBe(true);
    expect(s.enemies.filter((e) => e.active).length).toBe(1);
    expect(s.squadron.difficulty).toBe('hard');
  });
});
