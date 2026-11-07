// 10-3a: 白鯨「アルビオン（Albion）」の数値（仮。10-3b のボットの表で決める）。設計は docs/kaiju-roster.md の「白鯨」。
// 動きは src/entities/albion/（Three.js 非依存）、攻撃と子分と部位は src/ai/albion-*.ts、形は src/render/albion-model/。
// 今は ?dev=albion の確かめる場だけ（起動時には読まない。遅延チャンク albion-runtime）。
// 距離は m、時間は秒、角度は度、速さは m/s。座標はワールド（前 = 方位 heading の向き。src/ai/raid-kit/frame.ts）
import type { MinionSpec, NestSpec } from '../ai/raid-kit/minions';
import type { PartSpec } from '../ai/raid-kit/parts';

/** 部位（PartSet の順。子分の巣の part はこの番号） */
export const ALBION_PARTS = [
  'body',
  'nestFront',
  'nestMid',
  'nestRear',
  'dorsal',
  'tail',
  'head',
] as const;
export type AlbionPart = (typeof ALBION_PARTS)[number];

/**
 * 攻撃: 真上への潮吹き / 尾の叩きつけ / 雲を吐く（10-3a）と、10-3c の人を狙う攻撃（水柱 / 歌（衝撃の輪）/ 横転（胸びれの払い）/
 * 呼び声（子分が囲んで一斉に突っ込む））
 */
export const ALBION_ATTACKS = [
  'spout',
  'slam',
  'cloud',
  'geyser',
  'sonar',
  'roll',
  'call',
] as const;
export type AlbionAttack = (typeof ALBION_ATTACKS)[number];

/** 攻撃の段: 何もしていない / 予兆 / 攻撃 / 硬直 / 段階が変わって吠える */
export const ALBION_ACTIONS = ['idle', 'windup', 'active', 'recover', 'roar'] as const;
export type AlbionAction = (typeof ALBION_ACTIONS)[number];

const part = (i: AlbionPart): number => ALBION_PARTS.indexOf(i);

