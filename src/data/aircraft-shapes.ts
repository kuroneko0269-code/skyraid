// 機体モデル（4-3）の形のパラメータ。生成は src/render/aircraft-model/。長さは m、角度は度。
// 前方は -Z・上 +Y・右 +X。原点は機体の位置（当たり判定の球の中心）。docs/spec.md「10. ビジュアル」の「機体モデル」

/** 尾翼の形。single = 中央に垂直尾翼 1 枚、twin = 左右に外へ傾けた 2 枚 */
export type TailKind = 'single' | 'twin';

/** 台形の翼（主翼・水平尾翼・垂直尾翼）。span は主翼・水平尾翼は左右合わせた幅、垂直尾翼は高さ */
export interface WingShape {
  readonly span: number;
  readonly rootChord: number;
  readonly tipChord: number;
  /** 前縁の後退角 */
  readonly sweepDeg: number;
  /** 翼の厚み（翼弦に対する最大の厚さの比） */
  readonly thickness: number;
  /** 付け根の前縁の位置（機首からの全長に対する割合） */
  readonly position: number;
  /** 付け根の高さ（胴体の中心線から。胴体の高さの半分に対する割合。+1 で胴体の上面） */
  readonly height: number;
  /** 上反角（垂直尾翼は外への傾き） */
  readonly dihedralDeg: number;
}

export interface AircraftShape {
  /** 全長（機首の先端からノズルの後端） */
  readonly length: number;
  /** 胴体の最大の幅・高さ（エアインテークを除く） */
  readonly fuselageWidth: number;
  readonly fuselageHeight: number;
  /** 機首（尖った部分）の長さの割合 */
  readonly noseFraction: number;
  /** 原点の位置（機首からの全長に対する割合） */
  readonly originFraction: number;
  /** コックピット（キャノピーの中心）の位置の割合。キャノピーの長さ・幅・高さ（m） */
  readonly cockpit: {
    readonly position: number;
    readonly length: number;
    readonly width: number;
    readonly height: number;
  };
  readonly wing: WingShape;
  readonly stabilizer: WingShape;
  readonly fin: WingShape;
  readonly tail: TailKind;
  /** エンジン。1・2 は胴体の後端のノズル、4 は主翼の下のナセル（輸送機） */
  readonly engines: 1 | 2 | 4;
  /** ノズルの外の半径 */
  readonly nozzleRadius: number;
  /** 胴体の横のエアインテーク（左右）があるか */
  readonly intakes: boolean;
  /** 後部胴体の跳ね上げ（m。輸送機の貨物扉の上がり） */
  readonly tailUpsweep: number;
  /** 機体の色・アクセント（垂直尾翼の後ろ半分と上端・主翼の翼端）の色 */
  readonly bodyColor: number;
  readonly accentColor: number;
}

const fighterStab = (span: number, root: number, tip: number, sweep: number): WingShape => ({
  span,
  rootChord: root,
  tipChord: tip,
  sweepDeg: sweep,
  thickness: 0.05,
  position: 0.79,
  height: 0,
  dihedralDeg: -3,
});

/**
 * Kestrel（バランス型）: 単発・単垂直尾翼・中翼の中くらいの後退翼。全長 15m（プレースホルダーの 12.5m を
 * 約 1.2 倍。当たり判定の半径 6m・カメラの距離 24m は変えない）
 */
export const KESTREL_SHAPE: AircraftShape = {
  length: 15,
  fuselageWidth: 1.5,
  fuselageHeight: 1.6,
  noseFraction: 0.22,
  originFraction: 0.52,
  cockpit: { position: 0.25, length: 2.9, width: 0.86, height: 0.62 },
  wing: {
    span: 10,
    rootChord: 4.6,
    tipChord: 1.4,
    sweepDeg: 38,
    thickness: 0.05,
    position: 0.4,
    height: -0.1,
    dihedralDeg: -1,
  },
  stabilizer: fighterStab(5.6, 2.3, 0.9, 40),
  fin: {
    span: 3.1,
    rootChord: 3.3,
    tipChord: 1.1,
    sweepDeg: 44,
    thickness: 0.05,
    position: 0.72,
    height: 0.75,
    dihedralDeg: 0,
  },
  tail: 'single',
  engines: 1,
  nozzleRadius: 0.5,
  intakes: true,
  tailUpsweep: 0,
  bodyColor: 0x9aa4ad,
  accentColor: 0xd04a2a,
};

