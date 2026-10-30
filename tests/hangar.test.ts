import { describe, expect, it } from 'vitest';
import { AIRCRAFT_MODELS, STARTER_AIRCRAFT, findAircraftModel } from '../src/data/aircraft';
import { MISSIONS } from '../src/data/missions';
import { BOMB_CONFIG, ROCKET_CONFIG } from '../src/data/ordnance';
import { DEFAULT_RANK_MULTIPLIERS, rewardCredits } from '../src/data/ranking';
import { SAVE_CONFIG } from '../src/data/save';
import { UPGRADE_KINDS, UPGRADE_PRICES } from '../src/data/upgrades';
import {
  FLARE_CONFIG,
  GUN_CONFIG,
  MISSILE_CONFIG,
  MISSILE_POOL_SIZE,
  TARGETING_CONFIG,
} from '../src/data/weapons';
import { FlightSession } from '../src/missions/flight-session';
import { Hangar, nextUpgradePrice, type HangarSave } from '../src/progression/hangar';
import { loadoutStats, payloadCounts, resolveLoadout } from '../src/progression/loadout';
import {
  createInitialSave,
  initialUpgrades,
  migrateSave,
  type SaveData,
  type UpgradeLevels,
} from '../src/progression/save';

function model(id: string) {
  const m = findAircraftModel(id);
  if (!m) throw new Error(id);
  return m;
}

const LV0 = initialUpgrades();
const LV5: UpgradeLevels = { engine: 5, airframe: 5, weapons: 5, avionics: 5 };

/** メモリ上のセーブ（SaveStore と同じく transact で書き換える） */
class MemorySave implements HangarSave {
  data: SaveData = createInitialSave();
  writes = 0;
  get snapshot(): Readonly<SaveData> {
    return this.data;
  }
  transact(fn: (d: SaveData) => boolean): boolean {
    if (!fn(this.data)) return false;
    this.writes++;
    return true;
  }
}

function hangarWith(credits: number, cleared: string[] = []) {
  const save = new MemorySave();
  save.data.credits = credits;
  return { save, hangar: new Hangar(save, (id) => cleared.includes(id)) };
}

