// 10-7b: 白鯨アルビオンの見た目の前後を同じ構図で撮る場面（?dev=kshot・scripts/kaiju-visual-pilot.js albion）。
// カメラは怪獣の基準点（体の中心と水平の向き）からの前・右・上の m。画像は docs/visual-pilot/albion/<before|after>/<天候>-<場面>.webp
import type { KaijuOffset } from './kaiju-look';

/** falling は撃破の前に一度描く形（落ちていく途中。撮らない） */
export type AlbionShotScene =
  | 'entrance'
  | 'orbit'
  | 'swim0'
  | 'swim1'
  | 'swim2'
  | 'turn'
  | 'spout'
  | 'roar'
  | 'break'
  | 'defeat'
  | 'falling';

export interface AlbionShotDef {
  readonly id: AlbionShotScene;
  readonly camera: KaijuOffset;
  readonly look: KaijuOffset;
  readonly fov: number;
  /** 泳ぎの位相（撮る瞬間に止める値）・傾き（ラジアン） */
  readonly swimPhase: number;
  readonly bank: number;
}

export const ALBION_SHOTS: readonly AlbionShotDef[] = [
  {
    // 登場の場面の中ほど（下から見上げる。雲の中から頭が出てくる）
    id: 'entrance',
    camera: { forward: 470, right: 60, up: -200 },
    look: { forward: 220, right: 0, up: 5 },
    fov: 50,
    swimPhase: 0.2,
    bank: 0,
  },
  {
    // 周回（横から。体の大きさ・鳥・影）
    id: 'orbit',
    camera: { forward: 100, right: 950, up: 380 },
    look: { forward: 0, right: 0, up: -260 },
    fov: 55,
    swimPhase: 0.35,
    bank: 0.18,
  },
  // 泳ぐ（横から。尾の打ちの 1/3 ずつ。尾びれの上下・後ろ半分のうねり・体の上下の揺れ・尾びれの水の筋と渦）
  ...[0, 1, 2].map((i): AlbionShotDef => ({
    id: i === 0 ? 'swim0' : i === 1 ? 'swim1' : 'swim2',
    camera: { forward: -60, right: 880, up: -60 },
    look: { forward: -60, right: 0, up: 0 },
    fov: 50,
    swimPhase: i / 3,
    bank: 0,
  })),
  {
    // 曲がる（半円で傾く。斜め前の下から。胸びれの舵）
    id: 'turn',
    camera: { forward: 620, right: 300, up: -200 },
    look: { forward: 0, right: 0, up: -20 },
    fov: 50,
    swimPhase: 0.15,
    bank: 0.42,
  },
  {
    // 潮吹き（斜め前の上から。しぶきと霧）
    id: 'spout',
    camera: { forward: 520, right: 520, up: 260 },
    look: { forward: 60, right: 0, up: 140 },
    fov: 50,
    swimPhase: 0.6,
    bank: 0,
  },
  {
    // 吠える（頭の斜め前の下から。口を開け目が光る）
    id: 'roar',
    camera: { forward: 520, right: 230, up: -70 },
    look: { forward: 260, right: 0, up: 0 },
    fov: 45,
    swimPhase: 0.1,
    bank: 0,
  },
  {
    // 部位の破壊（中の巣を壊した直後。斜め下から）
    id: 'break',
    camera: { forward: 120, right: 330, up: -260 },
    look: { forward: 20, right: 0, up: -50 },
    fov: 50,
    swimPhase: 0.4,
    bank: 0,
  },
  {
    // 撃破（海へ落ちて大きな水柱）
    id: 'defeat',
    camera: { forward: 520, right: 760, up: 110 },
    look: { forward: 0, right: 0, up: 170 },
    fov: 55,
    swimPhase: 0,
    bank: 0.4,
  },
];

/** 怪獣を置く決まった位置（港湾都市の湾の上）・向き（ラジアン。0 が −Z） */
export const ALBION_SHOT_BASE = { x: 300, y: 800, z: 3300, heading: 1.2 } as const;

/** 撮る天候（昼と夕方の空） */
export const ALBION_SHOT_WEATHERS = [
  { id: 'day', weather: 'day-clear' },
  { id: 'evening', weather: 'evening-clear' },
] as const;

/** 書き出し: 2 倍で描いて縮めた大きさ（16:9）と webp の品質 */
export const ALBION_SHOT_IMAGE = { width: 960, height: 540, quality: 0.8 } as const;
