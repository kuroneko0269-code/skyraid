// 10-4a: メカ怪獣ゴウライ: 決まった計算（同じ種で同じ状態・写して戻すと続きが同じ。リプレイは gourai-dev.test.ts）・NaN が出ない・
// 戦域から出ない・地形と海に潜らない（床から浮く）・弾の数の上限・砲台を壊すほど弾幕が薄い・死角・熱と放熱・核・後半・
// 一斉発射はフレアで外れる・回転掃射は高さを外せば当たらない
import { describe, expect, it } from 'vitest';
import { GouraiKaiju, type GouraiTarget } from '../src/ai/gourai-ai';
import type { Flare } from '../src/combat/flare';
import { Pool } from '../src/combat/pool';
import { GOURAI_CONFIG as C, GOURAI_PARTS, GOURAI_TARGET_SPHERES } from '../src/data/gourai';
import { HARBOR_MAP } from '../src/data/maps';
import type { GouraiPatrol } from '../src/entities/gourai/gourai-body';
import { vec3 } from '../src/flight/math';
import { ActiveMap } from '../src/missions/active-map';
import { bayPatrol } from '../src/missions/gourai-dev';
import { hashState, StateSnapshot } from '../src/replay/state-walk';

const DT = 1 / 60;
const island = new ActiveMap();
const harbor = new ActiveMap(HARBOR_MAP);
const PATROL: GouraiPatrol = { x: 500, z: -800, radius: C.patrol.radius };

type Path = 'front' | 'behindLow' | 'orbit' | 'high' | 'far' | 'side';

/** プレイヤーの代わり: 決まった動き（正面・後ろの下・周りを回る・真上の高く・遠く・横） */
function makeTarget(
  k: GouraiKaiju,
  path: Path,
): GouraiTarget & { position: ReturnType<typeof vec3>; t: number; tick(): void } {
  const pos = vec3();
  return {
    position: pos,
    active: true,
    id: 0,
    radius: 8,
    t: 0,
    tick() {
      this.t += DT;
      const b = k.body;
      const fx = -Math.sin(b.heading);
      const fz = -Math.cos(b.heading);
      if (path === 'front') {
        pos.x = b.position.x + fx * 700;
        pos.z = b.position.z + fz * 700;
        pos.y = b.position.y + 10;
      } else if (path === 'behindLow') {
        pos.x = b.position.x - fx * 500;
        pos.z = b.position.z - fz * 500;
        pos.y = b.position.y - 70;
      } else if (path === 'side') {
        pos.x = b.position.x - fz * 600;
        pos.z = b.position.z + fx * 600;
        pos.y = b.position.y + 20;
      } else if (path === 'orbit') {
        const a = this.t * 0.25;
        pos.x = b.position.x + Math.cos(a) * 900;
        pos.z = b.position.z + Math.sin(a) * 900;
        pos.y = b.position.y + 40 + Math.sin(a * 0.7) * 200;
      } else if (path === 'high') {
        pos.x = b.position.x + 200;
        pos.z = b.position.z;
        pos.y = b.position.y + 900;
      } else {
        const a = this.t * 0.1;
        pos.x = PATROL.x + Math.cos(a) * 3500;
        pos.z = PATROL.z + Math.sin(a) * 3500;
        pos.y = 30;
      }
    },
  };
}

function run(
  k: GouraiKaiju,
  path: Path,
  seconds: number,
  each?: (k: GouraiKaiju) => void,
  flares: Pool<Flare> | null = null,
): number {
  const t = makeTarget(k, path);
  let dmg = 0;
  for (let i = 0; i < seconds / DT; i++) {
    t.tick();
    k.step(DT, t, flares, (_kind, d) => {
      dmg += d;
    });
    each?.(k);
  }
  return dmg;
}

function mk(
  seed = 1234,
  ground = island.ordnanceGround,
  hp = 1,
  broken: string[] = [],
): GouraiKaiju {
  const k = new GouraiKaiju(ground);
  k.spawn(PATROL, PATROL.x, PATROL.z - PATROL.radius, 0, seed, hp, broken);
  return k;
}

