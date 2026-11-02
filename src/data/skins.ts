// スキン・デカール（7-3）の決めた値: 塗装パターン 8 種・パレット 12 色・デカール 10 種・価格・解放条件・置き方の範囲。
// 見た目だけで性能は変えない。塗装の型と直列化は src/progression/paint.ts、売り買いは src/progression/paintshop.ts、
// テクスチャの生成は src/render/aircraft-model/skin-texture.ts

import { t } from '../core/i18n';

export interface SkinColorDef {
  /** 文言のキー（skins.color.<id>）と判定に使う */
  readonly id: string;
  /** 表示名（今の言語） */
  readonly name: string;
  readonly hex: number;
}

function color(id: string, hex: number): SkinColorDef {
  return {
    id,
    get name() {
      return t(`skins.color.${id}`);
    },
    hex,
  };
}

/** パレット（自由色はなし。組み合わせを簡単にするため 12 色から選ぶ）。先頭 8 色は 4 機種の元の色 */
export const SKIN_PALETTE: readonly SkinColorDef[] = [
  color('slateBlue', 0x9aa4ad),
  color('vermilion', 0xd04a2a),
  color('silver', 0xb7c3c9),
  color('blue', 0x2a8fd0),
  color('olive', 0x6f7a5e),
  color('gold', 0xd0a02a),
  color('gunmetal', 0x3d4450),
  color('white', 0xe0e0e0),
  color('black', 0x1e2124),
  color('navy', 0x2b3f6b),
  color('sand', 0xc4ad82),
  color('purple', 0x6b4a9a),
];

export const SKIN_PATTERN_IDS = [
  'solid',
  'camoForest',
  'camoDesert',
  'camoOcean',
  'twoTone',
  'splitter',
  'stripe',
  'metal',
] as const;
export type SkinPatternId = (typeof SKIN_PATTERN_IDS)[number];

/** 解放条件。allMissionsS: キャンペーンの全ミッションで S / pvpKills: PvP の累計撃墜 / allRacesA: レース全コースで A 以上 */
export type SkinUnlock =
  | { readonly kind: 'allMissionsS' }
  | { readonly kind: 'pvpKills'; readonly count: number }
  | { readonly kind: 'allRacesA' };

export interface SkinPatternDef {
  readonly id: SkinPatternId;
  readonly name: string;
  /** 価格（CR）。0 は最初から持っている */
  readonly price: number;
  readonly unlock: SkinUnlock | null;
  /** 迷彩の 3 色（明・中・暗の順ではなく、ノイズの低い → 高い順）。迷彩以外は空 */
  readonly tones: readonly number[];
  /** マテリアルの金属度・粗さ（null は 4-3 の塗装の値） */
  readonly surface: { readonly metalness: number; readonly roughness: number } | null;
}

/**
 * 塗装パターン。色の使い方:
 * - 単色: 基本色。翼端・ラダー・垂直尾翼の上端がアクセント色（4-3 の塗り分けと同じ）
 * - 迷彩: 上面・側面は固定の 3 色、下面は基本色、垂直尾翼の上端だけアクセント色
 * - 2 トーン: 上面が基本色、下面がアクセント色（胴体の境目はゆるく波打つ）
 * - スプリッター: 基本色・アクセント色・基本色の暗い色の直線で区切った面
 * - ストライプ: 基本色に、胴体の上の 2 本・主翼の帯・垂直尾翼の帯をアクセント色（縁取りはマーキング色）
 * - 金属地: 基本色の金属（粗さ 0.22）。パネルごとに少し明るさを変え、前後方向のヘアライン。塗り分けは単色と同じ
 */
export const SKIN_PATTERNS: readonly SkinPatternDef[] = [
  {
    id: 'solid',
    get name() {
      return t('skins.pattern.solid');
    },
    price: 0,
    unlock: null,
    tones: [],
    surface: null,
  },
  {
    id: 'camoForest',
    get name() {
      return t('skins.pattern.camoForest');
    },
    price: 2000,
    unlock: null,
    tones: [0x56653a, 0x6e5b3e, 0x2c3324],
    surface: null,
  },
  {
    id: 'camoDesert',
    get name() {
      return t('skins.pattern.camoDesert');
    },
    price: 2000,
    unlock: null,
    tones: [0xcdb383, 0xa07d50, 0xe3d3aa],
    surface: null,
  },
  {
    id: 'camoOcean',
    get name() {
      return t('skins.pattern.camoOcean');
    },
    price: 3000,
    unlock: { kind: 'pvpKills', count: 10 },
    tones: [0x56758f, 0x2f4762, 0x93a8b8],
    surface: null,
  },
  {
    id: 'twoTone',
    get name() {
      return t('skins.pattern.twoTone');
    },
    price: 1500,
    unlock: null,
    tones: [],
    surface: null,
  },
  {
    id: 'splitter',
    get name() {
      return t('skins.pattern.splitter');
    },
    price: 2500,
    unlock: null,
    tones: [],
    surface: null,
  },
  {
    id: 'stripe',
    get name() {
      return t('skins.pattern.stripe');
    },
    price: 3000,
    unlock: { kind: 'allRacesA' },
    tones: [],
    surface: null,
  },
  {
    id: 'metal',
    get name() {
      return t('skins.pattern.metal');
    },
    price: 4000,
    unlock: { kind: 'allMissionsS' },
    tones: [],
    surface: { metalness: 0.85, roughness: 0.22 },
  },
];

