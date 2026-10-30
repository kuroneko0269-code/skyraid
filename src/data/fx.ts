// エフェクト（4-4）の数値: 爆発（閃光・火球・黒煙）・被弾・陽炎・墜落の水柱・ミサイル発射・対空砲のフラック。
// 描画は src/render/fx/。距離は m、時間は秒。2-1〜2-6 の演出（曳光弾・火花・破片・ミサイルの煙）は src/data/effects.ts

/**
 * 爆発の規模。small はミサイル・ロケットの着弾（4-4 の 5）、aircraft / ground / fuel が撃墜・破壊の 3 段階
 * （機体 / 地上目標 / 燃料タンク）
 */
export const EXPLOSION_SCALES = ['small', 'aircraft', 'ground', 'fuel'] as const;
export type ExplosionScale = (typeof EXPLOSION_SCALES)[number];

export interface ExplosionSpec {
  /** 閃光（1 描画フレームだけの白い球）の直径 */
  readonly flashSize: number;
  /** 火球の数（爆心のまわり spread の球の中にばらまく） */
  readonly fireballs: number;
  readonly spread: number;
  /** 火球の直径（出た直後 → 寿命の終わり） */
  readonly fireballStart: number;
  readonly fireballEnd: number;
  /** 火球が外へ広がる速さ（m/s。空気抵抗で止まる） */
  readonly fireballSpeed: number;
  /** 黒煙の玉の数・直径（出た直後 → 寿命の終わり）・上がる速さ */
  readonly smokePuffs: number;
  readonly smokeStart: number;
  readonly smokeEnd: number;
  readonly smokeRise: number;
  /** 近くで起きたときのカメラの揺れ（2-1 の地面衝突の揺れ 1.0 に対する強さ。距離で減らす） */
  readonly shake: number;
}

export const EXPLOSION_SPECS: Readonly<Record<ExplosionScale, ExplosionSpec>> = {
  small: {
    flashSize: 10,
    fireballs: 2,
    spread: 2,
    fireballStart: 3,
    fireballEnd: 11,
    fireballSpeed: 6,
    smokePuffs: 2,
    smokeStart: 5,
    smokeEnd: 18,
    smokeRise: 4,
    shake: 0.15,
  },
  aircraft: {
    flashSize: 18,
    fireballs: 4,
    spread: 4,
    fireballStart: 5,
    fireballEnd: 18,
    fireballSpeed: 10,
    smokePuffs: 6,
    smokeStart: 8,
    smokeEnd: 32,
    smokeRise: 6,
    shake: 0.35,
  },
  ground: {
    flashSize: 26,
    fireballs: 6,
    spread: 8,
    fireballStart: 8,
    fireballEnd: 28,
    fireballSpeed: 14,
    smokePuffs: 10,
    smokeStart: 10,
    smokeEnd: 42,
    smokeRise: 7,
    shake: 0.5,
  },
  fuel: {
    flashSize: 44,
    fireballs: 10,
    spread: 14,
    fireballStart: 14,
    fireballEnd: 52,
    fireballSpeed: 22,
    smokePuffs: 18,
    smokeStart: 16,
    smokeEnd: 70,
    smokeRise: 9,
    shake: 0.8,
  },
};

/** 範囲ダメージの半径（m）からの規模（ロケット 5m・ミサイル 25m → small、爆弾 40m → ground、誘爆 60m → fuel） */
export const BLAST_RADIUS_SCALES: readonly {
  readonly minRadius: number;
  readonly scale: ExplosionScale;
}[] = [
  { minRadius: 55, scale: 'fuel' },
  { minRadius: 35, scale: 'ground' },
  { minRadius: 0, scale: 'small' },
];

export const FIREBALL_CONFIG = {
  /** 同時に出せる火球（閃光・フラックも含む）の上限 */
  max: 160,
  /** 火球の寿命。色は白 → 橙 → 黒煙の色へ（寿命に対する割合で区切る） */
  life: 0.6,
  /** 白（閃光の残り）でいる割合・橙になりきる割合。そこから終わりまでで黒煙の色へ */
  whiteUntil: 0.12,
  orangeAt: 0.35,
  /** 色（線形の RGB に掛ける明るさ。露出後。1 を超えるとブルームで光る） */
  white: { color: 0xfff4dc, intensity: 5 },
  orange: { color: 0xff7a1a, intensity: 2.6 },
  smoke: { color: 0x221c18, intensity: 0.05 },
  /** 閃光の明るさ（露出後） */
  flashIntensity: 8,
  flashColor: 0xfff2d0,
  /** 寿命の最後のこの割合で薄くなる */
  fadeFraction: 0.35,
  /** 広がる速さの空気抵抗（1/秒） */
  drag: 3,
  /** 寿命の終わりにこの割合で黒煙の玉へ引き継ぐ（火球の数 × この割合だけ煙を足すのではなく、spec.smokePuffs を出す時刻） */
  smokeHandoff: 0.5,
} as const;

