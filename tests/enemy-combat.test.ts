import { describe, expect, it } from 'vitest';
import type { CombatInput } from '../src/combat/combat-system';
import { FlareField } from '../src/combat/flare';
import { MissileSystem } from '../src/combat/missile';
import { TEAM_ENEMY, TEAM_PLAYER } from '../src/combat/target';
import { loadEnemySettings, saveEnemySettings } from '../src/core/enemy-settings';
import type { StorageLike } from '../src/core/settings';
import { ENEMY_SETTINGS_KEYS } from '../src/data/ai';
import { AIRCRAFT_COMBAT, STARTER_AIRCRAFT } from '../src/data/aircraft';
import { MISSILE_CONFIG } from '../src/data/weapons';
import type { AircraftControls } from '../src/entities/aircraft';
import { EnemyAircraft } from '../src/entities/enemy-aircraft';
import { FlightSession } from '../src/missions/flight-session';
import { createHudFrame, fillRadar } from '../src/ui/hud-feed';
import { arenaForce } from './ai-sim';
import { DT, lookQuat, point, shooter } from './combat-helpers';

const NONE: CombatInput = { trigger: false, missile: false, flare: false, targetNext: false };
const LEVEL: AircraftControls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false };

function freeFlight(): FlightSession {
  const ff = new FlightSession({
    rng: () => 0.5,
    start: { x: 30000, y: 1500, z: 0 },
    enemies: arenaForce(2, 6000),
  });
  ff.configureEnemies(true, 'normal', 2);
  ff.reset();
  return ff;
}

describe('陣営とミサイル', () => {
  it('敵のミサイルはプレイヤーのフレアに釣られ、味方（敵側）のフレアには釣られない', () => {
    const player = point(0, 0, -1500);
    const make = (): MissileSystem<typeof player> =>
      new MissileSystem(MISSILE_CONFIG, undefined, null, () => 0);
    const fire = (flareOwner: number): boolean => {
      const missiles = make();
      const flares = new FlareField();
      const m = missiles.launch(shooter(250), player, TEAM_ENEMY);
      if (!m) throw new Error('撃てない');
      for (let i = 0; i < 40; i++) missiles.step([player], flares.flares, DT);
      // 目標の手前で、前を向いて撒く
      flares.release(
        {
          position: { x: 0, y: 0, z: -900 },
          orientation: lookQuat({ x: 0, y: 0, z: 1 }),
          speed: 0,
        },
        flareOwner,
      );
      for (let i = 0; i < 3; i++) missiles.step([player], flares.flares, DT);
      return m.target !== player;
    };
    expect(fire(TEAM_PLAYER)).toBe(true);
    expect(fire(TEAM_ENEMY)).toBe(false);
  });

  it('信管は撃った陣営には反応しない', () => {
    const own = { ...point(0, 0, -200), team: TEAM_ENEMY };
    const foe = { ...point(0, 0, -400), team: TEAM_PLAYER };
    let hit: unknown = null;
    const missiles = new MissileSystem<typeof own>(MISSILE_CONFIG, (d) => {
      hit = d.target;
    });
    missiles.launch(shooter(250), null, TEAM_ENEMY);
    for (let i = 0; i < 120 && !hit; i++) missiles.step([own, foe], null, DT);
    expect(hit).toBe(foe);
  });

  it('敵のミサイルはプレイヤーにダメージを与え、撃墜数には数えない', () => {
    const ff = freeFlight();
    const combat = ff.combat;
    const p = ff.player.position;
    // プレイヤーの真後ろから、プレイヤーへ向けて撃つ
    combat.missiles.launch(
      {
        position: { x: p.x, y: p.y, z: p.z + 600 },
        orientation: lookQuat({ x: 0, y: 0, z: -1 }),
        speed: 250,
      },
      ff.player,
      TEAM_ENEMY,
    );
    expect(ff.incomingMissiles).toBe(1);
    for (let i = 0; i < 180 && ff.player.hp === ff.player.maxHp; i++) ff.step(LEVEL, NONE, DT);
    expect(ff.player.hp).toBeLessThan(ff.player.maxHp);
    expect(combat.kills).toBe(0);
  });

  it('プレイヤーの機銃で敵機を落とすと撃墜数になり、破片の演出が呼ばれる', () => {
    const ff = freeFlight();
    const enemy = ff.enemies[0];
    if (!enemy) throw new Error('敵がいない');
    let destroyed = 0;
    ff.combat.onDestroyed((t) => {
      if (t === enemy) destroyed++;
    });
    for (let i = 0; i < 12; i++) ff.combat.dealDamage(enemy, 10, TEAM_PLAYER);
    expect(enemy.isDestroyed).toBe(true);
    expect(ff.combat.kills).toBe(1);
    expect(destroyed).toBe(1);
  });
});