export const ALBION_CONFIG = {
  /** 大きさ（見た目と判定）: 全長・胴の半径（太さ 116m）・胸びれの端から端・尾びれの端から端 */
  size: { length: 640, radius: 58, finSpan: 330, flukeSpan: 210 },
  /**
   * 進み方: 湾の上空の楕円の周回路（直線 2 本と半円 2 つ）。直線の半分の長さ・半円の半径・速さ（直線 / 半円）。
   * 半円は右回り（右へ傾いて腹を外へ見せる）。1 周 = 4 × 1000 + 2π × 420 ≈ 6,640m ÷ 24 m/s ≈ 4.6 分
   */
  route: { halfLength: 1000, turnRadius: 420, speed: 24, turnSpeed: 20, bankDeg: 24, bankRate: 6 },
  /** 10-3b のレイドの周回路（港湾都市の湾: 岸壁 z 1500 の沖を東西に）。?dev=albion&abroute=bay でも使う */
  bayRoute: { x: 0, z: 3300, axisDeg: 90 },
  /** 確かめる場: 開始位置の前方の距離（周回路の中心）。周回路は自機の向きに直角（横切る姿を見せる） */
  dev: { ahead: 4000, seedSalt: 0x41b10, firstAttackDelay: 10 },
  /** 高さ: 海面からの巡航の高さ・ゆらぎ（1 周に 1 回 ±m）・上がる / 下がる速さの上限 */
  altitude: { cruise: 800, wave: 90, climbRate: 22, sinkRate: 8 },
  /**
   * 地形と海: 体の中心から床（地面・海面・建物の屋根の高い方）までに空ける距離（胴の半径 58 + 尾を下ろす 60 + 余裕）。
   * 頭・中心・尾の下と、周回路の先（秒）の床を見る。押し上げの下限は min
   */
  floor: { clearance: 170, min: 90, lookahead: [6, 12, 20] as readonly number[] },
  /** 戦域（中心からの水平の半径）。周回路は soft の内側に置き、hard で位置を押し戻す（島・港湾の戦域 6000m の内側） */
  arena: { soft: 4300, hard: 5000 },
  /** 段階: 体力の割合の境目（未満で次へ）。段階ごとの速さ・攻撃の間隔・子分の間隔の倍率 */
  phases: {
    at: [0.6, 0.3] as readonly number[],
    speed: [1, 1.1, 1.18] as readonly number[],
    interval: [1, 0.8, 0.65] as readonly number[],
    minionInterval: [1, 0.8, 0.7] as readonly number[],
    /** 段階が変わったら吠えて攻撃しない秒数 */
    roarSeconds: 3,
  },
  /** 攻撃の間隔（秒。段階の倍率を掛ける）。同じ攻撃は 3 回続けない。10-3c: 13 → 12（人を狙う攻撃を足した） */
  attackInterval: 12,
  attacks: {
    /**
     * 真上への潮吹き: 背の噴気孔から真上へ高さ height・半径 radius の柱。予兆は噴気孔が膨らんで白く光り、体が沈む（sink m）。
     * 背の上（柱の中）にいると damage。段階 3 は半径 ×phase3Radius。腹の巣を 3 つとも壊すと間隔 ×nestsGoneInterval
     */
    spout: {
      windup: 2,
      active: 1.5,
      recover: 1.5,
      height: 600,
      radius: 120,
      damage: 40,
      sink: 14,
      phase3Radius: 1.25,
      nestsGoneInterval: 1.3,
      /** 噴気孔の位置（体の中心から。前 +forward・上 +up） */
      forward: 210,
      up: 52,
      /** 背の上（体の軸から水平 range m 以内・上）にいると選びやすくする重み */
      aboveRange: 260,
      aboveWeight: 4,
    },
    /**
     * 尾の叩きつけ: 尾を高く持ち上げて止まる → 尾の後ろの扇（半径 radius・左右 halfAngle 度・上下 band m）に打ち下ろす。
     * 後ろ（尾の付け根から behindRange m 以内・後ろの behindDeg 度以内）にいると選ぶ。背びれを壊すと半径 ×0.7（部位の mul）
     */
    slam: {
      windup: 1.6,
      active: 0.6,
      recover: 2,
      radius: 300,
      halfAngle: 50,
      band: 130,
      damage: 50,
      /** 尾の付け根（扇の要）の位置（体の中心から後ろへ） */
      pivotBack: 230,
      behindRange: 520,
      behindDeg: 60,
    },
    /**
     * 雲を吐く: 予兆は頭の周りに霧が渦を巻く（windup）→ 体の周り radius m に濃い雲が seconds 秒（体に付いて動く）。
     * 雲の中はロックの距離 ×lockRange（10-3b で霧の天候の仕組みと合わせる）。段階 2 から。頭を壊すと出さない
     */
    cloud: {
      windup: 2.5,
      recover: 0.8,
      seconds: 20,
      radius: 800,
      lockRange: 0.6,
      fromPhase: 2,
      /** 雲が出ていない時間がこの秒数を超えたら選びやすくする */
      weight: 1.5,
    },
    /**
     * 10-3c 水柱: 狙う人の進む先（予兆の始めの位置 + 水平の速度 × lead 秒）に 1 本、その周りの斜め 4 か所（進む向きから ±45°・
     * ±135°、半径 ring m）に 4 本。床から height m の柱（半径 radius）。予兆は海面の輪と薄い筒。まっすぐ進む・少し曲がるだけだと
     * 当たり、大きく横へ（90°）曲がると柱の間を抜ける。狙う人が水平に range m 以内のとき選ぶ
     */
    geyser: {
      windup: 1.8,
      active: 1.2,
      recover: 1,
      lead: 2.1,
      ring: 330,
      radius: 70,
      height: 2200,
      damage: 25,
      range: 3500,
      weight: 2,
      /** 柱が伸びきるまでの秒数（その前は伸びた所まで当たる） */
      rise: 0.3,
    },
    /**
     * 10-3c 歌（ソナー）: 体の中心の高さに、水平に広がる衝撃の輪（半径 start → 速さ speed m/s で maxRadius まで）。輪の厚さ
     * ±width/2 m・上下 ±band m。輪が通る所にいると damage。高度を band より大きく変えれば越える / くぐれる。
     * 体の中心から水平 range m 以内・上下 pickBand m 以内にいると選ぶ
     */
    sonar: {
      windup: 2,
      recover: 1,
      start: 90,
      speed: 330,
      maxRadius: 2400,
      width: 60,
      band: 60,
      damage: 25,
      range: 1800,
      pickBand: 260,
      weight: 2.5,
    },
    /**
     * 10-3c 横転（胸びれの払い）: 近くを横切る人の側へ体ごと傾く。予兆はその人の反対へ傾いて胸びれを持ち上げる（windupBankDeg）、
     * 攻撃で人の側へ bankDeg まで横転し、胸びれで払う。払う範囲は体の軸の横 30〜reach m（人の側）・前後 back〜front m・上下 ±band m。
     * 体の軸から横 minSide〜pickSide m・前後 −pickBack〜pickFront m・上下 ±pickBand m にいると選ぶ
     */
    roll: {
      windup: 1.4,
      active: 0.6,
      recover: 1.6,
      windupBankDeg: -22,
      bankDeg: 68,
      bankRate: 130,
      reach: 270,
      front: 260,
      back: -170,
      band: 200,
      damage: 35,
      pickSide: 380,
      /** 背の上（体の軸から横 minSide m より内）にいる人には使わない（背の上は潮吹き） */
      minSide: 70,
      pickFront: 300,
      pickBack: 220,
      pickBand: 260,
      weight: 4,
    },
    /**
     * 10-3c 呼び声: 吠えて（口を開けて）合図すると、狙う人から range m 以内の子分が人の周り（半径 gatherRadius）を囲みに行く
     * （予兆 windup の間、速さ gatherSpeed）。攻撃の始めの hold 秒は止まって構え（当たらない）、それから一斉に人の進む先
     * （会う点を見越す。最大 maxLead 秒）へまっすぐ突っ込む（速さ chargeSpeed・攻撃の終わりまで曲がらない）。突撃の当たりは
     * 半径 ramRadius。構えを見て大きく曲がると外れる。突撃した子分は通り過ぎて散る（攻撃の終わりに消える。撃墜に数えない）。
     * 子分が minMinions 匹以上で選ぶ
     */
    call: {
      windup: 2,
      active: 2.4,
      recover: 1,
      range: 2200,
      gatherRadius: 320,
      gatherSpeed: 240,
      gatherTurnDeg: 200,
      hold: 0.35,
      chargeSpeed: 310,
      maxLead: 2.5,
      ramRadius: 18,
      minMinions: 3,
      weight: 2,
    },
  },
  /**
   * 10-3c: 体（胴・頭・尾・胸びれ・尾びれ・背びれ）への衝突。通り抜けられず、ぶつかると damage・外へ弾く（機首を体の面で
   * 跳ね返し、面から外へ少なくとも minExit（向きの成分）・速さ ×speedKeep・面から pushOut m の所へ）・stun 秒の操作不能・
   * invulnerable 秒は続けて当たらない。margin は機体の大きさ、sampleStep は移動の線分を調べる間隔（m）
   */
  collision: {
    damage: 30,
    margin: 6,
    pushOut: 10,
    speedKeep: 0.7,
    minExit: 0.4,
    stun: 0.5,
    invulnerable: 1.5,
    sampleStep: 4,
  },
  /** 10-3c: 子分を落とすと本体の体力も減る（全体 HP の割合。落とした人の胴へのダメージに数える）。子分係の得 */
  minionReward: { hpRatio: 0.01 },
  /**
   * 体力（ソロ・通常。ヴォルガスの 13,000 の 2.5 倍）。10-3b でボットの表から決める
   */
  hp: 8000,
  /** 子分（腹の巣 3 つから。10-2 の MinionSwarm）。体力は機銃 6 発（12 × 6）・ミサイル 1 発（150） */
  minions: {
    /** プールの大きさ（協力 4 人の上限。同時に飛べる数は ALBION_RAID_CONFIG.minionCap で人数ごとに） */
    cap: 16,
    firstDelay: 8,
    interval: 18,
    perNest: 2,
    hp: 72,
    speed: 180,
    turnDeg: 110,
    life: 50,
    orbit: 20,
    homeOrbit: 420,
    dropSeconds: 1.2,
  } satisfies MinionSpec,
  /** 10-3b: 子分が寄る点の見越し（人の進む先。届くまでの秒数 × scale、最大 maxSeconds 秒） */
  minionLead: { scale: 0.5, maxSeconds: 2 },
  /** 子分の体当たり: 自機から radius m 以内で damage（当たった子分は散って消える。撃墜に数えない） */
  minionRam: { radius: 14, damage: 7 },
  /** 子分が床・海面から空ける高さ */
  minionFloor: 25,
} as const;

