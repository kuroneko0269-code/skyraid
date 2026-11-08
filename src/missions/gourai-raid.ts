// 10-4b: メカ怪獣ゴウライのレイド（ソロ。協力のホスト・写しも同じもの）の進め方（Three.js・DOM 非依存）: 体力（難易度・協力の人数の
// 倍率）・制限時間（湾を離れて去る）・撃破で傾きながら海へ沈む・被弾の光・勲章の印（砲台をすべて壊した・放熱中に核を壊した・
// ミサイルをフレアで外した）。動き・弾幕・熱・攻撃・部位は 10-4a の GouraiKaiju。
// 状態はすべて数・配列のプロパティ（関数を持たない）なので、リプレイの状態の走査にそのまま入る（GamePlay の差し込み口の stateRoot）
import { GouraiKaiju, type GouraiHit, type GouraiTarget } from '../ai/gourai-ai';
import type { Flare } from '../combat/flare';
import type { Pool } from '../combat/pool';
import { GOURAI_CONFIG as C, GOURAI_PARTS } from '../data/gourai';
import { GOURAI_RAID_CONFIG as R, gouraiCoopHpScale } from '../data/gourai-raid';
import type { RaidDifficulty } from '../data/raid';
import type { GouraiGround, GouraiPatrol } from '../entities/gourai/gourai-body';

const CORE = GOURAI_PARTS.indexOf('core');

export class GouraiRaid {
  readonly kaiju: GouraiKaiju;
  /** レイドで動かしている（確かめる場のフリーフライトは false: 体力は減るが倒れない） */
  raid = false;
  difficulty: RaidDifficulty = 'normal';
  /** 協力の人数（全体 HP の倍率） */
  players = 1;
  /** レイドの経過（秒。倒すと止まる） */
  elapsed = 0;
  /** 制限時間が切れた（湾を離れて去る。失敗） */
  timeUp = false;
  dead = false;
  deadTime = 0;
  /** 海面に着いてからの秒数（-1 は着いていない） */
  landedTime = -1;
  /** 被弾で白く光る残り秒数 */
  flash = 0;
  /** ソロの自機が受けた当たり（機銃の弾幕・回転掃射・ミサイル）と体への衝突の数 */
  gunTaken = 0;
  sweepTaken = 0;
  missileTaken = 0;
  bodyTaken = 0;
  /** 核を壊したのが放熱の間だった（1）か（勲章「放熱中に核を壊した」） */
  coreInVent = 0;

  /** mirror: 協力のクライアントの写し（ダメージを受けず、値はホストの state から写す） */
  constructor(
    ground: GouraiGround,
    readonly mirror = false,
  ) {
    this.kaiju = new GouraiKaiju(ground);
  }

  get targetable(): boolean {
    return this.kaiju.body.visible && !this.dead;
  }

  /** 与えたダメージの割合（0〜1） */
  get damageRatio(): number {
    return 1 - this.kaiju.parts.ratio;
  }

  /** 制限時間の残り（秒） */
  get timeLeft(): number {
    return Math.max(0, R.totalSeconds[this.difficulty] - this.elapsed);
  }

  /** 壊れた部位の数 */
  get brokenCount(): number {
    return this.kaiju.parts.brokenOrder.length;
  }

  /** 勲章「砲台をすべて壊して倒した」（src/missions/badges/sortie.ts が印で読む） */
  get gouraiTurretsGone(): boolean {
    return this.raid && this.kaiju.turretsAlive === 0;
  }

  /** 勲章「放熱中に核を壊した」 */
  get gouraiVentCore(): boolean {
    return this.raid && this.coreInVent === 1;
  }

  /** 勲章「ミサイルを一度も受けずに倒した（フレアで 4 発以上外した）」 */
  get gouraiFlared(): boolean {
    return this.raid && this.missileTaken === 0 && this.kaiju.decoyed >= 4;
  }