export const DECAL_IDS = [
  'chevron',
  'hexring',
  'diamonds',
  'star',
  'bolt',
  'bird',
  'number',
  'checker',
  'claws',
  'compass',
] as const;
export type DecalId = (typeof DECAL_IDS)[number];

export interface DecalDef {
  readonly id: DecalId;
  readonly name: string;
  readonly price: number;
}

function decal(id: DecalId, price: number): DecalDef {
  return {
    id,
    get name() {
      return t(`skins.decal.${id}`);
    },
    price,
  };
}

/** デカール（手続き生成の図形。実在の軍のマーク・国旗・ブランドは入れない）。number は機体番号を大きく描く */
export const DECALS: readonly DecalDef[] = [
  decal('chevron', 500),
  decal('hexring', 500),
  decal('diamonds', 500),
  decal('star', 500),
  decal('bolt', 500),
  decal('bird', 500),
  decal('number', 500),
  decal('checker', 500),
  decal('claws', 500),
  decal('compass', 500),
];

/** デカールを貼る場所。wing = 主翼の上面（左右に対称）、fin = 垂直尾翼（両面。双垂直尾翼は 2 枚とも） */
export const DECAL_SLOTS = ['wing', 'fin'] as const;
export type DecalSlot = (typeof DECAL_SLOTS)[number];

export const SKIN_CONFIG = {
  /** 機体番号の範囲（2 桁） */
  numberMax: 99,
  /**
   * デカールの置き方（スライダーは 0〜255 の整数。直列化の 1 バイト）。x・y は面の中の位置、size は基準の長さに対する割合、
   * rotation は 0〜255 を −180〜180°（128 が 0°）に。
   * 主翼: x = 付け根 → 翼端（翼幅の半分に対する割合の範囲）、y = 前縁 → 後縁、基準の長さ = 平均翼弦。
   * 垂直尾翼: x = 前縁 → 後縁、y = 付け根 → 上端、基準の長さ = 尾翼の高さ
   */
  placement: {
    wing: { x: [0.3, 0.92], y: [0.15, 0.85], size: [0.35, 1.3] },
    fin: { x: [0.15, 0.85], y: [0.12, 0.9], size: [0.2, 0.85] },
  },
  /** 初期の置き方（0〜255） */
  defaultPlacement: {
    wing: { x: 150, y: 110, size: 150, rotation: 128 },
    fin: { x: 110, y: 170, size: 110, rotation: 128 },
  },
  /** 垂直尾翼の機体番号: 前縁 → 後縁の位置・高さの位置（中心）・数字の高さ（尾翼の高さに対する割合） */
  number: { chord: 0.42, height: 0.42, size: 0.3 },
  /** 単色・金属地の塗り分け（4-3 と同じ）: 主翼の翼端・垂直尾翼の上端・ラダー（翼弦の後ろ・高さの範囲） */
  trim: { wingTip: 0.88, finTop: 0.85, rudderChord: 0.7, rudderSpan: [0.1, 0.85] },
  /** 迷彩の模様の大きさ（m）と、下面とみなす向き（上向きの成分がこれ未満） */
  camoScale: 2.4,
  camoUnderside: -0.35,
  /** 金属地: パネルの明るさの差（±）・ヘアラインの濃さ（±）と細かさ（1/m）・パネルの大きさ（m） */
  metal: { panelTint: 0.06, brush: 0.05, brushFrequency: 12, panel: [1.4, 1.1] },
  /** ストライプ: 胴体の上の 2 本の幅と間（m）・縁取りの幅（m）、主翼の帯（翼幅の割合）、垂直尾翼の帯（高さの割合） */
  stripe: { width: 0.24, gap: 0.12, pin: 0.035, wing: [0.62, 0.74], fin: [0.56, 0.7] },
  /** スプリッター: 面を区切る直線の数と、暗い色の明るさ（基本色に掛ける） */
  splitter: { lines: 9, darkShade: 0.55 },
  /** テクスチャの生成の時間の上限（ms。テストで確かめる） */
  maxGenerateMs: 50,
} as const;

export function findSkinPattern(id: string): SkinPatternDef | null {
  return SKIN_PATTERNS.find((p) => p.id === id) ?? null;
}

export function findDecal(id: string): DecalDef | null {
  return DECALS.find((d) => d.id === id) ?? null;
}
