// 10-4a: メカ怪獣ゴウライの本体（状態の根。Three.js 非依存）: 体（巡回をホバリングで滑る）・部位（10-2 の PartSet）・弾幕（Barrage）と
// 弾（ShotPool）・熱と放熱・大きな攻撃の段（何もしない → 予兆 → 攻撃 → 硬直）・段階（1: 装甲あり / 2: 装甲を捨てて速い）。
// 乱数は種の列（SeededRandom）だけ、時刻は dt の足し算だけ、状態は数・配列・数のオブジェクトのプロパティだけ
// （リプレイのキーフレームと状態のハッシュにそのまま入る）
import type { Flare } from '../combat/flare';
import type { Pool } from '../combat/pool';
import { SeededRandom } from '../core/random';
import {
  GOURAI_CONFIG as C,
  GOURAI_GUNS,
  GOURAI_PART_SPECS,
  GOURAI_PODS,
  GOURAI_PARTS,
  GOURAI_SHOTS,
  GOURAI_TARGET_SPHERES,
  GOURAI_TURRETS,
  type GouraiAction,
  type GouraiAttack,
} from '../data/gourai';
import type { Vec3 } from '../flight/math';
import { GouraiBody, type GouraiGround, type GouraiPatrol } from '../entities/gourai/gourai-body';
import { Barrage, type BarrageTarget, type ShotKind, type ShotOrder } from './raid-kit/barrage';
import { PartSet } from './raid-kit/parts';
import { ShotPool } from './raid-kit/shots';
import {
  aimSweep,
  aliveCount,
  attackTimes,
  chooseAttack,
  fireSweep,
  fireVolley,
} from './gourai-attacks';
import { actionLeftOf, resetGourai, stepGouraiPose, stepGouraiShots } from './gourai-step';

/** 狙う人（ソロは自機。id はプレイヤー ID、radius は当たりの球） */
export interface GouraiTarget {
  readonly position: Readonly<Vec3>;
  readonly active: boolean;
  readonly id?: number;
  readonly radius?: number;
  /** 10-4b: 速度（機銃の見越し。省略は見越さない） */
  readonly velocity?: Readonly<Vec3>;
}

/** 当たり（弾の種類・ダメージ・当たった人・10-4b: 回転掃射の弾か） */
export type GouraiHit = (kind: ShotKind, damage: number, who: GouraiTarget, sweep: boolean) => void;

const NO_HIT: GouraiHit = () => undefined;
const PART = (id: (typeof GOURAI_PARTS)[number]): number => GOURAI_PARTS.indexOf(id);
const CORE = PART('core');
const ARMOR = PART('armor');
const HULL = PART('hull');
/** 弾幕の狙う人の一覧（使い回す。状態の走査に入れないよう本体には持たない） */
const targetList: BarrageTarget[] = [];

export class GouraiKaiju {
  readonly body: GouraiBody;
  readonly parts = new PartSet(GOURAI_PART_SPECS, C.hp);
  readonly barrage = new Barrage(GOURAI_TURRETS);
  readonly shots = new ShotPool(GOURAI_SHOTS, C.shotCap);
  readonly random = new SeededRandom(1);
  action: GouraiAction = 'idle';
  attack: GouraiAttack | null = null;
  actionTime = 0;
  /** 次の大きな攻撃までの秒数（何もしない間に減る） */
  cooldown: number = C.dev.firstAttackDelay;
  lastAttack: GouraiAttack | null = null;
  repeat = 0;
  /** 1: 装甲あり / 2: 装甲を捨てた後半 */
  phase = 1;
  /** 熱（0〜100。100 で放熱） */
  heat = 0;
  /** 回転掃射の向き（度）と次の弾までの秒数 */
  sweepAngle = 0;
  sweepGap = 0;
  /** 10-4b: 回転掃射の面の傾き（度）と弾を揃える水平の距離（m。予兆の始めに狙う人へ） */
  sweepPitch = 0;
  sweepRange = 700;
  /** 数え: 大きな攻撃の回数・放熱の回数・撃った弾（機銃 / ミサイル）・当てた弾 */
  readonly attacksUsed = { volley: 0, sweep: 0 };
  vents = 0;
  readonly fired = { gun: 0, missile: 0 };
  readonly hits = { gun: 0, missile: 0 };
  /** フレアに乗り換えたミサイルの数と、弾ごとの数えた印（プールの番号。0 / 1） */
  decoyed = 0;
  readonly decoyedSeen: number[] = Array.from({ length: C.shotCap }, () => 0);
  elapsed = 0;
  /** 倒れない（確かめる場。体力は 1% で止まる） */
  immortal = false;
  /** 難易度の倍率（10-4b）: 攻撃の間隔・当たりのダメージ */
  intervalScale = 1;
  damageScale = 1;
  /** 10-4b: 高難度の弾幕の速さの倍率 */
  barrageScale = 1;
  /** 10-4b: 弾幕の弾を撃ったら呼ぶ（協力のホストが写しへ知らせる。関数は状態の走査に入らない） */
  onShot: ((o: ShotOrder) => void) | null = null;

