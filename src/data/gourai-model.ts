// 10-4a: メカ怪獣ゴウライのモデル（コードで作る形）の数値: 色・画質ごとの細かさ・動きの大きさ・弾と効果の見た目。
// 形は src/render/gourai-model/。三角形と描画の回数は tests/gourai-model.test.ts（ネフィルガ・アルビオンと比べる）

export interface GouraiDetailSpec {
  /** 円柱（砲身・排気口・推進器・ミサイルの筒）の側面の数 */
  readonly sides: number;
  /** 核の楕円体の緯度の分割（経度は 2 倍） */
  readonly rows: number;
  /** 装甲の板の細かな凹凸（継ぎ目の帯・放熱板のすじ）を足すか */
  readonly greebles: boolean;
}

export const GOURAI_MODEL_CONFIG = {
  colors: {
    /** 胴（暗い鉄色）・装甲の板（明るい灰）・継ぎ目と影（黒に近い）・警告の帯（黄土） */
    hull: 0x4a525c,
    armor: 0x76808b,
    dark: 0x22262c,
    accent: 0xc79a2e,
    /** 砲台（青みの灰）・砲身（黒） */
    turret: 0x5c6670,
    barrel: 0x1b1e22,
    /** 光る所: 核（水色）・排気口（橙）・ミサイルのハッチ（赤）・機銃（赤）・推進器（青白）・目の帯（黄） */
    core: 0x46e4ff,
    exhaust: 0xff8a2e,
    hatch: 0xff2a24,
    gun: 0xff3a2a,
    hover: 0x9fd2ff,
    visor: 0xffcc3a,
    /** 弾: 機銃の曳光（橙黄）・ミサイル（白い胴と赤い炎） */
    tracer: 0xffc85a,
    missile: 0xfff0e0,
    /** 回転掃射の危ない高さの輪 */
    sweepWarn: 0xff4a3a,
  },
  /** 画質ごと（「高」「中」は high、「低」は low。機体と同じ aircraftDetail） */
  detail: {
    high: { sides: 10, rows: 6, greebles: true },
    low: { sides: 5, rows: 3, greebles: false },
  } satisfies Record<'high' | 'low', GouraiDetailSpec>,
  /** 光の強さ: 核（閉じている / 開いている）・排気口（熱 0 → 放熱）・ハッチの点滅（回/秒）・推進器・目の帯 */
  glow: {
    coreClosed: 0.25,
    coreOpen: 3.2,
    exhaustMin: 0.5,
    exhaustMax: 3.6,
    hatchHz: 4,
    hover: 1.4,
    visor: 1.6,
  },
  /** 装甲が開く角度（ラジアン。左右の板が横の蝶番で外へ）・ハッチが開く角度・砲台の向きを変える速さ（ラジアン/秒） */
  motion: { armorOpen: 0.95, hatchOpen: 1.1, turretTurn: 2.5 },
  /** 装甲を捨てる: 板が外へ飛ぶ距離（m）・回る角度（ラジアン） */
  purge: { fly: 90, spin: 2.2 },
  /** 弾の見た目: 機銃の曳光の長さと太さ（m）・ミサイルの長さと太さ（m） */
  shot: { tracerLength: 16, tracerWidth: 1.6, missileLength: 9, missileWidth: 1.8 },
  /** 回転掃射の輪の不透明度（予兆 / 攻撃） */
  fx: { sweepWarn: 0.2, sweepActive: 0.3 },
} as const;
