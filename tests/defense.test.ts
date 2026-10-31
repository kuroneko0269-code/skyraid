// 防衛戦（7-2）: 波の定義の整合・人数スケール・補給の条件・スコアと報酬・爆撃機と巡航ミサイルの挙動・基地の施設の不利・
// 味方の対空砲・ボットでソロ通常を通す（Kestrel 未強化で 7 波以上、Lv3 強化で 10 波）
import { describe, expect, it } from 'vitest';
import { TEAM_PLAYER } from '../src/combat/target';
import { DIFFICULTIES } from '../src/data/ai';
import {
  BOMBER_CONFIG,
  CRUISE_CONFIG,
  DEFENSE_CONFIG,
  DEFENSE_MAPS,
  ENEMY_BOMB_BLAST,
} from '../src/data/defense';
import { DEFENSE_ENEMY_KINDS, DEFENSE_WAVES } from '../src/data/defense-waves';
import { MAPS } from '../src/data/maps';
import { Bomber } from '../src/entities/bomber';
import { ActiveMap } from '../src/missions/active-map';
import { defenseReward } from '../src/missions/defense/score';
import { canResupply, supplyFraction } from '../src/missions/defense/supply';
import {
  buildWave,
  countWave,
  enemyScale,
  forecastText,
  scaledCount,
} from '../src/missions/defense/waves';
import { DT, startDefenseSim } from './defense-bots';

describe('波の定義', () => {
  it('全 10 波。どの組も敵の種類・難易度が有効で、数は 1 以上', () => {
    expect(DEFENSE_WAVES).toHaveLength(DEFENSE_CONFIG.waves);
    for (const w of DEFENSE_WAVES) {
      expect(w.groups.length).toBeGreaterThan(0);
      for (const g of w.groups) {
        expect(DEFENSE_ENEMY_KINDS).toContain(g.kind);
        expect(DIFFICULTIES).toContain(g.difficulty);
        expect(g.count).toBeGreaterThanOrEqual(1);
        expect(g.delay ?? 0).toBeGreaterThanOrEqual(0);
        if (g.escort !== undefined) expect(g.kind).toBe('bomber');
      }
    }
  });

  it('1〜3 波は easy、4〜7 波は normal、8〜10 波は normal と hard の混在', () => {
    const diffs = DEFENSE_WAVES.map((w) => new Set(w.groups.map((g) => g.difficulty)));
    diffs.slice(0, 3).forEach((d) => {
      expect([...d]).toEqual(['easy']);
    });
    diffs.slice(3, 7).forEach((d) => {
      expect([...d]).toEqual(['normal']);
    });
    diffs.slice(7).forEach((d) => {
      expect(d.has('hard')).toBe(true);
      expect(d.has('normal')).toBe(true);
    });
  });

  it('波が進むほど敵の数が増える（ソロ・通常の数で 1 波 ≤ 5 波 ≤ 10 波）', () => {
    const n = (w: number): number => buildWave(w, 1, 'normal').length;
    expect(n(1)).toBeLessThanOrEqual(n(5));
    expect(n(5)).toBeLessThanOrEqual(n(10));
    expect(n(10)).toBeGreaterThan(n(1));
  });

  it('マップは島と港湾都市。どちらも 3 方向・施設 5 つ・開始位置', () => {
    expect(DEFENSE_MAPS.map((m) => m.mapId)).toEqual(['island', 'harbor']);
    for (const m of DEFENSE_MAPS) {
      expect(MAPS[m.mapId]).toBeDefined();
      expect(m.approaches).toHaveLength(3);
      expect(Object.keys(m.facilities)).toEqual(['hq', 'radar', 'fuel', 'aaa1', 'aaa2']);
    }
  });

  it('施設は地上（海の上でない）、港湾都市は建物と重ならない', () => {
    for (const def of DEFENSE_MAPS) {
      const map = new ActiveMap();
      map.use(def.mapId);
      for (const p of Object.values(def.facilities)) {
        expect(map.ground(p.x, p.z), def.mapId).toBeGreaterThan(0);
        expect(map.buildings?.topAt(p.x, p.z) ?? -Infinity).toBeLessThan(map.ground(p.x, p.z) + 1);
      }
    }
  });
});

