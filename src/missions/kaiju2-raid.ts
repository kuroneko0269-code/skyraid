// 9-6b: ネフィルガのレイド（ソロ。?dev=kaiju2 の裏だけ）の進め方（Three.js・DOM 非依存）: 体力と部位 HP・部位の破壊で
// 動きが変わる（翼・頭・尾）・段階（70% / 40%）・止まり木の間のダメージ・制限時間（嵐の 4.5 分と全体の 12 分）・撃破で落ちる。
// 動きと攻撃は 9-6a の Kaiju2Ai。状態はすべてプロパティ（関数を持たない）なので、リプレイの状態の走査にそのまま入る
import type { Flare } from '../combat/flare';
import type { Pool } from '../combat/pool';
import { Kaiju2Ai, type Kaiju2Hooks, type Kaiju2Target } from '../ai/kaiju2-ai';
import { forcePerch } from '../ai/kaiju2-perch';
import { KAIJU2_CONFIG, KAIJU2_PARTS } from '../data/kaiju2';
import { KAIJU2_RAID_CONFIG as R, KAIJU2_TARGETS, isBreakable } from '../data/kaiju2-raid';
import type { RaidDifficulty } from '../data/raid';
import { Kaiju2PartTarget } from '../entities/kaiju2/kaiju2-target';
import { SkyKaiju, type Kaiju2Ground } from '../entities/kaiju2/sky-kaiju';
import { vec3 } from '../flight/math';

/** 止まり木の間（降りる・休む・飛び立つ）は攻撃しない（攻める隙） */
export function isPerching(k: SkyKaiju): boolean {
  return k.state === 'landing' || k.state === 'perched' || k.state === 'takeoff';
}

export class Kaiju2Raid {
  readonly body: SkyKaiju;
  readonly ai: Kaiju2Ai;
  /** 撃てる部位（KAIJU2_TARGETS の順。CombatSystem.allTargets の末尾に足す） */
  readonly targets: Kaiju2PartTarget[];
  readonly velocity = vec3();
  /** レイドで動かしている（確かめる場のフリーフライトは false: 体力は減るが倒れない） */
  raid = false;
  difficulty: RaidDifficulty = 'normal';
  hp: number = R.hp;
  maxHp: number = R.hp;
  /** 倒した（落ちている・消えた） */
  dead = false;
  /** 倒してからの秒数 */
  deadTime = 0;
  /** 落ちて地面・海面に着いてからの秒数（-1 は着いていない） */
  landedTime = -1;
  /** レイドの経過（秒。倒すと止まる）と、嵐（段階 3）に入った時刻（-1 は入っていない） */
  elapsed = 0;
  stormAt = -1;
  /** 嵐が街に着いた（制限時間。失敗） */
  stormReached = false;
  /** 被弾で白く光る残り秒数 */
  flash = 0;
  /** 段階が変わって吠えている残り秒数 */
  shout = 0;
  /** 壊れた部位の数・最後に壊れた部位（HUD・音の合図。描画フレームが前の値と比べる） */
  brokenCount = 0;
  lastBroken: string | null = null;
  /** 部位ごとに与えたダメージ（全体 HP を減らした量。結果・ボットの集計） */
  readonly dealt: Record<string, number> = { body: 0, wingL: 0, wingR: 0, head: 0, tail: 0 };

  constructor(ground: Kaiju2Ground, hooks: Kaiju2Hooks) {
    this.body = new SkyKaiju(ground);
    this.ai = new Kaiju2Ai(this.body, hooks);
    this.targets = KAIJU2_TARGETS.map((id) => new Kaiju2PartTarget(id, this));
  }

  get targetable(): boolean {
    return this.body.visible && !this.dead;
  }

  get isDestroyed(): boolean {
    return this.dead;
  }

  /** 制限時間の残り（秒）。全体と嵐の短い方 */
  get timeLeft(): number {
    const total = R.totalSeconds[this.difficulty] - this.elapsed;
    if (this.stormAt < 0) return Math.max(0, total);
    return Math.max(
      0,
      Math.min(total, R.finalSeconds[this.difficulty] - (this.elapsed - this.stormAt)),
    );
  }

  /** 与えたダメージの割合（0〜1） */
  get damageRatio(): number {
    return 1 - this.hp / this.maxHp;
  }

  /** 体力と部位を満タンにする。raid なら難易度の倍率を掛ける（確かめる場は hpRatio と壊れた部位を URL から） */
  reset(raid: boolean, difficulty: RaidDifficulty): void {
    this.raid = raid;
    this.difficulty = difficulty;
    const hard = raid && difficulty === 'hard';
    const k = this.body;
    k.windupScale = hard ? R.hard.windupScale : 1;
    k.intervalScale = hard ? R.hard.intervalScale : 1;
    k.damageScale = hard ? R.hard.damageScale : 1;
    k.visible = true;
    this.maxHp = R.hp * (hard ? R.hard.hpScale : 1);
    this.hp = this.maxHp;
    for (const t of this.targets) t.reset(this.maxHp * R.targets[t.id].hpShare);
    for (const p of KAIJU2_PARTS) k.broken[p] = false;
    k.setHpRatio(1);
    this.dead = false;
    this.deadTime = 0;
    this.landedTime = -1;
    this.elapsed = 0;
    this.stormAt = -1;
    this.stormReached = false;
    this.flash = 0;
    this.shout = 0;
    this.brokenCount = 0;
    this.lastBroken = null;
    for (const key of Object.keys(this.dealt)) this.dealt[key] = 0;
  }

