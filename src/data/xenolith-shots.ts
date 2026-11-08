// 10-7d: UFO ゼノリスの見た目の前後を同じ構図で撮る場面（?dev=kshot・scripts/kaiju-visual-pilot.js xenolith）。
// カメラは怪獣の基準点（体の中心と水平の向き）からの前・右・上の m。画像は docs/visual-pilot/xenolith/<before|after>/<天候>-<場面>.webp
import type { KaijuOffset } from './kaiju-look';

/** falling は撃破の前に一度描く形（落ち始め。撮らない） */
export type XenolithShotScene =
  | 'entrance'
  | 'orbit'
  | 'under'
  | 'dash'
  | 'barrier'
  | 'warp'
  | 'sweep'
  | 'charged'
  | 'orbs'
  | 'break'
  | 'defeat'
  | 'falling';

export interface XenolithShotDef {
  readonly id: XenolithShotScene;
  readonly camera: KaijuOffset;
  readonly look: KaijuOffset;
  readonly fov: number;
}

export const XENOLITH_SHOTS: readonly XenolithShotDef[] = [
  {
    // 登場の場面の中ほど（下から見上げる。光の柱の中を降りてくる）
    id: 'entrance',
    camera: { forward: 420, right: 180, up: -150 },
    look: { forward: 0, right: 0, up: 70 },
    fov: 58,
  },
  {
    // 周回（斜め前の上から。全体の形・上の面の映り込み）
    id: 'orbit',
    camera: { forward: 250, right: 190, up: 110 },
    look: { forward: 0, right: 0, up: 0 },
    fov: 50,
  },
  {
    // 下から（砲口・発生器・下の面の模様）
    id: 'under',
    camera: { forward: 210, right: 130, up: -170 },
    look: { forward: 0, right: 0, up: -15 },
    fov: 55,
  },
  {
    // 急加速（横へ 320 m/s で飛ぶ途中。光の尾）
    id: 'dash',
    camera: { forward: 300, right: -120, up: 70 },
    look: { forward: 0, right: -90, up: 0 },
    fov: 55,
  },
  {
    // バリア（殻に当たった波紋）
    id: 'barrier',
    camera: { forward: 300, right: 170, up: 60 },
    look: { forward: 0, right: 0, up: 5 },
    fov: 52,
  },
  {
    // 瞬間移動の予兆（右に移る先の柱と輪が光る。本体は光がほどけ始める）
    id: 'warp',
    camera: { forward: 640, right: 230, up: 90 },
    look: { forward: 0, right: 200, up: 10 },
    fov: 55,
  },
  {
    // なぎ払う光線（撃つ途中。光線の芯と外側の光）
    id: 'sweep',
    camera: { forward: -180, right: 280, up: 170 },
    look: { forward: 260, right: 0, up: -30 },
    fov: 60,
  },
  {
    // 溜め撃ちの溜め（砲口が光り、線が止まる = 避けどき）
    id: 'charged',
    camera: { forward: 260, right: 230, up: -70 },
    look: { forward: 120, right: 0, up: -60 },
    fov: 55,
  },
  {
    // 光の弾のばらまき（予兆の縁の光と、撃ったばかりの弾の格子）
    id: 'orbs',
    camera: { forward: 420, right: 170, up: 40 },
    look: { forward: 160, right: 0, up: 0 },
    fov: 55,
  },
  {
    // 部位の破壊（縁の発光体を壊した直後）
    id: 'break',
    camera: { forward: 230, right: 170, up: 90 },
    look: { forward: 0, right: 20, up: 0 },
    fov: 50,
  },
  {
    // 撃破（光が消えて傾きながら落ちる）
    id: 'defeat',
    camera: { forward: 300, right: 230, up: 70 },
    look: { forward: 0, right: 0, up: -10 },
    fov: 55,
  },
];

/** 怪獣を置く決まった位置（港湾都市の湾の上。中心は床から y m）・向き（ラジアン。0 が −Z） */
export const XENOLITH_SHOT_BASE = { x: 200, y: 300, z: 2900, heading: 2.4 } as const;

/** 撮る天候（昼と夕方の空） */
export const XENOLITH_SHOT_WEATHERS = [
  { id: 'day', weather: 'day-clear' },
  { id: 'evening', weather: 'evening-clear' },
] as const;

/** 書き出し: 2 倍で描いて縮めた大きさ（16:9）と webp の品質 */
export const XENOLITH_SHOT_IMAGE = { width: 960, height: 540, quality: 0.8 } as const;
