// 怪獣 AI（6-2。Three.js 非依存）: 上陸 → 歩行 → 攻撃選択 → 攻撃（予兆 → 攻撃 → 硬直）→ 歩行 の状態機械。
// 攻撃は 4 種（薙ぎ払い・咆哮・熱線・投擲）で、すべて予兆がある。選び方は最も近い機体の距離と高さ（kaiju-attacks.ts）。
// フェーズ 2 から歩行 ×1.3・攻撃間隔 ×0.8、フェーズ 3 で熱線が 2 連射。ダウン中は止まり、攻撃は取り消す。
// 当たりはホスト（シングルプレイは FlightSession）の受け口に知らせるだけで、HP は呼び出し側が減らす
import {
  KAIJU_ATTACKS,
  KAIJU_ATTACK_CONFIG as A,
  KAIJU_CONFIG,
  type KaijuAttack,
} from '../data/kaiju';
import { vec3, type Vec3 } from '../flight/math';
import type { Kaiju } from '../entities/kaiju';
import { forwardOf, headingToward, mouthPosition } from '../entities/kaiju-pose';
import {
  chooseAttack,
  createRock,
  launchRock,
  distanceToRay,
  stepRock,
  trackDirection,
  type Rock,
  type RockTarget,
} from './kaiju-attacks';

/** 怪獣が狙う機体 */
export interface KaijuTarget extends RockTarget {
  /** 最後にフレアを撒いてからの秒数（撒いていなければ Infinity） */
  readonly flareAge: number;
}

/** 当たりの受け口 */
export interface KaijuHitHandler {
  damage(id: number, amount: number, attack: KaijuAttack): void;
  stun(id: number, seconds: number): void;
}

/** AI のできごと（音・HUD・演出） */
export type KaijuAiEvent =
  | { readonly kind: 'windup'; readonly attack: KaijuAttack }
  | { readonly kind: 'fire'; readonly attack: KaijuAttack }
  | { readonly kind: 'rockImpact'; readonly x: number; readonly y: number; readonly z: number };

export interface KaijuAiOptions {
  /** 使える攻撃（M5 は咆哮と投擲だけ） */
  readonly attacks?: readonly KaijuAttack[];
  /** 歩いて向かう先と、止まる距離 */
  readonly goal: { readonly x: number; readonly z: number };
  readonly stopRadius?: number;
}

/** 熱線（描画・判定） */
export interface KaijuBeam {
  on: boolean;
  readonly origin: Vec3;
  readonly direction: Vec3;
  length: number;
}

const DEG = Math.PI / 180;
/** 予兆の間に相手へ向き直る速さ（度/秒） */
const AIM_TURN_DEG = 40;

export class KaijuAi {
  readonly beam: KaijuBeam = { on: false, origin: vec3(), direction: vec3(0, 0, -1), length: 0 };
  readonly rocks: Rock[] = [createRock(), createRock(), createRock()];
  /** 次の攻撃を選ぶまでの秒数 */
  cooldown: number = A.intervalSeconds;
  /** 使った攻撃の並び（3 回連続しない） */
  readonly history: KaijuAttack[] = [];
  /** 狙っている機体の ID（null はなし） */
  targetId: number | null = null;
  private attacks: readonly KaijuAttack[] = KAIJU_ATTACKS;
  private readonly goal = { x: 0, z: 0 };
  private stopRadius: number = KAIJU_CONFIG.walk.stopRadius;
  private beamRepeats = 0;
  private readonly hitThisAttack = new Set<number>();
  private readonly listeners: ((e: KaijuAiEvent) => void)[] = [];
  private readonly want = vec3();

  constructor(
    readonly kaiju: Kaiju,
    private readonly hits: KaijuHitHandler,
  ) {}

