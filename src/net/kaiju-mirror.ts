// レイドの協力のクライアントの怪獣（6-2）: ホストの state の怪獣の状態を写し、描画・HUD・音（KaijuBodyView /
// KaijuEffectsView）と、ロックの対象（部位。当たりはホストが決めるのでダメージは受けない）にする。
// 位置は届いた値へ毎ステップ寄せ、攻撃の経過・歩数は届くまで進めておく。
// 6-6: 歩数は 2 で割った余りで届くので続きの値に直す。岩は event（rock）で投げた位置と速度を受け、同じ放物線を進める。Three.js 非依存
import { TEAM_ENEMY, type CombatTarget } from '../combat/target';
import {
  KAIJU_ATTACK_CONFIG,
  KAIJU_ATTACKS,
  KAIJU_CONFIG,
  KAIJU_PARTS,
  type KaijuAttack,
  type KaijuPartId,
} from '../data/kaiju';
import type { KaijuBodyView, KaijuEffectsView } from '../entities/kaiju-display';
import { KAIJU_STAGES, type KaijuStage } from '../entities/kaiju';
import {
  ATTACK_STEPS,
  createPose,
  derivePose,
  mouthPosition,
  partCenter,
  wrapAngle,
  type AttackStep,
} from '../entities/kaiju-pose';
import { approachFactor, copyVec3, vec3, type Vec3 } from '../flight/math';
import { NO_ATTACK, unpackRockVelocity, type EventMsg, type KaijuStateMsg } from './protocol';

/** 写しの部位（ロックの対象・HUD） */
export class MirrorPart implements CombatTarget {
  readonly position: Vec3 = vec3();
  readonly prevPosition: Vec3 = vec3();
  readonly hitRadius: number;
  readonly visualRadius: number;
  readonly team = TEAM_ENEMY;
  readonly label: string;
  hp = 1;
  maxHp = 1;
  breakTimer = 0;

  constructor(
    readonly id: KaijuPartId,
    /** 部位の番号（入力の targetId は KAIJU_ID_BASE + これ） */
    readonly kaijuIndex: number,
    private readonly owner: KaijuMirror,
  ) {
    const s = KAIJU_CONFIG.parts[id];
    this.hitRadius = s.radius;
    this.visualRadius = s.radius;
    this.label = s.label;
  }

  get velocity(): Readonly<Vec3> {
    return this.owner.velocity;
  }

  get active(): boolean {
    return this.owner.targetable;
  }

  get broken(): boolean {
    return this.hp <= 0;
  }

  get isDestroyed(): boolean {
    return this.owner.stage === 'dead';
  }

  /** 表示だけ（当たりはホスト） */
  applyDamage(): boolean {
    return false;
  }
}

/** 位置を寄せる速さ（1/秒） */
const FOLLOW = 8;

export class KaijuMirror implements KaijuBodyView, KaijuEffectsView {
  readonly feet: Vec3 = vec3();
  readonly prevFeet: Vec3 = vec3();
  readonly velocity: Vec3 = vec3();
  heading = 0;
  prevHeading = 0;
  stage: KaijuStage = 'hidden';
  attack: KaijuAttack | null = null;
  attackStep: AttackStep = 'windup';
  attackTime = 0;
  attackDuration = 0;
  downTimer = 0;
  walkPhase = 0;
  hp = 1;
  maxHp = 1;
  phase = 1;
  finalRemaining: number | null = null;
  flashTimer = 0;
  readonly pose = createPose();
  readonly parts: readonly MirrorPart[];
  readonly beam = { on: false, origin: vec3(), direction: vec3(0, 0, -1), length: 0 };
  readonly rocks = [0, 1, 2].map(() => ({
    position: vec3(),
    prevPosition: vec3(),
    velocity: vec3(),
    active: false,
    age: 0,
  }));
  private readonly target: Vec3 = vec3();
  private targetHeading = 0;
  private walkRate = 0;
  private lastWalk = 0;
  private lastHp = -1;
  private received = false;

  constructor() {
    this.parts = KAIJU_PARTS.map((id, i) => new MirrorPart(id, i, this));
  }

  get visible(): boolean {
    return this.received && this.stage !== 'hidden' && this.stage !== 'gone';
  }

  get targetable(): boolean {
    return this.stage === 'rising' || this.stage === 'active';
  }

