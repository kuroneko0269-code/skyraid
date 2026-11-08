// 10-7a: ネフィルガの見た目の試作の前後を同じ構図で撮る場面（?dev=kshot・scripts/kaiju-visual-pilot.js nephirga）。
// カメラは怪獣の基準点（体の中心と水平の向き）からの前・右・上の m。画像は docs/visual-pilot/nephirga/<before|after>/<天候>-<場面>.webp
import type { KaijuOffset } from './kaiju-look';

export type Kaiju2ShotOffset = KaijuOffset;

export type Kaiju2ShotScene = 'entrance' | 'orbit' | 'orbs' | 'perch' | 'break' | 'defeat';

export interface Kaiju2ShotDef {
  readonly id: Kaiju2ShotScene;
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
    camera: { forward: 230, right: -90, up: -95 },
    look: { forward: 0, right: 0, up: 12 },
    fov: 55,
    flapPhase: 0.62,
    bank: 0,
  },
  {
    id: 'orbit',
    camera: { forward: 90, right: 320, up: 35 },
    look: { forward: -5, right: 0, up: 0 },
    fov: 45,
    flapPhase: 0.1,
    bank: 0.32,
  },
  {
    id: 'orbs',
    camera: { forward: 250, right: 150, up: 45 },
    look: { forward: 0, right: 0, up: 5 },
    fov: 45,
    flapPhase: 0.3,
    bank: 0,
  },
  {
    id: 'perch',
    camera: { forward: 190, right: 150, up: 35 },
    look: { forward: 0, right: 0, up: 5 },
    fov: 45,
    flapPhase: 0,
    bank: 0,
  },
  {
    id: 'break',
    camera: { forward: -120, right: 260, up: 90 },
    look: { forward: 0, right: 40, up: 0 },
    fov: 48,
    flapPhase: 0.45,
    bank: 0.1,
  },
  {
    id: 'defeat',
    camera: { forward: 230, right: 260, up: -30 },
    look: { forward: 0, right: 0, up: -20 },
    fov: 48,
    flapPhase: 0,
    bank: 0.2,
  },
];

/** 怪獣を置く決まった位置（港湾都市の湾の上。ソロのレイドの出てすぐの所）・向き（ラジアン。0 が −Z）・止まり木の乱数の種 */
export const KAIJU2_SHOT_BASE = {
  x: -80,
  y: 780,
  z: 2100,
  heading: -0.78,
  perchSeed: 0x5107,
} as const;

/** 撮る天候（昼と嵐の空） */
export const KAIJU2_SHOT_WEATHERS = [
  { id: 'day', weather: 'day-clear' },
  { id: 'storm', weather: 'day-rain' },
] as const;

/** 書き出し: 2 倍で描いて縮めた大きさ（16:9）と webp の品質 */
export const KAIJU2_SHOT_IMAGE = { width: 960, height: 540, quality: 0.8 } as const;
