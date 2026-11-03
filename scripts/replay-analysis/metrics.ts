// 9-1 操作の診断: 1 ステップごとの入力と状態から、操作の数値を集計する（Three.js・DOM 非依存）。
// リプレイの再生（analyze.ts）と、実験の飛行（experiments.ts）の両方から、判定を進める前（before）と後（after）に呼ぶ
import { applyAimAssist } from '../../src/combat/aim-assist';
import type { CombatInput } from '../../src/combat/combat-input';
import type { CombatTarget } from '../../src/combat/target';
import { CAMERA_CONFIG } from '../../src/data/camera';
import { AIM_ASSIST_CONFIG, type AimAssistSpec } from '../../src/data/assist';
import { GUN_CONFIG } from '../../src/data/weapons';
import type { AircraftControls } from '../../src/entities/aircraft';
import { inverseRotateVec3, type Vec3 } from '../../src/flight/math';
import type { GamePlay } from '../../src/missions/game-play';
import { Totals } from './totals';

const DEG = 180 / Math.PI;
/** スティックの倒し具合の区切り（中央付近 < low ≤ 中間 < edge ≤ 端） */
export const STICK_LOW = 0.3;
export const STICK_EDGE = 0.9;
/** 向きの反転を数える閾値（この大きさを超えて反対側へ倒したら 1 回） */
const REVERSAL_LEVEL = 0.25;
/** 反転から次の反転までがこれ未満なら「往復」（行き過ぎて戻す） */
const QUICK_REVERSAL_SECONDS = 1;
/** 照準の行き過ぎ: 機首から近い（この角度以内）ときに、対象が機首の反対側へ抜けた回数 */
const CROSS_NEAR_DEG = 10;
const CROSS_HYSTERESIS_DEG = 1;
/** 見失った（機首からこの角度を超えた）→ 捉え直した（この角度以内）の時間 */
const LOST_DEG = 30;
const REACQUIRE_DEG = 10;
/** 推移の 1 区切りの秒数 */
export const TIMELINE_SECONDS = 10;

export interface AnalyzerOptions {
  /** 画面の横 / 縦（iPhone の横画面 844×390 で約 2.16） */
  readonly aspect: number;
  /** 記録の値からエイムアシストの補正を見積もって引くときの数値（実験で差し替えたとき。省略は今の値） */
  readonly assist?: AimAssistSpec;
}

/** 1 ステップ分の操作（記録の値。エイムアシストを足した後） */
export interface StepInput {
  readonly controls: Readonly<AircraftControls>;
  readonly input: Readonly<CombatInput>;
  /** エイムアシスト（判定の拡大）が効いていたか（記録の flags の 4） */
  readonly assist: boolean;
  /**
   * スティックの値（右・上が正）。「方向へ倒す」方式（9-2）の模擬では、記録の値（組み立てた後の操縦）ではなくこちらで
   * 倒し具合・往復を数える（省略は記録の値から）
   */
  readonly stick?: { readonly x: number; readonly y: number } | null;
}

const curveAt = (curve: readonly { speed: number; value: number }[], speed: number): number => {
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (!first || !last) return 60;
  if (speed <= first.speed) return first.value;
  if (speed >= last.speed) return last.value;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (a && b && speed <= b.speed)
      return a.value + ((b.value - a.value) * (speed - a.speed)) / (b.speed - a.speed);
  }
  return last.value;
};

/** 軸の反転を数える（閾値をまたいで反対側へ倒したら 1 回） */
class ReversalCounter {
  private side = 0;
  private lastAt = -Infinity;

  constructor(
    private readonly onReversal: (quick: boolean) => void,
    private readonly level = REVERSAL_LEVEL,
  ) {}

  push(v: number, time: number): void {
    const s = v > this.level ? 1 : v < -this.level ? -1 : 0;
    if (s === 0 || s === this.side) return;
    if (this.side !== 0) {
      this.onReversal(time - this.lastAt < QUICK_REVERSAL_SECONDS);
      this.lastAt = time;
    }
    this.side = s;
  }
}

