// 10-7c: メカ怪獣ゴウライの見た目（質感・光・動き・演出・粒）の数値。判定・時間には使わない（描画と演出だけ）。
// 共通の部品は src/render/kaiju-look/、生成器は src/render/gourai-model/（絵は textures.ts・光は material.ts・
// 動きは motion.ts・演出の進行は gourai-effects.ts）、演出は src/ui/gourai-cinema.ts（共通の kaiju-cinema.ts）。
// 画質ごとの切り替えは tier（低 low = 10-4a に近い軽さ・中 medium・高 high）
import type { KaijuCinemaSpec, KaijuDebrisSpec, KaijuStreakSpec, KaijuTier } from './kaiju-look';

export interface GouraiTierSpec {
  /** 起動時（チャンクを読んだとき）に作る金属の板の絵の一辺（0 は作らない = 10-4a の頂点の色だけ） */
  readonly textureSize: number;
  /** 凹凸（板の継ぎ目・リベット・傷）・つやのむら・継ぎ目から漏れる熱の光を計算するか */
  readonly surfaceDetail: boolean;
  /** 雨と火花の線の粒の数（InstancedMesh 1 つ） */
  readonly streaks: number;
  /** 柔らかい粒（蒸気・煙・水しぶき・熱のゆらぎ）の数（InstancedMesh 1 つ） */
  readonly puffs: number;
  /** 光る粒（爆発の炎・推進器と排気の熱）の数（InstancedMesh 1 つ。加算） */
  readonly fire: number;
  /** 破片と煙の粒の数（InstancedMesh 2 つ） */
  readonly debris: number;
  /** 体の下の大きな影（板 1 枚） */
  readonly shadow: boolean;
  /** 排気口と推進器の熱のゆらぎ・海面の吹きおろしのしぶきを出すか */
  readonly haze: boolean;
}