/** Swift（軽量・高速）: 小さな単発・単垂直尾翼・大きな後退角のデルタに近い主翼。全長 13.8m */
export const SWIFT_SHAPE: AircraftShape = {
  length: 13.8,
  fuselageWidth: 1.3,
  fuselageHeight: 1.45,
  noseFraction: 0.25,
  originFraction: 0.54,
  cockpit: { position: 0.27, length: 2.6, width: 0.8, height: 0.6 },
  wing: {
    span: 8.4,
    rootChord: 5.6,
    tipChord: 0.9,
    sweepDeg: 52,
    thickness: 0.045,
    position: 0.4,
    height: -0.2,
    dihedralDeg: -2,
  },
  stabilizer: fighterStab(4.6, 2.0, 0.7, 48),
  fin: {
    span: 2.8,
    rootChord: 3.2,
    tipChord: 0.9,
    sweepDeg: 50,
    thickness: 0.05,
    position: 0.71,
    height: 0.75,
    dihedralDeg: 0,
  },
  tail: 'single',
  engines: 1,
  nozzleRadius: 0.45,
  intakes: true,
  tailUpsweep: 0,
  bodyColor: 0xb7c3c9,
  accentColor: 0x2a8fd0,
};

/** Bastion（重武装・高耐久）: 双発・双垂直尾翼・幅の広い胴体と後退角の小さい大きな主翼。全長 17m */
export const BASTION_SHAPE: AircraftShape = {
  length: 17,
  fuselageWidth: 2.3,
  fuselageHeight: 1.8,
  noseFraction: 0.2,
  originFraction: 0.5,
  cockpit: { position: 0.21, length: 3.0, width: 0.95, height: 0.66 },
  wing: {
    span: 13,
    rootChord: 4.8,
    tipChord: 2.0,
    sweepDeg: 22,
    thickness: 0.06,
    position: 0.42,
    height: 0.1,
    dihedralDeg: 0,
  },
  stabilizer: fighterStab(6.8, 2.6, 1.2, 30),
  fin: {
    span: 3.0,
    rootChord: 3.1,
    tipChord: 1.4,
    sweepDeg: 35,
    thickness: 0.05,
    position: 0.7,
    height: 0.8,
    dihedralDeg: 12,
  },
  tail: 'twin',
  engines: 2,
  nozzleRadius: 0.52,
  intakes: true,
  tailUpsweep: 0,
  bodyColor: 0x6f7a5e,
  accentColor: 0xd0a02a,
};

/** Vector（高性能）: 双発・外へ傾けた双垂直尾翼・大きな菱形に近い主翼。全長 16m */
export const VECTOR_SHAPE: AircraftShape = {
  length: 16,
  fuselageWidth: 2.0,
  fuselageHeight: 1.55,
  noseFraction: 0.24,
  originFraction: 0.52,
  cockpit: { position: 0.25, length: 3.0, width: 0.9, height: 0.6 },
  wing: {
    span: 10.6,
    rootChord: 6.4,
    tipChord: 1.3,
    sweepDeg: 42,
    thickness: 0.045,
    position: 0.4,
    height: 0,
    dihedralDeg: -1,
  },
  stabilizer: fighterStab(6.4, 2.5, 1.0, 42),
  fin: {
    span: 2.7,
    rootChord: 3.0,
    tipChord: 1.1,
    sweepDeg: 42,
    thickness: 0.05,
    position: 0.71,
    height: 0.7,
    dihedralDeg: 26,
  },
  tail: 'twin',
  engines: 2,
  nozzleRadius: 0.5,
  intakes: true,
  tailUpsweep: 0,
  bodyColor: 0x3d4450,
  accentColor: 0xe0e0e0,
};

/** 敵機（2-3）: Kestrel と同じ形で、濃い灰色 + 赤いアクセント */
export const ENEMY_SHAPE: AircraftShape = {
  ...KESTREL_SHAPE,
  bodyColor: 0x50565d,
  accentColor: 0xb3201a,
};

/**
 * 輸送機（2-5）: 太い胴体・高翼・主翼の下に 4 発のエンジン・跳ね上がった後部胴体。プレースホルダーと
 * 同じ全長 26m・翼幅 30m（当たり判定の半径 14m は変えない）
 */
export const TRANSPORT_SHAPE: AircraftShape = {
  length: 26,
  fuselageWidth: 4.2,
  fuselageHeight: 4.4,
  noseFraction: 0.12,
  originFraction: 0.5,
  cockpit: { position: 0.08, length: 2.2, width: 2.4, height: 0.5 },
  wing: {
    span: 30,
    rootChord: 4.8,
    tipChord: 2.2,
    sweepDeg: 8,
    thickness: 0.12,
    position: 0.38,
    height: 0.85,
    dihedralDeg: -2,
  },
  stabilizer: {
    span: 11,
    rootChord: 3.4,
    tipChord: 1.6,
    sweepDeg: 22,
    thickness: 0.08,
    position: 0.84,
    height: 0.6,
    dihedralDeg: 4,
  },
  fin: {
    span: 6,
    rootChord: 4.6,
    tipChord: 2.2,
    sweepDeg: 34,
    thickness: 0.09,
    position: 0.78,
    height: 0.8,
    dihedralDeg: 0,
  },
  tail: 'single',
  engines: 4,
  nozzleRadius: 0.62,
  intakes: false,
  tailUpsweep: 1.6,
  bodyColor: 0xd9dee6,
  accentColor: 0x5a6470,
};
