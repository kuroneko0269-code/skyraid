// 10-3a: 白鯨アルビオンの本体（状態の根。Three.js 非依存）: 体（周回路を進む）・部位（10-2 の PartSet）・子分（MinionSwarm）・
// 攻撃の段（何もしない → 予兆 → 攻撃 → 硬直）・段階（体力で 1〜3）・雲。乱数は種の列（SeededRandom）だけ、時刻は dt の足し算だけ、
// 状態は数・配列・数のオブジェクトのプロパティだけ（リプレイのキーフレームと状態のハッシュにそのまま入る）
import { SeededRandom } from '../core/random';
import {
  ALBION_CONFIG as C,
  ALBION_NESTS,
  ALBION_PART_SPECS,
  type AlbionAction,
  type AlbionAttack,
} from '../data/albion';
import { ALBION_RAID_CONFIG } from '../data/albion-raid';
import type { Vec3 } from '../flight/math';
import { AlbionBody, type AlbionGround } from '../entities/albion/albion-body';
import type { AlbionRoute } from '../entities/albion/albion-route';
import { MinionSwarm } from './raid-kit/minions';
import { stepAlbionMinions } from './albion-minions';
export { nearest } from './albion-minions';
import { PartSet } from './raid-kit/parts';
import {
  attackTimes,
  chooseAttack,
  inSlam,
  inSpout,
  slamRadius,
  spoutRadius,
} from './albion-attacks';

/** 狙う人（ソロは自機。10-3b: 協力は 1 人ずつ。id はプレイヤー ID） */
export interface AlbionTarget {
  readonly position: Readonly<Vec3>;
  readonly active: boolean;
  readonly id?: number;
  /** 10-3b: 速度（子分が進む先を見越して寄る。無ければ今の位置へ） */
  readonly velocity?: Readonly<Vec3>;
}

/** 当たり（ダメージ。kind は攻撃か子分の体当たり、who は当たった人） */
export type AlbionHit = (kind: AlbionAttack | 'ram', damage: number, who: AlbionTarget) => void;

const NO_HIT: AlbionHit = () => undefined;

export class AlbionKaiju {
  readonly body: AlbionBody;
  readonly parts = new PartSet(ALBION_PART_SPECS, C.hp);
  readonly swarm = new MinionSwarm(C.minions, ALBION_NESTS);
  readonly random = new SeededRandom(1);
  action: AlbionAction = 'idle';
  attack: AlbionAttack | null = null;
  /** 今の段の経過秒 */
  actionTime = 0;
  /** 次の攻撃までの秒数（何もしない間に減る） */
  cooldown: number = C.dev.firstAttackDelay;
  lastAttack: AlbionAttack | null = null;
  /** 同じ攻撃が続いた回数（3 回続けない） */
  repeat = 0;
  phase = 1;
  /** 雲の残り秒（体に付いて動く） */
  cloudLeft = 0;
  /** この攻撃で当てたか（1 回の攻撃で 1 回） */
  hitDone = false;
  /** 数え: 攻撃ごとの回数・自機に当てた回数・子分の体当たり */
  readonly attacksUsed = { spout: 0, slam: 0, cloud: 0 };
  hitsOnPlayer = 0;
  rams = 0;
  elapsed = 0;
  /** 倒れない（確かめる場。体力は 1% で止まる） */
  immortal = false;
  /** 10-3b: 難易度の倍率（攻撃の間隔・当たりのダメージ・子分の間隔） */
  intervalScale = 1;
  damageScale = 1;
  minionIntervalScale = 1;

  constructor(ground: AlbionGround) {
    this.body = new AlbionBody(ground);
    this.swarm.limit = ALBION_RAID_CONFIG.minionCap[0] ?? C.minions.cap;
  }

