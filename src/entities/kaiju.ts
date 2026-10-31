// 怪獣「ヴォルガス」の本体（6-1。2-5 の kaiju-placeholder.ts を置き換え。Three.js 非依存）。
// - 部位 HP（頭・背中の結晶・左脚・右脚・尾）と全体 HP。全体 HP は部位に与えたダメージの合計で減る（壊れた部位にも入る）
// - 部位破壊: 結晶 → 熱線封じ / 脚 → 15 秒ダウン（全部位ダメージ 2 倍）/ 尾 → 薙ぎ払い封じ / 頭 → 咆哮封じ。部位 HP は復活しない
// - ブレイク（6-3 の前倒し）: 同じ部位に 3 秒以内に 2 人以上 → その部位のダメージ ×3 を 5 秒。人数ごとの部位ダメージ倍率 partyDamageScale（1 人 ×3.8。6-1b で ×5.3 から）
// - フェーズ: HP 70% で 2（歩行が速く・攻撃間隔 −20%。AI が読む）、40% で 3（熱線 2 連射・制限時間 3 分。時間切れで街に到達）
// - 人数スケール: 全体 HP = 基礎 × (0.55 + 0.45 × 人数)
// 動き（歩く・向きを変える）と攻撃の段階は AI（src/ai/kaiju-ai.ts）が決めて、ここに書き込む
import { KAIJU_CONFIG, KAIJU_PARTS, type KaijuAttack, type KaijuPartId } from '../data/kaiju';
import { clamp, copyVec3, vec3, type Vec3 } from '../flight/math';
import type { GroundHeightFn } from './aircraft';
import { KaijuPart, type KaijuPartOwner } from './kaiju-part';
import {
  createPose,
  derivePose,
  headingToward,
  partCenter,
  wrapAngle,
  type AttackStep,
  type KaijuPoseInput,
} from './kaiju-pose';

/** 本体の段階（通信では番号で送る。6-2） */
export const KAIJU_STAGES = ['hidden', 'rising', 'active', 'retreating', 'dead', 'gone'] as const;
export type KaijuStage = (typeof KAIJU_STAGES)[number];

/** 本体のできごと（HUD・音・演出が購読する） */
export type KaijuEvent =
  | { readonly kind: 'partBroken'; readonly part: KaijuPartId }
  | { readonly kind: 'break'; readonly part: KaijuPartId }
  | { readonly kind: 'down' }
  | { readonly kind: 'phase'; readonly phase: number }
  | { readonly kind: 'step' }
  | { readonly kind: 'killed' }
  | { readonly kind: 'retreat' }
  | { readonly kind: 'cityReached' };

/** 全体 HP の人数スケール（1 人は solo の倍率。6-1b） */
export function kaijuMaxHp(players: number, base: number = KAIJU_CONFIG.baseHp): number {
  const s = KAIJU_CONFIG.hpScale;
  const n = clamp(Math.round(players), 1, 4);
  return Math.round(base * (n === 1 ? s.solo : s.constant + s.perPlayer * n));
}

export interface KaijuEmergeOptions {
  /** 遊ぶ人数（1〜4）。HP とブレイクの成立（1 人は不成立・部位ダメージ増し）に使う */
  readonly players?: number;
  /** この割合のダメージで撤退する（M5）。1 なら撤退せず倒せる */
  readonly retreatRatio?: number;
  /** 最終フェーズの制限時間を使う（レイド。M5 は撤退が先なので使わない） */
  readonly finalTimer?: boolean;
}

const config = KAIJU_CONFIG;