  constructor(ground: GouraiGround) {
    this.body = new GouraiBody(ground);
  }

  /** 出す（巡回・始めの位置と向き・種・体力の割合・壊れた部位） */
  spawn(
    patrol: GouraiPatrol,
    x: number,
    z: number,
    heading: number,
    seed: number,
    hpRatio = 1,
    broken: readonly string[] = [],
  ): void {
    this.random.reseed(seed);
    this.body.spawn(patrol, x, z, heading);
    resetGourai(this, hpRatio, broken);
    // 始めから後半の条件なら、装甲を捨てた姿で始める（?grhp=30 など）
    if (this.lateCondition) {
      this.phase = 2;
      this.body.pose.purge = 1;
    }
  }

  /** 後半の条件（核が壊れた・体力が境目より下） */
  get lateCondition(): boolean {
    return this.parts.isBroken(CORE) || this.parts.ratio < C.phases.purgeAt;
  }

  /** 砲台が生きているか */
  turretAlive(i: number): boolean {
    const t = GOURAI_TURRETS[i];
    return t !== undefined && (t.part < 0 || !this.parts.isBroken(t.part));
  }

  /** 生きている砲台の数 */
  get turretsAlive(): number {
    let n = 0;
    for (let i = 0; i < GOURAI_TURRETS.length; i++) if (this.turretAlive(i)) n++;
    return n;
  }

  /** 核が見えている（当たる）: 放熱で装甲が開いている間か、後半（装甲が無い）。壊れたら見えない */
  get coreOpen(): boolean {
    return !this.parts.isBroken(CORE) && (this.phase === 2 || this.action === 'vent');
  }

  /** 熱の増え方の倍率（排気口を壊すと ×1.5 ずつ） */
  get heatMul(): number {
    return this.parts.mul('heat');
  }

  /**
   * 判定の球に当てる（attacker はプレイヤー ID。ソロは 0）。核は開いていなければ当たらない。前の装甲は、開いている間は核に、
   * 後半は胴に入る。この被弾で倒れたら true
   */
  damageSphere(sphere: number, amount: number, attacker = 0): boolean {
    const s = GOURAI_TARGET_SPHERES[sphere];
    if (!s) return false;
    let index = PART(s.part);
    if (index === CORE && !this.coreOpen) return false;
    if (index === ARMOR) {
      if (this.phase === 2) index = HULL;
      else if (this.coreOpen) index = CORE;
    }
    const hit = this.parts.damage(index, amount, attacker);
    if (!this.immortal) return hit.killed;
    const floor = this.parts.maxHp * 0.01;
    if (this.parts.hp < floor) this.parts.hp = floor;
    return false;
  }

  private readonly isBroken = (part: number): boolean => this.parts.isBroken(part);

  private readonly fireShot = (o: ShotOrder): void => {
    this.shots.fire(o);
    this.onShot?.(o);
    this.fired[o.weapon]++;
    const h = o.weapon === 'gun' ? C.heat.gunShot : C.heat.missileShot;
    this.addHeat(h);
  };

  private addHeat(amount: number): void {
    this.heat = Math.min(C.heat.max, this.heat + amount * this.heatMul);
  }

  /**
   * 1 ステップ。target は大きな攻撃を向ける人（ソロは自機）、crowd は弾幕が狙い・弾が当たる人の一覧（協力。省略は target だけ）。
   * flares はミサイルが乗り換えるフレア（無ければ null）
   */
  step(
    dt: number,
    target: GouraiTarget,
    flares: Pool<Flare> | null = null,
    onHit: GouraiHit = NO_HIT,
    crowd: readonly GouraiTarget[] = [target],
  ): void {
    if (!this.body.visible) return;
    this.elapsed += dt;
    // 後半へ: 装甲を捨てる（攻撃・放熱の途中なら取り消す）
    if (this.phase === 1 && this.lateCondition) {
      this.phase = 2;
      this.setAction('purge', null);
    }
    const late = this.phase === 2;
    const a = this.attack;
    const act = this.action;
    const holding = act === 'purge' || ((act === 'windup' || act === 'active') && a !== null);
    let speed: number = late ? C.phases.speed : C.patrol.speed;
    if (holding) speed = 0;
    else if (act === 'vent') speed *= 0.4;
    const face = target.active ? target.position : null;
    const turn = (late ? C.phases.turn : 1) * (act === 'active' && a === 'sweep' ? 0 : 1);
    this.body.step(dt, speed, turn, face);
    // 弾幕（いつも）: 放熱・装甲を捨てる間と回転掃射の間は止まる
    const barrageOn =
      act !== 'vent' &&
      act !== 'purge' &&
      !(a === 'sweep' && (act === 'windup' || act === 'active'));
    this.barrage.step(
      dt,
      this.body,
      this.isBroken,
      this.barrageTargets(crowd),
      this.random.next,
      this.fireShot,
      (late ? C.phases.barrageRate : 1) * this.barrageScale,
      barrageOn,
    );
    this.stepAction(dt, target);
    if (this.action !== 'vent') this.heat = Math.max(0, this.heat - C.heat.cool * dt);
    stepGouraiShots(this, dt, crowd, flares, onHit);
    stepGouraiPose(this, dt);
  }