  /** 届いた状態を写す（新しい state が来たときだけ） */
  receive(m: Readonly<KaijuStateMsg>, sinceLast: number): void {
    this.stage = KAIJU_STAGES[m.stage] ?? 'hidden';
    if (!this.received) {
      copyVec3(this.feet, m.feet);
      copyVec3(this.prevFeet, m.feet);
      this.heading = this.prevHeading = m.heading;
    }
    this.received = true;
    copyVec3(this.target, m.feet);
    this.targetHeading = m.heading;
    this.attack = m.attack === NO_ATTACK ? null : (KAIJU_ATTACKS[m.attack] ?? null);
    this.attackStep = ATTACK_STEPS[m.attackStep] ?? 'windup';
    this.attackTime = m.attackTime;
    this.attackDuration = m.attackDuration;
    this.downTimer = m.downTimer;
    // 歩数は 2 で割った余り（6-6）: 前の値からの進み（0〜2）を足して続きの値にする
    const step = (((m.walkPhase - this.lastWalk) % 2) + 2) % 2;
    const walk = this.lastWalk + step;
    this.walkRate = sinceLast > 0 ? step / sinceLast : 0;
    this.lastWalk = walk;
    this.walkPhase = walk;
    if (this.lastHp >= 0 && m.hp < this.lastHp) this.flashTimer = KAIJU_CONFIG.hitFlashSeconds;
    this.lastHp = m.hp;
    this.hp = m.hp;
    this.maxHp = m.maxHp;
    this.phase = m.phase;
    this.finalRemaining = m.finalRemaining;
    this.parts.forEach((p, i) => {
      const s = m.parts[i];
      p.maxHp = Math.max(1, Math.round(m.maxHp * KAIJU_CONFIG.parts[p.id].hpShare));
      p.hp = (s?.hpRatio ?? 0) * p.maxHp;
      p.breakTimer = s?.breakTimer ?? 0;
    });
    this.beam.on = m.beam !== null;
    if (m.beam) copyVec3(this.beam.direction, m.beam);
  }

  /** 岩の event（6-6）: 投げた（位置と速度）/ 落ちた（いちばん近い岩を消す） */
  handleRock(e: Readonly<EventMsg>): void {
    if (e.b === 0) {
      const r = this.rocks[e.a];
      if (!r) return;
      r.position.x = r.prevPosition.x = e.x;
      r.position.y = r.prevPosition.y = e.y;
      r.position.z = r.prevPosition.z = e.z;
      unpackRockVelocity(e.n, r.velocity);
      r.age = 0;
      r.active = true;
      return;
    }
    let best: (typeof this.rocks)[number] | null = null;
    let bestD = Infinity;
    for (const r of this.rocks) {
      if (!r.active) continue;
      const d = Math.hypot(r.position.x - e.x, r.position.y - e.y, r.position.z - e.z);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    if (best) best.active = false;
  }

  /** 固定ステップ 1 回分: 位置を寄せ、経過を進め、部位の位置を出す */
  step(dt: number): void {
    copyVec3(this.prevFeet, this.feet);
    this.prevHeading = this.heading;
    for (const p of this.parts) copyVec3(p.prevPosition, p.position);
    this.stepRocks(dt);
    if (!this.received) return;
    const k = approachFactor(FOLLOW, dt);
    const f = this.feet;
    const x0 = f.x;
    const z0 = f.z;
    f.x += (this.target.x - f.x) * k;
    f.y += (this.target.y - f.y) * k;
    f.z += (this.target.z - f.z) * k;
    this.velocity.x = (f.x - x0) / dt;
    this.velocity.z = (f.z - z0) / dt;
    this.heading = wrapAngle(this.heading + wrapAngle(this.targetHeading - this.heading) * k);
    this.attackTime = Math.min(this.attackDuration, this.attackTime + dt);
    this.walkPhase += this.walkRate * dt;
    if (this.downTimer > 0) this.downTimer = Math.max(0, this.downTimer - dt);
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
    derivePose(this, this.pose);
    for (const p of this.parts) partCenter(p.position, p.id, f, this.heading, this.pose);
    mouthPosition(this.beam.origin, f, this.heading, this.pose);
    this.beam.length = KAIJU_ATTACK_CONFIG.beam.range;
  }

  /** 岩をホストと同じ放物線で進める（落ちた知らせが来なくても飛ぶ時間の上限で消す） */
  private stepRocks(dt: number): void {
    const g = KAIJU_ATTACK_CONFIG.throw.gravity;
    for (const r of this.rocks) {
      if (!r.active) continue;
      copyVec3(r.prevPosition, r.position);
      r.velocity.y -= g * dt;
      r.position.x += r.velocity.x * dt;
      r.position.y += r.velocity.y * dt;
      r.position.z += r.velocity.z * dt;
      r.age += dt;
      if (r.age > KAIJU_ATTACK_CONFIG.throw.maxFlightSeconds + 4 || r.position.y < -50)
        r.active = false;
    }
  }
}
