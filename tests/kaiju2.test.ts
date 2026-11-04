// 9-6a: 空の怪獣ネフィルガ（?dev=kaiju2）: 決定性・NaN が出ない・戦域から出ない・地形に潜らない・攻撃と止まり木・
// 部位の壊れ・リプレイで同じ結果・付けていないときは今までと同じ（ハッシュ）
import { describe, expect, it } from 'vitest';
import { attackCandidates, attackUsable } from '../src/ai/kaiju2-attacks';
import { Kaiju2Ai, type Kaiju2Target } from '../src/ai/kaiju2-ai';
import { parseDevFlags } from '../src/core/debug-flags';
import {
  KAIJU2_CONFIG as C,
  KAIJU2_PARTS,
  type Kaiju2Attack,
  type Kaiju2Part,
} from '../src/data/kaiju2';
import { SkyKaiju } from '../src/entities/kaiju2/sky-kaiju';
import { ActiveMap } from '../src/missions/active-map';
import { attachFreeExtra } from '../src/missions/free-extra';
import { attachKaiju2Dev, parseKaiju2Options } from '../src/missions/kaiju2-dev';
import { simHash } from '../src/replay/sim';
import { hashState } from '../src/replay/state-walk';
import { BASE_START, createWorld, record, replay } from './replay-helpers';

const DT = 1 / 60;
const island = new ActiveMap();
const ground = island.ground;

/** プレイヤーの代わり: 決まった動き（周回・地面すれすれ・止まる・怪獣にくっつく） */
type Path = 'orbit' | 'low' | 'still' | 'far' | 'hug' | 'above' | 'chase';

function makeTarget(): Kaiju2Target & {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
} {
  return {
    position: { x: 0, y: 800, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    active: true,
  };
}

function moveTarget(t: ReturnType<typeof makeTarget>, path: Path, time: number, k: SkyKaiju): void {
  const p = t.position;
  const ox = p.x;
  const oy = p.y;
  const oz = p.z;
  switch (path) {
    case 'orbit':
      p.x = Math.cos(time * 0.09) * 2200;
      p.z = Math.sin(time * 0.09) * 2200;
      p.y = 700 + Math.sin(time * 0.2) * 300;
      break;
    case 'low':
      p.x = Math.cos(time * 0.05) * 3800;
      p.z = Math.sin(time * 0.05) * 3800;
      p.y = Math.max(0, ground(p.x, p.z)) + 60;
      break;
    case 'still':
      p.x = 500;
      p.y = Math.max(0, ground(500, -400)) + 300;
      p.z = -400;
      break;
    case 'far':
      p.x = 5900;
      p.y = 3000;
      p.z = 0;
      break;
    case 'hug':
      p.x = k.position.x;
      p.y = k.position.y;
      p.z = k.position.z;
      break;
    case 'chase': {
      // 後ろ 220m を追いかける（尾の打ち払いの間合い）
      const f = k.forward;
      p.x = k.position.x - f.x * 220;
      p.y = k.position.y - f.y * 220 + 20;
      p.z = k.position.z - f.z * 220;
      break;
    }
    case 'above':
      p.x = k.position.x + 200;
      p.y = k.position.y + 900;
      p.z = k.position.z;
      break;
  }
  t.velocity.x = (p.x - ox) / DT;
  t.velocity.y = (p.y - oy) / DT;
  t.velocity.z = (p.z - oz) / DT;
}

interface RunResult {
  k: SkyKaiju;
  hits: Record<Kaiju2Attack, number>;
  attacks: Set<Kaiju2Attack>;
  states: Set<string>;
  worstFloor: number;
  worstArena: number;
  nan: boolean;
}

function run(
  seed: number,
  seconds: number,
  path: Path,
  o: { hp?: number; broken?: readonly Kaiju2Part[]; x?: number; z?: number } = {},
): RunResult {
  const k = new SkyKaiju(ground);
  for (const part of o.broken ?? []) k.broken[part] = true;
  k.setHpRatio(o.hp ?? 1);
  const hits: Record<Kaiju2Attack, number> = { orbs: 0, gust: 0, dive: 0, tail: 0 };
  const ai = new Kaiju2Ai(k, { hit: (a) => hits[a]++ });
  ai.spawn(o.x ?? 2000, 750, o.z ?? 0, 1.2, seed);
  const t = makeTarget();
  const attacks = new Set<Kaiju2Attack>();
  const states = new Set<string>();
  let worstFloor = Infinity;
  let worstArena = 0;
  let nan = false;
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    moveTarget(t, path, i * DT, k);
    ai.step(DT, t, null);
    if (k.attack) attacks.add(k.attack);
    states.add(k.state);
    const min =
      k.state === 'perched' || k.state === 'landing' || k.state === 'takeoff'
        ? C.perch.standHeight
        : C.bodyClearance;
    worstFloor = Math.min(worstFloor, k.position.y - k.floorAt(k.position.x, k.position.z) - min);
    worstArena = Math.max(worstArena, Math.hypot(k.position.x, k.position.z));
    const nums = [
      k.position.x,
      k.position.y,
      k.position.z,
      k.forward.x,
      k.forward.y,
      k.forward.z,
      k.speed,
      k.bank,
      k.pose.flapPhase,
      k.pose.wingFold,
      ...k.orbs.flatMap((b) => [b.position.x, b.position.y, b.position.z, b.velocity.x]),
    ];
    if (nums.some((n) => !Number.isFinite(n))) nan = true;
  }
  return { k, hits, attacks, states, worstFloor, worstArena, nan };
}

