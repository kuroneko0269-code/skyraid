// 機体ごとの飛行パラメータ。速度は m/s 相当、角速度は 度/秒
// docs/spec.md「4. 飛行モデル」に各数値の意味を書いている

/** 速度 → 旋回率の係数（折れ線）。speed は昇順 */
export interface TurnCurvePoint {
  readonly speed: number;
  readonly factor: number;
}

export interface AircraftSpec {
  readonly id: string;
  readonly name: string;
  readonly speed: {
    /** これを下回ると失速 */
    readonly stall: number;
    /** 起動時・リセット時の速度 */
    readonly cruise: number;
    /** スロットル 0 で落ち着く速度（失速より低いので、絞り続けると失速する） */
    readonly idle: number;
    /** スロットル 1（アフターバーナーなし）で落ち着く速度 */
    readonly military: number;
    /** アフターバーナー中に落ち着く速度（spec の最高速度） */
    readonly afterburner: number;
    /** 降下などで到達できる絶対上限 */
    readonly limit: number;
    /** 目標速度へ近づく速さ（1/秒）。大きいほどスロットルへの反応が速い */
    readonly response: number;
    /** アフターバーナー中の response */
    readonly afterburnerResponse: number;
    /** エンジンによる加速の上限（m/s²）。重力より小さいので垂直上昇は必ず減速する */
    readonly maxAccel: number;
    /** アフターバーナー中の maxAccel */
    readonly afterburnerMaxAccel: number;
    /** スロットルを絞ったときの減速の上限（m/s²） */
    readonly maxDecel: number;
  };
  readonly rates: {
    /** 係数 1.0 のときの最大ピッチ角速度 */
    readonly pitch: number;
    /** 係数 1.0 のときの最大ロール角速度 */
    readonly roll: number;
    /** 係数 1.0 のときの最大ヨー角速度 */
    readonly yaw: number;
    /** ロールが速度の影響を受ける割合（0 = 常に最大、1 = ピッチと同じだけ落ちる） */
    readonly rollSpeedSensitivity: number;
  };
  readonly turnCurve: readonly TurnCurvePoint[];
  readonly afterburner: {
    /** 満タンから空になるまでの秒数 */
    readonly durationSeconds: number;
    /** 空から満タンまで回復する秒数 */
    readonly rechargeSeconds: number;
    /** 離してから回復が始まるまでの秒数 */
    readonly rechargeDelaySeconds: number;
    /** 空になったあと、再点火できるゲージ量（0〜1） */
    readonly restartThreshold: number;
  };
}

/** 初期機（バランス型の練習機） */
export const STARTER_AIRCRAFT: AircraftSpec = {
  id: 'starter',
  name: 'SR-1 Swallow',
  speed: {
    stall: 80,
    cruise: 250,
    idle: 60,
    military: 330,
    afterburner: 400,
    limit: 460,
    response: 0.45,
    afterburnerResponse: 0.9,
    maxAccel: 15,
    afterburnerMaxAccel: 35,
    maxDecel: 20,
  },
  rates: {
    pitch: 75,
    roll: 200,
    yaw: 22,
    rollSpeedSensitivity: 0.5,
  },
  turnCurve: [
    { speed: 0, factor: 0.2 },
    { speed: 80, factor: 0.35 },
    { speed: 180, factor: 0.9 },
    { speed: 220, factor: 1.0 },
    { speed: 300, factor: 1.0 },
    { speed: 400, factor: 0.7 },
    { speed: 460, factor: 0.55 },
  ],
  afterburner: {
    durationSeconds: 6,
    rechargeSeconds: 10,
    rechargeDelaySeconds: 1,
    restartThreshold: 0.15,
  },
};
