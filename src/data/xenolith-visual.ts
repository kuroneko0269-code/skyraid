// 10-7d: UFO ゼノリスの見た目（質感・光・動き・演出・粒）の数値。判定・時間には使わない（描画と演出だけ）。
// 共通の部品は src/render/kaiju-look/、生成器は src/render/xenolith-model/（鏡の金属と虹色の板・光の筋は material.ts・
// 効果は fx.ts / holo.ts・粒と演出の進行は xenolith-effects.ts）、演出は src/ui/xenolith-cinema.ts（共通の kaiju-cinema.ts）。
// 画質ごとの切り替えは tier（低 low = 10-5a に近い軽さ・中 medium・高 high）
import type { KaijuCinemaSpec, KaijuDebrisSpec, KaijuTier } from './kaiju-look';

export interface XenolithTierSpec {
  /** 虹色の板・表面を走る光の筋・回る光の輪・下の浮かぶ模様・六角のバリアを計算するか（低は鏡の金属と光だけ） */
  readonly surfaceDetail: boolean;
  /** きらめく粒・瞬間移動の光の粒・光線の口の光（足し合わせて光る粒。InstancedMesh 1 つ） */
  readonly glints: number;
  /** 柔らかい粒（撃破の水しぶき・煙）の数（InstancedMesh 1 つ） */
  readonly puffs: number;
  /** 破片と煙の粒の数（InstancedMesh 2 つ） */
  readonly debris: number;
  /** 急加速の光の尾（帯 1 枚）・光の弾のきらめき（板 1 つ）・海の上の影（板 1 枚）・電気の弧（撃破） */
  readonly trail: boolean;
  readonly orbHalo: boolean;
  readonly shadow: boolean;
  readonly arcs: number;
}

