// 10-7b: 白鯨アルビオンの見た目（質感・光・動き・演出・粒）の数値。判定・時間には使わない（描画と演出だけ）。
// 共通の部品は src/render/kaiju-look/、生成器は src/render/albion-model/（絵は textures.ts・光は material.ts・
// 動きは motion.ts・演出の進行は albion-effects.ts）、演出は src/ui/albion-runtime.ts の登場の場面（共通の kaiju-cinema.ts）。
// 画質ごとの切り替えは tier（低 low = 10-3c に近い軽さ・中 medium・高 high）
import type { KaijuCinemaSpec, KaijuDebrisSpec, KaijuStreakSpec, KaijuTier } from './kaiju-look';

export interface AlbionTierSpec {
  /** 起動時（チャンクを読んだとき）に作る皮の絵の一辺（0 は作らない = 10-3a の頂点の色だけ） */
  readonly textureSize: number;
  /** 凹凸（しわ・フジツボ・腹のうね）・つやのむら・白い体の照り（日を透かす）を計算するか */
  readonly surfaceDetail: boolean;
  /** ひれの水の筋・雨の線の粒の数（InstancedMesh 1 つ） */
  readonly streaks: number;
  /** 柔らかい粒（体に沿って流れる雲・潮吹きのしぶきと霧・巣の赤い霧・水柱）の数（InstancedMesh 1 つ） */
  readonly puffs: number;
  /** 破片と煙の粒の数（InstancedMesh 2 つ） */
  readonly debris: number;
  /** 大きさを比べる鳥の数（InstancedMesh 1 つ。0 は出さない） */
  readonly birds: number;
  /** 体の下の大きな影（板 1 枚） */
  readonly shadow: boolean;
  /** 体に沿って流れる雲を出す間隔（秒。0 は出さない） */
  readonly wispEvery: number;
}