  /** 出す（種・周回路・周回路の上の位置・体力の割合・壊れた部位で始める） */
  spawn(
    route: AlbionRoute,
    s: number,
    seed: number,
    hpRatio = 1,
    broken: readonly string[] = [],
  ): void {
    this.random.reseed(seed);
    this.body.spawn(route, s);
    const p = this.parts;
    p.hp = p.maxHp;
    for (let i = 0; i < p.count; i++) p.partHp[i] = p.partMaxHp[i] ?? 0;
    p.brokenOrder.length = 0;
    for (const row of p.damageBy) row.fill(0);
    p.breaksBy.fill(0);
    for (const id of broken) {
      const i = p.indexOf(id);
      if (i >= 0 && p.specs[i]?.breakable) p.partHp[i] = 0;
    }
    p.hp = p.maxHp * Math.max(0.01, Math.min(1, hpRatio));
    const sw = this.swarm;
    sw.clear();
    sw.timer = C.minions.firstDelay;
    sw.nextId = 0;
    sw.spawned = 0;
    sw.expired = 0;
    sw.killsBy.fill(0);
    this.action = 'idle';
    this.attack = null;
    this.actionTime = 0;
    this.cooldown = C.dev.firstAttackDelay;
    this.lastAttack = null;
    this.repeat = 0;
    this.phase = this.phaseOf(p.ratio);
    this.cloudLeft = 0;
    this.hitDone = false;
    this.attacksUsed.spout = 0;
    this.attacksUsed.slam = 0;
    this.attacksUsed.cloud = 0;
    this.hitsOnPlayer = 0;
    this.rams = 0;
    this.elapsed = 0;
  }

  phaseOf(ratio: number): number {
    const at = C.phases.at;
    let ph = 1;
    for (const v of at) if (ratio < v) ph++;
    return ph;
  }

  /** 部位に当てる（attacker はプレイヤー ID。ソロは 0）。この被弾で倒れたら true */
  damagePart(index: number, amount: number, attacker = 0): boolean {
    const hit = this.parts.damage(index, amount, attacker);
    if (!this.immortal) return hit.killed;
    const floor = this.parts.maxHp * 0.01;
    if (this.parts.hp < floor) this.parts.hp = floor;
    return false;
  }

  disabled(action: string): boolean {
    return this.parts.disabled(action);
  }

  mul(key: string): number {
    return this.parts.mul(key);
  }

  /** 腹の巣が全部壊れたか */
  get nestsGone(): boolean {
    return ALBION_NESTS.every((n) => this.parts.isBroken(n.part));
  }

  get phaseIndex(): number {
    return Math.min(2, this.phase - 1);
  }

  /**
   * 1 ステップ。target は攻撃を向ける人（ソロは自機）、crowd は子分が追う・体当たりする人の一覧（協力。省略はソロの target だけ）
   */
  step(
    dt: number,
    target: AlbionTarget,
    onHit: AlbionHit = NO_HIT,
    crowd: readonly AlbionTarget[] = [target],
  ): void {
    if (!this.body.visible) return;
    this.elapsed += dt;
    const ph = this.phaseIndex;
    // 段階: 体力が境目を下回ったら吠える（攻撃の途中なら取り消す）
    const next = this.phaseOf(this.parts.ratio);
    if (next > this.phase) {
      this.phase = next;
      this.setAction('roar', null);
    }
    const slow = this.action === 'windup' && this.attack === 'spout' ? 0.6 : 1;
    this.body.step(dt, (C.phases.speed[ph] ?? 1) * slow, this.mul('turnSpeed'));
    this.stepAction(dt, target, onHit);
    if (this.cloudLeft > 0) this.cloudLeft = Math.max(0, this.cloudLeft - dt);
    this.stepPose(dt);
    stepAlbionMinions(this, dt, crowd, onHit);
  }

  /** 10-3b: 協力の写し: 体と姿勢と子分の飛び方だけ進める（攻撃の選び方・当たり・子分を出すのはホスト） */
  stepMirror(dt: number): void {
    if (!this.body.visible) return;
    const slow = this.action === 'windup' && this.attack === 'spout' ? 0.6 : 1;
    this.body.step(dt, (C.phases.speed[this.phaseIndex] ?? 1) * slow, this.mul('turnSpeed'));
    this.actionTime += dt;
    if (this.cloudLeft > 0) this.cloudLeft = Math.max(0, this.cloudLeft - dt);
    this.stepPose(dt);
    for (const m of this.swarm.minions) {
      if (!m.active) continue;
      m.age += dt;
      m.position.x += m.velocity.x * dt;
      m.position.y += m.velocity.y * dt;
      m.position.z += m.velocity.z * dt;
    }
  }

  private setAction(a: AlbionAction, attack: AlbionAttack | null): void {
    this.action = a;
    this.attack = attack;
    this.actionTime = 0;
    this.hitDone = false;
  }

