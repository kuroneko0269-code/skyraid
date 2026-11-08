// 10-5a: UFO ゼノリスの本体（状態の根。Three.js 非依存）: 体（狙う人の周りを回る円盤）・部位（10-2 の PartSet）・バリア（Barrier）・
// 瞬間移動（Warp）・光線（Beam のなぎ払いと溜め撃ち）・段階（1 / 2: 瞬間移動が多く速い / 3: 溜め撃ちの後に続けてなぎ払う）。
// 乱数は種の列（SeededRandom）だけ、時刻は dt の足し算だけ、状態は数・文字列・配列・数のオブジェクトのプロパティだけ
// （リプレイのキーフレームと状態のハッシュにそのまま入る）。攻撃の選び方と始め方は xenolith-attacks.ts
import { SeededRandom } from '../core/random';
import {
  XENOLITH_CHARGED,
  XENOLITH_CONFIG as C,
  XENOLITH_EMITTERS,
  XENOLITH_GENS,
  XENOLITH_PARTS,
  XENOLITH_PART_SPECS,
  XENOLITH_SWEEP,
  XENOLITH_TARGET_SPHERES,
  type XenolithAttack,
  type XenolithPart,
} from '../data/xenolith';
import { vec3, type Vec3 } from '../flight/math';
import { XenolithBody, type XenolithGround } from '../entities/xenolith/xenolith-body';
import { Beam } from './raid-kit/beam';
import { PartSet } from './raid-kit/parts';
import { Barrier, Warp, type WarpSpec } from './raid-kit/shield';
import { beamMouth, beginWarp, chooseAttack, startAttack } from './xenolith-attacks';
import { resetXenolith } from './xenolith-reset';

/** 狙う人（ソロは自機。id はプレイヤー ID、radius は当たりの球） */
export interface XenolithTarget {
  readonly position: Readonly<Vec3>;
  readonly active: boolean;
  readonly id?: number;
  readonly radius?: number;
}

/** 光線の当たり（攻撃・ダメージ・当たった人） */
export type XenolithHit = (attack: XenolithAttack, damage: number, who: XenolithTarget) => void;

const NO_HIT: XenolithHit = () => undefined;
const PART = (id: XenolithPart): number => XENOLITH_PARTS.indexOf(id);
const HULL = PART('hull');
const DOME = PART('dome');
const EMITTERS = XENOLITH_EMITTERS.map(PART);
const GENS = XENOLITH_GENS.map(PART);
const DEFAULT_RADIUS = 8;
const mouth = vec3();

/** 判定の球 i の世界の位置（縁の発光体は輪の回った角度で回す） */
export function xenolithSpherePoint(out: Vec3, body: XenolithBody, i: number): Vec3 {
  const s = XENOLITH_TARGET_SPHERES[i];
  if (!s) return body.point(out, { forward: 0, right: 0, up: 0 });
  if (!s.ring) return body.point(out, s);
  const a = ((s.ring.deg + body.ringDeg) * Math.PI) / 180;
  return body.point(out, {
    forward: Math.cos(a) * s.ring.r,
    right: Math.sin(a) * s.ring.r,
    up: s.up,
  });
}

export class XenolithKaiju {
  readonly body: XenolithBody;
  readonly parts = new PartSet(XENOLITH_PART_SPECS, C.hp);
  /** バリア・瞬間移動の数値（壊れた部位で変える。部品が読む） */
  readonly barrierSpec: { flicker: number; down: number } = {
    flicker: C.barrier.flicker,
    down: C.barrier.down,
  };
  readonly warpSpec: { -readonly [K in keyof WarpSpec]: number } = {
    telegraph: C.warp.telegraph,
    cooldown: C.warp.cooldown,
    ringMin: C.warp.ringMin,
    ringMax: C.warp.ringMax,
    altitudeMin: C.warp.altMin,
    altitudeMax: C.warp.altMax,
    keepAway: C.warp.keepAway,
  };
  readonly barrier = new Barrier(this.barrierSpec);
  readonly warp = new Warp(this.warpSpec);
  readonly beam = new Beam(XENOLITH_SWEEP, XENOLITH_CHARGED);
  readonly random = new SeededRandom(1);
  /** 今の光線（なぎ払い / 溜め撃ち。段は beam.phase） */
  attack: XenolithAttack | null = null;
  /** 次の光線までの秒数（光線をしていない間に減る） */
  cooldown: number = C.firstAttack;
  lastAttack: XenolithAttack | null = null;
  repeat = 0;
  /** 次の瞬間移動までの秒数 */
  warpTimer: number = C.warp.first;
  /** 1 / 2（体力 60% 未満）/ 3（30% 未満） */
  stage = 1;
  /** この溜め撃ちの後に続けてなぎ払う（段階 3） */
  comboArmed = false;
  /** 数え: 光線の回数・当てた回数・続けて撃った回数・バリアが止めた当たり */
  readonly attacksUsed = { sweep: 0, charged: 0 };
  readonly beamHits = { sweep: 0, charged: 0 };
  combos = 0;
  absorbed = 0;
  /** バリアの波紋（最後に止めた判定の球と、経過秒。見た目） */
  rippleSphere = -1;
  rippleAge = 99;
  elapsed = 0;
  /** 倒れない（確かめる場。体力は 1% で止まる） */
  immortal = false;
  /** 難易度の倍率（10-5b）: 光線の間隔・当たりのダメージ */
  intervalScale = 1;
  damageScale = 1;