  onEvent(fn: (e: KaijuAiEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(e: KaijuAiEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  /** 出現のたびに呼ぶ（使える攻撃・行き先） */
  configure(o: KaijuAiOptions): void {
    this.attacks = o.attacks ?? KAIJU_ATTACKS;
    this.goal.x = o.goal.x;
    this.goal.z = o.goal.z;
    this.stopRadius = o.stopRadius ?? KAIJU_CONFIG.walk.stopRadius;
    this.reset();
  }

  reset(): void {
    this.cooldown = A.intervalSeconds;
    this.history.length = 0;
    this.targetId = null;
    this.beam.on = false;
    this.beamRepeats = 0;
    for (const r of this.rocks) r.active = false;
  }

  /** 使える攻撃か（未開放・部位破壊で封じられたものは使えない） */
  usable(a: KaijuAttack): boolean {
    return this.attacks.includes(a) && !this.kaiju.sealed(a);
  }

  /** 固定ステップ 1 回分（本体のタイマー → 行動 → 岩 → 部位の位置） */
  step(targets: readonly KaijuTarget[], dt: number): void {
    const k = this.kaiju;
    k.step(dt);
    this.stepRocks(targets, dt);
    if (k.stage !== 'active') {
      this.beam.on = false;
      k.finishStep();
      return;
    }
    if (k.downTimer > 0) {
      this.beam.on = false;
      if (k.attack) k.clearAttack();
    } else if (k.attack) this.stepAttack(targets, dt);
    else this.stepWalk(targets, dt);
    k.finishStep();
  }

  private get intervalScale(): number {
    return this.kaiju.phase >= 2 ? KAIJU_CONFIG.phases.phase2IntervalScale : 1;
  }

  private stepWalk(targets: readonly KaijuTarget[], dt: number): void {
    const k = this.kaiju;
    const w = KAIJU_CONFIG.walk;
    const speed =
      (w.strideLength / w.stepSeconds) * (k.phase >= 2 ? KAIJU_CONFIG.phases.phase2WalkScale : 1);
    const dx = this.goal.x - k.feet.x;
    const dz = this.goal.z - k.feet.z;
    if (Math.hypot(dx, dz) > this.stopRadius) k.walkToward(this.goal.x, this.goal.z, speed, dt);
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    const t = this.nearest(targets);
    const attack = t ? this.pick(t) : null;
    if (!t || !attack) {
      this.cooldown = A.retrySeconds;
      return;
    }
    this.begin(attack, t.id);
  }

  /** 最も近い（水平）機体 */
  nearest(targets: readonly KaijuTarget[]): KaijuTarget | null {
    const f = this.kaiju.feet;
    let best: KaijuTarget | null = null;
    let bestD: number = A.aggroRange;
    for (const t of targets) {
      if (!t.active) continue;
      const d = Math.hypot(t.position.x - f.x, t.position.z - f.z);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  private pick(t: KaijuTarget): KaijuAttack | null {
    const f = this.kaiju.feet;
    const d = Math.hypot(t.position.x - f.x, t.position.z - f.z);
    return chooseAttack(d, t.position.y - f.y, (a) => this.usable(a), this.history);
  }

  /** 攻撃を始める（予兆から） */
  begin(attack: KaijuAttack, targetId: number): void {
    const k = this.kaiju;
    this.targetId = targetId;
    this.history.push(attack);
    if (this.history.length > 8) this.history.shift();
    this.beamRepeats = attack === 'beam' && k.phase >= 3 ? 1 : 0;
    this.hitThisAttack.clear();
    this.setStep(attack, 'windup', A[attack].windup);
    this.emit({ kind: 'windup', attack });
  }

  private setStep(
    attack: KaijuAttack,
    step: 'windup' | 'active' | 'recover',
    duration: number,
  ): void {
    const k = this.kaiju;
    k.attack = attack;
    k.attackStep = step;
    k.attackTime = 0;
    k.attackDuration = duration;
  }

  private stepAttack(targets: readonly KaijuTarget[], dt: number): void {
    const k = this.kaiju;
    const attack = k.attack;
    if (!attack) return;
    // 予兆の間に部位破壊で封じられたら取り消す
    if (k.attackStep === 'windup' && !this.usable(attack)) {
      this.finish();
      return;
    }
    const target = targets.find((t) => t.id === this.targetId && t.active) ?? null;
    k.attackTime += dt;
    if (k.attackStep === 'windup') {
      if (target && attack !== 'sweep') this.faceTarget(target, dt);
      if (k.attackTime >= k.attackDuration - 1e-9) this.fire(attack, target, targets);
      return;
    }
    if (k.attackStep === 'active') {
      this.stepActive(attack, target, targets, dt);
      if (k.attackTime >= k.attackDuration - 1e-9) {
        this.beam.on = false;
        if (attack === 'beam' && this.beamRepeats > 0) {
          this.beamRepeats--;
          this.setStep('beam', 'windup', A.beam.repeatWindup);
          this.emit({ kind: 'windup', attack: 'beam' });
        } else this.setStep(attack, 'recover', A[attack].recover);
      }
      return;
    }
    if (k.attackTime >= k.attackDuration - 1e-9) this.finish();
  }

  private finish(): void {
    this.kaiju.clearAttack();
    this.beam.on = false;
    this.cooldown = A.intervalSeconds * this.intervalScale;
  }

  private faceTarget(t: KaijuTarget, dt: number): void {
    const k = this.kaiju;
    k.turnToward(headingToward(t.position.x - k.feet.x, t.position.z - k.feet.z), AIM_TURN_DEG, dt);
  }

  /** 予兆が終わった: 攻撃の始まり */
  private fire(
    attack: KaijuAttack,
    target: KaijuTarget | null,
    targets: readonly KaijuTarget[],
  ): void {
    const k = this.kaiju;
    this.setStep(attack, 'active', A[attack].active);
    this.emit({ kind: 'fire', attack });
    switch (attack) {
      case 'roar':
        this.roar(targets);
        break;
      case 'throw':
        if (target) launchRock(this.rocks, k.feet, k.heading, k.pose.bodyDrop, target.position);
        break;
      case 'beam': {
        const b = this.beam;
        mouthPosition(b.origin, k.feet, k.heading, k.pose);
        if (target) this.aimAt(b.direction, b.origin, target.position);
        else forwardOf(b.direction, k.heading);
        b.length = A.beam.range;
        b.on = true;
        break;
      }
      default:
        break;
    }
  }

  private stepActive(
    attack: KaijuAttack,
    target: KaijuTarget | null,
    targets: readonly KaijuTarget[],
    dt: number,
  ): void {
    const k = this.kaiju;
    if (attack === 'sweep') {
      // 尾で 1 回転。足元から水平 radius 以内・高さ maxAltitude 以下に当たる（1 人 1 回）
      const s = A.sweep;
      k.heading += (Math.PI * 2 * dt) / s.active;
      for (const t of targets) {
        if (!t.active || this.hitThisAttack.has(t.id)) continue;
        const d = Math.hypot(t.position.x - k.feet.x, t.position.z - k.feet.z);
        if (d <= s.radius + t.hitRadius && t.position.y - k.feet.y <= s.maxAltitude) {
          this.hitThisAttack.add(t.id);
          this.hits.damage(t.id, s.damage, 'sweep');
        }
      }
      return;
    }
    if (attack !== 'beam') return;
    const b = this.beam;
    const s = A.beam;
    mouthPosition(b.origin, k.feet, k.heading, k.pose);
    if (target) {
      this.aimAt(this.want, b.origin, target.position);
      trackDirection(b.direction, this.want, s.trackDegPerSecond * DEG * dt);
      k.turnToward(headingToward(b.direction.x, b.direction.z), s.trackDegPerSecond * 2, dt);
    }
    for (const t of targets) {
      if (!t.active) continue;
      if (distanceToRay(t.position, b.origin, b.direction, b.length) <= s.width / 2 + t.hitRadius)
        this.hits.damage(t.id, s.damagePerSecond * dt, 'beam');
    }
  }

  /** 咆哮: 頭から radius 以内。高度 immuneAltitude 以上と、flareSeconds 以内にフレアを撒いた機体は無効 */
  private roar(targets: readonly KaijuTarget[]): void {
    const k = this.kaiju;
    const s = A.roar;
    const head = k.parts[0]?.position ?? k.feet;
    for (const t of targets) {
      if (!t.active || t.position.y >= s.immuneAltitude || t.flareAge <= s.flareSeconds) continue;
      const p = t.position;
      if (Math.hypot(p.x - head.x, p.y - head.y, p.z - head.z) <= s.radius)
        this.hits.stun(t.id, s.stunSeconds);
    }
  }

  private stepRocks(targets: readonly KaijuTarget[], dt: number): void {
    const floor = (x: number, z: number): number => this.kaiju.floorAt(x, z);
    for (const r of this.rocks) {
      const hit = stepRock(r, targets, floor, dt);
      if (hit === null) continue;
      if (hit !== 'ground') this.hits.damage(hit.id, A.throw.damage, 'throw');
      const p = r.position;
      this.emit({ kind: 'rockImpact', x: p.x, y: p.y, z: p.z });
    }
  }

  private aimAt(out: Vec3, from: Readonly<Vec3>, to: Readonly<Vec3>): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const n = Math.hypot(dx, dy, dz) || 1;
    out.x = dx / n;
    out.y = dy / n;
    out.z = dz / n;
  }
}
