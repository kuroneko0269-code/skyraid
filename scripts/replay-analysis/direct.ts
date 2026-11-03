// 9-1 操作の診断 → 9-2 で本番の操作にした「方向へ倒す」方式の模擬。人は向かいたい点（敵・リング・戦域の中央）が機首から見て
// どちらにあるかを見て、その方向へスティックを倒す（端まで倒すのは機首から DIRECT_STEER_CONFIG.fullDeg 度より外）。
// 向きの読み方は 2 通り（frame）。人の手の遅れ・ぶれ・デッドゾーン・カーブ・感度は今のスティックの
// 模擬（hands.ts）と同じものを通し、組み立ては本番と同じ DirectSteer（src/flight/direct-steer.ts。低空の安全も）
import type { AircraftControls, GroundHeightFn } from '../../src/entities/aircraft';
import { DIRECT_STEER_CONFIG } from '../../src/data/steer';
import { DirectSteer, type SteerCommand } from '../../src/flight/direct-steer';
import { inverseRotateVec3, type Vec3 } from '../../src/flight/math';
import { stickToward } from '../../tests/direct-steer-bots';
import type { FlightSession } from '../../src/missions/flight-session';
import type { Hands } from './hands';

/** スティックを端まで倒したときに向かわせる、機首からの角度（度） */
export const DIRECT_FULL_DEG = DIRECT_STEER_CONFIG.fullDeg;

export class DirectStick {
  private readonly local: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly steer = new DirectSteer();
  private readonly command: SteerCommand = { pitch: 0, roll: 0, yaw: 0 };
  private readonly intent: AircraftControls = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0,
    afterburner: false,
    throttleTarget: null,
  };
  private readonly finger: AircraftControls = { ...this.intent };
  /** 直前のスティックの値（右・上が正。集計用） */
  readonly stick = { x: 0, y: 0 };

  private readonly v = { x: 0, y: 0 };

  /**
   * frame: 人が向かう点の方向をどう読むか。horizon = 地平線を基準に「右へ何度・上へ何度」（この方式の説明どおり。初期値）/
   * screen = 画面（≒機体の向き。カメラは機体と一緒に傾く）の上の方向（傾いていると、画面の上 ≠ 世界の上）
   */
  constructor(
    private readonly hands: Hands,
    private readonly ground: GroundHeightFn,
    private readonly frame: 'horizon' | 'screen' = 'horizon',
  ) {}

  /** aim（ワールド。null は離す）の方向へ倒した操縦を out に書く（スロットル類は base から写す） */
  apply(
    session: FlightSession,
    aim: Readonly<Vec3> | null,
    base: Readonly<AircraftControls>,
    out: AircraftControls,
  ): void {
    const st = session.aircraft.state;
    const it = this.intent;
    it.pitch = 0;
    it.roll = 0;
    if (aim) {
      if (this.frame === 'horizon') {
        // 地平線を基準に見る: 方位のずれ（右が正）と、上下の角度のずれ（tests/direct-steer-bots.ts）
        stickToward(this.v, st, aim);
      } else {
        // 画面（≒機体の向き）の上の方向（後ろにいれば、近い側の端へ倒し切る）
        const l = this.local;
        l.x = aim.x - st.position.x;
        l.y = aim.y - st.position.y;
        l.z = aim.z - st.position.z;
        inverseRotateVec3(l, st.orientation, l);
        const full = (DIRECT_FULL_DEG * Math.PI) / 180;
        this.v.x = Math.atan2(l.x, -l.z) / full;
        this.v.y = Math.atan2(l.y, Math.hypot(l.x, -l.z)) / full;
        const len = Math.hypot(this.v.x, this.v.y);
        if (len > 1) {
          this.v.x /= len;
          this.v.y /= len;
        }
      }
      it.pitch = this.v.y;
      it.roll = this.v.x;
    }
    it.throttle = base.throttle;
    it.afterburner = base.afterburner;
    it.throttleTarget = base.throttleTarget;
    // 人の手（遅れ・ぶれ・デッドゾーン・カーブ・感度）を通した、スティックの値（右・上が正）
    this.hands.apply(it, this.finger);
    this.stick.x = this.finger.roll;
    this.stick.y = this.finger.pitch;
    const c = this.steer.apply(this.command, st, this.finger.roll, this.finger.pitch, this.ground);
    out.pitch = c.pitch;
    out.roll = c.roll;
    out.yaw = c.yaw;
    out.throttle = base.throttle;
    out.afterburner = base.afterburner;
    out.throttleTarget = base.throttleTarget;
  }
}