  /** 体力の割合と壊れた部位を決める（確かめる場の URL）。部位 HP も合わせる */
  setStart(hpRatio: number, broken: readonly string[]): void {
    this.hp = this.maxHp * hpRatio;
    for (const t of this.targets) {
      if (isBreakable(t.id) && broken.includes(t.id)) {
        t.partHp = 0;
        this.body.broken[t.id] = true;
      }
    }
    this.body.setHpRatio(hpRatio);
    if (this.body.phase === 3) this.stormAt = 0;
  }

  /** 出した直後に部位の位置を置く */
  placeTargets(): void {
    for (const t of this.targets) t.place(this.body, true);
  }

  damageTarget(target: Kaiju2PartTarget, amount: number): boolean {
    if (!this.targetable || amount <= 0) return false;
    const k = this.body;
    const dmg =
      amount * R.targets[target.id].damageScale * (isPerching(k) ? R.perchedDamageScale : 1);
    this.flash = R.flashSeconds;
    // 確かめる場（raid でない）は 1 まで減らして倒さない
    const floor = this.raid ? 0 : 1;
    const before = this.hp;
    this.hp = Math.max(floor, this.hp - dmg);
    this.dealt[target.id] = (this.dealt[target.id] ?? 0) + (before - this.hp);
    if (isBreakable(target.id) && !target.broken) {
      target.partHp = Math.max(0, target.partHp - dmg);
      if (target.partHp <= 0) this.breakPart(target.id);
    }
    const phase = k.phase;
    k.setHpRatio(this.hp / this.maxHp);
    if (k.phase > phase) {
      this.shout = R.phaseShoutSeconds;
      k.attackCooldown = Math.max(k.attackCooldown, R.phaseShoutSeconds);
      if (k.phase === 3 && this.stormAt < 0) this.stormAt = this.elapsed;
    }
    if (this.hp <= 0 && !this.dead) {
      this.dead = true;
      this.deadTime = 0;
      for (const o of k.orbs) o.active = false;
      return true;
    }
    return false;
  }

  private breakPart(id: (typeof KAIJU2_PARTS)[number]): void {
    const k = this.body;
    k.broken[id] = true;
    this.brokenCount++;
    this.lastBroken = id;
    this.ai.cancelBlocked();
    // 両方の翼を壊すと地上へ落ちて羽を休める（「落とす」手応え）
    if (k.broken.wingL && k.broken.wingR && (id === 'wingL' || id === 'wingR')) {
      this.lastBroken = 'both';
      forcePerch(k);
    }
  }

  /** 固定ステップ 1 回分 */
  step(dt: number, target: Kaiju2Target, flares: Pool<Flare> | null): void {
    const k = this.body;
    for (const t of this.targets) t.beginStep();
    this.flash = Math.max(0, this.flash - dt);
    this.shout = Math.max(0, this.shout - dt);
    if (this.dead) this.fall(dt);
    else {
      this.ai.step(dt, target, flares);
      if (this.raid) {
        this.elapsed += dt;
        if (
          this.elapsed >= R.totalSeconds[this.difficulty] ||
          (this.stormAt >= 0 && this.elapsed - this.stormAt >= R.finalSeconds[this.difficulty])
        )
          this.stormReached = true;
      }
    }
    const s = k.state === 'perched' ? 0 : k.speed;
    this.velocity.x = k.forward.x * s;
    this.velocity.y = k.forward.y * s;
    this.velocity.z = k.forward.z * s;
    for (const t of this.targets) t.place(k);
  }

  /** 倒した後: 翼をたたんで落ち、地面・海面に着いたら少しして消える */
  private fall(dt: number): void {
    const k = this.body;
    this.deadTime += dt;
    k.beginStep();
    if (!k.visible) return;
    const p = k.pose;
    p.wingFold += (1 - p.wingFold) * Math.min(1, dt * 2);
    p.flapAmount = 0;
    p.neckPitch += (-0.8 - p.neckPitch) * Math.min(1, dt * 2);
    p.throatGlow = 0;
    if (this.landedTime >= 0) {
      this.landedTime += dt;
      k.speed = 0;
      if (this.landedTime >= R.vanishSeconds) k.visible = false;
      return;
    }
    const f = k.forward;
    const h = Math.hypot(f.x, f.z) || 1;
    // 機首を下げて（最大 50°）落ちる
    const down = Math.min(0.9, 0.2 + this.deadTime * 0.4);
    f.x = (f.x / h) * Math.cos(down);
    f.z = (f.z / h) * Math.cos(down);
    f.y = -Math.sin(down);
    k.approachSpeed(R.fallSpeed, 40, dt);
    const before = k.position.y;
    k.integrate(dt, KAIJU2_CONFIG.bodyClearance);
    if (k.position.y >= before - 1e-6 && this.deadTime > 0.5) this.landedTime = 0;
  }
}