export const XENOLITH_VISUAL = {
  tiers: {
    low: {
      surfaceDetail: false,
      glints: 40,
      puffs: 30,
      debris: 24,
      trail: false,
      orbHalo: false,
      shadow: false,
      arcs: 0,
    },
    medium: {
      surfaceDetail: true,
      glints: 120,
      puffs: 80,
      debris: 48,
      trail: true,
      orbHalo: true,
      shadow: true,
      arcs: 4,
    },
    high: {
      surfaceDetail: true,
      glints: 220,
      puffs: 140,
      debris: 96,
      trail: true,
      orbHalo: true,
      shadow: true,
      arcs: 8,
    },
  } satisfies Record<KaijuTier, XenolithTierSpec>,
  colors: {
    /** 映り込みの海の色（空の光が無いとき） */
    sea: 0x0d2a3c,
    /** 表面を走る光の筋・回る光の輪（水色）・下の浮かぶ模様（青紫）・ドームの中の光る核（白に近い紫） */
    trace: 0x6ff6ff,
    halo: 0x8ff0ff,
    glyph: 0x8a7bff,
    core: 0xf2e6ff,
    coreEdge: 0x9b6bff,
    /** 結晶（ドームのまわり）の色 */
    crystal: 0xd4f4ff,
    /** バリアの六角（線・面）と走査の線 */
    hex: 0x6fc4ff,
    hexFill: 0x2a64ff,
    /** 光の尾（前 → 後ろ）・急停止の光の波・きらめく粒 */
    trailHead: 0x9ff8ff,
    trailTail: 0x7a5cff,
    wave: 0xb8f6ff,
    glint: 0xffffff,
    /** 瞬間移動の光（ほどける / 組み上がる縁の光と粒）・ゆがみの波 */
    warpEdge: 0xaef4ff,
    /** 撃破: 電気の弧・火花・煙・水しぶき */
    arc: 0xbfe4ff,
    smoke: 0x2c2f36,
    splash: 0xe4f2fa,
  },
  /**
   * 鏡の金属: 粗さ（滑らかな所・板の継ぎ目）・空の映り込みの強さ（「低」も）・虹色の板の強さ（見る角度で色が変わる）・
   * 板の分け方（周の数・輪の境目の半径 m）
   */
  chrome: {
    roughness: 0.14,
    seamRoughness: 0.42,
    reflect: 0.85,
    iridescence: 0.55,
    sectors: 16,
    bands: [30, 44, 58, 72] as const,
  },
  /**
   * 光: 表面を走る光の筋（強さ・外へ走る速さ m/秒・間隔 m）・回る光の輪（強さ・回/秒）・下の浮かぶ模様（強さ・回/秒）・
   * ドームの中の核（強さ・脈 Hz・大きさ m）
   */
  lights: {
    trace: 2.0,
    traceSpeed: 46,
    traceGap: 34,
    halo: 0.9,
    haloHz: 0.35,
    glyph: 1.4,
    glyphHz: -0.12,
    core: 1.5,
    coreHz: 0.8,
    coreSize: 7,
  },
  /** 縁の光（共通の部品。鏡なので弱め） */
  rim: { strength: 0.22, power: 3, ambient: 0.25 },
  /**
   * 動き（描画だけ）: 浮かぶ上下の揺れ（m・回/秒）・急停止で前へつんのめる傾き（ラジアン・減衰）・浮かぶ光の輪の回る速さ
   * （ラジアン/秒）。足した形は動かしても体の当たり（円盤の楕円体とドーム + 衝突の余裕）の中（tests/xenolith-visual.test.ts）
   */
  motion: { bob: 0.7, bobHz: 0.4, stopTilt: 0.015, stopDecay: 2.5, haloSpin: 1.4 },
  /** 光の尾: 残す点の数・残す秒数・出す速さ（m/秒。これより速いと出る）・帯の濃さ */
  trail: { points: 28, seconds: 0.7, minSpeed: 190, alpha: 0.9 },
  /** 光の波（急停止・瞬間移動の前後・登場）: 広がる大きさ（m）・秒数・濃さ */
  wave: { stop: 150, warp: 230, seconds: 0.7, alpha: 0.75 },
  /**
   * きらめく粒: 1 秒の数（ふだん・急加速）・大きさ（m）・寿命。瞬間移動で光がほどける / 組み上がる粒の数・ほどける割合の最大
   * （体を全部消さない。見失わないように）・組み上がる秒数
   */
  glints: {
    rate: 10,
    dashRate: 40,
    size: 5,
    life: 0.5,
    warpBurst: 60,
    dissolveMax: 0.55,
    assemble: 0.6,
  },
  /**
   * 遠くの目印: 遠いほど大きく光る星（画面の大きさをほぼそろえる）。出始める距離・一番濃い距離（m）・画面の大きさ（距離の割合）・濃さ。
   * 予兆が見えなくならない濃さ（光線の予兆の線より暗い）
   */
  beacon: { near: 650, far: 1800, scale: 0.035, alpha: 0.5 },
  /** 光線: 外側の光の太さ（芯の倍率）・芯の白さ・予兆の線が流れる速さ（m/秒）・口の光の大きさ（m） */
  beam: { glowScale: 3.2, core: 0.7, flow: 900, flare: 40 },
  /** 光の弾のきらめき: 大きさ（m。弾の当たり 7m の倍率）・瞬く速さ（Hz） */
  orbHalo: { scale: 1.8, twinkleHz: 9 },
  /** バリアの六角のホログラム: 六角の大きさ（周の数）・線の太さ・走査の線の速さ（回/秒）・揺らぎで六角が消える割合 */
  hex: { cells: 26, line: 0.08, scanHz: 0.5, flickerDrop: 0.7 },
  /** 破片と煙（共通の部品）: 鏡の板のかけら・光る水色のかけら・暗い灰 */
  debris: {
    debrisSpeed: 80,
    debrisLife: 3.5,
    smokeLife: 3.5,
    shardColors: [0xdfe6ee, 0x7ff6ff, 0x5a6270],
    smokeColor: 0x34383f,
  } satisfies KaijuDebrisSpec,
  /** 影: 体の長さ・幅（m）・濃さ・消える高さ（床から m） */
  shadow: { length: 180, width: 180, opacity: 0.4, fadeHeight: 700 },
  /** 撃破: 電気の弧の数・水しぶきの柱の高さ（m）・粒の数 */
  splash: { height: 120, count: 50 },
  /** 登場: 空から光の柱の中を降りてくる高さ（m。体の中心の上）・降り切る割合（場面の長さに対して）・柱の太さ（m） */
  descend: { height: 700, share: 0.7, pillar: 42 },
  /** 登場の場面（下から見上げる。光の柱で降りてきて、組み上がる） */
  cinema: {
    seconds: 4.2,
    from: { forward: 520, right: 240, up: -170 },
    to: { forward: 380, right: 170, up: -120 },
    lookFrom: { forward: 0, right: 0, up: 380 },
    lookTo: { forward: 0, right: 0, up: 10 },
    fovFrom: 60,
    fovTo: 52,
    moveShare: 0.85,
    roarAt: 3.1,
    phaseShake: 0.8,
    defeatShake: 1.0,
  } satisfies KaijuCinemaSpec,
  /** 撃破で海に着いたときの揺れ */
  splashShake: 0.9,
} as const;
