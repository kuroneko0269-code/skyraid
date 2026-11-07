// 10-3b: 白鯨アルビオンのレイド（ソロ。協力のホスト・写しも同じもの）の進め方（Three.js・DOM 非依存）: 体力（難易度・協力の人数の
// 倍率）・制限時間（湾を渡り切って去る）・撃破で海へ落ちる・被弾の光。動き・攻撃・部位・子分は 10-3a の AlbionKaiju。
// 状態はすべて数・配列のプロパティ（関数を持たない）なので、リプレイの状態の走査にそのまま入る（GamePlay の差し込み口の stateRoot）
import { AlbionKaiju, type AlbionHit, type AlbionTarget } from '../ai/albion-ai';
import { ALBION_CONFIG as C } from '../data/albion';
import { ALBION_RAID_CONFIG as R, albionCoopHpScale, albionMinionCap } from '../data/albion-raid';
import type { RaidDifficulty } from '../data/raid';
import type { AlbionGround } from '../entities/albion/albion-body';
import type { AlbionRoute } from '../entities/albion/albion-route';

export class AlbionRaid {
  readonly kaiju: AlbionKaiju;
  /** レイドで動かしている（確かめる場のフリーフライトは false: 体力は減るが倒れない） */
  raid = false;
  difficulty: RaidDifficulty = 'normal';
  /** 協力の人数（全体 HP・子分の上限の倍率） */
  players = 1;
  /** レイドの経過（秒。倒すと止まる） */
  elapsed = 0;
  /** 制限時間が切れた（湾を渡り切って去る。失敗） */
  timeUp = false;
  dead = false;
  deadTime = 0;
  /** 海面・地面に着いてからの秒数（-1 は着いていない） */
  landedTime = -1;
  /** 被弾で白く光る残り秒数 */
  flash = 0;
  /** 10-3c: ソロの自機が受けた人を狙う攻撃（水柱・歌・横転・呼び声）と体への衝突の数（勲章） */
  aimedTaken = 0;
  bodyTaken = 0;
  /** 攻撃した人（プレイヤー ID 0〜7）ごとの子分へのダメージ（協力の成績の「子分」の列） */
  readonly minionDamageBy: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

