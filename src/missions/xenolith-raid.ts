// 10-5b: UFO ゼノリスのレイド（ソロ。協力のホスト・写しも同じもの）の進め方（Three.js・DOM 非依存）: 体力（難易度・協力の人数の
// 倍率）・制限時間（空へ去る）・撃破で光が消えて落ちる・被弾の光・勲章の印（発生器をすべて壊した・発光体をすべて壊した・
// 溜め撃ちに一度も当たらなかった）。動き・バリア・瞬間移動・光線・部位は 10-5a の XenolithKaiju。
// 状態はすべて数・配列のプロパティ（関数を持たない）なので、リプレイの状態の走査にそのまま入る（GamePlay の差し込み口の stateRoot）
import { XenolithKaiju, type XenolithHit, type XenolithTarget } from '../ai/xenolith-ai';
import { XENOLITH_CONFIG as C } from '../data/xenolith';
import { XENOLITH_RAID_CONFIG as R, xenolithCoopHpScale } from '../data/xenolith-raid';
import type { RaidDifficulty } from '../data/raid';
import type { XenolithGround } from '../entities/xenolith/xenolith-body';

export class XenolithRaid {
  readonly kaiju: XenolithKaiju;
  /** レイドで動かしている（確かめる場のフリーフライトは false: 体力は減るが倒れない） */
  raid = false;
  difficulty: RaidDifficulty = 'normal';
  /** 協力の人数（全体 HP の倍率） */
  players = 1;
  /** レイドの経過（秒。倒すと止まる） */
  elapsed = 0;
  /** 制限時間が切れた（空へ去る。失敗） */
  timeUp = false;
  dead = false;
  deadTime = 0;
  /** 海面に着いてからの秒数（-1 は着いていない） */
  landedTime = -1;
  /** 被弾で白く光る残り秒数 */
  flash = 0;
  /** ソロの自機が受けた当たり（なぎ払い・溜め撃ち・光の弾）と体への衝突の数 */
  sweepTaken = 0;
  chargedTaken = 0;
  orbTaken = 0;
  bodyTaken = 0;

  /** mirror: 協力のクライアントの写し（ダメージを受けず、値はホストの state から写す） */
  constructor(
    ground: XenolithGround,
    readonly mirror = false,
  ) {
    this.kaiju = new XenolithKaiju(ground);
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

  /** 勲章「発生器をすべて壊して倒した」（src/missions/badges/sortie.ts が印で読む） */
  get xenolithGensGone(): boolean {
    return this.raid && this.kaiju.brokenGens >= 3;
  }

  /** 勲章「縁の発光体をすべて壊して倒した（瞬間移動を止めた）」 */
  get xenolithWarpStopped(): boolean {
    return this.raid && !this.kaiju.warpEnabled;
  }

  /** 勲章「溜め撃ちに一度も当たらずに倒した（溜め撃ちを 3 回以上撃たせて）」 */
  get xenolithChargedDodged(): boolean {
    return this.raid && this.chargedTaken === 0 && this.kaiju.attacksUsed.charged >= 3;
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
    k.parts.setMaxHp(C.hp * (hard ? R.hard.hpScale : 1) * xenolithCoopHpScale(raid ? players : 1));
    this.elapsed = 0;
    this.timeUp = false;
    this.dead = false;
    this.deadTime = 0;
    this.landedTime = -1;
    this.flash = 0;
    this.sweepTaken = 0;
    this.chargedTaken = 0;
    this.orbTaken = 0;
    this.bodyTaken = 0;
  }

  /** 出す（種・体力の割合・壊れた部位は確かめる場の URL から。レイドは 1 と無し） */
  spawn(
    x: number,
    y: number,
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
    k.spawn(x, y, z, heading, seed, hpRatio, broken);
    if (this.raid) {
      k.cooldown = R.firstAttackDelay;
      k.warpTimer = R.firstWarpDelay;
    }
  }

  /** 判定の球に当てる（attacker はプレイヤー ID）。倒したら true */
  damageSphere(sphere: number, amount: number, attacker = 0): boolean {
    if (this.mirror || !this.targetable || amount <= 0) return false;
    const k = this.kaiju;
    const before = k.parts.hp;
    const killed = k.damageSphere(sphere, amount, attacker);
    if (k.parts.hp < before) this.flash = R.flashSeconds;
    if (killed && this.raid && !this.dead) {
      this.dead = true;
      this.deadTime = 0;
      return true;
    }
    return false;
  }

  /** 当たりの数え（ソロの自機・協力の全員の合計） */
  count(attack: string): void {
    if (attack === 'sweep') this.sweepTaken++;
    else if (attack === 'charged') this.chargedTaken++;
    else if (attack === 'orbs') this.orbTaken++;
  }

  /** 固定ステップ 1 回分。target は回る中心・光線・瞬間移動を向ける人、crowd は光線が当たる人（ソロは自機だけ） */
  step(
    dt: number,
    target: XenolithTarget,
    onHit: XenolithHit,
    crowd?: readonly XenolithTarget[],
  ): void {
    this.flash = Math.max(0, this.flash - dt);
    if (this.dead) {
      this.fall(dt);
      return;
    }
    this.kaiju.step(dt, target, onHit, crowd ?? [target]);
    if (!this.raid) return;
    this.elapsed += dt;
    if (this.elapsed >= R.totalSeconds[this.difficulty]) this.timeUp = true;
  }

  /** 倒した後: 光線とバリアが消え、傾きながら落ちて、海面に着いたら少しして消える */
  private fall(dt: number): void {
    const k = this.kaiju;
    const b = k.body;
    this.deadTime += dt;
    b.prevPosition.x = b.position.x;
    b.prevPosition.y = b.position.y;
    b.prevPosition.z = b.position.z;
    b.prevHeading = b.heading;
    b.prevSpin = b.spin;
    b.warped = false;
    if (this.deadTime <= dt) {
      k.beam.cancel();
      k.attack = null;
      k.warp.phase = 'idle';
      k.barrier.phase = 'down';
      k.barrier.time = 0;
      k.clearOrbs();
    }
    if (!b.visible) return;
    if (this.landedTime >= 0) {
      this.landedTime += dt;
      if (this.landedTime >= R.vanishSeconds) b.visible = false;
      return;
    }
    b.roll += (0.6 - b.roll) * Math.min(1, dt * 0.8);
    b.pitch += (0.2 - b.pitch) * Math.min(1, dt * 0.8);
    b.spin = (b.spin + C.move.spin * 3 * dt) % (Math.PI * 2);
    b.position.x += b.velocity.x * dt;
    b.position.z += b.velocity.z * dt;
    b.velocity.x *= Math.max(0, 1 - dt);
    b.velocity.z *= Math.max(0, 1 - dt);
    b.position.y -= R.fallSpeed * Math.min(1, this.deadTime / 1.2) * dt;
    const floor = b.floorAt(b.position.x, b.position.z) + 8;
    if (b.position.y <= floor) {
      b.position.y = floor;
      this.landedTime = 0;
    }
    b.velocity.y = dt > 0 ? (b.position.y - b.prevPosition.y) / dt : 0;
  }
}
