// 三人称カメラのパラメータ（1-2）。距離・高さは m、角度は 度、速さは 1/秒
// docs/spec.md「カメラ」に各数値の意味を書いている

/** 速度（m/s）→ 値 の折れ線の点。範囲外は端の値 */
export interface CameraCurvePoint {
  readonly speed: number;
  readonly value: number;
}

export interface CameraConfig {
  readonly chase: {
    readonly distanceCurve: readonly CameraCurvePoint[];
    readonly height: number;
    readonly lookAhead: number;
    readonly fovCurve: readonly CameraCurvePoint[];
    readonly afterburnerFovBoost: number;
    readonly afterburnerDistanceBoost: number;
    readonly afterburnerResponse: number;
    readonly positionStiffness: number;
    readonly lookStiffness: number;
    readonly upStiffness: number;
    readonly turnLeadGain: number;
    readonly turnLeadMax: number;
  };
  readonly fixed: {
    readonly distance: number;
    readonly height: number;
    readonly lookAhead: number;
  };
  readonly minHeightAboveGround: number;
  readonly shake: {
    readonly stallAmplitude: number;
    readonly impactAmplitude: number;
    readonly impactDecay: number;
    readonly frequency: number;
  };
  readonly maxDt: number;
}

export const CAMERA_CONFIG: CameraConfig = {
  chase: {
    /** 機体の後方への距離。巡航 250 で 1-1 と同じ 24m、低速で寄り、高速で離れる */
    distanceCurve: [
      { speed: 80, value: 22 },
      { speed: 250, value: 24 },
      { speed: 400, value: 28 },
      { speed: 460, value: 29 },
    ],
    /** 機体の上方向へのオフセット（機体基準） */
    height: 6,
    /** 注視点（機体の前方 m） */
    lookAhead: 30,
    /** 垂直画角。巡航で 1-1 と同じ 60° */
    fovCurve: [
      { speed: 80, value: 57 },
      { speed: 250, value: 60 },
      { speed: 400, value: 70 },
      { speed: 460, value: 73 },
    ],
    /** アフターバーナー点火中に上乗せする画角と距離（速度が上がる前に効かせる） */
    afterburnerFovBoost: 5,
    afterburnerDistanceBoost: 2,
    /** アフターバーナーの上乗せが立ち上がる・戻る速さ */
    afterburnerResponse: 4,
    /**
     * スプリングの固有角振動数（1/秒）。臨界減衰なので行き過ぎない。
     * 定常的な追従遅れはおよそ 2 / 値 秒（位置 8 → 約 0.25 秒）
     */
    positionStiffness: 8,
    lookStiffness: 14,
    /** 上方向（ロール）の追従。位置より柔らかくして、機体より少し遅れて傾く */
    upStiffness: 5,
    /** 旋回中に注視点を曲がる側へずらす量（m / (rad/s)）と上限（m） */
    turnLeadGain: 6,
    turnLeadMax: 8,
  },
  /** 固定後方カメラ。スプリングなしで機体に完全追従。画角は速度の折れ線のみ使う */
  fixed: {
    distance: 24,
    height: 6,
    lookAhead: 30,
  },
  /** 地面（または将来の地形）からカメラが保つ最低高さ */
  minHeightAboveGround: 3,
  shake: {
    /** 失速最大時の揺れ幅（m）。0 で無効 */
    stallAmplitude: 0.25,
    /** 地面衝突時の揺れ幅（m）。0 で無効 */
    impactAmplitude: 1.2,
    /** 衝突の揺れが減衰する速さ（1/秒）。1 秒で約 5% */
    impactDecay: 3,
    /** 揺れの基本周波数（Hz） */
    frequency: 9,
  },
  /** 1 フレームの dt の上限（秒）。タブ復帰時に揺れの位相などが飛ばないように */
  maxDt: 0.1,
};
