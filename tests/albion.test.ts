// 10-3a: 白鯨アルビオン: 決まった計算（同じ種で同じ状態・写して戻すと続きが同じ。リプレイは albion-dev.test.ts）・NaN が出ない・
// 戦域から出ない・地形と海に潜らない・子分の上限・巣を壊すと出ない・攻撃の当たり（予兆の間は当たらない）・部位で攻撃が止まる
import { describe, expect, it } from 'vitest';
import { AlbionKaiju, type AlbionTarget } from '../src/ai/albion-ai';
import { inSlam, inSpout, blowhole } from '../src/ai/albion-attacks';
import { ALBION_CONFIG as C, ALBION_PARTS } from '../src/data/albion';
import { HARBOR_MAP } from '../src/data/maps';
import { routeLength, routePoint, type AlbionRoute } from '../src/entities/albion/albion-route';
import { vec3 } from '../src/flight/math';
import { ActiveMap } from '../src/missions/active-map';
import { hashState, StateSnapshot } from '../src/replay/state-walk';

const DT = 1 / 60;
const island = new ActiveMap();
const harbor = new ActiveMap(HARBOR_MAP);
const ROUTE: AlbionRoute = {
  x: 600,
  z: -300,
  axis: 0.7,
  halfLength: C.route.halfLength,
  turnRadius: C.route.turnRadius,
};

type Path = 'above' | 'behind' | 'orbit' | 'low';

/** プレイヤーの代わり: 決まった動き（背の上・尾の後ろ・周りを回る・海面すれすれ） */
function makeTarget(
  k: AlbionKaiju,
  path: Path,
): AlbionTarget & { position: { x: number; y: number; z: number }; t: number; tick(): void } {
  const pos = vec3();
  return {
    position: pos,
    active: true,
    t: 0,
    tick() {
      this.t += DT;
      const b = k.body;
      const fx = -Math.sin(b.heading);
      const fz = -Math.cos(b.heading);
      if (path === 'above') {
        pos.x = b.position.x + fx * 150;
        pos.z = b.position.z + fz * 150;
        pos.y = b.position.y + 200;
      } else if (path === 'behind') {
        pos.x = b.position.x - fx * 450;
        pos.z = b.position.z - fz * 450;
        pos.y = b.position.y + 20;
      } else if (path === 'orbit') {
        const a = this.t * 0.3;
        pos.x = b.position.x + Math.cos(a) * 900;
        pos.z = b.position.z + Math.sin(a) * 900;
        pos.y = b.position.y + Math.sin(a * 0.7) * 300;
      } else {
        const a = this.t * 0.2;
        pos.x = ROUTE.x + Math.cos(a) * 2200;
        pos.z = ROUTE.z + Math.sin(a) * 2200;
        pos.y = 12;
      }
    },
  };
}

function run(k: AlbionKaiju, path: Path, seconds: number, each?: (k: AlbionKaiju) => void): number {
  const t = makeTarget(k, path);
  let dmg = 0;
  for (let i = 0; i < seconds / DT; i++) {
    t.tick();
    k.step(DT, t, (_kind, d) => {
      dmg += d;
    });
    each?.(k);
  }
  return dmg;
}

function finiteAll(o: unknown, seen = new Set<unknown>()): boolean {
  if (typeof o === 'number') return Number.isFinite(o);
  if (o === null || typeof o !== 'object' || seen.has(o)) return true;
  seen.add(o);
  return Object.values(o as Record<string, unknown>).every((v) => finiteAll(v, seen));
}