describe('loadout の変換', () => {
  it('Kestrel の Lv0 は今までの飛行モデル・HP・武装と完全に一致する', () => {
    const l = resolveLoadout(model('kestrel'), LV0);
    expect(l.flight).toEqual(STARTER_AIRCRAFT);
    expect(l.flight.hull.maxHp).toBe(200);
    expect(l.gunDamage).toBe(GUN_CONFIG.damage);
    expect(l.missiles).toBe(MISSILE_CONFIG.ammo);
    expect(l.rockets).toBe(ROCKET_CONFIG.ammo);
    expect(l.bombs).toBe(BOMB_CONFIG.ammo);
    expect(l.flares).toBe(FLARE_CONFIG.charges);
    expect(l.targeting).toEqual(TARGETING_CONFIG);
  });

  it('Lv5 は Lv0 より最高速 +20%・旋回 +15%・HP +50%、武装と電子装備も上がる', () => {
    const a = resolveLoadout(model('kestrel'), LV0);
    const b = resolveLoadout(model('kestrel'), LV5);
    expect(b.flight.speed.afterburner / a.flight.speed.afterburner).toBeCloseTo(1.2, 9);
    expect(b.flight.speed.military / a.flight.speed.military).toBeCloseTo(1.2, 9);
    expect(b.flight.rates.pitch / a.flight.rates.pitch).toBeCloseTo(1.15, 9);
    expect(b.flight.hull.maxHp).toBe(300);
    expect(b.flight.speed.afterburnerMaxAccel / a.flight.speed.afterburnerMaxAccel).toBeCloseTo(
      1.25,
      9,
    );
    expect(b.flight.afterburner.durationSeconds).toBeCloseTo(9, 9);
    // 4-12 で基準値 10 → 12。Lv5 は 1.5 倍の 18
    expect(a.gunDamage).toBe(12);
    expect(b.gunDamage).toBeCloseTo(18, 9);
    expect(b.missiles).toBe(a.missiles + 5);
    expect(b.flares).toBe(a.flares + 5);
    expect(b.targeting.lockSeconds).toBeCloseTo(0.72, 9);
    expect(b.targeting.sensorRange).toBeCloseTo(6500, 6);
    expect(b.targeting.keepRange).toBeGreaterThan(b.targeting.sensorRange);
    // 巡航・失速は変えない（起動時の速度とスロットルの位置は同じ）
    expect(b.flight.speed.cruise).toBe(a.flight.speed.cruise);
    expect(b.flight.speed.stall).toBe(a.flight.speed.stall);
  });

  it('強化は系統ごとに効く（エンジンだけ上げても HP は変わらない）', () => {
    const l = resolveLoadout(model('kestrel'), { ...LV0, engine: 3 });
    expect(l.flight.hull.maxHp).toBe(200);
    expect(l.flight.rates).toEqual(STARTER_AIRCRAFT.rates);
    expect(l.flight.speed.afterburner).toBeCloseTo(400 * 1.12, 9);
  });

  it('機体の差: Swift は速く曲がり脆い、Bastion は硬く積めて鈍い、Vector は全体に高い', () => {
    const s = (id: string) => loadoutStats(resolveLoadout(model(id), LV0));
    const k = s('kestrel');
    const swift = s('swift');
    const bastion = s('bastion');
    const vector = s('vector');
    expect(swift.speed).toBeGreaterThan(k.speed);
    expect(swift.turn).toBeGreaterThan(k.turn);
    expect(swift.durability).toBeLessThan(k.durability);
    expect(swift.payload).toBeLessThan(k.payload);
    expect(bastion.durability).toBeGreaterThan(k.durability);
    expect(bastion.payload).toBeGreaterThan(k.payload);
    expect(bastion.turn).toBeLessThan(k.turn);
    for (const key of ['speed', 'turn', 'durability', 'payload'] as const)
      expect(vector[key]).toBeGreaterThan(k[key]);
    expect(k.payload).toBe(1);
  });

  it('高速側の旋回の折れ線は最高速に合わせて伸び、速度の大小関係を保つ', () => {
    const f = resolveLoadout(model('swift'), LV5).flight;
    for (let i = 1; i < f.turnCurve.length; i++) {
      const prev = f.turnCurve[i - 1];
      const cur = f.turnCurve[i];
      expect(cur && prev && cur.speed > prev.speed).toBe(true);
    }
    expect(f.speed.limit).toBeGreaterThan(f.speed.afterburner);
    expect(f.speed.afterburner).toBeGreaterThan(f.speed.military);
  });
});

