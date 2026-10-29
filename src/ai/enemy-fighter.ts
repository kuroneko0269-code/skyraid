// 敵戦闘機の AI（Three.js 非依存）。状態機械: 巡航 → 追尾 → 攻撃 → 回避 → 離脱。
// 判断（遷移・発射）は反応時間ごと、操縦は毎ステップ（ai-pilot.ts）。
// 出すのは飛行モデルへの入力（AiCommand）だけで、物理はプレイヤーと共通（src/flight/）
import { AI_CONFIG, type DifficultySpec, type PatrolPoint } from '../data/ai';
import type { AircraftSpec } from '../data/aircraft';
import { ENEMY_GUN_CONFIG, type GunSpec } from '../data/weapons';
import { LOCAL_FORWARD } from '../flight/flight-model';
import { copyVec3, rotateVec3, vec3 } from '../flight/math';
import { AiPilot, type PilotIntent } from './ai-pilot';
import {
  unit,
  type AiCommand,
  type AiSelf,
  type AiSenses,
  type AiState,
  type AiTarget,
  type Rng,
} from './ai-types';
import {
  angleToDeg,
  canDetect,
  distance,
  gunLeadPoint,
  hasRearPosition,
  inAttackWindow,
  predictPosition,
} from './perception';

export type { AiCommand, AiSelf, AiSenses, AiState, AiTarget, Rng } from './ai-types';
export { createCommand } from './ai-types';
export type AiConfig = typeof AI_CONFIG;

const DEG = Math.PI / 180;

export class EnemyFighterAI {
  /** 今の状態に入ってからの時間 */
  stateTime = 0;
  /** 追尾・攻撃中に、最後に後方を取ってからの時間 */
  engageTime = 0;
  /** 受けたダメージの「続いている」度合い（半減しながら足す） */
  recentDamage = 0;
  private readonly intent: { -readonly [K in keyof PilotIntent]: PilotIntent[K] };
  private readonly pilot: AiPilot;
  private thinkTimer = 0;
  private hpRetreated = false;
  private missileTimer = 0;
  private wantMissile = false;
  private wantFlare = false;
  // 判断のときに見た相手（反応時間の分だけ古い）。今の位置は速度で外挿する
  private seenAge = 0;
  private readonly seenPos = vec3();
  private readonly seenVel = vec3();
  private readonly seenAcc = vec3();
  private readonly estimate = vec3();
  private readonly threatPos = vec3();
  private readonly forward = vec3();
  private readonly scratch = vec3();

  constructor(
    readonly spec: AircraftSpec,
    public difficulty: DifficultySpec,
    patrol: readonly PatrolPoint[],
    private readonly rng: Rng = Math.random,
    readonly config: AiConfig = AI_CONFIG,
    private readonly gun: GunSpec = ENEMY_GUN_CONFIG,
  ) {
    this.pilot = new AiPilot(spec, patrol, gun, config);
    this.intent = {
      state: 'patrol',
      seen: false,
      estimate: this.estimate,
      seenVel: this.seenVel,
      seenAcc: this.seenAcc,
      threatSeen: false,
      threatPos: this.threatPos,
      evadeBarrel: false,
      evadeSide: 1,
      aimYaw: 0,
      aimPitch: 0,
    };
  }

  get state(): AiState {
    return this.intent.state;
  }

  /** 巡航から始め直す（出現・再出現） */
  reset(): void {
    this.enter('patrol');
    this.engageTime = 0;
    this.recentDamage = 0;
    this.thinkTimer = 0;
    this.hpRetreated = false;
    this.missileTimer = 0;
    this.intent.seen = false;
    this.intent.threatSeen = false;
    this.pilot.reset();
  }

