// 9-1 操作の診断の部品（metrics.ts が 300 行を超えたので分けた。9-5b）: 速度の折れ線の値と、軸の反転の数え方
import { autoFireReady } from '../../src/combat/auto-fire';
import { LOCAL_FORWARD, type FlightState } from '../../src/flight/flight-model';
import { rotateVec3, vec3 } from '../../src/flight/math';
import type { FlightSession } from '../../src/missions/flight-session';
import type { Totals } from './totals';

const DEG = 180 / Math.PI;
/** 9-5b: 真上・真下の近くで「速い横回転」とみなす機体の軸まわりの速さ（度/秒） */
const VERTICAL_ROLL_FAST = 120;
const fwd = vec3();

/**
 * 9-5b: v1.0.6 より前の記録（自動射撃とボタンの区別なし）で、撃っていたのが GUN ボタンと決まるか: 自動射撃は条件（当たる範囲・
 * 射程内）を満たすときしか撃たないので、満たさずに撃っていたのはボタン
 */
export function surelyButton(s: FlightSession): boolean {
  const c = s.combat;
  const st = s.aircraft.state;
  return !autoFireReady(
    c.targeting.selected,
    c.lead,
    c.leadValid,
    st.position,
    st.orientation,
    c.gun.hitRadiusScale,
  );
}

/** 9-5b: 機首が ±70° より先のときの、機体の軸まわりの横回転の速さを数える */
export function countVerticalRoll(t: Totals, st: Readonly<FlightState>): void {
  if (Math.abs(rotateVec3(fwd, st.orientation, LOCAL_FORWARD).y) < Math.sin(70 / DEG)) return;
  const rate = Math.abs(st.angularRate.z) * DEG;
  t.verticalSteps++;
  if (rate > VERTICAL_ROLL_FAST) t.verticalFastRoll++;
  if (rate > t.verticalRollMax) t.verticalRollMax = rate;
}

/** 向きの反転を数える閾値（この大きさを超えて反対側へ倒したら 1 回） */
const REVERSAL_LEVEL = 0.25;
/** 反転から次の反転までがこれ未満なら「往復」（行き過ぎて戻す） */
const QUICK_REVERSAL_SECONDS = 1;

export const curveAt = (
  curve: readonly { speed: number; value: number }[],
  speed: number,
): number => {
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
export class ReversalCounter {
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
