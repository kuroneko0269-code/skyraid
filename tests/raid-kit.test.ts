// 10-2: レイドの怪獣の共通の部品（src/ai/raid-kit/）: 決まった計算（同じ種で同じ状態）・リプレイのキーフレーム（写して戻すと
// 続きが同じ）・部位の破壊で攻撃が止まる・予兆の間は当たらない・バリアと瞬間移動の予兆
import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../src/core/random';
import { vec3, type Vec3 } from '../src/flight/math';
import { Barrage, inArc, type TurretSpec } from '../src/ai/raid-kit/barrage';
import { Beam, type BeamSpec } from '../src/ai/raid-kit/beam';
import { bodyPoint } from '../src/ai/raid-kit/frame';
import { MinionSwarm, type MinionSpec } from '../src/ai/raid-kit/minions';
import { PartSet, type PartSpec } from '../src/ai/raid-kit/parts';
import { Barrier, Warp } from '../src/ai/raid-kit/shield';
import { ShotPool } from '../src/ai/raid-kit/shots';
import { hashState, StateSnapshot } from '../src/replay/state-walk';

const PARTS: readonly PartSpec[] = [
  { id: 'body', hpShare: 1, breakable: false },
  { id: 'nestA', hpShare: 0.05, breakable: true, effects: { disable: ['spawnA'] } },
  { id: 'nestB', hpShare: 0.05, breakable: true },
  { id: 'turretL', hpShare: 0.04, breakable: true, effects: { mul: { speed: 0.8 } } },
  { id: 'vent', hpShare: 0.1, breakable: true, bodyFactor: 2 },
];

const MINIONS: MinionSpec = {
  cap: 12,
  firstDelay: 2,
  interval: 6,
  perNest: 2,
  hp: 30,
  speed: 120,
  turnDeg: 70,
  life: 40,
  orbit: 220,
  homeOrbit: 400,
  dropSeconds: 1.2,
};

const TURRET: TurretSpec = {
  offset: { forward: 40, right: -20, up: 30 },
  part: 3,
  weapon: 'gun',
  yawCenterDeg: 0,
  yawHalfDeg: 180,
  pitchMinDeg: -60,
  pitchMaxDeg: 80,
  interval: 1.5,
  firstDelay: 0.5,
  burst: 4,
  burstGap: 0.1,
  spreadDeg: 2,
  range: 2500,
};

const BEAM: BeamSpec = {
  warn: 1.5,
  charge: 0.8,
  fire: 1.2,
  recover: 1,
  length: 3000,
  radius: 25,
  damage: 40,
};

/** 部品をまとめた「仮の怪獣」（1 つの根に全部の状態を持つ。本番の怪獣もこの形でリプレイの根に入れる） */
class ToyKaiju {
  readonly rng = new SeededRandom();
  readonly body = { position: vec3(0, 400, 0), heading: 0 };
  readonly parts = new PartSet(PARTS, 10000);
  readonly swarm = new MinionSwarm(MINIONS, [
    { offset: { forward: 0, right: -30, up: -40 }, part: 1 },
    { offset: { forward: 0, right: 30, up: -40 }, part: 2 },
  ]);
  readonly barrage = new Barrage([TURRET, { ...TURRET, part: -1, weapon: 'missile', interval: 4 }]);
  readonly shots = new ShotPool(
    {
      gun: { speed: 600, life: 3, damage: 4, radius: 2, turnDeg: 0 },
      missile: { speed: 260, life: 8, damage: 20, radius: 6, turnDeg: 40 },
    },
    64,
  );
  readonly beam = new Beam({ ...BEAM, charge: 0 }, BEAM);
  readonly barrier = new Barrier({ flicker: 0.6, down: 4 });
  readonly warp = new Warp({
    telegraph: 1.2,
    cooldown: 8,
    ringMin: 600,
    ringMax: 1200,
    altitudeMin: 300,
    altitudeMax: 700,
    keepAway: 500,
  });
  readonly players = [
    { id: 0, position: vec3(), radius: 8, hp: 1000 },
    { id: 1, position: vec3(), radius: 8, hp: 1000 },
  ];
  time = 0;
  hitsTaken = 0;

  constructor(seed: number) {
    this.rng.reseed(seed);
  }