  /** 固定ステップ 1 回分。判断は reactionSeconds ごと、操縦は毎ステップ */
  step(senses: Readonly<AiSenses>, dt: number, out: AiCommand): void {
    const self = senses.self;
    rotateVec3(this.forward, self.orientation, LOCAL_FORWARD);
    this.stateTime += dt;
    this.engageTime += dt;
    this.seenAge += dt;
    this.missileTimer = Math.max(0, this.missileTimer - dt);
    const halfLife = this.config.evade.damageHalfLifeSeconds;
    this.recentDamage = this.recentDamage * Math.pow(0.5, dt / halfLife) + senses.damageTaken;

    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer += this.difficulty.reactionSeconds;
      if (this.thinkTimer <= 0) this.thinkTimer = this.difficulty.reactionSeconds;
      this.think(senses);
    }
    out.missile = this.wantMissile && senses.missileReady;
    out.flare = this.wantFlare && senses.flareReady;
    this.wantMissile = this.wantFlare = false;
    const i = this.intent;
    predictPosition(this.estimate, this.seenPos, this.seenVel, this.seenAge);
    this.pilot.fly(i, this.difficulty, self, this.forward, dt, out);
  }

  /** 状態の遷移と発射の判断（反応時間ごと） */
  private think(s: Readonly<AiSenses>): void {
    const cfg = this.config;
    const d = this.difficulty;
    const i = this.intent;
    const self = s.self;
    const target = s.target && s.target.active ? s.target : null;
    this.look(target);
    i.threatSeen = s.threat !== null;
    if (s.threat) copyVec3(this.threatPos, s.threat);
    // 狙いのずれは判断ごとに引き直す（円の中で一様）
    const r = Math.sqrt(this.rng()) * d.aimErrorDeg * DEG;
    const a = this.rng() * Math.PI * 2;
    i.aimYaw = Math.cos(a) * r;
    i.aimPitch = Math.sin(a) * r;

    const hpLow = self.hpRatio < cfg.disengage.hpRatio && !this.hpRetreated;
    if (i.state !== 'evade' && this.shouldEvade(d)) {
      this.enterEvade();
      return;
    }

    switch (i.state) {
      case 'patrol':
        if (target && canDetect(self.position, this.forward, target.position, cfg.detection))
          this.enter('engage');
        break;
      case 'engage':
      case 'attack':
        this.thinkCombat(s, target, hpLow);
        break;
      case 'evade':
        if (i.threatSeen && this.rng() < d.flareChance) this.wantFlare = true;
        if (
          this.stateTime >= cfg.evade.seconds &&
          (!i.threatSeen || this.stateTime >= cfg.evade.maxSeconds)
        ) {
          if (hpLow) this.enterRetreat();
          else this.enter(target ? 'engage' : 'patrol');
        }
        break;
      case 'disengage':
        if (this.stateTime >= cfg.disengage.seconds) this.enter(target ? 'engage' : 'patrol');
        break;
    }
  }

  /** 相手を見る: 位置・速度と、前回見たときからの速度の変化（加速度）を覚える */
  private look(target: AiTarget | null): void {
    const i = this.intent;
    const wasSeen = i.seen;
    i.seen = target !== null;
    if (!target) return;
    const acc = this.seenAcc;
    const elapsed = this.seenAge;
    if (wasSeen && elapsed > 1e-6) {
      acc.x = (target.velocity.x - this.seenVel.x) / elapsed;
      acc.y = (target.velocity.y - this.seenVel.y) / elapsed;
      acc.z = (target.velocity.z - this.seenVel.z) / elapsed;
    } else {
      acc.x = acc.y = acc.z = 0;
    }
    copyVec3(this.seenPos, target.position);
    copyVec3(this.seenVel, target.velocity);
    this.seenAge = 0;
  }

  /** ミサイルに追われている、または被弾が続いていれば、確率で回避へ */
  private shouldEvade(d: DifficultySpec): boolean {
    const i = this.intent;
    if (i.threatSeen && this.rng() < d.evadeMissileChance) return true;
    return (
      this.recentDamage > this.config.evade.damageThreshold &&
      i.seen &&
      this.rng() < d.evadeHitChance
    );
  }

  /** 追尾・攻撃中の判断: 見失い・HP 低下・タイムアウト・攻撃の窓・ミサイル */
  private thinkCombat(s: Readonly<AiSenses>, target: AiTarget | null, hpLow: boolean): void {
    const cfg = this.config;
    const d = this.difficulty;
    const self = s.self;
    const dist = target ? distance(self.position, target.position) : Infinity;
    if (!target || dist > cfg.detection.loseRange) {
      this.enter('patrol');
      return;
    }
    if (hpLow) {
      this.enterRetreat();
      return;
    }
    const back = unit(this.scratch, target.velocity);
    if (hasRearPosition(self.position, target.position, back, cfg.engage)) this.engageTime = 0;
    if (this.engageTime > cfg.engage.timeoutSeconds && this.rng() < cfg.engage.disengageChance) {
      this.enter('disengage');
      return;
    }
    const engaging = this.intent.state === 'engage';
    const inWindow = inAttackWindow(this.noseToLeadDeg(self, target), dist, engaging, cfg.attack);
    if (engaging && inWindow) this.enter('attack');
    else if (!engaging && !inWindow) this.enter('engage');
    if (s.locked && this.missileTimer <= 0 && this.rng() < d.missileChance) {
      this.wantMissile = true;
      this.missileTimer = d.missileIntervalSeconds;
    }
  }

  private noseToLeadDeg(self: AiSelf, target: AiTarget): number {
    const lead = this.scratch;
    const t = gunLeadPoint(
      lead,
      self.position,
      self.speed,
      target.position,
      target.velocity,
      this.gun,
      this.seenAcc,
      this.difficulty.leadAccelWeight,
    );
    if (t < 0) return 180;
    return angleToDeg(self.position, this.forward, lead);
  }

  private enter(state: AiState): void {
    const i = this.intent;
    // 攻撃 ⇄ 追尾の行き来では「後方を取れていない時間」を続ける
    if (state === 'engage' && i.state !== 'attack') this.engageTime = 0;
    i.state = state;
    this.stateTime = 0;
  }

  private enterEvade(): void {
    this.enter('evade');
    this.intent.evadeBarrel = this.rng() < this.config.evade.barrelRollChance;
    this.intent.evadeSide = this.rng() < 0.5 ? -1 : 1;
  }

  private enterRetreat(): void {
    this.hpRetreated = true;
    this.enter('disengage');
  }
}
