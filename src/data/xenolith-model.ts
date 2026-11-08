// 10-5a: UFO ゼノリスのモデル（コードで作る形）の数値: 色・画質ごとの細かさ・光の強さ・バリア・光線・瞬間移動の光の見た目。
// 形は src/render/xenolith-model/。三角形と描画の回数は tests/xenolith-model.test.ts（ほかの怪獣と比べる）

export interface XenolithDetailSpec {
  /** 円盤・ドームの周の分割 */
  readonly segments: number;
  /** 発光体・発生器の球の緯度の分割（経度は 2 倍） */
  readonly rows: number;
  /** 円盤の上の細かな凹凸（放射状の筋・継ぎ目の帯）を足すか */
  readonly greebles: boolean;
}

export const XENOLITH_MODEL_CONFIG = {
  colors: {
    /** 銀の円盤（上は明るく、下は少し暗い）・継ぎ目（暗い灰）・ドームのガラス（青みの暗い色）。10-7d で鏡の金属の映り込みの色に */
    silver: 0xe6ecf4,
    under: 0xa9b2bf,
    seam: 0x4a5058,
    glass: 0x203040,
    /** 光る所: 縁の帯（水色）・発光体（白に近い水色）・砲口（溜めで橙）・発生器（青）・ドーム（薄紫） */
    rim: 0x5ff2ff,
    emitter: 0xd8fbff,
    cannon: 0xff7a3a,
    gen: 0x4a8cff,
    dome: 0xb7a0ff,
    /** バリア（青い殻と波紋）・光線（なぎ払い = 水色・溜め撃ち = 橙）・瞬間移動の光（白い柱と輪） */
    barrier: 0x5aa8ff,
    sweepBeam: 0x7ff6ff,
    chargedBeam: 0xffa060,
    warp: 0xf0f8ff,
    /** 10-5b: 光の弾（外は白に近い水色・芯は白） */
    orb: 0x9ff8ff,
    orbCore: 0xffffff,
  },
  /** 画質ごと（「高」「中」は high、「低」は low。機体と同じ aircraftDetail） */
  detail: {
    high: { segments: 32, rows: 5, greebles: true },
    low: { segments: 14, rows: 3, greebles: false },
  } satisfies Record<'high' | 'low', XenolithDetailSpec>,
  /** 光の強さ: 縁の帯（ふだん / バリアの揺らぎで点滅）・発光体・砲口（溜め撃ちの最大）・発生器・ドーム */
  glow: { rim: 1.6, emitter: 2.4, cannonIdle: 0.2, cannonMax: 4, gen: 1.8, dome: 0.6 },
  /** バリアの殻の不透明度（張っている / 揺らぎ）と波紋の秒数 */
  barrier: { opacity: 0.22, flicker: 0.5, ripple: 0.8 },
  /** 光線の太さ（m。撃つ間の芯の半径の倍率・予兆の線の半径） */
  beam: { fireScale: 1, warnRadius: 1.6 },
  /** 10-5b: 光の弾の粒の大きさ（m。当たりの半径 7m より少し大きく見せる）と、ばらまきの予兆の縁の光の倍率 */
  orb: { radius: 9, warnRim: 2.4 },
  /** 瞬間移動の予兆: 柱の高さと太さ・地上の輪の半径（m） */
  warp: { pillarHeight: 900, pillarRadius: 14, ringRadius: 110 },
} as const;
