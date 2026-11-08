// 10-7b: 怪獣の見た目の共通の型と数値（10-7a のネフィルガから共通にした）。判定・時間には使わない（描画と演出だけ）。
// 部品は src/render/kaiju-look/（シェーダーの部品・絵のノイズ・雨と風の筋・電気の弧・破片と煙・柔らかい粒・影・鳥の群れ）、
// 演出は src/ui/kaiju-cinema.ts、撮影は src/ui/kaiju-shot.ts。怪獣ごとの数値は src/data/<怪獣>-visual.ts
export type KaijuTier = 'low' | 'medium' | 'high';

/** 画質の設定（機体の細かさとブルーム）から見た目の段: 低 = low、中（ブルームなし）= medium、高 = high */
export function kaijuTier(p: {
  readonly aircraftDetail: string;
  readonly bloom: boolean;
}): KaijuTier {
  if (p.aircraftDetail === 'low') return 'low';
  return p.bloom ? 'high' : 'medium';
}

/** 機体の細かさ（9-6a の LOD）か見た目の段から段 */
export function toKaijuTier(d: string): KaijuTier {
  return d === 'low' ? 'low' : d === 'medium' ? 'medium' : 'high';
}

/** 縁の光（逆光で強い）: 強さ・幅の指数・空の色の常時の分 */
export interface KaijuRimSpec {
  readonly strength: number;
  readonly power: number;
  readonly ambient: number;
}

/** 縁の光・稲光の色 */
export interface KaijuRimColors {
  /** 嵐のときの縁の光の色 */
  readonly rim: number;
  /** 稲光の照り返しの色 */
  readonly lightning: number;
}

/** 線の粒（雨・風の筋）: 雨の箱の半分の大きさ m・落ちる速さ・風の筋の長さと寿命 */
export interface KaijuStreakSpec {
  readonly rainBox: number;
  readonly rainSpeed: number;
  readonly windLength: number;
  readonly windLife: number;
}

/** 破片と煙: 破片の速さ・寿命・煙の寿命・破片の色（いくつか）・煙の色 */
export interface KaijuDebrisSpec {
  readonly debrisSpeed: number;
  readonly debrisLife: number;
  readonly smokeLife: number;
  readonly shardColors: readonly number[];
  readonly smokeColor: number;
}

/** カメラの置き場所（怪獣の基準点（体の中心と水平の向き）からの前・右・上 m） */
export interface KaijuOffset {
  readonly forward: number;
  readonly right: number;
  readonly up: number;
}

/** 登場の場面（秒・カメラの最初と最後・見る所の最初と最後・画角・咆哮の時刻・段階 / 撃破の揺れ） */
export interface KaijuCinemaSpec {
  readonly seconds: number;
  readonly from: KaijuOffset;
  readonly to: KaijuOffset;
  readonly lookFrom: KaijuOffset;
  readonly lookTo: KaijuOffset;
  readonly fovFrom: number;
  readonly fovTo: number;
  /** カメラが寄り切る割合（場面の長さに対して） */
  readonly moveShare: number;
  readonly roarAt: number;
  readonly phaseShake: number;
  readonly defeatShake: number;
}