  constructor(ground: XenolithGround) {
    this.body = new XenolithBody(ground);
  }

  /** 出す（位置・向き・種・体力の割合・壊れた部位） */
  spawn(
    x: number,
    y: number,
    z: number,
    heading: number,
    seed: number,
    hpRatio = 1,
    broken: readonly string[] = [],
  ): void {
    this.random.reseed(seed);
    resetXenolith(this, x, y, z, heading, hpRatio, broken);
    this.updateStage();
  }

  /** 壊れた縁の発光体の数（4 で瞬間移動しない） */
  get brokenEmitters(): number {
    return EMITTERS.filter((i) => this.parts.isBroken(i)).length;
  }

  get brokenGens(): number {
    return GENS.filter((i) => this.parts.isBroken(i)).length;
  }

  get warpEnabled(): boolean {
    return this.brokenEmitters < EMITTERS.length;
  }

  /** 瞬間移動の間隔（秒） */
  get warpInterval(): number {
    return (
      (C.warp.interval + C.warp.perEmitter * this.brokenEmitters) *
      (this.stage >= 2 ? C.stages.warpMul2 : 1)
    );
  }

  /** 判定の球の部位が殻の外か（下の発生器だけ。バリアを張っていても当たる） */
  outsideBarrier(sphere: number): boolean {
    const s = XENOLITH_TARGET_SPHERES[sphere];
    return s !== undefined && GENS.includes(PART(s.part));
  }

  /**
   * 判定の球に当てる（attacker はプレイヤー ID。ソロは 0）。バリアを張っている間は殻の中の部位に効かない（波紋）。
   * 壊れたドームは胴に入る。この被弾で倒れたら true
   */
  damageSphere(sphere: number, amount: number, attacker = 0): boolean {
    const s = XENOLITH_TARGET_SPHERES[sphere];
    if (!s || this.parts.dead) return false;
    if (this.barrier.absorbs && !this.outsideBarrier(sphere)) {
      this.absorbed++;
      this.rippleSphere = sphere;
      this.rippleAge = 0;
      return false;
    }
    let index = PART(s.part);
    if (index === DOME && this.parts.isBroken(DOME)) index = HULL;
    const hit = this.parts.damage(index, amount, attacker);
    this.updateStage();
    if (!this.immortal) return hit.killed;
    const floor = this.parts.maxHp * 0.01;
    if (this.parts.hp < floor) this.parts.hp = floor;
    return false;
  }

  /** 段階（体力の割合から。戻らない） */
  updateStage(): void {
    const r = this.parts.ratio;
    const want = r < C.stages.stage3 ? 3 : r < C.stages.stage2 ? 2 : 1;
    if (want > this.stage) this.stage = want;
    this.body.speedMul = this.stage >= 2 ? C.stages.speedMul2 : 1;
  }

  /** 光線の段（予兆・溜め・撃つ）で体が止まるか */
  get holding(): boolean {
    const ph = this.beam.phase;
    return ph === 'warn' || ph === 'charge' || ph === 'fire';
  }

