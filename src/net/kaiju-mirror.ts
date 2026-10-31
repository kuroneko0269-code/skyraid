// レイドの協力のクライアントの怪獣（6-2。最小限）: ホストの state の怪獣の状態を写し、描画・HUD・音（KaijuBodyView /
// KaijuEffectsView）と、ロックの対象（部位。当たりはホストが決めるのでダメージは受けない）にする。
// 位置は届いた値へ毎ステップ寄せ、攻撃の経過・歩数は届くまで進めておく。本格的な補間は 6-6。Three.js 非依存
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
import { NO_ATTACK, type KaijuStateMsg } from './protocol';

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
  readonly rocks = [0, 1, 2].map(() => ({ position: vec3(), prevPosition: vec3(), active: false }));
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
    this.walkRate = sinceLast > 0 ? Math.max(0, m.walkPhase - this.lastWalk) / sinceLast : 0;
    this.lastWalk = m.walkPhase;
    this.walkPhase = m.walkPhase;
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
    this.rocks.forEach((r, i) => {
      const p = m.rocks[i];
      r.active = p !== undefined;
      if (!p) return;
      copyVec3(r.prevPosition, r.position);
      copyVec3(r.position, p);
    });
  }

  /** 固定ステップ 1 回分: 位置を寄せ、経過を進め、部位の位置を出す */
  step(dt: number): void {
    copyVec3(this.prevFeet, this.feet);
    this.prevHeading = this.heading;
    for (const p of this.parts) copyVec3(p.prevPosition, p.position);
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
}
