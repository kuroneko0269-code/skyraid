// 10-7e: ヴォルガスの見た目の前後を同じ構図で撮る場面（?dev=kshot・scripts/kaiju-visual-pilot.js vorgas）。
// カメラは怪獣の基準点（足元の床と水平の向き）からの前・右・上の m。画像は docs/visual-pilot/vorgas/<before|after>/<天候>-<場面>.webp
import type { KaijuAttack } from './kaiju';
import type { KaijuOffset } from './kaiju-look';

/** prestep は歩く場面の前に一度描く形（足が着く直前。撮らない）・alive は撃破 / 破壊の前の形 */
export type VorgasShotScene =
  | 'entrance'
  | 'orbit'
  | 'low'
  | 'walk'
  | 'charge'
  | 'beam'
  | 'roar'
  | 'sweep'
  | 'break'
  | 'down'
  | 'defeat'
  | 'prestep'
  | 'alive';

export interface VorgasShotDef {
  readonly id: VorgasShotScene;
  readonly camera: KaijuOffset;
  readonly look: KaijuOffset;
  readonly fov: number;
  /** 置く所（海 = 上陸の途中・陸 = 港の岸の内側） */
  readonly at: 'sea' | 'land';
  /** 攻撃（予兆 / 攻撃と進み 0〜1） */
  readonly attack?: {
    readonly kind: KaijuAttack;
    readonly step: 'windup' | 'active';
    readonly k: number;
  };
}

export const VORGAS_SHOTS: readonly VorgasShotDef[] = [
  {
    // 登場の場面の中ほど（海から上陸する途中。水面の近くから見上げる）
    id: 'entrance',
    camera: { forward: 300, right: 120, up: 8 },
    look: { forward: 0, right: 0, up: 55 },
    fov: 55,
    at: 'sea',
  },
  {
    // 周回（斜め前の上から。全体の形・皮膚・背の骨板）
    id: 'orbit',
    camera: { forward: 270, right: 200, up: 150 },
    look: { forward: 0, right: 0, up: 70 },
    fov: 50,
    at: 'land',
  },
  {
    // 足元から見上げる（大きさ・目・亀裂）
    id: 'low',
    camera: { forward: 150, right: 70, up: 6 },
    look: { forward: -10, right: 0, up: 95 },
    fov: 62,
    at: 'land',
  },
  {
    // 歩く（足が着いた瞬間。横から。土煙）
    id: 'walk',
    camera: { forward: 80, right: 320, up: 30 },
    look: { forward: 0, right: 0, up: 50 },
    fov: 52,
    at: 'land',
  },
  {
    // 熱線の溜め（結晶と亀裂が明るくなる。斜め前）
    id: 'charge',
    camera: { forward: 230, right: 130, up: 90 },
    look: { forward: -30, right: 0, up: 90 },
    fov: 50,
    at: 'land',
    attack: { kind: 'beam', step: 'windup', k: 0.85 },
  },
  {
    // 熱線を撃つ途中（横から。芯と外側の光）
    id: 'beam',
    camera: { forward: 120, right: 330, up: 110 },
    look: { forward: -140, right: 0, up: 90 },
    fov: 55,
    at: 'land',
    attack: { kind: 'beam', step: 'active', k: 0.4 },
  },
  {
    // 咆哮（頭を上げて口を開ける。正面の下から）
    id: 'roar',
    camera: { forward: 210, right: -60, up: 30 },
    look: { forward: -20, right: 0, up: 100 },
    fov: 52,
    at: 'land',
    attack: { kind: 'roar', step: 'active', k: 0.3 },
  },
  {
    // 薙ぎ払いの予兆（尾が上がる。斜め後ろ）
    id: 'sweep',
    camera: { forward: -260, right: 230, up: 90 },
    look: { forward: 20, right: 0, up: 50 },
    fov: 52,
    at: 'land',
    attack: { kind: 'sweep', step: 'windup', k: 0.95 },
  },
  {
    // 部位の破壊（結晶を壊した直後。破片）
    id: 'break',
    camera: { forward: 200, right: 180, up: 120 },
    look: { forward: -20, right: 0, up: 90 },
    fov: 50,
    at: 'land',
  },
  {
    // ダウン（左脚を壊して膝をつく）
    id: 'down',
    camera: { forward: 240, right: 160, up: 50 },
    look: { forward: 0, right: 0, up: 40 },
    fov: 52,
    at: 'land',
  },
  {
    // 撃破（崩れ落ちた後）
    id: 'defeat',
    camera: { forward: 260, right: 260, up: 90 },
    look: { forward: -10, right: 0, up: 30 },
    fov: 55,
    at: 'land',
  },
];

/** 陸に置く決まった位置（港湾都市の岸壁の上。海から 70m。足元の床の高さは地形から）・向き（ラジアン。0 が −Z = 街の方） */
export const VORGAS_SHOT_BASE = { x: 60, z: 1380, heading: 0.25 } as const;
/** 海に置く位置（上陸の途中。沖から岸へ向かう）と、浮かび上がった割合 */
export const VORGAS_SHOT_SEA = { x: 0, z: 3600, heading: 0, rise: 0.55 } as const;

/** 撮る天候（昼と夕方の空） */
export const VORGAS_SHOT_WEATHERS = [
  { id: 'day', weather: 'day-clear' },
  { id: 'evening', weather: 'evening-clear' },
] as const;

/** 書き出し: 2 倍で描いて縮めた大きさ（16:9）と webp の品質 */
export const VORGAS_SHOT_IMAGE = { width: 960, height: 540, quality: 0.8 } as const;