export const ALBION_VISUAL = {
  tiers: {
    low: {
      textureSize: 0,
      surfaceDetail: false,
      streaks: 0,
      puffs: 48,
      debris: 24,
      birds: 0,
      shadow: false,
      wispEvery: 0,
    },
    medium: {
      textureSize: 256,
      surfaceDetail: true,
      streaks: 240,
      puffs: 200,
      debris: 64,
      birds: 28,
      shadow: true,
      wispEvery: 0.45,
    },
    high: {
      textureSize: 512,
      surfaceDetail: true,
      streaks: 500,
      puffs: 420,
      debris: 120,
      birds: 48,
      shadow: true,
      wispEvery: 0.22,
    },
  } satisfies Record<KaijuTier, AlbionTierSpec>,
  colors: {
    /** 縁の光（嵐）・稲光の照り返し（共通の縁の光の部品） */
    rim: 0xe8f4ff,
    lightning: 0xdde6ff,
    /** 白い体を透かした日の色（あたたかい）・フジツボ・古傷の色・腹の巣のまわりの血の筋 */
    subsurface: 0xffd2b0,
    barnacle: 0x8c8a7c,
    scarPink: 0xc9a9a4,
    vein: 0xff2a18,
    /** 口の中・あご */
    mouth: 0x40181c,
    /** 雲・霧・しぶき・水柱・巣の赤い霧・鳥 */
    cloud: 0xf2f5f8,
    spray: 0xf6fbff,
    splash: 0xeaf6ff,
    nestMist: 0xa8201a,
    bird: 0x2e3238,
  },
  /** 皮の絵（三方向から貼る）: 一枚が覆う大きさ（m）・しわの数・フジツボの群れの数・古傷の数・凹凸の強さ */
  skin: {
    tileMeters: 90,
    wrinkles: 16,
    barnacleClusters: 6,
    barnaclesPerCluster: 40,
    scars: 5,
    bump: 0.7,
  },
  /** 腹のうね（胸びれの前から巣の前まで。本数・深さ） */
  pleats: { count: 34, depth: 0.7 },
  /** 縁の光（共通の部品。白い体なので弱め） */
  rim: { strength: 0.32, power: 3.2, ambient: 0.35 },
  /** 白い体に日が当たる照り（日の側のあたたかい透け・強さ）と、腹の巣のまわりの赤い脈（強さ・脈の速さ Hz・広がり m） */
  subsurface: { strength: 0.22, wrap: 0.45 },
  nestVeins: { strength: 0.7, pulseHz: 0.7, reach: 70 },
  /** 呼吸（胴がふくらむ m・回/秒）。大きな体はゆっくり深く */
  breath: { amount: 0.9, rate: 0.12 },
  /**
   * 動き（描画だけ。判定の姿勢の値に上乗せする）。尾びれの打ちと後ろ半分のうねりは判定の形と同じ式（albion-model.ts の swim）なので
   * 足さない。足す動きは当たりの形からのずれを tolerance（m。機体の大きさ 6m の半分）の中に収める: 体全体の上下の揺れ（m）と
   * 機首の上下（ラジアン）・横の揺れ・胸びれの舵のひねり（最大。舵いっぱいになる傾き）・被弾の身じろぎ（最大の角度・強さ・減衰）・
   * 口を開ける角度（下あごは当たりの形の中に収まる）
   */
  motion: {
    tolerance: 3,
    bob: 0.8,
    bobPitch: 0.0015,
    roll: 0.002,
    finTwist: 0.026,
    steerBank: 0.35,
    flinchMax: 0.0015,
    flinchKick: 0.02,
    flinchDecay: 2.2,
    jawOpen: 0.15,
  },
  /** 腹の巣の光の強さ（10-3a の 2.4 より深い赤に。脈打つ） */
  nestGlow: 1.1,
  /** 目の光（常時・吠える・予兆のとき） */
  eyes: { idle: 1, roar: 3.2, windup: 1.8 },
  /** 線の粒（共通の部品）: 雨の箱・落ちる速さ・水の筋の長さと寿命 */
  streaks: {
    rainBox: 360,
    rainSpeed: 160,
    windLength: 70,
    windLife: 1.6,
  } satisfies KaijuStreakSpec,
  /** 破片と煙（共通の部品）: 白い皮・灰色の肉・暗い血のかけら */
  debris: {
    debrisSpeed: 55,
    debrisLife: 4.5,
    smokeLife: 3.5,
    shardColors: [0xe6e8e4, 0x7a2a26, 0xa8aaa6],
    smokeColor: 0x8a8e94,
  } satisfies KaijuDebrisSpec,
  /** 影: 体の長さ・幅（m）・濃さ・消える高さ（床から m） */
  shadow: { length: 720, width: 260, opacity: 0.55, fadeHeight: 2400 },
  /** 鳥: 翼の端から端（m）・群れの広がり（m）・群れの中心（体の右・上・前 m） */
  birds: { span: 4, spread: 140, offset: { right: 150, up: -40, forward: -120 } },
  /** 体に沿って流れる雲: 大きさ（m）・寿命（秒）・濃さ・体からの離れ（半径の倍） */
  wisps: { size: 70, life: 14, alpha: 0.32, standoff: 1.12 },
  /** 潮吹き: しぶきの粒の速さ（m/秒）・霧の大きさ（m）・1 秒に出す数 */
  spout: { speed: 170, mist: 40, rate: 70 },
  /** 撃破の水柱: 高さ（m）・粒の数・広がり（m） */
  splash: { height: 560, count: 110, spread: 240 },
  /** 登場の場面（下から見上げる。雲の中から頭が出てくる） */
  cinema: {
    seconds: 4.2,
    from: { forward: 760, right: 260, up: -120 },
    to: { forward: 330, right: -170, up: -260 },
    lookFrom: { forward: 330, right: 0, up: -10 },
    lookTo: { forward: 120, right: 0, up: 20 },
    fovFrom: 38,
    fovTo: 58,
    moveShare: 0.85,
    roarAt: 2.2,
    phaseShake: 1.2,
    defeatShake: 1.1,
  } satisfies KaijuCinemaSpec,
  /** 撃破で海へ落ちたときの揺れ */
  splashShake: 1.6,
} as const;