  /** 体力（難易度・人数の倍率）と難易度の倍率を決める。raid でなければ確かめる場（倒れない・倍率なし） */
  reset(raid: boolean, difficulty: RaidDifficulty, players = 1): void {
    this.raid = raid;
    this.difficulty = difficulty;
    this.players = players;
    const k = this.kaiju;
    const hard = raid && difficulty === 'hard';
    k.immortal = !raid;
    k.intervalScale = hard ? R.hard.intervalScale : 1;
    k.damageScale = hard ? R.hard.damageScale : 1;
    k.barrageScale = hard ? R.hard.barrageRate : 1;
    k.parts.setMaxHp(C.hp * (hard ? R.hard.hpScale : 1) * gouraiCoopHpScale(raid ? players : 1));
    this.elapsed = 0;
    this.timeUp = false;
    this.dead = false;
    this.deadTime = 0;
    this.landedTime = -1;
    this.flash = 0;
    this.gunTaken = 0;
    this.sweepTaken = 0;
    this.missileTaken = 0;
    this.bodyTaken = 0;
    this.coreInVent = 0;
  }

  /** 巡回の上に出す（種・体力の割合・壊れた部位は確かめる場の URL から。レイドは 1 と無し） */
  spawn(
    patrol: GouraiPatrol,
    x: number,
    z: number,
    heading: number,
    seed: number,
    arena: { readonly x: number; readonly z: number },
    hpRatio = 1,
    broken: readonly string[] = [],
  ): void {
    const k = this.kaiju;
    k.body.arenaX = arena.x;
    k.body.arenaZ = arena.z;
    k.spawn(patrol, x, z, heading, seed, hpRatio, broken);
    if (this.raid) k.cooldown = R.firstAttackDelay;
  }

  /** 判定の球に当てる（attacker はプレイヤー ID）。倒したら true */
  damageSphere(sphere: number, amount: number, attacker = 0): boolean {
    if (this.mirror || !this.targetable || amount <= 0) return false;
    const k = this.kaiju;
    this.flash = R.flashSeconds;
    const coreBefore = k.parts.isBroken(CORE);
    const venting = k.action === 'vent';
    const killed = k.damageSphere(sphere, amount, attacker);
    if (!coreBefore && k.parts.isBroken(CORE) && venting) this.coreInVent = 1;
    if (killed && this.raid && !this.dead) {
      this.dead = true;
      this.deadTime = 0;
      return true;
    }
    return false;
  }

  /** 固定ステップ 1 回分。target は大きな攻撃を向ける人、crowd は弾幕が狙い・弾が当たる人（ソロは自機だけ） */
  step(
    dt: number,
    target: GouraiTarget,
    flares: Pool<Flare> | null,
    onHit: GouraiHit,
    crowd?: readonly GouraiTarget[],
  ): void {
    this.flash = Math.max(0, this.flash - dt);
    if (this.dead) {
      this.fall(dt);
      return;
    }
    this.kaiju.step(dt, target, flares, onHit, crowd ?? [target]);
    if (!this.raid) return;
    this.elapsed += dt;
    if (this.elapsed >= R.totalSeconds[this.difficulty]) this.timeUp = true;
  }

  /** 倒した後: 推進器が止まり、傾きながら海へ沈んで、着いたら少しして消える（飛んでいる弾は消す） */
  private fall(dt: number): void {
    const k = this.kaiju;
    const b = k.body;
    this.deadTime += dt;
    b.prevPosition.x = b.position.x;
    b.prevPosition.y = b.position.y;
    b.prevPosition.z = b.position.z;
    b.prevHeading = b.heading;
    if (this.deadTime <= dt) k.shots.clear();
    if (!b.visible) return;
    const pose = b.pose;
    pose.exhaust += (0 - pose.exhaust) * Math.min(1, dt);
    pose.gunGlow = 0;
    pose.hatch += (0 - pose.hatch) * Math.min(1, dt);
    if (this.landedTime >= 0) {
      this.landedTime += dt;
      if (this.landedTime >= R.vanishSeconds) b.visible = false;
      return;
    }
    b.roll += (0.45 - b.roll) * Math.min(1, dt * 0.6);
    b.pitch += (0.25 - b.pitch) * Math.min(1, dt * 0.6);
    b.position.x += b.velocity.x * dt;
    b.position.z += b.velocity.z * dt;
    b.velocity.x *= Math.max(0, 1 - dt);
    b.velocity.z *= Math.max(0, 1 - dt);
    b.position.y -= R.fallSpeed * Math.min(1, this.deadTime / 1.5) * dt;
    const floor = b.floorAt(b.position.x, b.position.z) + 10;
    if (b.position.y <= floor) {
      b.position.y = floor;
      this.landedTime = 0;
    }
    b.velocity.y = dt > 0 ? (b.position.y - b.prevPosition.y) / dt : 0;
  }
}
