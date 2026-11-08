// 10-7e: ヴォルガスの見た目（質感・光・動き・演出・粒）の数値。判定・時間には使わない（描画と演出だけ）。
// 共通の部品は src/render/kaiju-look/、生成器は src/render/kaiju-model/（絵は textures.ts・皮膚は material.ts・動きは motion.ts・
// 粒と演出の進行は vorgas-effects.ts）、演出は src/ui/vorgas-cinema.ts（共通の kaiju-cinema.ts）。
// 画質ごとの切り替えは tier（低 low = 6-1b に近い軽さ・中 medium・高 high）
import type { KaijuCinemaSpec, KaijuDebrisSpec, KaijuTier } from './kaiju-look';

export interface VorgasTierSpec {
  /** 起動時（チャンクを読んだとき）に作る絵の一辺（0 は作らない = 6-1b の式の鱗だけ） */
  readonly textureSize: number;
  /** 背と尾の骨板（三角形が増える） */
  readonly scutes: boolean;
  /** 柔らかい粒（土煙・水しぶき・上陸の滝・煙）の数（InstancedMesh 1 つ） */
  readonly puffs: number;
  /** 光る粒（熱線の溜めの吸い込み・口の光・亀裂の火の粉）の数（InstancedMesh 1 つ） */
  readonly embers: number;
  /** 破片と煙の粒の数（InstancedMesh 2 つ） */
  readonly debris: number;
}

export const VORGAS_VISUAL = {
  tiers: {
    low: { textureSize: 0, scutes: false, puffs: 48, embers: 24, debris: 24 },
    medium: { textureSize: 256, scutes: true, puffs: 160, embers: 80, debris: 64 },
    high: { textureSize: 512, scutes: true, puffs: 300, embers: 160, debris: 110 },
  } satisfies Record<KaijuTier, VorgasTierSpec>,
  colors: {
    /** 縁の光（嵐のときの色。ヴォルガスは使わない）・稲光の照り返し（同） */
    rim: 0xffd2a8,
    lightning: 0xd8d0ff,
    /** 古傷（白っぽい桃）・焦げ・熱線の溜めで白熱する亀裂の芯（黄白）・喉の光 */
    scar: 0x9a8a78,
    hot: 0xffd27a,
    throat: 0xff7a1c,
    /** 熱線の溜めの吸い込む粒（結晶の青）・火の粉（橙） */
    charge: 0x7cc4ff,
    ember: 0xff7a26,
    /** 土煙（陸）・水しぶき（海） */
    dust: 0x8a7d68,
    spray: 0xe6eef2,
  },
  /** 皮膚の絵: 一枚の絵が覆う皮膚の大きさ（m。三方向から貼る）・一辺の鱗の板の数・凹凸の強さ・古傷の数 */
  skin: { tileMeters: 40, platesPerTile: 9, bump: 0.75, scars: 6 },
  /** 亀裂: 溝の深さ（凹凸）・まわりのにじむ熱の幅と強さ・熱線の溜めで明るくなる倍率と尾から頭へ流れる脈の速さ */
  crack: { groove: 0.6, halo: 0.22, haloStrength: 0.35, heatBoost: 2.6, waveSpeed: 1.6 },
  /** 縁の光: 強さ（逆光で最大）・幅の指数・空の色の常時の分 */
  rim: { strength: 0.42, power: 3.2, ambient: 0.25 },
  /** 濡れ（上陸した直後。暗くつやつや）が乾くまでの秒数 */
  wet: { seconds: 28, darken: 0.72, gloss: 0.32 },
  /** 呼吸（腹がふくらむ m・回/秒） */
  breath: { amount: 0.8, rate: 0.22 },
  /**
   * 動き（描画だけ。判定の姿勢の値に上乗せする。動いていない形との差は tolerance m の中。ヴォルガスの体は通り抜けられ、
   * 頭の当たりの球は半径 20m なので、衝突の余裕と同じ 6m まで）: 足が着いたときの体の沈み（m）と
   * 胸のうなずき（ラジアン）・頭が自機を追う最大角（ラジアン）と速さ・被弾の身じろぎ（ラジアン・減衰/秒）
   */
  motion: {
    stompDrop: 0.9,
    stompNod: 0.01,
    lookYaw: 0.12,
    lookPitch: 0.06,
    lookRate: 1.6,
    flinchKick: 0.01,
    flinchDecay: 5,
    tolerance: 6,
  },
  /**
   * 崩れ落ちる（倒した後。描画だけ）: 膝が折れるまで・横へ倒れ込んで地面に着くまでの秒数（倒してから）・横へ倒れる角度・前へ傾く角度
   * （ラジアン）・体を持ち上げる m（下になる腕と脚が地面に埋まりすぎない）
   */
  collapse: { kneel: 1.1, fall: 2.4, topple: 1.1, pitch: 0.15, lift: 18 },
  /** 足音の揺れ（近いほど強い。この距離 m で 0）・膝をつく / 倒れた揺れ */
  shake: { step: 0.32, stepRange: 1100, kneel: 0.9, fall: 1.6 },
  /** 粒: 破片の速さ・寿命・煙の寿命・破片（鱗・結晶・岩）と煙の色 */
  fx: {
    debrisSpeed: 60,
    debrisLife: 3.4,
    smokeLife: 2.8,
    shardColors: [0x17211a, 0x2b3d2b, 0x5fa8ff, 0x5a5249],
    smokeColor: 0x4a443e,
  } satisfies KaijuDebrisSpec,
  /** 熱線の見た目: 芯の白さ（向きの指数）・流れる筋の速さ・太さの揺らぎ */
  beam: { corePower: 2.6, flow: 9, flicker: 0.12 },
  /** 登場の場面（秒）・寄りのカメラの最初と最後の位置（怪獣の基準点 = 足元の床からの前・右・上 m）・咆哮の時刻 */
  cinema: {
    seconds: 5.4,
    from: { forward: 900, right: 320, up: 14 },
    to: { forward: 330, right: 140, up: 6 },
    lookFrom: { forward: 0, right: 0, up: 30 },
    lookTo: { forward: 0, right: 0, up: 85 },
    fovFrom: 38,
    fovTo: 56,
    moveShare: 0.85,
    roarAt: 4.0,
    /** 段階が変わるときの画面の揺れ（強さ）・撃破の揺れ */
    phaseShake: 1.2,
    defeatShake: 1,
  } satisfies KaijuCinemaSpec,
} as const;