  /** mirror: 協力のクライアントの写し（ダメージを受けず、値はホストの state から写す） */
  constructor(
    ground: AlbionGround,
    readonly mirror = false,
  ) {
    this.kaiju = new AlbionKaiju(ground);
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

  /** 腹の巣を全部壊したか（勲章「巣をすべて壊して倒した」。src/missions/badges/sortie.ts が印で読む） */
  get albionNestsGone(): boolean {
    return this.kaiju.nestsGone;
  }

  /** 10-3c: 人を狙う攻撃と体に一度も当たっていないか（勲章「当たらずに倒した」。sortie.ts が印で読む） */
  get albionUntouched(): boolean {
    return this.raid && this.aimedTaken === 0 && this.bodyTaken === 0;
  }

  /** 壊れた部位の数 */
  get brokenCount(): number {
    return this.kaiju.parts.brokenOrder.length;
  }

  /**
   * 体力（難易度・人数の倍率）と難易度の倍率を決める。raid でなければ確かめる場（倒れない・倍率なし）
   */
  reset(raid: boolean, difficulty: RaidDifficulty, players = 1): void {
    this.raid = raid;
    this.difficulty = difficulty;
    this.players = players;
    const k = this.kaiju;
    const hard = raid && difficulty === 'hard';
    k.immortal = !raid;
    k.intervalScale = hard ? R.hard.intervalScale : 1;
    k.damageScale = hard ? R.hard.damageScale : 1;
    k.minionIntervalScale = hard ? R.hard.minionIntervalScale : 1;
    k.parts.setMaxHp(C.hp * (hard ? R.hard.hpScale : 1) * albionCoopHpScale(raid ? players : 1));
    k.swarm.limit = albionMinionCap(raid ? players : 1);
    this.elapsed = 0;
    this.timeUp = false;
    this.dead = false;
    this.deadTime = 0;
    this.landedTime = -1;
    this.flash = 0;
    this.aimedTaken = 0;
    this.bodyTaken = 0;
    this.minionDamageBy.fill(0);
  }

  /** 周回路の上に出す（種・体力の割合・壊れた部位は確かめる場の URL から。レイドは 1 と無し） */
  spawn(
    route: AlbionRoute,
    s: number,
    seed: number,
    arena: { readonly x: number; readonly z: number },
    hpRatio = 1,
    broken: readonly string[] = [],
  ): void {
    const k = this.kaiju;
    k.spawn(route, s, seed, hpRatio, broken);
    k.body.arenaX = arena.x;
    k.body.arenaZ = arena.z;
    if (this.raid) k.cooldown = R.firstAttackDelay;
  }

  /** 部位に当てる（attacker はプレイヤー ID）。倒したら true */
  damagePart(index: number, amount: number, attacker = 0): boolean {
    if (this.mirror || !this.targetable || amount <= 0) return false;
    this.flash = R.flashSeconds;
    const killed = this.kaiju.damagePart(index, amount, attacker);
    if (killed && this.raid && !this.dead) {
      this.dead = true;
      this.deadTime = 0;
      this.kaiju.swarm.clear();
      return true;
    }
    return false;
  }

  /** 子分に当てる（attacker はプレイヤー ID）。落ちたら true */
  damageMinion(index: number, amount: number, attacker = 0): boolean {
    if (this.mirror || !this.targetable) return false;
    const m = this.kaiju.swarm.minions[index];
    if (!m?.active || amount <= 0) return false;
    const who = Math.max(0, Math.min(7, Math.floor(attacker)));
    this.minionDamageBy[who] = (this.minionDamageBy[who] ?? 0) + Math.min(amount, m.hp);
    const down = this.kaiju.swarm.hit(index, amount, attacker);
    // 10-3c: 子分を落とすと本体の体力も減る（全体 HP の割合。落とした人の胴へのダメージ。胴の硬さ ×0.8 を戻して渡す）
    if (down) {
      const k = this.kaiju;
      const body = k.parts.indexOf('body');
      const factor = k.parts.specs[body]?.bodyFactor ?? 1;
      this.damagePart(body, (k.parts.maxHp * C.minionReward.hpRatio) / factor, attacker);
    }
    return down;
  }

  /** 固定ステップ 1 回分。target は攻撃を向ける人、crowd は子分が追う人（ソロは自機だけ） */
  step(dt: number, target: AlbionTarget, onHit: AlbionHit, crowd?: readonly AlbionTarget[]): void {
    this.flash = Math.max(0, this.flash - dt);
    if (this.dead) {
      this.fall(dt);
      return;
    }
    this.kaiju.step(dt, target, onHit, crowd);
    if (!this.raid) return;
    this.elapsed += dt;
    if (this.elapsed >= R.totalSeconds[this.difficulty]) this.timeUp = true;
  }

  /** 倒した後: 機首を下げて海へ落ち、着いたら少しして消える */
  private fall(dt: number): void {
    const b = this.kaiju.body;
    this.deadTime += dt;
    b.prevPosition.x = b.position.x;
    b.prevPosition.y = b.position.y;
    b.prevPosition.z = b.position.z;
    b.prevHeading = b.heading;
    b.prevBank = b.bank;
    if (!b.visible) return;
    const pose = b.pose;
    pose.mouth += (1 - pose.mouth) * Math.min(1, dt);
    pose.tailLift += (0 - pose.tailLift) * Math.min(1, dt);
    pose.spoutSwell = 0;
    pose.mist = 0;
    if (this.landedTime >= 0) {
      this.landedTime += dt;
      b.speed = 0;
      if (this.landedTime >= R.vanishSeconds) b.visible = false;
      return;
    }
    b.pitch += (-0.35 - b.pitch) * Math.min(1, dt * 0.5);
    b.bank += (0.5 - b.bank) * Math.min(1, dt * 0.3);
    b.speed = Math.max(0, b.speed - 4 * dt);
    const fx = -Math.sin(b.heading);
    const fz = -Math.cos(b.heading);
    b.position.x += fx * b.speed * dt;
    b.position.z += fz * b.speed * dt;
    b.position.y -= R.fallSpeed * Math.min(1, this.deadTime / 2) * dt;
    const floor = b.floorAt(b.position.x, b.position.z) + C.size.radius * 0.4;
    if (b.position.y <= floor) {
      b.position.y = floor;
      this.landedTime = 0;
    }
    if (dt > 0) {
      b.velocity.x = (b.position.x - b.prevPosition.x) / dt;
      b.velocity.y = (b.position.y - b.prevPosition.y) / dt;
      b.velocity.z = (b.position.z - b.prevPosition.z) / dt;
    }
  }
}
