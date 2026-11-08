// 10-7a: ネフィルガの見た目の試作の前後を同じ構図で撮る場面（?dev=k2shot・scripts/kaiju2-visual-pilot.js）。
// カメラは怪獣の基準点（体の中心と水平の向き）からの前・右・上の m。画像は docs/visual-pilot/<天候>-<場面>.webp
export interface Kaiju2ShotOffset {
  readonly forward: number;
  readonly right: number;
  readonly up: number;
}

export type Kaiju2ShotScene = 'entrance' | 'orbit' | 'orbs' | 'perch' | 'break' | 'defeat';

export interface Kaiju2ShotDef {
  readonly id: Kaiju2ShotScene;
  /** 見出し（docs/visual-pilot/README.md） */
  readonly label: string;
  readonly camera: Kaiju2ShotOffset;
  readonly look: Kaiju2ShotOffset;
  readonly fov: number;
  /** 羽ばたきの位相（撮る瞬間に止める値） */
  readonly flapPhase: number;
  /** 傾き（ラジアン） */
  readonly bank: number;
}

export const KAIJU2_SHOTS: readonly Kaiju2ShotDef[] = [
  {
    id: 'entrance',
    label: '登場（下から見上げる）',
    camera: { forward: 230, right: -90, up: -95 },
    look: { forward: 0, right: 0, up: 12 },
    fov: 55,
    flapPhase: 0.62,
    bank: 0,
  },
  {
    id: 'orbit',
    label: '周回（横から）',
    camera: { forward: 90, right: 320, up: 35 },
    look: { forward: -5, right: 0, up: 0 },
    fov: 45,
    flapPhase: 0.1,
    bank: 0.32,
  },
  {
    id: 'orbs',
    label: '雷球の予兆（喉と膜の筋が光る）',
    camera: { forward: 250, right: 150, up: 45 },
    look: { forward: 0, right: 0, up: 5 },
    fov: 45,
    flapPhase: 0.3,
    bank: 0,
  },
  {
    id: 'perch',
    label: '止まり木（翼をたたんで休む）',
    camera: { forward: 190, right: 150, up: 35 },
    look: { forward: 0, right: 0, up: 5 },
    fov: 45,
    flapPhase: 0,
    bank: 0,
  },
  {
    id: 'break',
    label: '部位の破壊（右翼を壊した直後）',
    camera: { forward: -120, right: 260, up: 90 },
    look: { forward: 0, right: 40, up: 0 },
    fov: 48,
    flapPhase: 0.45,
    bank: 0.1,
  },
  {
    id: 'defeat',
    label: '撃破（墜ちていく）',
    camera: { forward: 230, right: 260, up: -30 },
    look: { forward: 0, right: 0, up: -20 },
    fov: 48,
    flapPhase: 0,
    bank: 0.2,
  },
];

/** 撮る天候（昼と嵐の空） */
export const KAIJU2_SHOT_WEATHERS = [
  { id: 'day', weather: 'day-clear', label: '昼・快晴' },
  { id: 'storm', weather: 'day-rain', label: '嵐（昼・雨）' },
] as const;

/** 書き出し: 2 倍で描いて縮めた大きさ（16:9）と webp の品質 */
export const KAIJU2_SHOT_IMAGE = { width: 960, height: 540, quality: 0.8 } as const;
