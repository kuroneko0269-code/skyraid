// 戦闘の演出（2-1）の数値。描画は src/render/combat-view.ts ほか。本格的な爆発・煙は 4-4
// 距離は m、時間は秒

export const TRACER_CONFIG = {
  /** 曳光弾の棒の長さ（飛んだ距離がこれより短い間は飛んだ距離まで） */
  length: 14,
  /** 太さ。遠くでも細くなりすぎないよう、カメラからの距離 × widthPerMeter を下限にする */
  width: 0.35,
  /** 1080p・画角 60° で約 2.5px 相当 */
  widthPerMeter: 0.0025,
  /** 光の影響を受けない単色（明るい空でも白飛びしないよう加算合成はしない） */
  color: 0xffb21e,
} as const;

export const MUZZLE_FLASH_CONFIG = {
  /** 1 発ごとに光らせる描画フレーム数 */
  frames: 2,
  /** 大きさ（横・縦・前後の半径）。前後に長い楕円体 */
  radius: { x: 0.7, y: 0.7, z: 1.8 },
  /** 大きさのばらつき（±割合） */
  jitter: 0.3,
  color: 0xffd060,
} as const;

export const SPARK_CONFIG = {
  /** 同時に出せる火花の上限（プールの大きさ） */
  max: 320,
  /** 的に当たったとき・地面に当たったときに出す数 */
  perTargetHit: 8,
  perGroundHit: 4,
  speedMin: 20,
  speedMax: 60,
  lifeMin: 0.18,
  lifeMax: 0.35,
  /** 大きさ（一辺）。遠くでも見えるよう、カメラからの距離 × sizePerMeter を下限にする */
  size: 1.2,
  sizePerMeter: 0.004,
  gravity: 9.8,
  color: 0xffa424,
} as const;

export const DEBRIS_CONFIG = {
  /** 同時に出せる破片の上限（的 8 個ぶん） */
  max: 64,
  /** 撃墜 1 回で出す破片の数（この範囲でランダム） */
  countMin: 6,
  countMax: 8,
  /** 飛び散る速さと、上向きに足す速さ */
  speedMin: 12,
  speedMax: 28,
  upBoost: 8,
  /** 破片の寸法（各辺がこの範囲でランダム） */
  sizeMin: 1.2,
  sizeMax: 3.2,
  /** 回転の速さの上限（rad/s） */
  spinMax: 8,
  gravity: 9.8,
  /** 寿命。最後の shrinkFraction の間に小さくなって消える */
  life: 1.5,
  shrinkFraction: 0.35,
} as const;

// ---- 2-2: ミサイル・フレア・起爆。描画は src/render/missile-view.ts / smoke.ts ----

export const MISSILE_VIEW_CONFIG = {
  /** ミサイル本体（細長い箱）の長さ・太さ */
  length: 3.6,
  width: 0.35,
  color: 0xeeeeee,
} as const;

export const SMOKE_CONFIG = {
  /** 同時に出せる煙の玉の上限（ミサイル 8 発 × 寿命 0.9 秒 × 50 個/秒 = 360 に余裕） */
  max: 400,
  /** 燃焼中のミサイルが煙を出す間隔（秒、ゲーム内時間） */
  interval: 1 / 50,
  life: 0.9,
  /** 大きさ（直径）。出た直後 → 寿命の終わりへ広がり、最後の fadeFraction で縮んで消える */
  startSize: 1.4,
  endSize: 6,
  fadeFraction: 0.3,
  color: 0xdadada,
  opacity: 0.55,
} as const;

export const FLARE_VIEW_CONFIG = {
  /** 光点の大きさ。遠くでも見えるよう、カメラからの距離 × sizePerMeter を下限にする */
  size: 1.6,
  sizePerMeter: 0.006,
  /** 大きさのちらつき（±割合） */
  flicker: 0.35,
  color: 0xfff1b8,
} as const;

export const EXPLOSION_CONFIG = {
  /** 閃光（球）の同時に出せる上限・寿命・直径。出た瞬間が最大で縮んで消える */
  flashMax: 16,
  flashLife: 0.35,
  flashSize: 16,
  flashColor: 0xffc45a,
  /** 起爆で出す火花（2-1 の火花のプールを使う）の数と速さ */
  sparks: 24,
  sparkSpeedMin: 40,
  sparkSpeedMax: 110,
} as const;