describe('プレイヤーの被弾とリスポーン', () => {
  it('HP 0 で撃墜 → 操作を受け付けず、3 秒後に撃墜地点の 300m 上空へ HP 満タンで戻る（フリーフライト）', () => {
    const ff = freeFlight();
    let downs = 0;
    let respawns = 0;
    ff.onPlayerDown(() => downs++);
    ff.onRespawn(() => respawns++);
    ff.step(LEVEL, NONE, DT);
    ff.combat.dealDamage(ff.player, STARTER_AIRCRAFT.hull.maxHp, TEAM_ENEMY);
    expect(ff.player.isDestroyed).toBe(true);
    expect(ff.player.flashTimer).toBeGreaterThan(0);
    const at = { ...ff.aircraft.state.position };
    const steps = Math.round(AIRCRAFT_COMBAT.playerRespawnSeconds / DT);
    for (let i = 0; i < steps - 1; i++) ff.step({ ...LEVEL, pitch: 1 }, NONE, DT);
    // 撃墜中は機体が止まっている
    expect(ff.aircraft.state.position).toEqual(at);
    expect(ff.player.isDestroyed).toBe(true);
    ff.step(LEVEL, NONE, DT);
    expect(ff.player.hp).toBe(ff.player.maxHp);
    // 地形なし（地表 = 高度 0）なので、撃墜地点の真上 300m・水平
    expect(ff.aircraft.state.position).toEqual({ x: at.x, y: 300, z: at.z });
    const q = ff.aircraft.state.orientation;
    expect(Math.abs(q.x) + Math.abs(q.z)).toBeLessThan(1e-9);
    expect(downs).toBe(1);
    expect(respawns).toBe(1);
  });

  it('フリーフライトでは何度でもリスポーンする', () => {
    const ff = freeFlight();
    for (let n = 0; n < 3; n++) {
      ff.combat.dealDamage(ff.player, 1000, TEAM_ENEMY);
      for (let i = 0; i < 200; i++) ff.step(LEVEL, NONE, DT);
    }
    expect(ff.player.downCount).toBe(3);
    expect(ff.player.active).toBe(true);
  });
});

describe('敵機', () => {
  it('地面に衝突したら撃墜扱い（撃墜数には数えない）で、時間が経つと再出現する', () => {
    const enemy = new EnemyAircraft(undefined, () => 0, 2);
    enemy.spawn({ x: 0, y: 5, z: 0, headingDeg: 0 });
    enemy.aircraft.state.orientation.x = -0.3826834;
    enemy.aircraft.state.orientation.w = 0.9238795;
    let crashed = false;
    for (let i = 0; i < 30 && !crashed; i++) crashed = enemy.step(LEVEL, DT);
    expect(crashed).toBe(true);
    expect(enemy.isDestroyed).toBe(true);
    expect(enemy.active).toBe(false);
    // 残骸の位置は地表付近（Aircraft の墜落リセットで上空へ飛ばない）
    expect(enemy.position.y).toBeLessThan(10);
    expect(enemy.respawnTimer).toBe(2);
  });

  it('敵の有無を切ると全機引っ込め、入れると出し直す', () => {
    const ff = freeFlight();
    expect(ff.enemies.filter((e) => e.active)).toHaveLength(2);
    ff.configureEnemies(false, 'normal');
    expect(ff.enemies.some((e) => e.active)).toBe(false);
    ff.configureEnemies(true, 'hard');
    expect(ff.enemies.filter((e) => e.active)).toHaveLength(2);
    expect(ff.squadron.difficulty).toBe('hard');
  });

  it('レーダーには出撃中の敵機と、自機を追う敵のミサイルが出る', () => {
    const ff = freeFlight();
    const frame = createHudFrame(ff.aircraft);
    fillRadar(frame.radar, ff);
    expect(frame.radar.count).toBe(2);
    const e = ff.enemies[0];
    if (!e) throw new Error('敵がいない');
    ff.combat.missiles.launch(e.aircraft.state, ff.player, TEAM_ENEMY);
    // プレイヤー自身のミサイルは出さない
    ff.combat.missiles.launch(ff.aircraft.state, e, TEAM_PLAYER);
    fillRadar(frame.radar, ff);
    expect(frame.radar.count).toBe(3);
    expect(frame.radar.contacts[2]?.kind).toBe('missile');
  });
});

describe('敵の設定の保存', () => {
  function memory(): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        data.set(k, v);
      },
    };
  }

  it('未保存なら「敵あり・ふつう」、保存した値を読み戻せる', () => {
    const s = memory();
    expect(loadEnemySettings(s)).toEqual({ enabled: true, difficulty: 'normal' });
    saveEnemySettings(s, { enabled: false, difficulty: 'hard' });
    expect(loadEnemySettings(s)).toEqual({ enabled: false, difficulty: 'hard' });
  });

  it('不正な値・読めないストレージは既定値', () => {
    const s = memory();
    s.data.set(ENEMY_SETTINGS_KEYS.difficulty, 'insane');
    expect(loadEnemySettings(s).difficulty).toBe('normal');
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadEnemySettings(broken)).toEqual({ enabled: true, difficulty: 'normal' });
    expect(saveEnemySettings(broken, { enabled: true, difficulty: 'easy' })).toBe(false);
    expect(loadEnemySettings(null).enabled).toBe(true);
  });
});