  /**
   * 1 ステップ。target は光線・瞬間移動を向ける人（ソロは自機）、crowd は光線が当たる人の一覧（協力。省略は target だけ）
   */
  step(
    dt: number,
    target: XenolithTarget,
    onHit: XenolithHit = NO_HIT,
    crowd: readonly XenolithTarget[] = [target],
  ): void {
    const b = this.body;
    if (!b.visible) return;
    this.elapsed += dt;
    this.rippleAge += dt;
    this.updateStage();
    this.barrierSpec.down = C.barrier.down * this.parts.mul('barrierDown');
    this.warpSpec.telegraph = C.warp.telegraph * this.parts.mul('warpTelegraph');
    const focus = target.active
      ? target.position
      : { x: b.arenaX, y: b.floorAt(b.arenaX, b.arenaZ) + 600, z: b.arenaZ };
    const beam = this.beam;
    // 体の向き: ふだんと溜め撃ちのロック警告・硬直の間は狙う人へ。なぎ払いの予兆と撃つ間・溜めと撃つ間は止める
    const turn =
      !beam.busy || beam.phase === 'recover' || (beam.kind === 'charged' && beam.phase === 'warn');
    b.step(dt, focus, this.holding, turn, this.random.next);
    this.stepWarp(dt, target, focus);
    const wasBusy = beam.busy;
    // 光線を始める（瞬間移動の予兆の間と、移った直後は始めない）
    if (!beam.busy && this.warp.phase !== 'telegraph') {
      this.cooldown -= dt;
      if (this.cooldown <= 0 && target.active) {
        const pick = chooseAttack(this, target.position, this.random.next);
        if (pick) {
          this.repeat = pick === this.lastAttack ? this.repeat + 1 : 1;
          this.lastAttack = pick;
          startAttack(this, pick, target, this.random.next);
        } else this.cooldown = 1;
      }
    }
    beamMouth(mouth, this);
    beam.step(dt, b, mouth, target.active ? target.position : null);
    // 段階 3: 溜め撃ちを撃ち終えたら、すぐになぎ払う（バリアは外れたまま）
    if (
      beam.kind === 'charged' &&
      beam.phase === 'recover' &&
      this.comboArmed &&
      target.active &&
      !this.parts.disabled('combo')
    ) {
      this.comboArmed = false;
      beam.cancel();
      this.combos++;
      startAttack(this, 'sweep', target, this.random.next);
      beamMouth(mouth, this);
      beam.step(0, b, mouth, target.position);
    }
    // （段の番号で見る: 上の分岐で busy が絞り込まれないように）
    if (wasBusy && beam.phaseIndex === 0) {
      this.attack = null;
      this.comboArmed = false;
      this.cooldown =
        C.attackInterval * (this.stage >= 3 ? C.stages.intervalMul3 : 1) * this.intervalScale;
    }
    this.stepBarrier(dt);
    // 光線の当たり（撃つ間だけ。1 回の撃ちで 1 人に 1 回）
    if (beam.phase === 'fire' && this.attack) {
      const attack = this.attack;
      const spec = beam.spec;
      crowd.forEach((c, i) => {
        if (!c.active) return;
        if (!beam.hits(c.id ?? i, c.position, c.radius ?? DEFAULT_RADIUS)) return;
        this.beamHits[attack]++;
        onHit(attack, spec.damage * this.damageScale, c);
      });
    }
  }

  /** バリア: 光線を撃つ flicker 秒前に揺らぎ始め、撃つ間と硬直の間は外れたまま、その後 down 秒で張り直す */
  private stepBarrier(dt: number): void {
    const beam = this.beam;
    const bar = this.barrier;
    if (
      (beam.phase === 'warn' || beam.phase === 'charge') &&
      beam.untilFire <= this.barrierSpec.flicker + dt
    )
      bar.drop();
    if (bar.phase === 'down' && beam.busy && beam.phase !== 'warn') bar.time = 0;
    bar.step(dt);
  }

  /** 瞬間移動: 間隔が来たら（光線の間でなければ）移る先を決めて光らせ、予兆の後に移る */
  private stepWarp(dt: number, target: XenolithTarget, focus: Readonly<Vec3>): void {
    const w = this.warp;
    if (w.phase === 'idle') {
      if (!this.warpEnabled || this.beam.busy) return;
      this.warpTimer -= dt;
      if (this.warpTimer > 0 || !target.active) return;
      beginWarp(this, focus, this.random.next);
      this.warpTimer = this.warpInterval;
      return;
    }
    if (!w.step(dt)) return;
    this.body.teleport(w.destination, target.active ? target.position : null);
    this.cooldown = Math.max(this.cooldown, C.warp.afterWarp);
    // 発生器を 3 つ壊すと、瞬間移動の後にもバリアが外れる
    if (this.brokenGens >= GENS.length) this.barrier.drop();
  }

  /** 次の瞬間移動までの秒数（予兆の間は移るまで。使わないときは Infinity） */
  get untilWarp(): number {
    const w = this.warp;
    if (w.phase === 'telegraph') return Math.max(0, w.spec.telegraph - w.time);
    if (!this.warpEnabled) return Infinity;
    return Math.max(0, this.warpTimer) + w.spec.telegraph;
  }
}