function finiteAll(o: unknown, seen = new Set<unknown>()): boolean {
  if (typeof o === 'number') return Number.isFinite(o);
  if (o === null || typeof o !== 'object' || seen.has(o)) return true;
  seen.add(o);
  return Object.values(o as Record<string, unknown>).every((v) => finiteAll(v, seen));
}

const idx = (id: (typeof GOURAI_PARTS)[number]): number => GOURAI_PARTS.indexOf(id);

describe('メカ怪獣ゴウライ（10-4a）', () => {
  it('同じ種で同じ状態。写して戻すと続きが同じ。種が違えば別の動き', () => {
    const a = mk();
    const b = mk();
    run(a, 'orbit', 90);
    run(b, 'orbit', 90);
    expect(hashState([a])).toBe(hashState([b]));
    const snap = StateSnapshot.take([a]);
    run(a, 'side', 40);
    const h1 = hashState([a]);
    snap.restore();
    run(a, 'side', 40);
    expect(hashState([a])).toBe(h1);
    const c = mk(99);
    run(c, 'orbit', 90);
    expect(hashState([c])).not.toBe(hashState([b]));
  });

  it('7 分動かして NaN が出ない・戦域から出ない・床から浮く（島・港湾都市・いろいろな自機）。弾は上限を超えない', () => {
    for (const [map, patrol] of [
      [island, PATROL],
      [harbor, bayPatrol(HARBOR_MAP.center)],
    ] as const) {
      for (const path of ['orbit', 'front', 'behindLow', 'far', 'high'] as const) {
        const k = new GouraiKaiju(map.ordnanceGround);
        k.spawn(patrol, patrol.x, patrol.z + patrol.radius, 1, 7, path === 'high' ? 0.3 : 1);
        k.immortal = true;
        let minAgl = Infinity;
        let maxR = 0;
        let maxShots = 0;
        run(k, path, 420, (kk) => {
          const b = kk.body;
          minAgl = Math.min(minAgl, b.position.y - b.floorAt(b.position.x, b.position.z));
          maxR = Math.max(maxR, Math.hypot(b.position.x - b.arenaX, b.position.z - b.arenaZ));
          maxShots = Math.max(maxShots, kk.shots.activeCount);
          // 体の下（四隅）も床にめり込まない
        });
        expect(finiteAll(k)).toBe(true);
        expect(minAgl).toBeGreaterThanOrEqual(C.hover.min - 1e-6);
        expect(maxR).toBeLessThanOrEqual(C.arena.hard + 1e-6);
        expect(maxShots).toBeLessThanOrEqual(C.shotCap);
        expect(k.body.laps).toBeGreaterThan(0.2);
      }
    }
  });

  it('弾の数: 回転掃射の最中でもプールの上限（360）以内で、ほとんど溢れない', () => {
    const k = mk(5);
    k.immortal = true;
    let maxShots = 0;
    run(k, 'side', 300, (kk) => {
      maxShots = Math.max(maxShots, kk.shots.activeCount);
    });
    expect(k.attacksUsed.sweep).toBeGreaterThan(0);
    console.info(
      `gourai shots: max alive ${String(maxShots)} / ${String(C.shotCap)}, dropped ${String(k.shots.dropped)}, fired gun ${String(k.fired.gun)} missile ${String(k.fired.missile)}`,
    );
    expect(maxShots).toBeLessThanOrEqual(C.shotCap);
    expect(k.shots.dropped).toBeLessThanOrEqual(k.fired.gun * 0.02);
  });

  it('弾幕: 正面は厚く、後ろの下は死角。砲台を壊すほど目に見えて薄くなる', () => {
    const count = (path: Path, broken: string[]): number => {
      const k = mk(3, () => 0, 1, broken);
      k.immortal = true;
      // 大きな攻撃を出さずに弾幕だけを数える
      k.cooldown = 1e9;
      run(k, path, 60);
      return k.fired.gun + k.fired.missile;
    };
    const front = count('front', []);
    const side = count('side', []);
    const rear = count('behindLow', []);
    const frontHalf = count('front', ['gunL']);
    const frontNone = count('front', ['gunL', 'gunR']);
    const sideHalf = count('side', ['gunR', 'hipR']);
    console.info(
      `gourai barrage 60s: front ${String(front)} (gunL broken ${String(frontHalf)}, both ${String(frontNone)}), side ${String(side)} (right guns broken ${String(sideHalf)}), behind-low ${String(rear)}`,
    );
    expect(front).toBeGreaterThan(100);
    expect(rear).toBe(0);
    expect(frontHalf).toBeLessThan(front * 0.65);
    expect(frontNone).toBeLessThan(front * 0.1);
    expect(sideHalf).toBeLessThan(side * 0.2);
  });

  it('熱: 撃ち続けると放熱（装甲が開いて核が当たる・砲台が止まる）。閉じている間は核に当たらない。排気口を壊すと早くたまる', () => {
    const k = mk(8, () => 0);
    k.immortal = true;
    const core = GOURAI_TARGET_SPHERES.findIndex((s) => s.part === 'core');
    const armor = GOURAI_TARGET_SPHERES.findIndex((s) => s.part === 'armor');
    const hp0 = k.parts.hp;
    k.damageSphere(core, 100);
    expect(k.parts.hp).toBe(hp0);
    k.damageSphere(armor, 100);
    expect(k.parts.hp).toBeCloseTo(hp0 - 20, 5);
    let firstVent = -1;
    let ventFired = 0;
    run(k, 'front', 120, (kk) => {
      if (kk.action === 'vent' && firstVent < 0) firstVent = kk.elapsed;
      if (kk.action === 'vent')
        ventFired = Math.max(
          ventFired,
          kk.barrage.fired.reduce((s, v) => s + v, 0),
        );
    });
    expect(firstVent).toBeGreaterThan(0);
    expect(k.vents).toBeGreaterThan(0);
    // 放熱中は核に当たる
    const k2 = mk(8, () => 0);
    k2.immortal = true;
    run(k2, 'front', 120, (kk) => {
      if (kk.action !== 'vent' || kk.actionTime < 1 || kk.actionTime > 1 + DT) return;
      expect(kk.coreOpen).toBe(true);
      const before = kk.parts.partHp[idx('core')] ?? 0;
      kk.damageSphere(armor, 10);
      expect(kk.parts.partHp[idx('core')]).toBeCloseTo(before - 10, 5);
    });
    // 排気口を 2 つ壊すと熱が 2.25 倍たまる → 放熱が早い
    const k3 = mk(8, () => 0, 1, ['exhaustL', 'exhaustR']);
    k3.immortal = true;
    let vent3 = -1;
    run(k3, 'front', 120, (kk) => {
      if (kk.action === 'vent' && vent3 < 0) vent3 = kk.elapsed;
    });
    console.info(
      `gourai first vent: ${firstVent.toFixed(1)}s, exhausts broken ${vent3.toFixed(1)}s`,
    );
    expect(vent3).toBeGreaterThan(0);
    expect(vent3).toBeLessThan(firstVent);
  });

  it('後半: 核を壊すと装甲を捨て（3 秒）、速くなる。装甲は胴に、核は見えたまま', () => {
    const k = mk(4, () => 0);
    k.immortal = true;
    run(k, 'front', 5);
    const v1 = Math.hypot(k.body.velocity.x, k.body.velocity.z);
    k.parts.partHp[idx('core')] = 0;
    run(k, 'front', 1);
    expect(k.phase).toBe(2);
    expect(k.action).toBe('purge');
    k.cooldown = 1e9;
    run(k, 'orbit', 20);
    const v2 = Math.hypot(k.body.velocity.x, k.body.velocity.z);
    expect(v1).toBeLessThanOrEqual(C.patrol.speed + 0.5);
    expect(v2).toBeGreaterThan(C.patrol.speed * 1.8);
    expect(k.body.pose.purge).toBe(1);
    const armor = GOURAI_TARGET_SPHERES.findIndex((s) => s.part === 'armor');
    const hp = k.parts.hp;
    k.damageSphere(armor, 100);
    expect(k.parts.hp).toBeCloseTo(hp - 100, 5);
    // 体力 40% 未満でも後半（核は見えたまま）
    const k2 = mk(4, () => 0, 0.35);
    expect(k2.phase).toBe(2);
    expect(k2.coreOpen).toBe(true);
  });
});