  step(dt: number): void {
    this.time += dt;
    const t = this.time;
    // 自機 2 機: 怪獣の周りを回る
    this.players.forEach((p, i) => {
      const a = t * (0.3 + i * 0.1) + i;
      p.position.x = Math.cos(a) * (700 + i * 200);
      p.position.y = 420 + i * 60;
      p.position.z = Math.sin(a) * (700 + i * 200);
    });
    // 体: 前へゆっくり進み、少しずつ向きを変える（壊れた部位で遅く）
    const speed = 20 * this.parts.mul('speed');
    this.body.heading += 0.02 * dt;
    this.body.position.x += -Math.sin(this.body.heading) * speed * dt;
    this.body.position.z += -Math.cos(this.body.heading) * speed * dt;
    const rnd = this.rng.next;
    const broken = (part: number): boolean => this.parts.isBroken(part);
    this.swarm.step(dt, this.body, broken, (m) => this.players[m.id % 2]?.position ?? null, rnd);
    this.barrage.step(dt, this.body, broken, this.players, rnd, this.shots.fire);
    this.shots.step(
      dt,
      this.players,
      (id) => this.players[id]?.position ?? null,
      (hit) => {
        this.hitsTaken += hit.damage;
      },
    );
    const mouth = bodyPoint(vec3(), this.body, { forward: 60, right: 0, up: 0 });
    if (!this.beam.busy && rnd() < 0.01) {
      if (rnd() < 0.5) this.beam.startSweep(-60, 60, -5);
      else {
        this.beam.startCharged(0);
        this.barrier.drop();
      }
    }
    this.beam.step(dt, this.body, mouth, this.players[this.beam.targetId]?.position ?? null);
    for (const p of this.players) if (this.beam.hits(p.id, p.position, p.radius)) p.hp -= 40;
    this.barrier.step(dt);
    if (this.warp.ready && rnd() < 0.005)
      this.warp.begin(vec3(), this.players[0]?.position ?? null, rnd);
    if (this.warp.step(dt)) {
      this.body.position.x = this.warp.destination.x;
      this.body.position.y = this.warp.destination.y;
      this.body.position.z = this.warp.destination.z;
    }
    // 1 秒ごとに部位を撃つ（巣 → 砲台 → 排気口の順に）・子分を撃つ
    if (Math.round(t * 60) % 60 === 0) {
      const part = 1 + (Math.floor(t) % 4);
      if (!this.barrier.absorbs) this.parts.damage(part, 120, Math.floor(t) % 2);
      const m = this.swarm.minions.findIndex((x) => x.active);
      if (m >= 0) this.swarm.hit(m, 15, 1);
    }
  }
}

function run(seed: number, steps: number, k = new ToyKaiju(seed)): ToyKaiju {
  for (let i = 0; i < steps; i++) k.step(1 / 60);
  return k;
}