/** 腹の巣（前・中・後）。体の中心から（前 +forward・下 −up） */
export const ALBION_NESTS: readonly NestSpec[] = [
  { offset: { forward: 120, right: 0, up: -56 }, part: part('nestFront') },
  { offset: { forward: 0, right: 0, up: -52 }, part: part('nestMid') },
  { offset: { forward: -110, right: 0, up: -40 }, part: part('nestRear') },
];

/** 部位（PartSet）。HP は全体の割合。巣が壊れるとその巣から出ないのは MinionSwarm が巣の part で見る */
export const ALBION_PART_SPECS: readonly PartSpec[] = [
  { id: 'body', hpShare: 1, breakable: false, bodyFactor: 0.8 },
  { id: 'nestFront', hpShare: 0.04, breakable: true },
  { id: 'nestMid', hpShare: 0.04, breakable: true },
  { id: 'nestRear', hpShare: 0.04, breakable: true },
  { id: 'dorsal', hpShare: 0.06, breakable: true, effects: { mul: { slamRadius: 0.7 } } },
  {
    id: 'tail',
    hpShare: 0.07,
    breakable: true,
    effects: { disable: ['slam'], mul: { turnSpeed: 0.75 } },
  },
  { id: 'head', hpShare: 0.08, breakable: true, bodyFactor: 1.5, effects: { disable: ['cloud'] } },
];