describe('積載と弾数', () => {
  it.each([
    ['kestrel', 4, 12, 4, 6],
    ['swift', 3, 8, 3, 4],
    ['bastion', 6, 18, 6, 9],
    ['vector', 5, 14, 5, 7],
  ])('%s: ミサイル %i・ロケット %i・爆弾 %i・フレア %i', (id, missiles, rockets, bombs, flares) => {
    expect(payloadCounts(model(id).stats.payload)).toEqual({ missiles, rockets, bombs, flares });
  });

  it('ロケットは斉射（2 発）の倍数、プールは最大の搭載数より大きい', () => {
    for (const m of AIRCRAFT_MODELS) {
      const l = resolveLoadout(m, LV5);
      expect(l.rockets % ROCKET_CONFIG.perSalvo).toBe(0);
      expect(l.rockets).toBeLessThanOrEqual(ROCKET_CONFIG.maxRockets);
      expect(l.bombs).toBeLessThanOrEqual(BOMB_CONFIG.maxBombs);
      expect(l.missiles).toBeLessThan(MISSILE_POOL_SIZE);
    }
  });

  it('FlightSession に入れると HP と弾数が変わり、Kestrel Lv0 に戻すと元どおり', () => {
    const session = new FlightSession();
    const combat = session.combat;
    const before = {
      hp: session.player.maxHp,
      missiles: combat.missileAmmo.count,
      flares: combat.flares.magazine.count,
      rockets: combat.rockets.count,
      bombs: combat.bombs.magazine.count,
    };
    session.applyLoadout(resolveLoadout(model('bastion'), LV5));
    session.startFree();
    expect(session.player.maxHp).toBe(480);
    expect(session.player.hp).toBe(480);
    expect(combat.missileAmmo.count).toBe(11);
    expect(combat.flares.magazine.count).toBe(14);
    expect(combat.rockets.count).toBe(18);
    expect(combat.bombs.magazine.count).toBe(6);
    expect(combat.gunDamage).toBeCloseTo(18, 9);
    expect(session.aircraft.flight.spec.speed.afterburner).toBeCloseTo(400 * 0.92 * 1.2, 9);
    session.applyLoadout(resolveLoadout(model('kestrel'), LV0));
    session.startFree();
    expect({
      hp: session.player.maxHp,
      missiles: combat.missileAmmo.count,
      flares: combat.flares.magazine.count,
      rockets: combat.rockets.count,
      bombs: combat.bombs.magazine.count,
    }).toEqual(before);
    expect(session.aircraft.flight.spec).toEqual(STARTER_AIRCRAFT);
    expect(combat.targeting.spec).toEqual(TARGETING_CONFIG);
  });
});

describe('購入と強化の残高判定', () => {
  it('強化の価格は Lv ごとに 500 / 1,000 / 2,000 / 4,000 / 8,000、Lv5 で終わり', () => {
    expect([0, 1, 2, 3, 4].map(nextUpgradePrice)).toEqual(UPGRADE_PRICES);
    expect(nextUpgradePrice(5)).toBeNull();
  });

  it('残高が足りなければ買えず、足りれば引いて所持・選択する', () => {
    const { save, hangar } = hangarWith(7999);
    expect(hangar.status('swift')).toBe('buyable');
    expect(hangar.buy('swift')).toBe('insufficient');
    expect(save.writes).toBe(0);
    save.data.credits = 8000;
    expect(hangar.buy('swift')).toBe('ok');
    expect(hangar.credits).toBe(0);
    expect(hangar.status('swift')).toBe('owned');
    expect(hangar.selectedId).toBe('swift');
    expect(hangar.levels('swift')).toEqual(LV0);
    expect(hangar.buy('swift')).toBe('owned');
  });

  it('強化は 1 段ずつ価格を引き、機体ごとに独立。Lv5 の次は maxed', () => {
    const { save, hangar } = hangarWith(15_500 + 499);
    for (const price of UPGRADE_PRICES) {
      expect(hangar.upgradePrice('kestrel', 'engine')).toBe(price);
      expect(hangar.upgrade('kestrel', 'engine')).toBe('ok');
    }
    expect(hangar.levels('kestrel').engine).toBe(5);
    expect(hangar.credits).toBe(499);
    expect(hangar.upgrade('kestrel', 'engine')).toBe('maxed');
    expect(hangar.upgrade('kestrel', 'airframe')).toBe('insufficient');
    // 未所持の機体は強化できない
    save.data.credits = 100_000;
    expect(hangar.upgrade('swift', 'engine')).toBe('insufficient');
    expect(hangar.upgrade('vector', 'engine')).toBe('locked');
    hangar.buy('swift');
    expect(hangar.levels('swift').engine).toBe(0);
    expect(hangar.loadout('swift').flight.speed.afterburner).toBeCloseTo(400 * 1.12, 9);
  });

  it('所持していない機体は出撃機に選べない', () => {
    const { hangar } = hangarWith(0);
    expect(hangar.select('bastion')).toBe(false);
    expect(hangar.selectedId).toBe('kestrel');
  });

  it('新しく買える物ができたときだけ知らせる（報酬の前は買えず、後は買える）', () => {
    const { hangar } = hangarWith(0);
    expect(hangar.newlyAffordable(0, 400)).toBe(false);
    // Kestrel の強化 Lv1（500）
    expect(hangar.newlyAffordable(0, 500)).toBe(true);
    // 500〜7,999 の間には買える物の境目がない（1,000 は Lv2 なのでまだ買えない段）
    expect(hangar.newlyAffordable(600, 7_999)).toBe(false);
    expect(hangar.newlyAffordable(7_000, 8_000)).toBe(true);
    // Vector（25,000）は未解放なので数えない
    expect(hangar.newlyAffordable(20_000, 30_000)).toBe(false);
  });
});