describe('10-2: レイドの怪獣の共通の部品', () => {
  it('決まった計算: 同じ種なら同じ状態、違う種なら違う状態', () => {
    const a = run(7, 60 * 90);
    const b = run(7, 60 * 90);
    const c = run(8, 60 * 90);
    expect(hashState([a])).toBe(hashState([b]));
    expect(hashState([a])).not.toBe(hashState([c]));
    // 部品がそれぞれ動いた
    expect(a.swarm.spawned).toBeGreaterThan(0);
    expect(a.swarm.kills).toBeGreaterThan(0);
    expect(a.barrage.fired.reduce((s, v) => s + v, 0)).toBeGreaterThan(0);
    expect(a.beam.shots).toBeGreaterThan(0);
    expect(a.parts.brokenOrder.length).toBeGreaterThan(0);
  });

  it('リプレイのキーフレーム: 写して戻すと続きが同じ', () => {
    const k = run(11, 60 * 30);
    const snap = StateSnapshot.take([k], () => false);
    run(11, 60 * 30, k);
    const want = hashState([k]);
    snap.restore();
    run(11, 60 * 30, k);
    expect(hashState([k])).toBe(want);
  });

  it('部位と破壊: 壊れると攻撃が止まり、倍率が掛かる。弱点は全体の HP に多く効く', () => {
    const p = new PartSet(PARTS, 1000);
    expect(p.disabled('spawnA')).toBe(false);
    const hit = p.damage(1, 60, 2);
    expect(hit.broke).toBe(true);
    expect(p.disabled('spawnA')).toBe(true);
    expect(p.brokenMask).toBe(0b10);
    expect(p.scoreOf(2)).toEqual({ partDamage: [0, 60, 0, 0, 0], breaks: 1 });
    p.damage(3, 40, 0);
    expect(p.mul('speed')).toBeCloseTo(0.8);
    const before = p.hp;
    p.damage(4, 10, 0);
    expect(before - p.hp).toBe(20);
    // 壊れない部位（胴）は何度当てても壊れない
    p.damage(0, 500, 0);
    expect(p.isBroken(0)).toBe(false);
  });

  it('子分: 巣が壊れたらその巣から出ない・上限を超えない', () => {
    const s = new MinionSwarm({ ...MINIONS, cap: 5, firstDelay: 0, interval: 1 }, [
      { offset: { forward: 0, right: 0, up: 0 }, part: 1 },
      { offset: { forward: 0, right: 0, up: 0 }, part: 2 },
    ]);
    const body = { position: vec3(), heading: 0 };
    const rng = new SeededRandom(3);
    const brokenB = (part: number): boolean => part === 2;
    for (let i = 0; i < 600; i++) s.step(1 / 60, body, brokenB, () => null, rng.next);
    expect(s.activeCount).toBeLessThanOrEqual(5);
    expect(s.minions.filter((m) => m.active).every((m) => m.nest === 0)).toBe(true);
  });

  it('弾幕: 砲台の部位が壊れたら撃たない・向きの範囲の外は狙わない', () => {
    const b = new Barrage([{ ...TURRET, yawCenterDeg: 180, yawHalfDeg: 30 }]);
    const body = { position: vec3(), heading: 0 };
    const rng = new SeededRandom(1);
    const shots: number[] = [];
    // 前（-z）にいる人は、後ろ向きの砲台の範囲の外
    const front = [{ id: 0, position: vec3(0, 30, -500) }];
    for (let i = 0; i < 300; i++)
      b.step(
        1 / 60,
        body,
        () => false,
        front,
        rng.next,
        (o) => shots.push(o.turret),
      );
    expect(shots).toEqual([]);
    const back = [{ id: 0, position: vec3(0, 30, 500) }];
    expect(inArc(b.turrets[0] ?? TURRET, body, vec3(), back[0]?.position ?? vec3())).toBe(true);
    for (let i = 0; i < 300; i++)
      b.step(
        1 / 60,
        body,
        () => false,
        back,
        rng.next,
        (o) => shots.push(o.turret),
      );
    expect(shots.length).toBeGreaterThan(0);
    const n = shots.length;
    for (let i = 0; i < 300; i++)
      b.step(
        1 / 60,
        body,
        () => true,
        back,
        rng.next,
        (o) => shots.push(o.turret),
      );
    expect(shots.length).toBe(n);
  });

  it('光線: 予兆・溜めの間は当たらない。溜めの間は向きが止まる（避けどき）', () => {
    const beam = new Beam({ ...BEAM, charge: 0 }, BEAM);
    const body = { position: vec3(), heading: 0 };
    const mouth = vec3();
    const target: Vec3 = vec3(0, 0, -1000);
    beam.startCharged(0);
    let hitWhileWarn = false;
    let fireYaw = Number.NaN;
    for (let i = 0; i < 60 * 6; i++) {
      // ロック警告の間は狙う人が横へ動く
      if (beam.phase === 'warn') target.x += 2;
      beam.step(1 / 60, body, mouth, target);
      if (beam.phase === 'charge' && Number.isNaN(fireYaw)) fireYaw = beam.yawDeg;
      if (beam.phase === 'warn' || beam.phase === 'charge')
        hitWhileWarn ||= beam.hits(0, target, 8);
      if (beam.phase === 'fire') expect(beam.yawDeg).toBe(fireYaw);
    }
    expect(hitWhileWarn).toBe(false);
    expect(beam.shots).toBe(1);
    // 撃つ間は線の上にいれば 1 回だけ当たる
    beam.startSweep(0, 0, 0);
    let hits = 0;
    for (let i = 0; i < 60 * 4; i++) {
      beam.step(1 / 60, body, mouth, null);
      if (beam.hits(1, vec3(0, 0, -800), 8)) hits++;
    }
    expect(hits).toBe(1);
  });

  it('バリアと瞬間移動: 揺らいでから外れる・移る先が光ってから移る（狙う人から離れた所）', () => {
    const bar = new Barrier({ flicker: 0.5, down: 2 });
    expect(bar.absorbs).toBe(true);
    bar.drop();
    bar.step(0.3);
    expect(bar.phase).toBe('flicker');
    expect(bar.absorbs).toBe(true);
    bar.step(0.3);
    expect(bar.absorbs).toBe(false);
    bar.step(2.1);
    expect(bar.absorbs).toBe(true);
    const warp = new Warp({
      telegraph: 1,
      cooldown: 3,
      ringMin: 800,
      ringMax: 800,
      altitudeMin: 500,
      altitudeMax: 500,
      keepAway: 1000,
    });
    const rng = new SeededRandom(5);
    const avoid = vec3(800, 500, 0);
    warp.begin(vec3(), avoid, rng.next);
    const d = warp.destination;
    expect(Math.hypot(d.x - avoid.x, d.y - avoid.y, d.z - avoid.z)).toBeGreaterThanOrEqual(1000);
    let moved = 0;
    for (let i = 0; i < 59; i++) if (warp.step(1 / 60)) moved++;
    expect(moved).toBe(0);
    expect(warp.glow).toBeGreaterThan(0.9);
    if (warp.step(1 / 60) || warp.step(1 / 60)) moved++;
    expect(moved).toBe(1);
    expect(warp.ready).toBe(false);
  });
});