export const GOURAI_VISUAL = {
  tiers: {
    low: {
      textureSize: 0,
      surfaceDetail: false,
      streaks: 0,
      puffs: 40,
      fire: 32,
      debris: 24,
      shadow: false,
      haze: false,
    },
    medium: {
      textureSize: 256,
      surfaceDetail: true,
      streaks: 160,
      puffs: 180,
      fire: 90,
      debris: 64,
      shadow: true,
      haze: true,
    },
    high: {
      textureSize: 512,
      surfaceDetail: true,
      streaks: 320,
      puffs: 340,
      fire: 160,
      debris: 120,
      shadow: true,
      haze: true,
    },
  } satisfies Record<KaijuTier, GouraiTierSpec>,
  colors: {
    /** 縁の光（嵐）・稲光の照り返し（共通の縁の光の部品） */
    rim: 0xd8e6ff,
    lightning: 0xdde6ff,
    /** 継ぎ目から漏れる熱・放熱の格子・口の中の光・焦げ・錆と汚れ・むき出しの金属（傷） */
    seamHeat: 0xff5a14,
    grill: 0xff7a22,
    mouth: 0xff4418,
    scorch: 0x17130f,
    rust: 0x5e4630,
    bare: 0xb8c0c8,
    /** 目（ふだん・攻撃の予兆で赤へ） */
    eye: 0xffd24a,
    eyeAngry: 0xff3a16,
    /** 粒: 蒸気・黒い煙・水しぶき・熱のゆらぎ・炎（外 / 芯）・火花・推進器の吹き出し */
    steam: 0xeef2f5,
    smoke: 0x2a2724,
    splash: 0xe4f2fa,
    haze: 0xffc89a,
    fire: 0xff7a24,
    fireCore: 0xffe2a0,
    spark: 0xffc860,
    hover: 0x8fc8ff,
  },
  /** 金属の板の絵（三方向から貼る）: 一枚が覆う大きさ（m）・板の並び（大きい板の数）・リベットの間隔（画素の割合）・傷・焦げ・汚れの数・凹凸の強さ */
  plate: {
    tileMeters: 90,
    panels: 3,
    rivetGap: 0.03,
    scratches: 34,
    scorches: 6,
    drips: 46,
    bump: 0.8,
  },
  /** 縁の光（共通の部品。金属なので少し強め） */
  rim: { strength: 0.42, power: 3.4, ambient: 0.3 },
  /**
   * 熱の光: 継ぎ目から漏れる光の強さ（熱 1 のとき・放熱のとき）・脈の速さ（Hz）・排気口の筒が赤く焼ける強さ・放熱の格子の強さ
   */
  heat: { seam: 0.5, seamVent: 2.2, pulseHz: 1.3, nozzle: 0.9, grill: 3.4, mouth: 2.6 },
  /** 目の光（ふだん・予兆・登場で灯る瞬間）・登場の前の暗さ */
  eyes: { idle: 1.6, windup: 3.2, flare: 7, dark: 0.04 },
  /**
   * 動き（描画だけ。判定の姿勢の値に上乗せする）。足した形（頭・あご・腕・爪・背の板・尾）は動かしても体の当たりの箱 + 衝突の
   * 余裕（data/gourai.ts の collision.margin）の中（tests/gourai-visual.test.ts が頂点ごとに確かめる）。
   * 油圧のように「止まって・速く動いて・止まる」（rate: 1 秒に動く最大の割合・accel: 加速・settle: 止まるときの揺れ戻り）
   */
  motion: {
    /** 頭が自機を追う（左右・上下の最大ラジアン）・あごを開く角度 */
    headYaw: 0.38,
    headPitchUp: 0.1,
    headPitchDown: 0.12,
    jawOpen: 0.36,
    /** 腕: 構える（予兆。上腕を前へ上げ armGuard、前腕を前へたたむ armFold。爪が頭の高さの前へ）・下ろす（放熱）・ふだんの小さな動き（ラジアン） */
    armGuard: 0.75,
    armFold: 1.45,
    armVent: -0.1,
    /** 構える / 戻すときに上腕を後ろへ引く角度（爪の通る道を体の当たりの中に収める） */
    armBack: -0.24,
    armIdle: 0.06,
    clawOpen: 0.5,
    /** 背の放熱板が開く角度（ラジアン）と、熱が高いときに少し浮く割合・開くときに後ろの板ほど遅れる秒数 */
    finOpen: 0.6,
    finHeat: 0.16,
    finStagger: 0.18,
    /** 尾の振れ（ラジアン）・回/秒（後半は ×1.6） */
    tailSwing: 0.12,
    tailHz: 0.22,
    /** 浮いた体の重い揺れ（m・ラジアン・回/秒）と被弾の身じろぎ（最大の角度・強さ・減衰） */
    bob: 1.0,
    sway: 0.008,
    swayHz: 0.13,
    flinchMax: 0.012,
    flinchKick: 0.06,
    flinchDecay: 3,
    /** 油圧のサーボ（1 秒の最大の変化・加速・揺れ戻り） */
    rate: 1.6,
    accel: 9,
    settle: 0.12,
  },
  /** 線の粒（共通の部品）: 雨の箱・落ちる速さ・火花の筋の長さと寿命 */
  streaks: {
    rainBox: 240,
    rainSpeed: 160,
    windLength: 9,
    windLife: 0.7,
  } satisfies KaijuStreakSpec,
  /** 破片と煙（共通の部品）: 暗い鉄・明るい灰の板・焼けた橙のかけら */
  debris: {
    debrisSpeed: 70,
    debrisLife: 4,
    smokeLife: 4.5,
    shardColors: [0x4a525c, 0xff8a3a, 0x8a929c],
    smokeColor: 0x34302c,
  } satisfies KaijuDebrisSpec,
  /** 影: 体の長さ・幅（m）・濃さ・消える高さ（床から m） */
  shadow: { length: 260, width: 170, opacity: 0.5, fadeHeight: 600 },
  /** 蒸気: 放熱の板から出す 1 秒の数・大きさ（m）・上がる速さ（m/秒）・寿命 */
  steam: { rate: 34, size: 16, rise: 26, life: 3.2 },
  /** 熱のゆらぎ: 排気口・推進器の後ろ / 下に出す 1 秒の数・大きさ・寿命・濃さ */
  haze: { rate: 22, size: 22, life: 1.4, alpha: 0.07 },
  /** 海面の吹きおろしのしぶき（床から体までがこの高さ以下のとき）: 1 秒の数・大きさ */
  wash: { height: 140, rate: 14, size: 26 },
  /** 爆発: 炎の大きさ（m）・寿命・火花の数（部位の破壊）・撃破の連鎖の間隔（秒）と続く秒数 */
  blast: { size: 34, life: 1.1, sparks: 40, chainEvery: 0.22, chainSeconds: 4.5 },
  /** 撃破: 海に着いたときの水柱の高さ（m）・粒の数・沈む深さ（m。着いてから消えるまで） */
  splash: { height: 180, count: 70, sink: 70 },
  /** 登場: 湾の中から浮かび上がる深さ（m。体の中心が水面の下へ）・浮かぶのにかける割合（場面の長さに対して）・水が落ちる粒の数 */
  rise: { depth: 130, share: 0.62, cascade: 90 },
  /** 登場の場面（水面の近くから見上げる。浮かび上がって目が光る） */
  cinema: {
    seconds: 4.4,
    from: { forward: 420, right: 210, up: -60 },
    to: { forward: 250, right: 90, up: -45 },
    lookFrom: { forward: 0, right: 0, up: -60 },
    lookTo: { forward: 10, right: 0, up: -5 },
    fovFrom: 42,
    fovTo: 54,
    moveShare: 0.9,
    roarAt: 3.0,
    phaseShake: 1.1,
    defeatShake: 1.2,
  } satisfies KaijuCinemaSpec,
  /** 撃破で海に着いたときの揺れ */
  splashShake: 1.3,
} as const;
