// 練習場（9-5）の狙いの指標（Three.js 非依存）: 9-1 の解析（scripts/replay-analysis/metrics.ts）と同じ数え方で、
// 「照準の外で撃った割合」「敵が画面の外にいた時間」「行き過ぎて戻した回数」を判定の中で数える（リプレイでも同じ値になる）。
// - 照準の外: 撃っていたステップのうち、機首にいちばん近い対象の予測照準点（距離 / 弾の速さ 秒先。重力は無視）が
//   「的の半径 × 判定の拡大 / 距離」の角度に入っていなかった（射程外・対象なしも外）割合
// - 画面の外: 選んだ対象がいるステップのうち、追従カメラ ≒ 機首の向きで画面（縦の画角は速度の折れ線、横は縦横比）の外にいた割合
// - 行き過ぎ: 選んだ対象（射程内は予測照準点）が機首から 10° 内にあるとき、機首の左右・上下の反対側へ 1° 以上抜けた回数
import type { CombatSystem } from '../../combat/combat-system';
import { CAMERA_CONFIG } from '../../data/camera';
import { GUN_CONFIG } from '../../data/weapons';
import type { FlightState as AircraftState } from '../../flight/flight-model';
import { inverseRotateVec3, vec3, type Vec3 } from '../../flight/math';

const DEG = 180 / Math.PI;
const CROSS_NEAR_DEG = 10;
const CROSS_HYSTERESIS_DEG = 1;

/** 速度の折れ線の値（縦の画角） */
function curveAt(curve: readonly { speed: number; value: number }[], speed: number): number {
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
}

/** 数えた値（終わりに結果へ写す） */
export interface AimStatsTotals {
  /** 撃っていたステップ・そのうち照準の中 */
  readonly fireSteps: number;
  readonly fireInCone: number;
  /** 選んだ対象がいたステップ・そのうち画面の外 */
  readonly engagedSteps: number;
  readonly offScreenSteps: number;
  /** 行き過ぎて戻した回数 */
  readonly overshoots: number;
  /** 飛んでいたステップ（1 分あたりの行き過ぎに使う） */
  readonly aliveSteps: number;
}

export class AimStats implements AimStatsTotals {
  fireSteps = 0;
  fireInCone = 0;
  engagedSteps = 0;
  offScreenSteps = 0;
  overshoots = 0;
  aliveSteps = 0;
  private crossX = 0;
  private crossY = 0;
  private readonly local: Vec3 = vec3();
  private readonly point: Vec3 = vec3();

  /** aspect は画面の横 / 縦（記録のヘッダに入れる） */
  constructor(readonly aspect: number) {}

  /**
   * 固定ステップを進めた後に 1 回: firing はこのステップで引き金を引いていたか（自動射撃も含む）。
   * 自機が撃墜されている間は数えない
   */
  step(combat: CombatSystem, st: Readonly<AircraftState>, active: boolean, firing: boolean): void {
    // 9-1 の解析と同じく、撃墜中・対象なしでは行き過ぎの左右・上下の向きを捨てない
    if (!active) return;
    this.aliveSteps++;
    if (firing) {
      this.fireSteps++;
      if (this.nearestInCone(combat, st)) this.fireInCone++;
    }
    const sel = combat.targeting.selected;
    const target = sel && sel.active ? sel : null;
    if (!target) return;
    this.engagedSteps++;
    const aim = combat.leadValid ? combat.lead : target.position;
    const a = this.toLocal(st, aim.x, aim.y, aim.z);
    const ahead = -a.z;
    const angle = Math.atan2(Math.hypot(a.x, a.y), ahead) * DEG;
    if (angle < CROSS_NEAR_DEG && ahead > 0) {
      const ax = Math.atan2(a.x, ahead) * DEG;
      const ay = Math.atan2(a.y, ahead) * DEG;
      const sx = ax > CROSS_HYSTERESIS_DEG ? 1 : ax < -CROSS_HYSTERESIS_DEG ? -1 : 0;
      const sy = ay > CROSS_HYSTERESIS_DEG ? 1 : ay < -CROSS_HYSTERESIS_DEG ? -1 : 0;
      if (sx !== 0 && this.crossX !== 0 && sx !== this.crossX) this.overshoots++;
      if (sy !== 0 && this.crossY !== 0 && sy !== this.crossY) this.overshoots++;
      if (sx !== 0) this.crossX = sx;
      if (sy !== 0) this.crossY = sy;
    } else this.crossX = this.crossY = 0;
    const tp = target.position;
    const p = this.toLocal(st, tp.x, tp.y, tp.z);
    const vHalf = curveAt(CAMERA_CONFIG.chase.fovCurve, st.speed) / 2 / DEG;
    const hHalf = Math.atan(Math.tan(vHalf) * this.aspect);
    const onScreen =
      -p.z > 0 &&
      Math.abs(Math.atan2(p.x, -p.z)) < hHalf &&
      Math.abs(Math.atan2(p.y, -p.z)) < vHalf;
    if (!onScreen) this.offScreenSteps++;
  }

  /** 機首にいちばん近い対象の予測照準点が当たる範囲（射程内）にあるか */
  private nearestInCone(combat: CombatSystem, st: Readonly<AircraftState>): boolean {
    const speed = st.speed + GUN_CONFIG.muzzleSpeed;
    let bestAngle = Infinity;
    let bestDistance = Infinity;
    let bestCone = 0;
    for (const t of combat.allTargets) {
      if (!t.active) continue;
      const q = t.position;
      const d0 = Math.hypot(q.x - st.position.x, q.y - st.position.y, q.z - st.position.z);
      const k = d0 / speed;
      const a = this.toLocal(
        st,
        q.x + t.velocity.x * k,
        q.y + t.velocity.y * k,
        q.z + t.velocity.z * k,
      );
      const angle = Math.atan2(Math.hypot(a.x, a.y), -a.z) * DEG;
      if (angle >= bestAngle) continue;
      bestAngle = angle;
      bestDistance = d0;
      bestCone = Math.atan2(t.hitRadius * combat.gun.hitRadiusScale, Math.max(1, d0)) * DEG;
    }
    return bestDistance <= GUN_CONFIG.range && bestAngle <= bestCone;
  }

  /** 世界の点の機体ローカル（機首は -Z） */
  private toLocal(st: Readonly<AircraftState>, x: number, y: number, z: number): Vec3 {
    const l = this.point;
    l.x = x - st.position.x;
    l.y = y - st.position.y;
    l.z = z - st.position.z;
    return inverseRotateVec3(this.local, st.orientation, l);
  }
}