describe('ネフィルガの動き（9-6a）', () => {
  it('同じ種・同じ相手の動きなら同じ結果。種が違えば違う', () => {
    const a = run(11, 90, 'orbit', { hp: 0.6 });
    const b = run(11, 90, 'orbit', { hp: 0.6 });
    const c = run(12, 90, 'orbit', { hp: 0.6 });
    expect(hashState([a.k])).toBe(hashState([b.k]));
    expect(hashState([a.k])).not.toBe(hashState([c.k]));
  });

  const paths: Path[] = ['orbit', 'low', 'still', 'far', 'hug', 'above', 'chase'];
  it.each(paths)(
    'NaN が出ない・戦域の外へ出ない・地形と海に潜らない（相手: %s、段階 1〜3・部位の壊れ）',
    (path) => {
      const cases: { hp: number; broken: Kaiju2Part[] }[] = [
        { hp: 1, broken: [] },
        { hp: 0.6, broken: [] },
        { hp: 0.3, broken: [] },
        { hp: 0.3, broken: ['wingL'] },
        { hp: 0.5, broken: ['wingL', 'wingR', 'tail', 'head'] },
      ];
      for (const [i, cs] of cases.entries()) {
        const r = run(100 + i, 240, path, cs);
        expect(r.nan).toBe(false);
        expect(r.worstArena).toBeLessThanOrEqual(C.arena.hard + 1e-6);
        expect(r.worstFloor).toBeGreaterThanOrEqual(-1e-6);
      }
    },
  );

  it('戦域の端から出しても中へ戻る（港の外の海の上から）', () => {
    const r = run(3, 120, 'far', { x: 4990, z: 0 });
    expect(r.worstArena).toBeLessThanOrEqual(C.arena.hard + 1e-6);
    expect(Math.hypot(r.k.position.x, r.k.position.z)).toBeLessThan(C.arena.hard);
  });

  it('段階 2 以上では 4 種の攻撃をすべて使い、止まり木に降りる（攻める隙）', () => {
    const seen = new Set<Kaiju2Attack>();
    const states = new Set<string>();
    for (const path of ['orbit', 'low', 'still', 'chase'] as Path[])
      for (const seed of [1, 2, 3]) {
        const r = run(seed, 300, path, { hp: 0.5 });
        for (const a of r.attacks) seen.add(a);
        for (const s of r.states) states.add(s);
      }
    expect([...seen].sort()).toEqual(['dive', 'gust', 'orbs', 'tail']);
    expect(states.has('perched')).toBe(true);
    expect(states.has('takeoff')).toBe(true);
  });

  it('段階 1 は急降下を使わない', () => {
    for (const seed of [1, 2, 3])
      expect(run(seed, 200, 'low', { hp: 1 }).attacks.has('dive')).toBe(false);
  });

  it('攻撃は当たることがある（数値は仮）。当たりは 1 回の攻撃で 1 回まで', () => {
    const r = run(5, 300, 'still', { hp: 0.5 });
    const total = r.hits.orbs + r.hits.gust + r.hits.dive + r.hits.tail;
    expect(total).toBeGreaterThan(0);
    expect(r.k.hits).toEqual(r.hits);
  });

  it('壊れた部位で使えない攻撃: 翼 → 突風・急降下 / 頭 → 雷球 / 尾 → 尾の打ち払い', () => {
    const none = { wingL: false, wingR: false, head: false, tail: false };
    expect(KAIJU2_PARTS.length).toBe(4);
    expect(attackUsable('gust', { ...none, wingR: true })).toBe(false);
    expect(attackUsable('dive', { ...none, wingL: true })).toBe(false);
    expect(attackUsable('orbs', { ...none, head: true })).toBe(false);
    expect(attackUsable('tail', { ...none, tail: true })).toBe(false);
    for (const seed of [1, 2]) {
      const r = run(seed, 240, 'still', { hp: 0.3, broken: ['wingL', 'head'] });
      expect(r.attacks.has('gust') || r.attacks.has('dive') || r.attacks.has('orbs')).toBe(false);
    }
  });

  it('尾が壊れると大回り、翼が壊れると遅く低い', () => {
    const k = new SkyKaiju(ground);
    const turn = k.turnRate;
    const speed = k.cruiseSpeed;
    const ceiling = k.ceiling;
    k.broken.tail = true;
    expect(k.turnRate).toBeLessThan(turn);
    k.broken.tail = false;
    k.broken.wingL = true;
    expect(k.cruiseSpeed).toBeLessThan(speed);
    expect(k.ceiling).toBeLessThan(ceiling);
  });

  it('攻撃の候補: 後ろの近く → 尾、正面の近く → 突風、下にいる（段階 2）→ 急降下、遠く → 雷球', () => {
    const ok = { wingL: false, wingR: false, head: false, tail: false };
    expect(attackCandidates({ distance: 200, angle: 170, drop: 0 }, 1, ok, [])[0]).toBe('tail');
    expect(attackCandidates({ distance: 600, angle: 10, drop: 0 }, 1, ok, [])[0]).toBe('gust');
    expect(attackCandidates({ distance: 1500, angle: 90, drop: 400 }, 2, ok, [])).toEqual([
      'dive',
      'orbs',
    ]);
    expect(attackCandidates({ distance: 1500, angle: 90, drop: 400 }, 1, ok, [])).toEqual(['orbs']);
    // 同じ攻撃を 3 回続けない
    expect(
      attackCandidates({ distance: 1500, angle: 90, drop: 0 }, 1, ok, ['orbs', 'orbs']),
    ).toEqual([]);
  });
});

