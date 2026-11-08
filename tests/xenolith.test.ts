// 10-5a: UFO ゼノリス: 決まった計算（同じ種で同じ状態・写して戻すと続きが同じ。リプレイは xenolith-dev.test.ts）・NaN が出ない・
// 戦域から出ない・地形と海に潜らない・速さ（巡航・急停止・急加速）・瞬間移動（移る先が先に光る・狙う人から離れる・発光体で間隔が延びる）・
// バリア（光線の前に外れる・殻の中は効かない・発生器は当たる・発生器で長く外れる）・光線（予兆を見て避ければ当たらない）・段階
import { describe, expect, it } from 'vitest';
import { XenolithKaiju, type XenolithTarget } from '../src/ai/xenolith-ai';
import {
  XENOLITH_CONFIG as C,
  XENOLITH_PARTS,
  XENOLITH_TARGET_SPHERES,
} from '../src/data/xenolith';
import { HARBOR_MAP } from '../src/data/maps';
import { vec3, type Vec3 } from '../src/flight/math';
import { ActiveMap } from '../src/missions/active-map';
import { hashState, StateSnapshot } from '../src/replay/state-walk';

const DT = 1 / 60;
const island = new ActiveMap();
const harbor = new ActiveMap(HARBOR_MAP);
const flat = (): number => 0;
const sphereOf = (part: (typeof XENOLITH_PARTS)[number]): number =>
  XENOLITH_TARGET_SPHERES.findIndex((s) => s.part === part);

type Path = 'orbit' | 'still' | 'far' | 'low' | 'high' | 'chase';

function makeTarget(
  k: XenolithKaiju,
  path: Path,
  cx = 0,
  cz = 0,
): XenolithTarget & { position: Vec3; t: number; tick(): void } {
  const pos = vec3(cx, 500, cz);
  return {
    position: pos,
    active: true,
    id: 0,
    radius: 8,
    t: 0,
    tick() {
      this.t += DT;
      const a = this.t;
      if (path === 'orbit') {
        pos.x = cx + Math.cos(a * 0.15) * 1200;
        pos.z = cz + Math.sin(a * 0.15) * 1200;
        pos.y = 450 + Math.sin(a * 0.4) * 200;
      } else if (path === 'far') {
        pos.x = cx + Math.cos(a * 0.06) * 3800;
        pos.z = cz + Math.sin(a * 0.06) * 3800;
        pos.y = 300;
      } else if (path === 'low') {
        pos.x = cx + Math.cos(a * 0.12) * 1500;
        pos.z = cz + Math.sin(a * 0.12) * 1500;
        pos.y = 60;
      } else if (path === 'high') {
        pos.y = 2600;
      } else if (path === 'chase') {
        // 体の後ろ 300m を追う（自機が追いかける形）
        const b = k.body.position;
        pos.x = b.x + 300;
        pos.y = b.y + 20;
        pos.z = b.z + 200;
      }
    },
  };
}

function spawnAt(k: XenolithKaiju, seed = 5, hp = 1, broken: readonly string[] = []): void {
  k.spawn(0, 600, -1500, 0, seed, hp, broken);
  k.immortal = true;
}