describe('解放条件', () => {
  it('Vector は M4（strike）クリアで買えるようになる', () => {
    const vector = model('vector');
    expect(vector.unlockMission).toBe('strike');
    expect(MISSIONS.findIndex((m) => m.id === 'strike')).toBe(3);
    const locked = hangarWith(30_000);
    expect(locked.hangar.status('vector')).toBe('locked');
    expect(locked.hangar.buy('vector')).toBe('locked');
    const open = hangarWith(30_000, ['strike']);
    expect(open.hangar.status('vector')).toBe('buyable');
    expect(open.hangar.buy('vector')).toBe('ok');
    expect(open.hangar.credits).toBe(5_000);
  });

  it('M1〜M3 の報酬で Swift が買える（S なら 1 回ずつ、A なら M3 をもう 1 回）', () => {
    const base = MISSIONS.slice(0, 3).map((m) => m.reward.baseCredits);
    const sum = (rank: 'S' | 'A') =>
      base.reduce((t, c) => t + rewardCredits(c, rank, DEFAULT_RANK_MULTIPLIERS), 0);
    const swift = model('swift').price;
    expect(sum('S')).toBeGreaterThanOrEqual(swift);
    expect(sum('A') + rewardCredits(base[2] ?? 0, 'A')).toBeGreaterThanOrEqual(swift);
  });

  it('機体は 4 種で、Kestrel だけ初期所持', () => {
    expect(AIRCRAFT_MODELS.map((m) => m.id)).toEqual(['kestrel', 'swift', 'bastion', 'vector']);
    expect(AIRCRAFT_MODELS.map((m) => m.price)).toEqual([0, 8000, 12000, 25000]);
    const { hangar } = hangarWith(0);
    expect(AIRCRAFT_MODELS.map((m) => hangar.status(m.id))).toEqual([
      'owned',
      'buyable',
      'buyable',
      'locked',
    ]);
  });
});

describe('セーブ v1 → v2 の移行', () => {
  it('強化 Lv を 1 下げ（v1 の Lv1 = 未強化）、初期機の id を starter → kestrel にする', () => {
    const v1 = {
      ...createInitialSave(),
      version: 1,
      credits: 4200,
      aircraft: {
        selected: 'starter',
        owned: { starter: { engine: 1, airframe: 3, weapons: 5, avionics: 1 } },
      },
    };
    const save = migrateSave(JSON.parse(JSON.stringify(v1)));
    expect(save?.version).toBe(SAVE_CONFIG.version);
    expect(save?.credits).toBe(4200);
    expect(save?.aircraft).toEqual({
      selected: 'kestrel',
      owned: { kestrel: { engine: 0, airframe: 2, weapons: 4, avionics: 0 } },
    });
  });

  it('v1 の初期値（3-1 の新規セーブ）は v2 の初期値と同じになる', () => {
    const v1 = {
      ...createInitialSave(),
      version: 1,
      aircraft: {
        selected: 'starter',
        owned: { starter: Object.fromEntries(UPGRADE_KINDS.map((k) => [k, 1])) },
      },
    };
    expect(migrateSave(v1)).toEqual(createInitialSave());
  });
});
