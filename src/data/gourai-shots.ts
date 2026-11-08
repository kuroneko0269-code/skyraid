// 10-7c: メカ怪獣ゴウライの見た目の前後を同じ構図で撮る場面（?dev=kshot・scripts/kaiju-visual-pilot.js gourai）。
// カメラは怪獣の基準点（体の中心と水平の向き）からの前・右・上の m。画像は docs/visual-pilot/gourai/<before|after>/<天候>-<場面>.webp
import type { GouraiPose } from '../entities/gourai/gourai-body';
import type { KaijuOffset } from './kaiju-look';

/** falling は撃破の前に一度描く形（落ち始め。撮らない） */
export type GouraiShotScene =
  | 'entrance'
  | 'orbit'
  | 'front'
  | 'rear'
  | 'volley'
  | 'sweep'
  | 'vent'
  | 'purge'
  | 'break'
  | 'defeat'
  | 'falling';

export interface GouraiShotDef {
  readonly id: GouraiShotScene;
  readonly camera: KaijuOffset;
  readonly look: KaijuOffset;
  readonly fov: number;
  /** 撮る瞬間の姿勢（判定の姿勢の値。撮るためだけに置く） */
  readonly pose: Partial<GouraiPose>;
}

export const GOURAI_SHOTS: readonly GouraiShotDef[] = [
  {
    // 登場の場面の中ほど（湾の水面の近くから見上げる。浮かび上がって目が光る）
    id: 'entrance',
    camera: { forward: 210, right: 90, up: -50 },
    look: { forward: 0, right: 0, up: -10 },
    fov: 50,
    pose: {},
  },
  {
    // 周回（斜め前の上から。全体の形）
    id: 'orbit',
    camera: { forward: 210, right: 190, up: 95 },
    look: { forward: 0, right: 0, up: -10 },
    fov: 50,
    pose: {},
  },
  {
    // 正面（少し下から。頭・目・大あご・砲台）
    id: 'front',
    camera: { forward: 185, right: 45, up: -12 },
    look: { forward: 0, right: 0, up: 8 },
    fov: 50,
    pose: { exhaust: 0.3 },
  },
  {
    // 後ろ（斜め後ろの上から。排気口・尾・背）
    id: 'rear',
    camera: { forward: -200, right: -120, up: 70 },
    look: { forward: 0, right: 0, up: 0 },
    fov: 50,
    pose: { exhaust: 0.6 },
  },
  {
    // ミサイルの一斉発射の予兆（ハッチが開いて赤く点滅）
    id: 'volley',
    camera: { forward: 90, right: 190, up: 120 },
    look: { forward: -10, right: 0, up: 20 },
    fov: 50,
    pose: { hatch: 1, exhaust: 0.4 },
  },
  {
    // 回転掃射の予兆（機銃が赤く光り、危ない高さの輪が広がる）
    id: 'sweep',
    camera: { forward: 230, right: 200, up: 60 },
    look: { forward: 0, right: 0, up: 0 },
    fov: 55,
    pose: { gunGlow: 1, exhaust: 0.5 },
  },
  {
    // 放熱（前の装甲が開いて核が光る。排気口が明るい）
    id: 'vent',
    camera: { forward: 175, right: 120, up: 45 },
    look: { forward: 20, right: 0, up: 0 },
    fov: 50,
    pose: { armorOpen: 1, exhaust: 1 },
  },
  {
    // 装甲を捨てる（板が外・上へ飛ぶ途中）
    id: 'purge',
    camera: { forward: 220, right: 170, up: 70 },
    look: { forward: 30, right: 0, up: 10 },
    fov: 55,
    pose: { purge: 0.45, exhaust: 0.7 },
  },
  {
    // 部位の破壊（右の肩の機銃を壊した直後）
    id: 'break',
    camera: { forward: 120, right: 160, up: 60 },
    look: { forward: 20, right: 30, up: 20 },
    fov: 50,
    pose: { exhaust: 0.5 },
  },
  {
    // 撃破（傾きながら沈む。爆発が続く）
    id: 'defeat',
    camera: { forward: 220, right: 220, up: 50 },
    look: { forward: 0, right: 0, up: -10 },
    fov: 55,
    pose: {},
  },
];

/** 怪獣を置く決まった位置（港湾都市の湾の上。中心は床から 80m）・向き（ラジアン。0 が −Z） */
export const GOURAI_SHOT_BASE = { x: 200, y: 80, z: 2900, heading: 2.4 } as const;

/** 撮る天候（昼と夕方の空） */
export const GOURAI_SHOT_WEATHERS = [
  { id: 'day', weather: 'day-clear' },
  { id: 'evening', weather: 'evening-clear' },
] as const;

/** 書き出し: 2 倍で描いて縮めた大きさ（16:9）と webp の品質 */
export const GOURAI_SHOT_IMAGE = { width: 960, height: 540, quality: 0.8 } as const;