  private barrageTargets(crowd: readonly GouraiTarget[]): readonly BarrageTarget[] {
    const out = targetList;
    out.length = 0;
    crowd.forEach((c, i) => {
      if (!c.active) return;
      out.push(
        c.velocity
          ? { id: c.id ?? i, position: c.position, velocity: c.velocity }
          : { id: c.id ?? i, position: c.position },
      );
    });
    return out;
  }

  private setAction(a: GouraiAction, attack: GouraiAttack | null): void {
    this.action = a;
    this.attack = attack;
    this.actionTime = 0;
  }

  private stepAction(dt: number, target: GouraiTarget): void {
    this.actionTime += dt;
    const t = this.actionTime;
    const a = this.attack;
    const p = target.active ? target.position : null;
    switch (this.action) {
      case 'idle': {
        // 熱が満ちたら放熱
        if (this.heat >= C.heat.max) {
          this.vents++;
          this.setAction('vent', null);
          return;
        }
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
        // 10-4b: 回転掃射は予兆の始めに、狙う人の高さへ面を傾けて決める（予兆の筒もその高さへ。見て高さを変えれば外れる）
        if (pick === 'sweep' && p) aimSweep(this, p);
        this.setAction('windup', pick);
        return;
      }
      case 'purge':
        if (t >= C.phases.purgeSeconds) {
          this.setAction('idle', null);
          this.cooldown = Math.min(this.cooldown, 3);
        }
        return;
      case 'vent': {
        const total = this.phase === 2 ? C.heat.ventSecondsLate : C.heat.ventSeconds;
        this.heat = Math.max(0, C.heat.max * (1 - t / total));
        if (t >= total) {
          this.heat = 0;
          this.setAction('idle', null);
          this.cooldown = Math.max(this.cooldown, 2);
        }
        return;
      }
      case 'windup':
        if (!a) return;
        // 予兆の間に砲台が壊れて撃てなくなったら取り消す
        if (!this.canUse(a)) {
          this.setAction('idle', null);
          this.cooldown = 2;
          return;
        }
        if (t >= attackTimes(a).windup) {
          this.setAction('active', a);
          if (a === 'volley' && p) {
            fireVolley(this, { id: target.id ?? 0, position: p }, this.fireShotNoHeat);
            this.addHeat(C.heat.volley);
          } else if (a === 'sweep') {
            this.addHeat(C.heat.sweep);
            this.sweepAngle = 0;
            this.sweepGap = 0;
          }
        }
        return;
      case 'active':
        if (!a) return;
        if (a === 'sweep') {
          const s = C.attacks.sweep;
          this.sweepAngle += s.spinDeg * dt;
          this.sweepGap -= dt;
          while (this.sweepGap <= 0) {
            this.sweepGap += s.gap;
            fireSweep(this, this.sweepAngle, this.random.next, this.fireShotNoHeat);
          }
        }
        if (t >= attackTimes(a).active) this.setAction('recover', a);
        return;
      case 'recover':
        if (!a) return;
        if (t >= attackTimes(a).recover) {
          const cd =
            C.attackInterval * (this.phase === 2 ? C.phases.interval : 1) * this.intervalScale;
          this.setAction('idle', null);
          this.cooldown = cd;
        }
        return;
    }
  }

  /** 大きな攻撃の弾（熱は攻撃ごとにまとめて足す） */
  private readonly fireShotNoHeat = (o: ShotOrder): void => {
    this.shots.fire(o);
    this.fired[o.weapon]++;
  };

  private canUse(a: GouraiAttack): boolean {
    return aliveCount(this, a === 'volley' ? GOURAI_PODS : GOURAI_GUNS) > 0;
  }

  /** 今の段の残り秒（値の表示） */
  get actionLeft(): number {
    return actionLeftOf(this);
  }
}