/** 撃てる部位の判定の球（体の中心から。前 +forward・右 +right・上 +up）。胴は 3 つの球（頭寄り・中・尾寄り） */
export const ALBION_TARGET_SPHERES: readonly {
  readonly part: AlbionPart;
  readonly forward: number;
  readonly right: number;
  readonly up: number;
  readonly radius: number;
}[] = [
  { part: 'body', forward: 140, right: 0, up: 0, radius: 60 },
  { part: 'body', forward: 0, right: 0, up: 0, radius: 58 },
  { part: 'body', forward: -150, right: 0, up: 0, radius: 46 },
  { part: 'nestFront', forward: 120, right: 0, up: -56, radius: 24 },
  { part: 'nestMid', forward: 0, right: 0, up: -52, radius: 24 },
  { part: 'nestRear', forward: -110, right: 0, up: -40, radius: 24 },
  { part: 'dorsal', forward: -40, right: 0, up: 70, radius: 30 },
  { part: 'tail', forward: -300, right: 0, up: 0, radius: 40 },
  { part: 'head', forward: 260, right: 0, up: 10, radius: 48 },
];

/** 子分の当たりの半径（m） */
export const ALBION_MINION_RADIUS = 9;

/**
 * 10-3c: 体の形（衝突。src/render/albion-model/parts.ts の形と同じ数）。前 forward（頭の先 +321・尾びれの付け根 −300）・右 right・
 * 上 up（m）。胴は前 → 半径の折れ線。胸びれ・尾びれは右側の点の列（左は鏡）で、点ごとに [right, up, forward, 翼弦の半分, 厚さの半分]。
 * 尾（尾びれの付け根から後ろ）と胸びれは泳ぎ・叩きつけの骨の動き（skeleton.ts）を同じ式でなぞる（src/ai/albion-hull.ts）
 */
export const ALBION_HULL = {
  body: [
    [321, 3],
    [318, 15],
    [308, 32],
    [285, 46],
    [250, 54],
    [200, 58],
    [140, 60],
    [60, 58],
    [-10, 54],
    [-70, 46],
    [-130, 36],
    [-190, 25],
    [-240, 17],
    [-282, 10],
    [-300, 5],
  ] as readonly (readonly [number, number])[],
  pectoral: [
    [36, -32, 125, 36, 7],
    [95, -46, 110, 30, 4.5],
    [140, -54, 90, 19, 3],
    [165, -58, 74, 5, 1.6],
  ] as readonly (readonly [number, number, number, number, number])[],
  /** 胸びれの骨の付け根（右・上） */
  pectoralPivot: [40, -32] as readonly [number, number],
  flukes: [
    [4, 0, -286, 22, 5],
    [40, 0, -297, 25, 4],
    [80, 1, -311, 17, 2.6],
    [105, 2, -328, 4, 1.4],
  ] as readonly (readonly [number, number, number, number, number])[],
  /** 背びれ（楕円体: 前・上の中心と半径 右 / 上 / 前） */
  dorsal: { forward: -40, up: 52, rx: 5, ry: 18, rz: 46 },
  /** 尾の骨（付け根から: 後ろへの位置 m）。tail0・tail1・tail2・flukes（skeleton.ts の BONE_DEFS） */
  tailBones: [60, 150, 225, 280] as readonly number[],
} as const;
