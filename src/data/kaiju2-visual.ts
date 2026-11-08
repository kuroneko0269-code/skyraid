// 10-7a: ネフィルガの見た目の試作（質感・光・動き・演出・粒）の数値。判定・時間には使わない（描画と演出だけ）。
// 生成器は src/render/kaiju2-model/（絵は textures.ts・光は material.ts・動きは motion.ts・演出の進行は kaiju2-effects.ts）、
// 演出は src/ui/kaiju2-cinema.ts。画質ごとの切り替えは tier（低 low = 9-6a に近い軽さ・中 medium・高 high）。
// 10-7b: 粒・シェーダー・演出・撮影の部品は共通（src/render/kaiju-look/・src/ui/kaiju-cinema.ts・kaiju-shot.ts）
import type { KaijuCinemaSpec, KaijuDebrisSpec, KaijuStreakSpec, KaijuTier } from './kaiju-look';

export type Kaiju2Tier = KaijuTier;

export interface Kaiju2TierSpec {
  /** 起動時（チャンクを読んだとき）に作る絵の一辺（0 は絵を作らない = 9-6a の頂点の色だけ） */
  readonly textureSize: number;
  /** 角・とさか・背のとげ・翼の爪の作り込み（三角形が増える） */
  readonly extraSpikes: boolean;
  /** 体の周りの雨・翼の風の筋の数（線の粒 InstancedMesh 1 つ） */
  readonly streaks: number;
  /** 電気の弧・稲妻の帯の数（帯 1 つ） */
  readonly arcs: number;
  /** 破片・煙の粒の数（InstancedMesh 1 つ） */
  readonly debris: number;
  /** 凹凸（バンプ）・つやのむら・膜の透けを計算するか */
  readonly surfaceDetail: boolean;
}

export const KAIJU2_VISUAL = {
  tiers: {
    low: {
      textureSize: 0,
      extraSpikes: false,
      streaks: 0,
      arcs: 0,
      debris: 24,
      surfaceDetail: false,
    },
    medium: {
      textureSize: 256,
      extraSpikes: false,
      streaks: 360,
      arcs: 10,
      debris: 64,
      surfaceDetail: true,
    },
    high: {
      textureSize: 512,
      extraSpikes: true,
      streaks: 900,
      arcs: 24,
      debris: 120,
      surfaceDetail: true,
    },
  } satisfies Record<Kaiju2Tier, Kaiju2TierSpec>,
  /** 色（体の色は src/data/kaiju2-model.ts の colors）: 膜の透け（日を透かしたときの色）・縁の光・稲光 */
  colors: {
    translucent: 0xd8607a,
    rim: 0xdfe8ff,
    lightning: 0xd8d0ff,
  },
  /** うろこの絵: 一枚の絵が覆う皮膚の大きさ（m。三方向から貼る）・一辺のうろこの数・凹凸の強さ・傷の数 */
  skin: { tileMeters: 32, scalesPerTile: 10, bump: 0.55, scars: 5, veins: 4 },
  /** 膜の絵: 指の骨の筋の数・細い筋の数・凹凸・傷 */
  membrane: { ribs: 4, veins: 70, bump: 0.6, scars: 7 },
  /** 嵐の力が走る発光の筋（常時・雷球の予兆・段階 3 の強さ。脈打つ速さ Hz） */
  veins: { idle: 0.25, windup: 4.5, storm: 1.4, pulseHz: 1.3 },
  /** 縁の光: 強さ（逆光で最大）・幅の指数・空の色の常時の分 */
  rim: { strength: 0.55, power: 3.5, ambient: 0.3 },
  /** 膜の透け（日を透かす強さ・広がりの指数） */
  translucency: { strength: 0.75, power: 4 },
  /** 呼吸（腹がふくらむ m・回/秒） */
  breath: { amount: 0.9, rate: 0.28 },
  /** 稲光: 嵐（雨 0.5 以上か段階 3）で光る間隔（秒の幅）・光る長さ・体を照らす強さ・稲妻の長さ（m） */
  lightning: { minGap: 2.2, maxGap: 6.5, flashSeconds: 0.32, strength: 2.6, boltLength: 900 },
  /**
   * 動き（描画だけ。判定の姿勢の値に上乗せする）: 翼のしなりの遅れ（ラジアン）・尾の揺れの波・頭が自機を追う最大角（度）と
   * 速さ・被弾の身じろぎ（ラジアン・減衰/秒）・咆哮で首を上げる量
   */
  motion: {
    wingFlex: 0.28,
    wingTwist: 0.12,
    tailWave: 0.07,
    tailBankLag: 0.25,
    lookYawDeg: 40,
    lookPitchDeg: 25,
    lookRate: 2.5,
    flinchKick: 0.16,
    flinchDecay: 6,
    roarNeck: 0.55,
  },
  /** 粒: 体の周りの雨の箱の半分の大きさ（m）・落ちる速さ・風の筋の長さと寿命・破片の速さ・煙の寿命・破片（うろこ・膜）と煙の色 */
  fx: {
    rainBox: 170,
    rainSpeed: 140,
    windLength: 55,
    windLife: 0.9,
    debrisSpeed: 70,
    debrisLife: 3.2,
    smokeLife: 2.4,
    shardColors: [0x2a2c33, 0x3a3264, 0xbdb5a3],
    smokeColor: 0x48464c,
  } satisfies KaijuStreakSpec & KaijuDebrisSpec,
  /** 登場の場面（秒）・寄りのカメラの最初と最後の位置（怪獣の基準点からの前・右・上 m）・咆哮の時刻 */
  cinema: {
    seconds: 3.6,
    from: { forward: 620, right: 160, up: 60 },
    to: { forward: 230, right: -90, up: -95 },
    lookFrom: { forward: -20, right: 0, up: 10 },
    lookTo: { forward: -20, right: 0, up: 10 },
    fovFrom: 40,
    fovTo: 55,
    moveShare: 0.8,
    roarAt: 1.4,
    /** 段階が変わるときの画面の揺れ（強さ）・撃破の揺れ */
    phaseShake: 1.4,
    defeatShake: 1,
  } satisfies KaijuCinemaSpec,
} as const;
