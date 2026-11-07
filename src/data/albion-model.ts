// 10-3a: 白鯨アルビオンのモデル（コードで作る形）の数値: 色・画質ごとの細かさ・動きの大きさ・効果の見た目。
// 形は src/render/albion-model/。三角形と描画の回数は tests/albion-model.test.ts（ネフィルガと比べる）

export interface AlbionDetailSpec {
  /** 胴の管の周の分割 */
  readonly radial: number;
  /** 胴の管の長さ方向の細かさ（点の間を何分割するか） */
  readonly rings: number;
  /** ひれの管の周の分割 */
  readonly finRadial: number;
  /** 楕円体の緯度の分割（経度は 2 倍） */
  readonly rows: number;
}

export const ALBION_MODEL_CONFIG = {
  colors: {
    /** 白い肌・灰色の古傷・腹の淡い青灰・ひれの縁の少し暗い白 */
    skin: 0xeef0ec,
    scar: 0x9a9fa3,
    belly: 0xb9c7d2,
    fin: 0xd9ddda,
    /** 目（淡い青で光る）・噴気孔（暗い灰。潮吹きの予兆で白く光る）・巣の裂け目（赤く脈打つ） */
    eye: 0x8fd8ff,
    blowhole: 0x5a6066,
    nest: 0xff3a2a,
    nestDark: 0x3a1010,
    /** 子分（灰白の小さな翼の怪獣。目は赤） */
    minion: 0xc9cdd1,
    minionWing: 0x8d949b,
    minionEye: 0xff4030,
    /** 効果: 潮吹きの柱・叩きつけの扇・雲 */
    spout: 0xf4fbff,
    slam: 0xffe0c0,
    cloud: 0xc8ccd2,
    /** 10-3c 効果: 水柱・歌の輪（淡い青）・横転の払う範囲 */
    geyser: 0xe6f6ff,
    sonar: 0x8fe0ff,
    roll: 0xffe0c0,
  },
  /** 画質ごと（「高」「中」は high、「低」は low。機体と同じ aircraftDetail） */
  detail: {
    high: { radial: 22, rings: 3, finRadial: 10, rows: 6 },
    low: { radial: 10, rings: 1, finRadial: 6, rows: 3 },
  } satisfies Record<'high' | 'low', AlbionDetailSpec>,
  /** 泳ぎ: 尾の上下（ラジアン。付け根 → 尾びれへ大きく）・胸びれのあおぎ・頭の上下 */
  swim: { tail: [0.05, 0.09, 0.14, 0.2] as readonly number[], fin: 0.22, head: 0.02 },
  /** 尾を持ち上げる角度（叩きつけの予兆。付け根 → 先）と打ち下ろす角度 */
  tailLift: {
    up: [0.14, 0.24, 0.32, 0.4] as readonly number[],
    down: [0.1, 0.18, 0.26, 0.34] as readonly number[],
  },
  /** 光の強さ: 目・噴気孔（予兆で最大）・巣（脈打つ） */
  glow: { eye: 1.6, blowholeMax: 3.2, nest: 2.4, nestPulseHz: 0.7 },
  /** 効果の不透明度: 予兆の柱（薄く）・攻撃の柱・扇・雲 */
  fx: {
    spoutWarn: 0.12,
    spoutActive: 0.5,
    slamWarn: 0.1,
    slamActive: 0.45,
    cloud: 0.38,
    mist: 0.35,
    /** 10-3c: 水柱の予兆（海面の輪と薄い筒）・攻撃・歌の予兆（体の周りの脈打つ輪）・輪・横転の予兆・払い */
    geyserWarn: 0.16,
    geyserActive: 0.55,
    sonarWarn: 0.3,
    sonarActive: 0.42,
    rollWarn: 0.12,
    rollActive: 0.4,
  },
  /** 子分の大きさ（翼の端から端 m）と羽ばたきの速さ（回/秒） */
  minion: { span: 16, flapHz: 2.6 },
} as const;