export class Kaiju implements KaijuPartOwner, KaijuPoseInput {
  readonly feet: Vec3 = vec3();
  readonly prevFeet: Vec3 = vec3();
  readonly velocity: Vec3 = vec3();
  heading = 0;
  prevHeading = 0;
  stage: KaijuStage = 'hidden';
  stageTime = 0;
  readonly parts: readonly KaijuPart[];
  /** 攻撃の段階（AI が書く） */
  attack: KaijuAttack | null = null;
  attackStep: AttackStep = 'windup';
  attackTime = 0;
  attackDuration = 0;
  downTimer = 0;
  /** 歩いた歩数（小数。足音・歩行のアニメーション） */
  walkPhase = 0;
  /** 1〜3 */
  phase = 1;
  /** 最終フェーズの残り秒数（null は始まっていない） */
  finalRemaining: number | null = null;
  /** 時間切れで島の中心（街）に到達した */
  cityReached = false;
  flashTimer = 0;
  readonly pose = createPose();
  /** 経過秒数（ブレイクの判定） */
  time = 0;
  players = 1;
  private hpValue = 1;
  private maxHpValue = 1;
  private retreatRatio = 1;
  private useFinalTimer = true;
  private readonly origin: Vec3 = vec3();
  private readonly listeners: ((e: KaijuEvent) => void)[] = [];

  constructor(private readonly groundHeight: GroundHeightFn = () => 0) {
    this.parts = KAIJU_PARTS.map((id, i) => new KaijuPart(id, i, this));
  }

  onEvent(fn: (e: KaijuEvent) => void): void {
    this.listeners.push(fn);
  }

