// 10-2: 弾幕（レイドの怪獣の共通の部品。メカ怪獣の砲台を想定）。砲台ごとに体に付いた位置・撃てる向きの範囲（体の向きからの
// 方位と仰角）・間隔・連射の数と間・広がり・射程を持ち、射程と向きの範囲に狙う人がいれば撃つ。砲台の部位が壊れたら
// その砲台は止まる（壊すほど弾幕が薄くなる）。撃った弾は ShotPool（shots.ts）に入れる。決まった計算（乱数は種の列だけ）。
// Three.js・DOM 非依存
import { vec3, type Vec3 } from '../../flight/math';
import {
  bodyDirection,
  bodyPoint,
  distance,
  relativeAim,
  type BodyFrame,
  type BodyOffset,
} from './frame';

export type ShotKind = 'gun' | 'missile';

export interface TurretSpec {
  readonly offset: BodyOffset;
  /** この砲台の部位（PartSet の番号。壊れたら止まる。-1 は部位なし） */
  readonly part: number;
  readonly weapon: ShotKind;
  /** 撃てる向き: 体の向きからの方位の中心と半分の幅（度）、仰角の下限・上限（度） */
  readonly yawCenterDeg: number;
  readonly yawHalfDeg: number;
  readonly pitchMinDeg: number;
  readonly pitchMaxDeg: number;
  /** 連射の始まりの間隔（秒）・最初の遅れ（秒。砲台をずらす） */
  readonly interval: number;
  readonly firstDelay: number;
  /** 1 回の連射の数と、弾の間（秒） */
  readonly burst: number;
  readonly burstGap: number;
  /** 狙いの広がり（度。乱数で散らす）と射程（m） */
  readonly spreadDeg: number;
  readonly range: number;
  /**
   * 10-4b: 見越し（0〜1。狙う人の速度が分かれば、弾の速さ shotSpeed で会う点へ lead の割合だけ寄せて撃つ。省略は今の位置）。
   * まっすぐ飛ぶ人には当たり、曲がり続ける人には外れる
   */
  readonly lead?: number;
  readonly shotSpeed?: number;
}

/** 撃った 1 発（ShotPool.fire に渡す） */
export interface ShotOrder {
  readonly turret: number;
  readonly weapon: ShotKind;
  readonly origin: Readonly<Vec3>;
  readonly direction: Readonly<Vec3>;
  /** 狙った人（ミサイルの追う先。NO_TARGET は無し） */
  readonly targetId: number;
  /** 10-4c: この弾だけの寿命（秒。省略は種類の寿命。ゴウライの回転掃射は予兆の輪の端で消える） */
  readonly life?: number;
  /** 10-4c: bendAge 秒たったら上下の速さを bendVy m/s に変える（ゴウライの回転掃射: 機銃から段の高さへ寄せてから水平に） */
  readonly bendAge?: number;
  readonly bendVy?: number;
}

export interface BarrageTarget {
  readonly id: number;
  readonly position: Readonly<Vec3>;
  /** 10-4b: 速度（見越しに使う。省略は見越さない） */
  readonly velocity?: Readonly<Vec3>;
}

const origin = vec3();
const dir = vec3();
const aimPoint = vec3();

export class Barrage {
  /** 砲台ごとの次の連射までの秒数・連射の残りの数・次の弾までの秒数・今の狙う人 */
  readonly cooldown: number[];
  readonly burstLeft: number[];
  readonly gapLeft: number[];
  readonly aimAt: number[];
  /** 撃った数（砲台ごと） */
  readonly fired: number[];

  constructor(readonly turrets: readonly TurretSpec[]) {
    this.cooldown = turrets.map((t) => t.firstDelay);
    this.burstLeft = turrets.map(() => 0);
    this.gapLeft = turrets.map(() => 0);
    this.aimAt = turrets.map(() => -1);
    this.fired = turrets.map(() => 0);
  }

  /** 生きている砲台の数（壊れた部位の砲台を除く） */
  alive(broken: (part: number) => boolean): number {
    return this.turrets.filter((t) => t.part < 0 || !broken(t.part)).length;
  }