export class ControlAnalyzer {
  readonly totals = new Totals();
  private step = 0;
  private edgeRun = 0;
  private readonly local: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly tmp: AircraftControls = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0,
    afterburner: false,
    throttleTarget: null,
  };
  private readonly reversals: ReversalCounter[];
  private crossX = 0;
  private crossY = 0;
  private lostAt = -1;
  private wasFiring = false;
  private shots0: number;
  private hits0: number;
  private kills0: number;
  private downs0: number;
  private crashes0: number;
  private missilesBefore = 0;
  private launchLocked = false;
  private launchAngle = -1;
  private triggerNow = false;
  private missileNow = false;
  private lastSelected: CombatTarget | null = null;

  constructor(
    private readonly play: GamePlay,
    private readonly options: AnalyzerOptions,
  ) {
    const t = this.totals;
    const s = play.session;
    this.shots0 = s.combat.gun.shotCount;
    this.hits0 = s.combat.gun.hitCount;
    this.kills0 = s.combat.kills;
    this.downs0 = s.player.downCount;
    this.crashes0 = s.aircraft.crashCount;
    this.reversals = (['pitch', 'roll', 'yaw'] as const).map(
      (axis) =>
        new ReversalCounter((quick) => {
          t.reversals[axis]++;
          if (quick) t.quickReversals[axis]++;
        }),
    );
    s.combat.onExplosion((_x, _y, _z, onTarget) => {
      if (onTarget) t.missileDetonations++;
    });
  }

  private get time(): number {
    return this.step / 60;
  }

  /** 狙う対象（選択中。無ければ null） */
  private target(): CombatTarget | null {
    const sel = this.play.session.combat.targeting.selected;
    return sel && sel.active ? sel : null;
  }

  /** 対象（狙う点）の機体ローカル。機首は -Z */
  private toLocal(p: Readonly<Vec3>): Vec3 {
    const st = this.play.session.aircraft.state;
    const l = this.local;
    l.x = p.x - st.position.x;
    l.y = p.y - st.position.y;
    l.z = p.z - st.position.z;
    return inverseRotateVec3(l, st.orientation, l);
  }

  /** 判定を進める前: 入力（スティック・反転・射撃）とミサイルの発射の前の状態 */
  before(f: StepInput): void {
    const s = this.play.session;
    const t = this.totals;
    t.steps++;
    const sel = s.combat.targeting.selected;
    if (sel !== this.lastSelected && sel) t.targetSwitches++;
    this.lastSelected = sel;
    if (!s.player.active) return;
    t.aliveSteps++;
    const c = f.controls;
    // 記録の値はエイムアシストを足した後。同じ計算で補正の量を見積もって引く（ピッチ・ヨーだけ。ロールは足さない）
    let pitch = c.pitch;
    let yaw = c.yaw;
    const target = this.target();
    if (f.assist && target) {
      const combat = s.combat;
      const tmp = this.tmp;
      tmp.pitch = c.pitch;
      tmp.roll = c.roll;
      tmp.yaw = c.yaw;
      const aim = combat.leadValid ? combat.lead : target.position;
      const st = s.aircraft.state;
      const opts = s.aircraft.flight.options;
      if (
        applyAimAssist(tmp, st.position, st.orientation, aim, opts.invertPitch, this.options.assist)
      ) {
        pitch -= tmp.pitch - c.pitch;
        yaw -= tmp.yaw - c.yaw;
        t.assistSteps++;
      }
    }
    if (c.pitch !== Math.round(c.pitch) || c.roll !== Math.round(c.roll)) t.analogSteps++;
    let roll = c.roll;
    if (f.stick) {
      pitch = f.stick.y;
      roll = f.stick.x;
    }
    const mag = Math.min(1, Math.hypot(pitch, roll));
    if (mag < 0.02) t.stick.zero++;
    else if (mag < STICK_LOW) t.stick.low++;
    else if (mag < STICK_EDGE) t.stick.mid++;
    else t.stick.edge++;
    if (Math.abs(pitch) >= STICK_EDGE) t.pitchEdge++;
    if (Math.abs(roll) >= STICK_EDGE) t.rollEdge++;
    if (mag >= STICK_EDGE) this.edgeRun++;
    else this.endEdgeRun();
    this.reversals[0]?.push(pitch, this.time);
    this.reversals[1]?.push(roll, this.time);
    this.reversals[2]?.push(yaw, this.time);
    // 射撃（照準の判定は after で、判定後の向きで）
    this.triggerNow = f.input.trigger;
    if (f.input.trigger && !this.wasFiring) t.bursts++;
    this.wasFiring = f.input.trigger;
    this.missileNow = f.input.missile;
    this.missilesBefore = s.combat.missileAmmo.count;
    this.launchLocked = s.combat.targeting.locked;
    this.launchAngle = target ? this.angleOf(target.position) : -1;
  }

  private endEdgeRun(): void {
    const sec = this.edgeRun / 60;
    if (sec >= 1) this.totals.edgeHolds++;
    if (sec > this.totals.edgeLongest) this.totals.edgeLongest = sec;
    this.edgeRun = 0;
  }

  private angleOf(p: Readonly<Vec3>): number {
    const l = this.toLocal(p);
    return Math.atan2(Math.hypot(l.x, l.y), -l.z) * DEG;
  }

  /**
   * 機首にいちばん近い敵（選んでいなくても撃てる。予測照準点は「距離 / 弾の速さ」秒先の位置の近似で、重力は無視）。
   * 角度・距離・当たる範囲（度）を返す。出ている対象が無ければ null
   */
  private nearestToNose(): { angle: number; distance: number; hitCone: number } | null {
    const s = this.play.session;
    const st = s.aircraft.state;
    const speed = st.speed + GUN_CONFIG.muzzleSpeed;
    let best: { angle: number; distance: number; hitCone: number } | null = null;
    for (const t of s.combat.allTargets) {
      if (!t.active) continue;
      const p = t.position;
      const d0 = Math.hypot(p.x - st.position.x, p.y - st.position.y, p.z - st.position.z);
      const k = d0 / speed;
      const a = this.toLocal({
        x: p.x + t.velocity.x * k,
        y: p.y + t.velocity.y * k,
        z: p.z + t.velocity.z * k,
      });
      const angle = Math.atan2(Math.hypot(a.x, a.y), -a.z) * DEG;
      if (best && angle >= best.angle) continue;
      const hitCone = Math.atan2(t.hitRadius * s.combat.gun.hitRadiusScale, Math.max(1, d0)) * DEG;
      best = { angle, distance: d0, hitCone };
    }
    return best;
  }

  /** 判定を進めた後: 機首と対象の角度・画面の外・照準・ミサイル */
  after(): void {
    const s = this.play.session;
    const t = this.totals;
    const bucket = Math.floor(this.time / TIMELINE_SECONDS);
    this.step++;
    if (!s.player.active) {
      this.wasFiring = false;
      return;
    }
    if (this.play.runner?.boundary.outside) t.outsideSteps++;
    if (this.missileNow && s.combat.missileAmmo.count < this.missilesBefore) {
      t.missiles++;
      if (this.launchLocked) t.missilesLocked++;
      if (this.launchAngle >= 0) t.missileAngles.push(this.launchAngle);
    }
    if (this.triggerNow) this.classifyFire();
    const target = this.target();
    if (!target) {
      this.lostAt = -1;
      return;
    }
    t.engagedSteps++;
    const combat = s.combat;
    const aim = combat.leadValid ? combat.lead : target.position;
    const a = this.toLocal(aim);
    const ahead = -a.z;
    const angle = Math.atan2(Math.hypot(a.x, a.y), ahead) * DEG;
    t.addAngle(bucket, angle);
    // 照準の行き過ぎ: 機首の近くで、対象が機首の左右・上下の反対側へ抜けた
    if (angle < CROSS_NEAR_DEG && ahead > 0) {
      const ax = Math.atan2(a.x, ahead) * DEG;
      const ay = Math.atan2(a.y, ahead) * DEG;
      const sx = ax > CROSS_HYSTERESIS_DEG ? 1 : ax < -CROSS_HYSTERESIS_DEG ? -1 : 0;
      const sy = ay > CROSS_HYSTERESIS_DEG ? 1 : ay < -CROSS_HYSTERESIS_DEG ? -1 : 0;
      if (sx !== 0 && this.crossX !== 0 && sx !== this.crossX) t.crossings++;
      if (sy !== 0 && this.crossY !== 0 && sy !== this.crossY) t.crossings++;
      if (sx !== 0) this.crossX = sx;
      if (sy !== 0) this.crossY = sy;
      t.nearSteps++;
    } else {
      this.crossX = 0;
      this.crossY = 0;
    }
    // 見失ってから捉え直すまで
    if (angle > LOST_DEG && this.lostAt < 0) this.lostAt = this.time;
    else if (angle <= REACQUIRE_DEG && this.lostAt >= 0) {
      t.reacquire.push(this.time - this.lostAt);
      this.lostAt = -1;
    }
    // 画面の外（追従カメラ ≒ 機首の向き。縦の画角は速度の折れ線、横は縦横比から）
    const p = this.toLocal(target.position);
    const vHalf = curveAt(CAMERA_CONFIG.chase.fovCurve, s.aircraft.state.speed) / 2 / DEG;
    const hHalf = Math.atan(Math.tan(vHalf) * this.options.aspect);
    const onScreen =
      -p.z > 0 &&
      Math.abs(Math.atan2(p.x, -p.z)) < hHalf &&
      Math.abs(Math.atan2(p.y, -p.z)) < vHalf;
    if (!onScreen) t.offScreenSteps++;
    t.addBucket(bucket, onScreen, this.triggerNow);
  }

  /**
   * 射撃中の照準: 機首にいちばん近い敵の予測照準点が「当たる範囲」（的の半径 × 判定の拡大 / 距離）に入っていたか。
   * 選択中の対象とは別に数える（選んでいない敵を撃つこともある）
   */
  private classifyFire(): void {
    const f = this.totals.fire;
    const n = this.nearestToNose();
    if (!n) f.noTarget++;
    else if (n.distance > GUN_CONFIG.range) f.outOfRange++;
    else if (n.angle <= n.hitCone) f.inHitCone++;
    else if (n.angle <= 2) f.within2++;
    else if (n.angle <= AIM_ASSIST_CONFIG.coneDeg) f.withinAssist++;
    else f.wide++;
  }

  /** 終わり: 弾数・撃墜・被撃墜・結果 */
  finish(): Totals {
    this.endEdgeRun();
    const s = this.play.session;
    const t = this.totals;
    t.shots = s.combat.gun.shotCount - this.shots0;
    t.hits = s.combat.gun.hitCount - this.hits0;
    t.kills = s.combat.kills - this.kills0;
    t.downs = s.player.downCount - this.downs0;
    t.crashes = s.aircraft.crashCount - this.crashes0;
    t.files = 1;
    const status = this.play.runner?.status;
    if (status === 'success') t.successes = 1;
    const reason = this.play.runner?.failReason;
    t.missionStatus = (status ?? 'free') + (reason ? `（${reason}）` : '');
    return t;
  }
}
