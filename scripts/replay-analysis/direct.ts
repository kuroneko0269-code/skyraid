// 9-1 操作の診断: 9-2 の「スティックの方式」の案の模擬。画面の上で行きたい方向（敵の見えている方向）へスティックを倒すと、
// ロール・引き・ヨーはゲームが組み立てる（AI の操縦 steerToward と同じ計算）。人は敵の画面上の方向を見て倒すだけ。
// 人の手の遅れ・ぶれ・デッドゾーン・カーブは今のスティックの模擬（hands.ts）と同じものを通す
import { steerToward } from '../../src/ai/steering';
import type { AircraftControls } from '../../src/entities/aircraft';
import { inverseRotateVec3, rotateVec3, type Vec3 } from '../../src/flight/math';
import type { FlightSession } from '../../src/missions/flight-session';
import type { Hands } from './hands';

/** スティックを端まで倒したときに向かわせる、機首からの角度（度） */
export const DIRECT_FULL_DEG = 30;
const TAN_FULL = Math.tan((DIRECT_FULL_DEG * Math.PI) / 180);

export class DirectStick {
  private readonly local: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly dir: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly intent: AircraftControls = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0,
    afterburner: false,
    throttleTarget: null,
  };
  private readonly finger: AircraftControls = { ...this.intent };

  constructor(private readonly hands: Hands) {}

  /** aim（ワールド）の方向へ機首を向ける操縦を out に書く（スロットル類は base から写す） */
  apply(
    session: FlightSession,
    aim: Readonly<Vec3>,
    base: Readonly<AircraftControls>,
    out: AircraftControls,
  ): void {
    const st = session.aircraft.state;
    const l = this.local;
    l.x = aim.x - st.position.x;
    l.y = aim.y - st.position.y;
    l.z = aim.z - st.position.z;
    inverseRotateVec3(l, st.orientation, l);
    // 画面の上の方向（後ろにいれば、近い側の端へ倒し切る）
    const ax = Math.atan2(l.x, -l.z);
    const ay = Math.atan2(l.y, Math.hypot(l.x, -l.z));
    const full = (DIRECT_FULL_DEG * Math.PI) / 180;
    let vx = ax / full;
    let vy = ay / full;
    const len = Math.hypot(vx, vy);
    if (len > 1) {
      vx /= len;
      vy /= len;
    }
    const it = this.intent;
    it.pitch = vy;
    it.roll = vx;
    it.throttle = base.throttle;
    it.afterburner = base.afterburner;
    it.throttleTarget = base.throttleTarget;
    // 人の手（遅れ・ぶれ・デッドゾーン・カーブ）を通した、スティックの値
    this.hands.apply(it, this.finger);
    const d = this.dir;
    d.x = this.finger.roll * TAN_FULL;
    d.y = this.finger.pitch * TAN_FULL;
    d.z = -1;
    rotateVec3(d, st.orientation, d);
    steerToward(out, st.orientation, st.angularRate, d, 1);
    out.throttle = base.throttle;
    out.afterburner = base.afterburner;
    out.throttleTarget = base.throttleTarget;
  }
}