  private stepAction(dt: number, target: AlbionTarget, onHit: AlbionHit): void {
    this.actionTime += dt;
    const t = this.actionTime;
    const a = this.attack;
    const p = target.active ? target.position : null;
    switch (this.action) {
      case 'idle': {
        this.cooldown -= dt;
        if (this.cooldown > 0) return;
        const pick = chooseAttack(this, p, this.random.next);
        if (!pick) {
          this.cooldown = 1;
          return;
        }
        this.repeat = pick === this.lastAttack ? this.repeat + 1 : 1;
        this.lastAttack = pick;
        this.attacksUsed[pick]++;
        this.setAction('windup', pick);
        return;
      }
      case 'roar':
        if (t >= C.phases.roarSeconds) {
          this.setAction('idle', null);
          this.cooldown = Math.min(this.cooldown, 2);
        }
        return;
      case 'windup':
        if (!a) return;
        // 予兆の間に部位が壊れて使えなくなったら取り消す
        if (this.disabled(a)) {
          this.setAction('idle', null);
          this.cooldown = 2;
          return;
        }
        if (t >= attackTimes(a).windup) {
          if (a === 'cloud') {
            this.cloudLeft = C.attacks.cloud.seconds;
            this.setAction('recover', a);
          } else this.setAction('active', a);
        }
        return;
      case 'active':
        if (!a) return;
        if (!this.hitDone && p) {
          const hit =
            a === 'spout'
              ? inSpout(this.body, this.phase, p)
              : a === 'slam' && inSlam(this.body, slamRadius(this), p);
          if (hit) {
            this.hitDone = true;
            this.hitsOnPlayer++;
            const base = a === 'spout' ? C.attacks.spout.damage : C.attacks.slam.damage;
            onHit(a, base * this.damageScale, target);
          }
        }
        if (t >= attackTimes(a).active) this.setAction('recover', a);
        return;
      case 'recover':
        if (!a) return;
        if (t >= attackTimes(a).recover) {
          let cd =
            C.attackInterval * (C.phases.interval[this.phaseIndex] ?? 1) * this.intervalScale;
          if (a === 'spout' && this.nestsGone) cd *= C.attacks.spout.nestsGoneInterval;
          this.setAction('idle', null);
          this.cooldown = cd;
        }
        return;
    }
  }

  /** 見た目の姿勢（予兆・攻撃の段から。固定ステップで寄せる） */
  private stepPose(dt: number): void {
    const pose = this.body.pose;
    const a = this.attack;
    const act = this.action;
    const toward = (v: number, want: number, rate: number): number =>
      v + Math.max(-rate * dt, Math.min(rate * dt, want - v));
    const spoutOn = a === 'spout' && (act === 'windup' || act === 'active');
    pose.spoutSwell = toward(pose.spoutSwell, spoutOn ? 1 : 0, 1.2);
    pose.sink = toward(pose.sink, a === 'spout' && act === 'windup' ? C.attacks.spout.sink : 0, 12);
    let lift = 0;
    if (a === 'slam' && act === 'windup') lift = 1;
    else if (a === 'slam' && act === 'active') lift = -1;
    pose.tailLift = toward(pose.tailLift, lift, act === 'active' ? 6 : 0.9);
    pose.mist = toward(pose.mist, a === 'cloud' && act === 'windup' ? 1 : 0, 0.6);
    pose.mouth = toward(
      pose.mouth,
      act === 'roar' || (a === 'cloud' && act === 'windup') ? 1 : 0,
      1.5,
    );
  }

  /** 今の攻撃の段の残り秒（値の表示） */
  get actionLeft(): number {
    const a = this.attack;
    if (this.action === 'roar') return Math.max(0, C.phases.roarSeconds - this.actionTime);
    if (!a || this.action === 'idle') return Math.max(0, this.cooldown);
    const tm = attackTimes(a);
    const total =
      this.action === 'windup' ? tm.windup : this.action === 'active' ? tm.active : tm.recover;
    return Math.max(0, total - this.actionTime);
  }

  /** 潮吹きの柱の半径（描画） */
  get spoutRadius(): number {
    return spoutRadius(this.phase);
  }

  /** 叩きつけの扇の半径（描画） */
  get slamRadius(): number {
    return slamRadius(this);
  }
}