describe('人数と難易度のスケール', () => {
  it('数 × (0.6 + 0.4 × 人数)。高難度は ×1.3', () => {
    expect([1, 2, 3, 4].map((n) => enemyScale(n, 'normal'))).toEqual(
      [1, 1.4, 1.8, 2.2].map((v) => expect.closeTo(v, 9) as number),
    );
    expect(enemyScale(1, 'hard')).toBeCloseTo(1.3);
    expect(enemyScale(4, 'hard')).toBeCloseTo(2.86);
  });

  it('四捨五入で、定義が 1 以上なら最低 1', () => {
    expect(scaledCount(1, 1)).toBe(1);
    expect(scaledCount(2, 1.4)).toBe(3);
    expect(scaledCount(3, 2.2)).toBe(7);
    expect(scaledCount(0, 2.2)).toBe(0);
    expect(scaledCount(1, 0.1)).toBe(1);
  });

  it('予告の数は護衛を戦闘機に数える。文は「北東から 爆撃機 2・戦闘機 3」', () => {
    const c = countWave(buildWave(5, 1, 'normal'));
    expect(c).toEqual({ fighter: 2, bomber: 2, cruise: 1 });
    expect(forecastText('北東', { fighter: 3, bomber: 2, cruise: 0 })).toBe(
      '北東から 爆撃機 2・戦闘機 3',
    );
    const four = countWave(buildWave(5, 4, 'normal'));
    expect(four).toEqual({ fighter: 4, bomber: 4, cruise: 2 });
  });
});

describe('補給の条件', () => {
  const c = { x: 2500, z: 0 };
  it('基地の中心から 600m 以内・地表 300m 以下・速度 150 以下', () => {
    expect(canResupply({ x: 2500, z: 0 }, 200, 140, c)).toBe(true);
    expect(canResupply({ x: 3100, z: 0 }, 300, 150, c)).toBe(true);
    expect(canResupply({ x: 3101, z: 0 }, 200, 140, c)).toBe(false);
    expect(canResupply({ x: 2500, z: 0 }, 301, 140, c)).toBe(false);
    expect(canResupply({ x: 2500, z: 0 }, 200, 151, c)).toBe(false);
  });

  it('燃料タンクを失うと半分', () => {
    expect(supplyFraction(true)).toBe(1);
    expect(supplyFraction(false)).toBe(0.5);
  });

  it('準備の間に 1 回だけ補給する（波の間はしない）。ミサイル・ロケット・爆弾・フレアが満タン', () => {
    const sim = startDefenseSim();
    const { play, defense } = sim;
    const s = play.session;
    const supplies: number[] = [];
    defense.bus.on('defense:supply', ({ id }) => supplies.push(id));
    // 撃ち尽くした状態で基地の真上を低く遅く通る
    s.combat.missileAmmo.setCapacity(s.combat.missileAmmo.capacity);
    while (s.combat.missileAmmo.tryUse()) s.combat.missileAmmo.step(1);
    while (s.combat.rockets.count > 0) s.combat.rockets.refillPart(-1);
    const a = s.aircraft;
    const m = defense.map;
    a.respawn(
      {
        x: m.center.x,
        y: 250 + Math.max(0, sim.map.ground(m.center.x, m.center.z)),
        z: m.center.z,
      },
      { x: 0, y: 0, z: 0, w: 1 },
    );
    a.state.speed = 140;
    const idle = { pitch: 0, roll: 0, yaw: 0, throttle: 0.2, afterburner: false };
    const none = {
      trigger: false,
      missile: false,
      flare: false,
      targetNext: false,
      rocket: false,
      bomb: false,
      bombHeld: false,
    };
    play.step(idle, none, DT);
    expect(supplies).toEqual([0]);
    expect(s.combat.missileAmmo.count).toBe(s.combat.missileAmmo.capacity);
    expect(s.combat.rockets.count).toBe(12);
    play.step(idle, none, DT);
    expect(supplies).toEqual([0]);
    // 波の間は補給しない
    defense.skip();
    play.step(idle, none, DT);
    expect(defense.phase).toBe('wave');
    expect(supplies).toEqual([0]);
  });
});

describe('スコアと報酬', () => {
  const base = { facilitiesTotal: 4 } as const;
  it('クリアした波 × 300 + 完全クリア 2000 + 施設が全部残れば 1000', () => {
    expect(
      defenseReward({ ...base, outcome: 'cleared', wavesCleared: 10, facilitiesAlive: 4 }).total,
    ).toBe(6000);
    expect(
      defenseReward({ ...base, outcome: 'cleared', wavesCleared: 10, facilitiesAlive: 3 }).total,
    ).toBe(5000);
  });

  it('失敗はクリアした波 × 300 だけ（施設が残っていても）', () => {
    const r = defenseReward({ ...base, outcome: 'failed', wavesCleared: 6, facilitiesAlive: 4 });
    expect(r).toEqual({ waves: 1800, fullClear: 0, facilities: 0, total: 1800 });
    expect(
      defenseReward({ ...base, outcome: 'failed', wavesCleared: 0, facilitiesAlive: 4 }).total,
    ).toBe(0);
  });
});