describe('白鯨アルビオン（10-3a）', () => {
  it('周回路: 位置と向きが続いていて（跳ばない）、1 周で元に戻る', () => {
    const len = routeLength(ROUTE);
    const p = { x: 0, z: 0, heading: 0, turning: false };
    const q = { ...p };
    routePoint(ROUTE, 0, q);
    for (let s = 1; s <= len; s += 1) {
      routePoint(ROUTE, s, p);
      expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThan(1.01);
      const dh = Math.atan2(Math.sin(p.heading - q.heading), Math.cos(p.heading - q.heading));
      expect(Math.abs(dh)).toBeLessThan(1.2 / C.route.turnRadius + 1e-6);
      Object.assign(q, p);
    }
    routePoint(ROUTE, 0, q);
    routePoint(ROUTE, len, p);
    expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThan(1e-6);
  });

  it('同じ種で同じ状態。写して戻すと続きが同じ', () => {
    const mk = () => {
      const k = new AlbionKaiju(island.ordnanceGround);
      k.spawn(ROUTE, 300, 1234);
      return k;
    };
    const a = mk();
    const b = mk();
    run(a, 'orbit', 120);
    run(b, 'orbit', 120);
    expect(hashState([a])).toBe(hashState([b]));
    const snap = StateSnapshot.take([a]);
    run(a, 'behind', 60);
    const h1 = hashState([a]);
    snap.restore();
    run(a, 'behind', 60);
    expect(hashState([a])).toBe(h1);
    // 種が違えば別の動き
    const c = new AlbionKaiju(island.ordnanceGround);
    c.spawn(ROUTE, 300, 99);
    run(c, 'orbit', 120);
    expect(hashState([c])).not.toBe(hashState([b]));
  });

  it('7 分動かしても NaN が出ず、戦域から出ず、地形・海に潜らない（子分も）。子分は上限まで', () => {
    for (const [map, path] of [
      [island, 'orbit'],
      [harbor, 'low'],
      [island, 'above'],
    ] as const) {
      const k = new AlbionKaiju(map.ordnanceGround);
      k.spawn(ROUTE, 0, 7, 0.5);
      let maxActive = 0;
      let minGap = Infinity;
      run(k, path, 420, (kk) => {
        const b = kk.body.position;
        expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(C.arena.hard + 1e-6);
        minGap = Math.min(minGap, b.y - Math.max(0, map.ordnanceGround(b.x, b.z)));
        const n = kk.swarm.activeCount;
        expect(n).toBeLessThanOrEqual(C.minions.cap);
        maxActive = Math.max(maxActive, n);
        for (const m of kk.swarm.minions) {
          if (!m.active) continue;
          expect(Math.hypot(m.position.x, m.position.z)).toBeLessThanOrEqual(C.arena.hard + 1e-6);
          expect(m.position.y).toBeGreaterThanOrEqual(
            Math.max(0, map.ordnanceGround(m.position.x, m.position.z)) + C.minionFloor - 1e-6,
          );
        }
      });
      expect(finiteAll(k)).toBe(true);
      expect(minGap).toBeGreaterThanOrEqual(C.floor.min);
      // 10-3b: 同時に飛べる数はソロ 12（プールは協力 4 人の 16）
      expect(maxActive).toBe(k.swarm.limit);
      expect(k.body.laps).toBeGreaterThanOrEqual(1);
      expect(k.swarm.spawned).toBeGreaterThan(C.minions.cap);
    }
  });

  it('巣を壊すとそこから出ない。3 つとも壊すと出ない', () => {
    const k = new AlbionKaiju(island.ordnanceGround);
    k.spawn(ROUTE, 0, 3, 1, ['nestFront', 'nestMid']);
    run(k, 'orbit', 120);
    expect(k.swarm.spawned).toBeGreaterThan(0);
    for (const m of k.swarm.minions) if (m.active) expect(m.nest).toBe(2);
    const k2 = new AlbionKaiju(island.ordnanceGround);
    k2.spawn(ROUTE, 0, 3, 1, ['nestFront', 'nestMid', 'nestRear']);
    run(k2, 'orbit', 120);
    expect(k2.swarm.spawned).toBe(0);
    expect(k2.nestsGone).toBe(true);
  });

  it('潮吹きは背の上に、叩きつけは尾の後ろに当たる。予兆の間は当たらない', () => {
    const k = new AlbionKaiju(island.ordnanceGround);
    k.spawn(ROUTE, 0, 5);
    const hits: string[] = [];
    const t = makeTarget(k, 'above');
    let windupHit = false;
    for (let i = 0; i < 90 / DT; i++) {
      t.tick();
      const before = hits.length;
      k.step(DT, t, (kind) => hits.push(kind));
      if (hits.length > before && k.action === 'windup') windupHit = true;
    }
    expect(windupHit).toBe(false);
    expect(hits).toContain('spout');
    expect(k.attacksUsed.spout).toBeGreaterThan(0);
    // 柱の形: 噴気孔の真上 300m は中、横 200m は外
    const h = blowhole(vec3(), k.body);
    expect(inSpout(k.body, 1, { x: h.x, y: h.y + 300, z: h.z })).toBe(true);
    expect(inSpout(k.body, 1, { x: h.x + 200, y: h.y + 300, z: h.z })).toBe(false);
    // 尾の後ろ
    const k2 = new AlbionKaiju(island.ordnanceGround);
    k2.spawn(ROUTE, 0, 5);
    const slamHits: string[] = [];
    run(k2, 'behind', 90);
    const t2 = makeTarget(k2, 'behind');
    for (let i = 0; i < 90 / DT; i++) {
      t2.tick();
      k2.step(DT, t2, (kind) => slamHits.push(kind));
    }
    expect(k2.attacksUsed.slam).toBeGreaterThan(0);
    expect(slamHits).toContain('slam');
    const fx = -Math.sin(k2.body.heading);
    const fz = -Math.cos(k2.body.heading);
    const b = k2.body.position;
    expect(inSlam(k2.body, 300, { x: b.x - fx * 400, y: b.y, z: b.z - fz * 400 })).toBe(true);
    expect(inSlam(k2.body, 300, { x: b.x + fx * 400, y: b.y, z: b.z + fz * 400 })).toBe(false);
  });

  it('部位: 尾を壊すと叩きつけを使わない・頭を壊すと雲を出さない・段階が下がると雲が加わる', () => {
    const k = new AlbionKaiju(island.ordnanceGround);
    k.spawn(ROUTE, 0, 8, 0.5, ['tail', 'head']);
    run(k, 'behind', 300);
    expect(k.attacksUsed.slam).toBe(0);
    expect(k.attacksUsed.cloud).toBe(0);
    const k2 = new AlbionKaiju(island.ordnanceGround);
    k2.spawn(ROUTE, 0, 8, 0.5);
    expect(k2.phase).toBe(2);
    run(k2, 'orbit', 300);
    expect(k2.attacksUsed.cloud).toBeGreaterThan(0);
    // 段階 1 では雲を出さない
    const k3 = new AlbionKaiju(island.ordnanceGround);
    k3.spawn(ROUTE, 0, 8, 1);
    run(k3, 'orbit', 200);
    expect(k3.attacksUsed.cloud).toBe(0);
    // 体力が境目を下回ると段階が上がって吠える
    k3.parts.hp = k3.parts.maxHp * 0.25;
    k3.step(DT, { position: { x: 0, y: 5000, z: 0 }, active: false });
    expect(k3.phase).toBe(3);
    expect(k3.action).toBe('roar');
    expect(ALBION_PARTS.length).toBe(k3.parts.count);
  });
});