  private emit(e: KaijuEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  get hp(): number {
    return this.hpValue;
  }

  get maxHp(): number {
    return this.maxHpValue;
  }

  /** 与えたダメージの割合（0〜1） */
  get damageRatio(): number {
    return 1 - this.hpValue / this.maxHpValue;
  }

  get isDestroyed(): boolean {
    return this.stage === 'dead';
  }

  /** 撃てる・ロックできる（上陸中と陸の上） */
  get targetable(): boolean {
    return this.stage === 'rising' || this.stage === 'active';
  }

  get visible(): boolean {
    return this.stage !== 'hidden' && this.stage !== 'gone';
  }

  part(id: KaijuPartId): KaijuPart {
    const p = this.parts[KAIJU_PARTS.indexOf(id)];
    if (!p) throw new Error(`部位がない: ${id}`);
    return p;
  }

  /** 部位が壊れて封じられた攻撃か */
  sealed(attack: KaijuAttack): boolean {
    switch (attack) {
      case 'beam':
        return this.part('crystal').broken;
      case 'sweep':
        return this.part('tail').broken;
      case 'roar':
        return this.part('head').broken;
      default:
        return false;
    }
  }

  /** 海の (x, z) から上陸を始める（向きは facingX, facingZ の方へ） */
  emerge(x: number, z: number, facingX: number, facingZ: number, o: KaijuEmergeOptions = {}): void {
    this.players = clamp(Math.round(o.players ?? 1), 1, 4);
    this.maxHpValue = kaijuMaxHp(this.players);
    this.hpValue = this.maxHpValue;
    this.retreatRatio = o.retreatRatio ?? 1;
    this.useFinalTimer = o.finalTimer ?? true;
    for (const p of this.parts) p.reset(this.maxHpValue * p.maxHpShare);
    this.origin.x = this.feet.x = x;
    this.origin.z = this.feet.z = z;
    this.heading = this.prevHeading = headingToward(facingX - x, facingZ - z);
    this.clearAttack();
    this.downTimer = 0;
    this.walkPhase = 0;
    this.phase = 1;
    this.finalRemaining = null;
    this.cityReached = false;
    this.flashTimer = 0;
    this.time = 0;
    this.enter('rising');
    this.feet.y = this.floorAt(x, z) - config.height;
    copyVec3(this.prevFeet, this.feet);
    this.updateParts();
    for (const p of this.parts) copyVec3(p.prevPosition, p.position);
  }

  /** 引っ込める（ミッションの開始・フリーフライト） */
  withdraw(): void {
    this.stage = 'hidden';
    this.clearAttack();
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
  }

  clearAttack(): void {
    this.attack = null;
    this.attackStep = 'windup';
    this.attackTime = 0;
    this.attackDuration = 0;
  }

  /**
   * 部位へのダメージ。倍率: 人数ごとの partyDamageScale・ダウン中 ×2・その部位がブレイク中 ×3。
   * 部位 HP と全体 HP を同じ量だけ減らす。倒れたら true
   */
  damagePart(part: KaijuPart, amount: number, attacker: number): boolean {
    if (!this.targetable || !(amount > 0)) return false;
    this.registerHit(part, attacker);
    let dmg = amount;
    dmg *= config.partyDamageScale[this.players - 1] ?? 1;
    if (this.downTimer > 0) dmg *= config.down.damageScale;
    if (part.breakTimer > 0) dmg *= config.break.damageScale;
    this.flashTimer = config.hitFlashSeconds;
    if (part.partHp > 0) {
      part.partHp = Math.max(0, part.partHp - dmg);
      if (part.partHp <= 0) this.breakPart(part);
    }
    const floor = this.retreatRatio < 1 ? 1 : 0;
    this.hpValue = Math.max(floor, this.hpValue - dmg);
    this.updatePhase();
    if (this.retreatRatio < 1 && this.damageRatio >= this.retreatRatio - 1e-9) {
      this.retreat();
      return false;
    }
    if (this.hpValue <= 0) {
      this.enter('dead');
      this.clearAttack();
      this.velocity.x = this.velocity.y = this.velocity.z = 0;
      this.emit({ kind: 'killed' });
      return true;
    }
    return false;
  }

  /** ブレイクの判定: 3 秒以内に当てた別の人が minAttackers 人以上（1 人のときは成立しない） */
  private registerHit(part: KaijuPart, attacker: number): void {
    const b = config.break;
    part.lastHitBy.set(attacker, this.time);
    if (this.players < b.minAttackers || part.breakTimer > 0 || part.breakCooldown > 0) return;
    let n = 0;
    for (const t of part.lastHitBy.values()) if (this.time - t <= b.windowSeconds + 1e-9) n++;
    if (n < b.minAttackers) return;
    part.breakTimer = b.seconds;
    part.breakCooldown = b.seconds + b.cooldownSeconds;
    this.emit({ kind: 'break', part: part.id });
  }

  private breakPart(part: KaijuPart): void {
    this.emit({ kind: 'partBroken', part: part.id });
    if (part.id === 'leftLeg' || part.id === 'rightLeg') {
      this.downTimer = config.down.seconds;
      this.clearAttack();
      this.emit({ kind: 'down' });
    }
    if (this.attack && this.sealed(this.attack) && this.attackStep === 'windup') this.clearAttack();
  }

  private updatePhase(): void {
    const ratio = this.hpValue / this.maxHpValue;
    const p = config.phases;
    const next = ratio <= p.phase3Ratio + 1e-9 ? 3 : ratio <= p.phase2Ratio + 1e-9 ? 2 : 1;
    while (this.phase < next) {
      this.phase++;
      if (this.phase === 3 && this.useFinalTimer) this.finalRemaining = p.finalSeconds;
      this.emit({ kind: 'phase', phase: this.phase });
    }
  }

  /** 撤退（M5）: 出てきた海へ引き返しながら沈む */
  retreat(): void {
    if (!this.targetable) return;
    this.clearAttack();
    this.downTimer = 0;
    this.heading = headingToward(this.origin.x - this.feet.x, this.origin.z - this.feet.z);
    this.enter('retreating');
    this.emit({ kind: 'retreat' });
  }

  /** 固定ステップの初め: 前の値を残し、タイマーを進める。動きは AI がこの後に書く */
  step(dt: number): void {
    copyVec3(this.prevFeet, this.feet);
    this.prevHeading = this.heading;
    for (const p of this.parts) copyVec3(p.prevPosition, p.position);
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
    if (!this.visible) return;
    this.stageTime += dt;
    this.time += dt;
    for (const p of this.parts) {
      if (p.breakTimer > 0) p.breakTimer = Math.max(0, p.breakTimer - dt);
      if (p.breakCooldown > 0) p.breakCooldown = Math.max(0, p.breakCooldown - dt);
    }
    if (this.downTimer > 0) this.downTimer = Math.max(0, this.downTimer - dt);
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
    switch (this.stage) {
      case 'rising': {
        const t = clamp(this.stageTime / config.riseSeconds + 1e-9, 0, 1);
        this.place(this.floorAt(this.feet.x, this.feet.z) - config.height * (1 - t));
        this.velocity.y = config.height / config.riseSeconds;
        if (t >= 1) this.enter('active');
        break;
      }
      case 'active':
        if (this.finalRemaining !== null && !this.cityReached) {
          this.finalRemaining = Math.max(0, this.finalRemaining - dt);
          if (this.finalRemaining <= 0) this.reachCity();
        }
        break;
      case 'retreating': {
        const r = config.retreat;
        const sink = config.height * clamp(this.stageTime / r.sinkSeconds, 0, 1);
        this.moveForward(r.speed, dt, sink);
        if (this.stageTime >= r.sinkSeconds) this.stage = 'gone';
        break;
      }
      default:
        break;
    }
  }

  /** 固定ステップの終わり（AI の後）: 姿勢と部位の位置 */
  finishStep(): void {
    if (!this.visible) return;
    this.updateParts();
  }

  /** 街に到達した（6-4: 向かう先に着いた。最終フェーズの時間切れと同じ失敗） */
  reachCity(): void {
    if (!this.cityReached) this.emit({ kind: 'cityReached' });
    this.cityReached = true;
  }

  /** (x, z) へ向きを変えながら speed で歩く（向きが大きくずれている間は足踏みで回る） */
  walkToward(x: number, z: number, speed: number, dt: number): void {
    const want = headingToward(x - this.feet.x, z - this.feet.z);
    const diff = this.turnToward(want, config.walk.turnDegPerSecond, dt);
    const d = Math.hypot(x - this.feet.x, z - this.feet.z);
    const pace = Math.abs(diff) > Math.PI / 3 ? 0.3 : 1;
    this.moveForward(Math.min(speed * pace, d / dt), dt, 0);
  }

  /** 向きを want へ degPerSecond で回す。回した後の残りの差（ラジアン）を返す */
  turnToward(want: number, degPerSecond: number, dt: number): number {
    const diff = wrapAngle(want - this.heading);
    const max = ((degPerSecond * Math.PI) / 180) * dt;
    this.heading = wrapAngle(this.heading + clamp(diff, -max, max));
    return wrapAngle(want - this.heading);
  }

  /** 前へ speed で進む（足元は地表・海面から sink 下）。歩数を数えて足音を出す */
  moveForward(speed: number, dt: number, sink: number): void {
    const f = this.feet;
    const y0 = f.y;
    const vx = -Math.sin(this.heading) * speed;
    const vz = -Math.cos(this.heading) * speed;
    f.x += vx * dt;
    f.z += vz * dt;
    this.place(this.floorAt(f.x, f.z) - sink);
    this.velocity.x = vx;
    this.velocity.y = (f.y - y0) / dt;
    this.velocity.z = vz;
    const before = Math.floor(this.walkPhase);
    this.walkPhase += (speed * dt) / config.walk.strideLength;
    if (Math.floor(this.walkPhase) !== before && sink === 0) this.emit({ kind: 'step' });
  }

  private place(y: number): void {
    this.feet.y = y;
  }

  private updateParts(): void {
    derivePose(this, this.pose);
    for (const p of this.parts) partCenter(p.position, p.id, this.feet, this.heading, this.pose);
  }

  private enter(stage: KaijuStage): void {
    this.stage = stage;
    this.stageTime = 0;
  }

  /** 立つ高さ: 島の上は地表、海の上は海面 */
  floorAt(x: number, z: number): number {
    return Math.max(0, this.groundHeight(x, z));
  }
}