  /**
   * 1 ステップ。targets のうち、砲台の向きの範囲と射程に入っている一番近い人を狙う。rate は間隔の倍率（熱がこもる・後半で
   * 速くなるなど。1 より大きいと速い）。active が false の間は時計だけ止める
   */
  step(
    dt: number,
    body: BodyFrame,
    broken: (part: number) => boolean,
    targets: readonly BarrageTarget[],
    rnd: () => number,
    fire: (shot: ShotOrder) => void,
    rate = 1,
    active = true,
  ): void {
    if (!active) return;
    for (let i = 0; i < this.turrets.length; i++) {
      const t = this.turrets[i];
      if (!t || (t.part >= 0 && broken(t.part))) continue;
      bodyPoint(origin, body, t.offset);
      if ((this.burstLeft[i] ?? 0) > 0) {
        this.gapLeft[i] = (this.gapLeft[i] ?? 0) - dt;
        if ((this.gapLeft[i] ?? 0) <= 0) this.shoot(i, t, body, targets, rnd, fire);
        continue;
      }
      this.cooldown[i] = (this.cooldown[i] ?? 0) - dt * rate;
      if ((this.cooldown[i] ?? 0) > 0) continue;
      const pick = this.pick(t, body, targets);
      if (pick < 0) {
        // 狙える人がいない: 少し待って見直す
        this.cooldown[i] = Math.min(t.interval, 0.5);
        continue;
      }
      this.cooldown[i] = t.interval;
      this.burstLeft[i] = t.burst;
      this.aimAt[i] = pick;
      this.shoot(i, t, body, targets, rnd, fire);
    }
  }

  /** 向きの範囲と射程に入っている一番近い人の番号（targets の中。いなければ -1） */
  private pick(t: TurretSpec, body: BodyFrame, targets: readonly BarrageTarget[]): number {
    let best = -1;
    let bestD = t.range;
    targets.forEach((target, k) => {
      const d = distance(origin, target.position);
      if (d > bestD || !inArc(t, body, origin, target.position)) return;
      best = k;
      bestD = d;
    });
    return best;
  }

  private shoot(
    i: number,
    t: TurretSpec,
    body: BodyFrame,
    targets: readonly BarrageTarget[],
    rnd: () => number,
    fire: (shot: ShotOrder) => void,
  ): void {
    this.burstLeft[i] = (this.burstLeft[i] ?? 1) - 1;
    this.gapLeft[i] = t.burstGap;
    const target = targets[this.aimAt[i] ?? -1];
    // 連射の途中で狙う人が範囲から出たら、残りは撃たない
    if (!target || !inArc(t, body, origin, target.position)) {
      this.burstLeft[i] = 0;
      return;
    }
    const aim = relativeAim(body, origin, leadPoint(t, origin, target));
    const yaw = aim.yawDeg + (rnd() - 0.5) * 2 * t.spreadDeg;
    const pitch = aim.pitchDeg + (rnd() - 0.5) * 2 * t.spreadDeg;
    bodyDirection(dir, body, yaw, pitch);
    this.fired[i] = (this.fired[i] ?? 0) + 1;
    fire({ turret: i, weapon: t.weapon, origin, direction: dir, targetId: target.id });
  }
}

/** 10-4b: 見越した狙いの点（見越しが無ければ今の位置）。会う時刻は 2 回の近似 */
export function leadPoint(
  t: Pick<TurretSpec, 'lead' | 'shotSpeed'>,
  from: Readonly<Vec3>,
  target: BarrageTarget,
): Readonly<Vec3> {
  const v = target.velocity;
  const k = t.lead ?? 0;
  const sp = t.shotSpeed ?? 0;
  const p = target.position;
  if (!v || k <= 0 || sp <= 0) return p;
  let tt = Math.hypot(p.x - from.x, p.y - from.y, p.z - from.z) / sp;
  for (let i = 0; i < 2; i++) {
    aimPoint.x = p.x + v.x * tt;
    aimPoint.y = p.y + v.y * tt;
    aimPoint.z = p.z + v.z * tt;
    tt = Math.hypot(aimPoint.x - from.x, aimPoint.y - from.y, aimPoint.z - from.z) / sp;
  }
  aimPoint.x = p.x + v.x * tt * k;
  aimPoint.y = p.y + v.y * tt * k;
  aimPoint.z = p.z + v.z * tt * k;
  return aimPoint;
}

/** 点が砲台の向きの範囲にあるか */
export function inArc(
  t: Pick<TurretSpec, 'yawCenterDeg' | 'yawHalfDeg' | 'pitchMinDeg' | 'pitchMaxDeg'>,
  body: BodyFrame,
  from: Readonly<Vec3>,
  to: Readonly<Vec3>,
): boolean {
  const aim = relativeAim(body, from, to);
  let dy = aim.yawDeg - t.yawCenterDeg;
  if (dy > 180) dy -= 360;
  if (dy < -180) dy += 360;
  return (
    Math.abs(dy) <= t.yawHalfDeg && aim.pitchDeg >= t.pitchMinDeg && aim.pitchDeg <= t.pitchMaxDeg
  );
}