describe('?dev=kaiju2 の確かめる場（9-6a）', () => {
  it('URL の dev フラグ', () => {
    expect([...parseDevFlags('?dev=kaiju2')]).toEqual(['kaiju2']);
    expect([...parseDevFlags('?dev=a,KAIJU2&dev=b')].sort()).toEqual(['a', 'b', 'kaiju2']);
    expect(parseDevFlags('?debug').size).toBe(0);
    expect(parseDevFlags('?dev=<x>').size).toBe(0);
  });

  it('URL の始めの状態（体力・壊れた部位）', () => {
    expect(parseKaiju2Options('')).toEqual({ hpPercent: 100, broken: [] });
    expect(parseKaiju2Options('?k2hp=35&k2break=wingL,tail,nope')).toEqual({
      hpPercent: 35,
      broken: ['wingL', 'tail'],
    });
    expect(parseKaiju2Options('?k2hp=abc').hpPercent).toBe(100);
  });

  it('付けていないときのリプレイのハッシュは今までと同じ（付けて外すと元に戻る）', () => {
    const w = createWorld();
    const plain = record(w, BASE_START, { seconds: 3, hashes: true }).hashes;
    const w2 = createWorld();
    const dev = attachKaiju2Dev(w2.play, parseKaiju2Options(''), {
      ground: w2.map.ordnanceGround,
      map: () => w2.map.def,
    });
    expect(dev.stateRoot).toBe(dev.raid);
    attachFreeExtra(w2.play, null);
    expect(record(w2, BASE_START, { seconds: 3, hashes: true }).hashes).toEqual(plain);
  });

  it('フリーフライトで怪獣が出て動き、記録を再生すると同じ結果（状態のハッシュに怪獣も入る）', () => {
    const mk = () => {
      const w = createWorld();
      const dev = attachKaiju2Dev(w.play, parseKaiju2Options('?k2hp=50'), {
        ground: w.map.ordnanceGround,
        map: () => w.map.def,
      });
      return { w, dev };
    };
    const a = mk();
    const rec = record(a.w, BASE_START, { seconds: 20, hashes: true });
    expect(a.dev.freeFlying).toBe(true);
    expect(a.dev.body.time).toBeGreaterThan(19);
    const plainWorld = createWorld();
    const plain = record(plainWorld, BASE_START, { seconds: 20, hashes: true }).hashes;
    // 怪獣が状態に入るのでハッシュは付けないときと違う
    expect(rec.hashes[rec.hashes.length - 1]).not.toBe(plain[plain.length - 1]);
    const b = mk();
    const back = replay(b.w, rec.data);
    expect(back.hashes).toEqual(rec.hashes);
    expect(hashState([b.dev.body])).toBe(hashState([a.dev.body]));
    expect(simHash(b.w)).toBe(simHash(a.w));
  });

  it('ほかのモード（ミッション）を始めると止まる', () => {
    const w = createWorld();
    const dev = attachKaiju2Dev(w.play, parseKaiju2Options(''), {
      ground: w.map.ordnanceGround,
      map: () => w.map.def,
    });
    record(w, BASE_START, { seconds: 1 });
    expect(dev.freeFlying).toBe(true);
    record(w, { ...BASE_START, mode: 'mission', missionId: 'training' }, { seconds: 1 });
    expect(dev.freeFlying).toBe(false);
  });
});