describe('爆撃機と巡航ミサイル', () => {
  it('爆撃機は旋回せずに一定の高度・速さで直進し、目標の上に爆弾を落として通り過ぎ、離脱する', () => {
    const b = new Bomber();
    const target = { x: 0, y: 20, z: 0 };
    b.attack({ x: 8000, y: BOMBER_CONFIG.altitude, z: 300 }, target, 0, 9000, 1);
    const dir = { ...b.direction };
    const drops: { x: number; y: number; z: number; vx: number; vz: number }[] = [];
    while (!b.arrived) {
      b.step(DT);
      expect(b.position.y).toBe(BOMBER_CONFIG.altitude);
      expect(b.direction).toEqual(dir);
      for (let n = b.takeDrops(); n > 0; n--)
        drops.push({ ...b.position, vx: b.velocity.x, vz: b.velocity.z });
    }
    expect(drops).toHaveLength(BOMBER_CONFIG.bombs);
    // 空気抵抗なしの放物線で、列の真ん中が目標に落ちる（地表 20m）
    const fall = Math.sqrt((2 * (BOMBER_CONFIG.altitude - target.y)) / 9.8);
    const lands = drops.map((d) => ({ x: d.x + d.vx * fall, z: d.z + d.vz * fall }));
    const mid = lands.reduce(
      (s, l) => ({ x: s.x + l.x / lands.length, z: s.z + l.z / lands.length }),
      { x: 0, z: 0 },
    );
    expect(Math.hypot(mid.x - target.x, mid.z - target.z)).toBeLessThan(5);
    for (const l of lands)
      expect(Math.hypot(l.x - target.x, l.z - target.z)).toBeLessThan(ENEMY_BOMB_BLAST.radius + 20);
    expect(b.maxHp).toBe(BOMBER_CONFIG.maxHp);
  });

  it('巡航ミサイルは低空を司令部へ直進し、撃墜されなければ司令部に 300 ダメージ', () => {
    const sim = startDefenseSim({ seed: 3 });
    const { defense, play } = sim;
    const s = play.session;
    defense.skip();
    play.step(
      { pitch: 0, roll: 0, yaw: 0, throttle: 0.7, afterburner: false },
      {
        trigger: false,
        missile: false,
        flare: false,
        targetNext: false,
        rocket: false,
        bomb: false,
        bombHeld: false,
      },
      DT,
    );
    const m = s.props.cruiseMissiles[0];
    if (!m) throw new Error('cruise');
    // 味方の対空砲が撃ち落とさないよう壊しておく（対空砲の支援は別のテスト）
    for (const i of [3, 4])
      defense.base.damage(
        i,
        10000,
        () => undefined,
        () => undefined,
      );
    for (const c of s.props.cruiseMissiles.slice(1)) c.withdraw();
    const hq = defense.base.hq;
    m.aim(
      { x: hq.position.x + 3000, y: CRUISE_CONFIG.altitude, z: hq.position.z },
      hq.position,
      hq.hitRadius,
      1,
    );
    expect(m.hitRadius).toBeLessThan(5);
    expect(m.spec.speed).toBeGreaterThan(200);
    const before = hq.hp;
    let impacts = 0;
    defense.bus.on('defense:cruiseImpact', () => impacts++);
    for (let i = 0; i < 20 * 60 && impacts === 0; i++) defense.step(DT, []);
    expect(impacts).toBe(1);
    expect(before - hq.hp).toBe(CRUISE_CONFIG.damage);
    // 撃墜すれば司令部は無傷
    m.aim(
      { x: hq.position.x + 3000, y: CRUISE_CONFIG.altitude, z: hq.position.z },
      hq.position,
      hq.hitRadius,
      1,
    );
    s.combat.dealDamage(m, CRUISE_CONFIG.maxHp, TEAM_PLAYER);
    const hp = hq.hp;
    for (let i = 0; i < 20 * 60; i++) defense.step(DT, []);
    expect(hq.hp).toBe(hp);
    expect(s.combat.kills).toBe(1);
  });
});