export const SMOKE_FIELD_CONFIG = {
  /** 同時に出せる煙の玉（爆発の黒煙・敵機の損傷の煙・フラック・水しぶき）の上限 */
  max: 640,
  /** 爆発の黒煙の寿命（8 秒で消える） */
  life: 8,
  /** 黒煙の色と不透明度 */
  color: 0x2b2723,
  opacity: 0.7,
  /** 風下へ流れる速さ（風の向きは src/data/wind.ts） */
  driftSpeed: 3,
  /** 横の速さの空気抵抗（1/秒）。爆発で外へ散った玉が止まる */
  drag: 0.8,
  /** 大きさのばらつき（±割合） */
  sizeJitter: 0.25,
  /** 寿命の最後のこの割合で薄くなる（最初の fadeIn 秒で濃くなる） */
  fadeFraction: 0.45,
  fadeIn: 0.25,
} as const;

/** 被弾（4-4 の 2） */
export const HIT_FX_CONFIG = {
  /** 自機の被弾のカメラの揺れ（2-1 の地面衝突 1.0 に対する強さ。1 発ごと、減衰は camera.ts の impactDecay） */
  playerShake: 0.22,
  /** 自機の被弾として扱う、着弾点と自機の中心の距離（当たり判定の半径 + この値） */
  playerHitMargin: 4,
  /** 敵機の被弾で出す小さな黒煙 */
  hitPuff: { life: 1.6, start: 1.5, end: 6, opacity: 0.55, color: 0x2a2622 },
  /** HP がこの割合以下の敵機は尾部から黒煙を曳く */
  trailBelowHp: 0.3,
  /** 曳く煙の間隔（秒、描画の時間）・寿命・直径・色 */
  trailInterval: 0.04,
  trail: { life: 2.4, start: 2, end: 9, opacity: 0.6, color: 0x1e1b18 },
  /** 尾部の位置（機首方向の後ろへ。m） */
  trailOffset: 6,
} as const;

/** 陽炎（4-4 の 3）。画質「高」は画面を歪める屈折（ポストエフェクトの仕上げのパス）、他は薄い半透明の揺らぎ */
export const HEAT_HAZE_CONFIG = {
  /** ノズルから後ろへの長さと、根元・先の半径（ノズルの半径に対する倍率） */
  length: 7,
  rootRadius: 1.0,
  tipRadius: 2.4,
  /** 半透明の揺らぎの不透明度（最大）と色 */
  opacity: 0.09,
  color: 0xd8d4cc,
  /** 揺らぎの速さ（模様が後ろへ流れる速さ。1/秒） */
  flowSpeed: 3.2,
  /** スロットルに対する強さ: スロットル 0 で minLevel、1 で 1。アフターバーナー中は炎があるので消す */
  minLevel: 0.35,
  /** 屈折（「高」）: 画面のずれの最大（画面の高さに対する割合）と、帯の太さ（ノズルの半径の画面上の大きさに対する倍率） */
  refractStrength: 0.006,
  refractWidth: 2.2,
} as const;

/** 墜落の水柱（4-4 の 4）。海面（地表の高さ ≤ 0）への墜落 */
export const WATER_COLUMN_CONFIG = {
  max: 8,
  life: 1.5,
  /** 立ち上がるまでの時間と、そのときの高さ・半径 */
  riseTime: 0.35,
  height: 46,
  radius: 5,
  /** 崩れたときの半径の倍率と高さの倍率（寿命の終わり） */
  spreadScale: 2.6,
  endHeightScale: 0.25,
  color: 0xf4f8fa,
  opacity: 0.85,
  /** 根元のしぶき（煙の玉を白く） */
  sprayPuffs: 8,
  spray: { life: 2.2, start: 6, end: 22, opacity: 0.5, color: 0xeef3f5 },
  /** 墜落の判定: 機体の高さ − 地表の高さがこれ以下なら地面・海面への衝突とみなす */
  crashAgl: 20,
} as const;

/** ミサイル発射（4-4 の 5）: ノズルの閃光と、強い初速の白煙 */
export const MISSILE_LAUNCH_FX_CONFIG = {
  /** 閃光の直径（1 描画フレーム）と、その後の短い火球の直径 */
  flashSize: 5,
  burstStart: 1.5,
  burstEnd: 4,
  /** 白煙: 発射の瞬間に出す玉の数・直径・寿命・速さ（後ろ向き + 横へ散る） */
  smokePuffs: 10,
  smoke: { life: 1.6, start: 2, end: 8, opacity: 0.6, color: 0xe6e6e6 },
  smokeSpeed: 28,
  smokeSpread: 10,
} as const;

/** 対空砲のフラック（4-4 の 6）: 自機のそばを通る砲弾が空中で小さく黒く破裂する（見た目だけ。当たり判定は 2-6 のまま） */
export const FLAK_CONFIG = {
  /** 砲弾が自機からこの距離の中に入り、離れ始めたら破裂する */
  burstRange: 70,
  /** 破裂の閃光（小さな火球）と黒い玉 */
  flashSize: 3,
  puffs: 3,
  puff: { life: 3, start: 3, end: 14, opacity: 0.75, color: 0x141210 },
  puffSpread: 2.5,
} as const;