describe('UFO ゼノリス（10-5a）', () => {
  it('決まった計算: 同じ種で同じ状態のハッシュ・写して戻すと続きが同じ・種が違えば違う', () => {
    const go = (seed: number, sec: number): XenolithKaiju => {
      const k = new XenolithKaiju(island.ground);
      spawnAt(k, seed);
      const t = makeTarget(k, 'orbit');
      for (let i = 0; i < sec / DT; i++) {
        t.tick();
        k.step(DT, t);
      }
      return k;
    };
    const a = go(3, 90);
    const b = go(3, 90);
    expect(hashState([a])).toBe(hashState([b]));
    expect(hashState([go(4, 90)])).not.toBe(hashState([a]));
    // 写して 30 秒進め、戻してもう一度 30 秒進めると同じ
    const k = go(9, 40);
    const t = makeTarget(k, 'orbit');
    const snap = StateSnapshot.take([k]);
    const tick = (): void => {
      for (let i = 0; i < 30 / DT; i++) {
        t.tick();
        k.step(DT, t);
      }
    };
    const t0 = t.t;
    tick();
    const h1 = hashState([k]);
    snap.restore();
    t.t = t0;
    tick();
    expect(hashState([k])).toBe(h1);
    expect(a.warp.warps).toBeGreaterThan(3);
    expect(a.attacksUsed.sweep + a.attacksUsed.charged).toBeGreaterThan(5);
  });

  it('7 分動かしても NaN が出ない・戦域から出ない・床（地形・建物・海）+ 90m より下へ行かない・天井より上へ行かない', () => {
    for (const [map, cx, cz] of [
      [island, island.def.center.x, island.def.center.z],
      [harbor, 0, 2700],
    ] as const) {
      for (const path of ['orbit', 'far', 'low', 'high', 'chase'] as const) {
        const k = new XenolithKaiju(map.ground);
        k.spawn(cx, 300, cz - 1500, 0, 21, 1);
        k.body.arenaX = map.def.center.x;
        k.body.arenaZ = map.def.center.z;
        k.immortal = true;
        const t = makeTarget(k, path, cx, cz);
        let minAgl = Infinity;
        let maxR = 0;
        for (let i = 0; i < 420 / DT; i++) {
          t.tick();
          k.step(DT, t);
          const p = k.body.position;
          expect(Number.isFinite(p.x + p.y + p.z + k.body.heading)).toBe(true);
          minAgl = Math.min(minAgl, p.y - k.body.floorAt(p.x, p.z));
          maxR = Math.max(maxR, Math.hypot(p.x - k.body.arenaX, p.z - k.body.arenaZ));
          expect(p.y).toBeLessThanOrEqual(C.floor.ceiling + 1e-6);
        }
        expect(minAgl, `${map.def.id} ${path}`).toBeGreaterThanOrEqual(C.floor.min - 1e-6);
        expect(maxR, `${map.def.id} ${path}`).toBeLessThanOrEqual(C.arena.hard + 1e-6);
      }
    }
  });

  it('速さ: 巡航は 150 前後、急加速で 300 を超え、急停止でほぼ 0 に（光線の間も止まる）', () => {
    const k = new XenolithKaiju(flat);
    spawnAt(k);
    const t = makeTarget(k, 'still');
    let maxSpeed = 0;
    let stopped = 0;
    let dashes = 0;
    let last = k.body.move;
    for (let i = 0; i < 120 / DT; i++) {
      t.tick();
      k.step(DT, t);
      const s = k.body.speed;
      if (!k.body.warped) maxSpeed = Math.max(maxSpeed, s);
      if (k.body.move === 'stop' && s < 5) stopped++;
      if (k.body.move === 'dash' && last !== 'dash') dashes++;
      if (k.holding && k.beam.phase === 'fire') expect(s).toBeLessThan(10);
      last = k.body.move;
    }
    expect(maxSpeed).toBeGreaterThan(300);
    expect(maxSpeed).toBeLessThan(450);
    expect(stopped).toBeGreaterThan(0);
    expect(dashes).toBeGreaterThan(5);
  });

  it('瞬間移動: 移る先が 1.2 秒前から光り（予兆）、その位置へ移る。狙う人から 500m 以上・床の上。直後 1 秒は光線を始めない', () => {
    const k = new XenolithKaiju(island.ground);
    spawnAt(k);
    const t = makeTarget(k, 'orbit');
    let telegraphFrom = -1;
    let warps = 0;
    let lastArrive = -99;
    for (let i = 0; i < 180 / DT; i++) {
      t.tick();
      const before = k.warp.phase;
      const startedBeam = k.beam.busy;
      k.step(DT, t);
      const now = i * DT;
      if (before === 'idle' && k.warp.phase === 'telegraph') telegraphFrom = now;
      if (k.body.warped) {
        warps++;
        expect(now - telegraphFrom).toBeGreaterThanOrEqual(C.warp.telegraph - 2 * DT);
        const d = k.warp.destination;
        const p = k.body.position;
        expect(Math.hypot(p.x - d.x, p.y - d.y, p.z - d.z)).toBe(0);
        expect(Math.hypot(p.x - t.position.x, p.z - t.position.z)).toBeGreaterThan(300);
        expect(p.y - k.body.floorAt(p.x, p.z)).toBeGreaterThanOrEqual(C.floor.min - 1e-6);
        lastArrive = now;
      }
      if (!startedBeam && k.beam.phaseIndex !== 0)
        expect(now - lastArrive).toBeGreaterThanOrEqual(C.warp.afterWarp - 2 * DT);
    }
    expect(warps).toBeGreaterThanOrEqual(8);
  });

  it('瞬間移動: 縁の発光体を壊すと 1 つにつき間隔 +3 秒、4 つで使わない。ドームを壊すと予兆が 1.5 倍長い。段階 2 で短い', () => {
    const count = (broken: string[], hp = 1): number => {
      const k = new XenolithKaiju(flat);
      spawnAt(k, 5, hp, broken);
      const t = makeTarget(k, 'orbit');
      for (let i = 0; i < 180 / DT; i++) {
        t.tick();
        k.step(DT, t);
      }
      return k.warp.warps;
    };
    const none = count([]);
    const two = count(['emitter0', 'emitter2']);
    expect(two).toBeLessThan(none);
    expect(count(['emitter0', 'emitter1', 'emitter2', 'emitter3'])).toBe(0);
    expect(count([], 0.5)).toBeGreaterThan(none);
    const k = new XenolithKaiju(flat);
    spawnAt(k, 5, 1, ['dome', 'emitter1']);
    expect(k.warpInterval).toBeCloseTo(C.warp.interval + C.warp.perEmitter, 5);
    k.step(DT, makeTarget(k, 'still'));
    expect(k.warp.spec.telegraph).toBeCloseTo(C.warp.telegraph * 1.5, 5);
  });

  it('バリア: 光線を撃つ前に外れ、撃つ間は必ず外れている。張っている間は殻の中の部位に効かず（波紋）、下の発生器には効く', () => {
    const k = new XenolithKaiju(flat);
    spawnAt(k);
    k.immortal = false;
    const t = makeTarget(k, 'orbit');
    expect(k.barrier.absorbs).toBe(true);
    const hp = k.parts.hp;
    expect(k.damageSphere(sphereOf('dome'), 100)).toBe(false);
    expect(k.parts.hp).toBe(hp);
    expect(k.absorbed).toBe(1);
    expect(k.rippleSphere).toBe(sphereOf('dome'));
    k.damageSphere(sphereOf('gen1'), 50);
    expect(k.parts.hp).toBeCloseTo(hp - 50, 5);
    let fires = 0;
    let downDuringFire = 0;
    let downWhileIdle = 0;
    for (let i = 0; i < 120 / DT; i++) {
      t.tick();
      k.step(DT, t);
      if (k.beam.phase === 'fire') {
        fires++;
        if (!k.barrier.absorbs) downDuringFire++;
      }
      if (!k.beam.busy && !k.barrier.absorbs) downWhileIdle++;
    }
    expect(fires).toBeGreaterThan(0);
    expect(downDuringFire).toBe(fires);
    // 硬直の後も down 秒は外れている（攻めどき）
    expect(downWhileIdle).toBeGreaterThan(0);
    // 外れている間は胴・ドームに効く（ドームは ×1.8）
    k.barrier.phase = 'down';
    const before = k.parts.hp;
    k.damageSphere(sphereOf('dome'), 100);
    expect(before - k.parts.hp).toBeCloseTo(180, 5);
  });

  it('バリア: 発生器を壊すと外れている時間が 1 つにつき ×1.5、3 つで瞬間移動の後にも外れる', () => {
    // afterWarp: 移った直後にバリアが張ったままだった回数
    const downTime = (broken: string[]): { down: number; afterWarp: number } => {
      const k = new XenolithKaiju(flat);
      spawnAt(k, 5, 1, broken);
      const t = makeTarget(k, 'orbit');
      let down = 0;
      let afterWarp = 0;
      for (let i = 0; i < 120 / DT; i++) {
        t.tick();
        k.step(DT, t);
        if (!k.barrier.absorbs) down += DT;
        if (k.body.warped && k.barrier.phase === 'up') afterWarp++;
      }
      return { down, afterWarp };
    };
    const a = downTime([]);
    const b = downTime(['gen0']);
    const c = downTime(['gen0', 'gen1', 'gen2']);
    expect(b.down).toBeGreaterThan(a.down);
    expect(c.down).toBeGreaterThan(b.down);
    expect(a.afterWarp).toBeGreaterThan(0);
    expect(c.afterWarp).toBe(0);
  });

  it('段階: 体力 60% 未満で 2（速い）、30% 未満で 3（溜め撃ちの後に続けてなぎ払う。ドームを壊すと続けない）', () => {
    const run = (hp: number, broken: string[] = []): XenolithKaiju => {
      const k = new XenolithKaiju(flat);
      spawnAt(k, 8, hp, broken);
      const t = makeTarget(k, 'orbit');
      for (let i = 0; i < 180 / DT; i++) {
        t.tick();
        k.step(DT, t);
      }
      return k;
    };
    expect(run(0.5).stage).toBe(2);
    expect(run(0.5).body.speedMul).toBeGreaterThan(1);
    const late = run(0.25);
    expect(late.stage).toBe(3);
    expect(late.combos).toBeGreaterThan(0);
    expect(run(0.25, ['dome']).combos).toBe(0);
    expect(run(1).combos).toBe(0);
  });
});
