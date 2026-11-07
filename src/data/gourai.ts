// 10-4a: メカ怪獣「ゴウライ（Gourai）」の数値（仮。10-4b のボットの表で決める）。設計は docs/kaiju-roster.md の「メカ怪獣」。
// 動きは src/entities/gourai/（Three.js 非依存）、攻撃・熱・部位は src/ai/gourai-*.ts、形は src/render/gourai-model/。
// 今は ?dev=gourai の確かめる場だけ（起動時には読まない。遅延チャンク gourai-runtime）。
// 距離は m、時間は秒、角度は度、速さは m/s。座標はワールド（前 = 体の向き heading。src/ai/raid-kit/frame.ts）
import type { ShotKind, TurretSpec } from '../ai/raid-kit/barrage';
import type { PartSpec } from '../ai/raid-kit/parts';
import type { ShotSpec } from '../ai/raid-kit/shots';

/** 部位（PartSet の順。砲台の part はこの番号） */
export const GOURAI_PARTS = [
  'hull',
  'armor',
  'core',
  'gunL',
  'gunR',
  'podL',
  'podR',
  'hipL',
  'hipR',
  'exhaustL',
  'exhaustR',
] as const;
export type GouraiPart = (typeof GOURAI_PARTS)[number];

/** 大きな攻撃 2 種（弾幕はいつも）: ミサイルの一斉発射 / 回転掃射 */
export const GOURAI_ATTACKS = ['volley', 'sweep'] as const;
export type GouraiAttack = (typeof GOURAI_ATTACKS)[number];

/**
 * 段: 何もしていない / 予兆 / 攻撃 / 硬直 / 放熱（熱が 100 で装甲が開く）/ 装甲を捨てる（後半へ）
 */
export const GOURAI_ACTIONS = ['idle', 'windup', 'active', 'recover', 'vent', 'purge'] as const;
export type GouraiAction = (typeof GOURAI_ACTIONS)[number];

const part = (i: GouraiPart): number => GOURAI_PARTS.indexOf(i);

/**
 * 10-4b: 機銃の見越し（人の進む先へ寄せる割合）と弾の速さ。まっすぐ飛ぶ人に当たり、曲がり続ける人には外れる
 * （10-4a は今の位置を狙っていて、動いている人にはほとんど当たらなかった）
 */
const GUN_LEAD = { lead: 1, shotSpeed: 600 } as const;

/** 部位の HP（全体 HP の割合）と効き目。前の装甲は ×0.2、核 ×2.0、排気口 ×1.6（壊すと熱 ×1.5） */
export const GOURAI_PART_SPECS: readonly PartSpec[] = [
  { id: 'hull', hpShare: 1, breakable: false },
  { id: 'armor', hpShare: 1, breakable: false, bodyFactor: 0.2 },
  { id: 'core', hpShare: 0.12, breakable: true, bodyFactor: 2 },
  { id: 'gunL', hpShare: 0.035, breakable: true },
  { id: 'gunR', hpShare: 0.035, breakable: true },
  { id: 'podL', hpShare: 0.045, breakable: true },
  { id: 'podR', hpShare: 0.045, breakable: true },
  { id: 'hipL', hpShare: 0.035, breakable: true },
  { id: 'hipR', hpShare: 0.035, breakable: true },
  {
    id: 'exhaustL',
    hpShare: 0.06,
    breakable: true,
    bodyFactor: 1.6,
    effects: { mul: { heat: 1.5 } },
  },
  {
    id: 'exhaustR',
    hpShare: 0.06,
    breakable: true,
    bodyFactor: 1.6,
    effects: { mul: { heat: 1.5 } },
  },
];

/**
 * 砲台 6 つ（Barrage の順）。撃てる向きは体の向きからの方位（frame.ts の決まりで左が正）と仰角。前は肩の機銃 2 つが重なって厚く、横は肩 1 + 腰 1、
 * 斜め後ろは腰だけ、真後ろはミサイルだけ（遅い・フレアで外れる）。後ろの下（ミサイルの仰角 −10° より下）は死角
 */
export const GOURAI_TURRETS: readonly TurretSpec[] = [
  // 肩の機銃（左・右）: 前と横を広く（左の砲台は左 120°〜右 50° / 右の砲台は左 50°〜右 120°）
  {
    offset: { forward: 22, right: -40, up: 30 },
    part: part('gunL'),
    weapon: 'gun',
    ...GUN_LEAD,
    yawCenterDeg: 35,
    yawHalfDeg: 85,
    pitchMinDeg: -30,
    pitchMaxDeg: 60,
    interval: 2,
    firstDelay: 1,
    burst: 5,
    burstGap: 0.09,
    spreadDeg: 2,
    range: 1500,
  },
  {
    offset: { forward: 22, right: 40, up: 30 },
    part: part('gunR'),
    weapon: 'gun',
    ...GUN_LEAD,
    yawCenterDeg: -35,
    yawHalfDeg: 85,
    pitchMinDeg: -30,
    pitchMaxDeg: 60,
    interval: 2,
    firstDelay: 2,
    burst: 5,
    burstGap: 0.09,
    spreadDeg: 2,
    range: 1500,
  },
  // 背のミサイル（左・右）: 後ろと横の上へ（左右それぞれ 55°〜180°・仰角 −10°〜85°）。10 秒ごとに 1 発ずつ交互に（10-4b: 8 → 10 秒）
  {
    offset: { forward: -28, right: -24, up: 42 },
    part: part('podL'),
    weapon: 'missile',
    yawCenterDeg: 150,
    yawHalfDeg: 95,
    pitchMinDeg: -10,
    pitchMaxDeg: 85,
    interval: 10,
    firstDelay: 4,
    burst: 1,
    burstGap: 0,
    spreadDeg: 4,
    range: 2500,
  },
  {
    offset: { forward: -28, right: 24, up: 42 },
    part: part('podR'),
    weapon: 'missile',
    yawCenterDeg: -150,
    yawHalfDeg: 95,
    pitchMinDeg: -10,
    pitchMaxDeg: 85,
    interval: 10,
    firstDelay: 9,
    burst: 1,
    burstGap: 0,
    spreadDeg: 4,
    range: 2500,
  },
  // 腰の機銃（左・右）: 横と斜め後ろの下寄り（それぞれの側の 20°〜160°）
  {
    offset: { forward: 0, right: -52, up: -8 },
    part: part('hipL'),
    weapon: 'gun',
    ...GUN_LEAD,
    yawCenterDeg: 90,
    yawHalfDeg: 70,
    pitchMinDeg: -40,
    pitchMaxDeg: 35,
    interval: 1.6,
    firstDelay: 1.5,
    burst: 4,
    burstGap: 0.1,
    spreadDeg: 2.5,
    range: 1300,
  },
  {
    offset: { forward: 0, right: 52, up: -8 },
    part: part('hipR'),
    weapon: 'gun',
    ...GUN_LEAD,
    yawCenterDeg: -90,
    yawHalfDeg: 70,
    pitchMinDeg: -40,
    pitchMaxDeg: 35,
    interval: 1.6,
    firstDelay: 0.5,
    burst: 4,
    burstGap: 0.1,
    spreadDeg: 2.5,
    range: 1300,
  },
];

/** 機銃の砲台の番号（回転掃射に使う）・ミサイルの砲台の番号（一斉発射に使う） */
export const GOURAI_GUNS: readonly number[] = [0, 1, 4, 5];
export const GOURAI_PODS: readonly number[] = [2, 3];

/** 弾: 機銃（まっすぐ 600 m/s・4）とミサイル（260 m/s・40°/秒で追う・20。フレアに乗り換える） */
export const GOURAI_SHOTS: Readonly<Record<ShotKind, ShotSpec>> = {
  // 10-4b: 見越して撃つようになったので 1 発を軽く（機銃 4 → 3・ミサイル 20 → 16・追う速さ 40 → 32°/秒・寿命 9 → 7 秒。フレアは 1 機 6 回なので、大きく曲がっても振り切れるように）。
  // 機銃の寿命 2.6 → 2.5 秒（肩の射程 1,500m まで）
  gun: { speed: 600, life: 2.5, damage: 3, radius: 3, turnDeg: 0 },
  missile: { speed: 260, life: 7, damage: 16, radius: 6, turnDeg: 32 },
};

/** 判定の球（体の中心から。part は GOURAI_PARTS）。核は開いている間だけ当たる（閉じている間は前の装甲に入る） */
export interface GouraiSphere {
  readonly forward: number;
  readonly right: number;
  readonly up: number;
  readonly radius: number;
  readonly part: GouraiPart;
}

export const GOURAI_TARGET_SPHERES: readonly GouraiSphere[] = [
  { forward: -8, right: 0, up: 6, radius: 44, part: 'hull' },
  { forward: -58, right: 0, up: 0, radius: 36, part: 'hull' },
  { forward: 52, right: 0, up: 0, radius: 40, part: 'armor' },
  { forward: 82, right: 0, up: 2, radius: 16, part: 'core' },
  ...GOURAI_TURRETS.map((t) => ({
    ...t.offset,
    radius: 11,
    part: GOURAI_PARTS[t.part] ?? 'hull',
  })),
  { forward: -92, right: -24, up: 6, radius: 13, part: 'exhaustL' },
  { forward: -92, right: 24, up: 6, radius: 13, part: 'exhaustR' },
];

/**
 * 10-4b: 体の当たりの箱（体の中心から。前・右・上の範囲 m。形 src/render/gourai-model/parts.ts に合わせた）: 胴と後ろの機関・排気口・
 * 下の推進器・肩と腰の砲台を 1 つの箱、前の装甲の楔を細い箱（後半に装甲を捨てると無くなる）
 */
export interface GouraiHullBox {
  readonly forward: readonly [number, number];
  readonly right: readonly [number, number];
  readonly up: readonly [number, number];
  readonly armor: boolean;
}

export const GOURAI_HULL: readonly GouraiHullBox[] = [
  { forward: [-98, 56], right: [-50, 50], up: [-34, 32], armor: false },
  { forward: [56, 96], right: [-34, 34], up: [-20, 22], armor: true },
];

export const GOURAI_CONFIG = {
  /** 大きさ（見た目と判定）: 全長・幅・胴の高さ（浮いた状態の全高は脚の推進器と背の砲台を入れて約 90m） */
  size: { length: 180, width: 112, height: 64 },
  /** 全体の HP（仮。ソロ通常。ヴォルガス 13,000・アルビオン 7,000） */
  hp: 5500,
  /**
   * 進み方: 巡回の点（中心から半径 radius の円の上に count 個。右回り）を順に、ホバリングで滑って巡る。体の向きは進む向きと別に、
   * 狙う人の方へ turnDeg/秒 で向ける（前の装甲を向ける。回り込まれると追いつけない）。点に arrive m まで寄ったら次へ
   */
  patrol: { radius: 900, count: 4, arrive: 80, speed: 12, accel: 4, turnDeg: 14 },
  /** 10-4b のレイドの巡回（港湾都市の湾: 岸壁 z 1500 の沖。低く浮くので岸壁の上へもかかる）。?dev=gourai&grroute=bay でも */
  bayPatrol: { x: 0, z: 2700, radius: 1100 },
  /** 確かめる場: 開始位置の前方の距離（巡回の中心）・種の塩・最初の大きな攻撃までの秒数 */
  dev: { ahead: 2600, seedSalt: 0x60a1, firstAttackDelay: 9 },
  /**
   * 高さ: 床（地面・建物の屋根・海面の高い方）から体の中心までの高さ（胴の下が床から約 45〜60m）・上下のゆらぎ・上がる / 下がる速さ。
   * 体の四隅と、進む先 lookahead 秒の床も見る（建物を越える）。押し上げの下限は min
   */
  hover: {
    height: 80,
    bob: 6,
    bobHz: 0.12,
    climbRate: 40,
    sinkRate: 10,
    min: 50,
    lookahead: [2, 5] as readonly number[],
  },
  /** 戦域（中心からの水平の半径）。巡回は soft の内側に置き、hard で押し戻す（島・港湾の戦域 6000m の内側） */
  arena: { soft: 4300, hard: 5000 },
  /** 後半（核を壊すか体力 purgeAt 未満）: 装甲を捨てる purgeSeconds 秒の後、速さ・旋回・弾幕の速さが上がる */
  phases: { purgeAt: 0.4, purgeSeconds: 3, speed: 30, turn: 1.5, barrageRate: 1.25, interval: 0.8 },
  /**
   * 熱: 弾 1 発ごと（機銃 / 弾幕のミサイル）・一斉発射・回転掃射で増え、1 秒に cool 冷める。100 で放熱（装甲が開いて核が見え、
   * 砲台が止まる。後半は ventSecondsLate）。排気口を壊すと増え方 ×1.5（2 つで ×2.25）
   */
  heat: {
    max: 100,
    gunShot: 1,
    missileShot: 2,
    volley: 15,
    sweep: 20,
    cool: 1.2,
    ventSeconds: 8,
    ventSecondsLate: 5,
  },
  /** 大きな攻撃の間隔（秒。後半は ×phases.interval）。同じ攻撃は 3 回続けない */
  attackInterval: 11,
  attacks: {
    /**
     * ミサイルの一斉発射: 予兆は背のハッチが開いて赤く点滅し、体が止まる。生きているミサイルの砲台 1 つにつき perPod 発を、
     * 狙う人の向きへ方位 ±fanDeg の扇に、仰角 +launchPitch で打ち上げる（その後は追う。フレアで外れる）。range m より遠いと選ばない
     */
    volley: {
      windup: 2,
      active: 0.8,
      recover: 1.2,
      /** 10-4b: 4 → 3 発（2 つで 6 発） */
      perPod: 3,
      fanDeg: 40,
      launchPitch: 25,
      range: 2600,
    },
    /**
     * 回転掃射: 予兆は止まって機銃が赤く光り、危ない高さの輪（体の中心から bandLow〜bandHigh m の薄い筒）が広がる。攻撃の間は生きている
     * 機銃 1 つずつが、水平に spinDeg/秒 で回りながら gap 秒ごとに 1 発。輪の高さから上か下へ外れれば当たらない。
     * 狙う人が range m 以内のときだけ選ぶ（10-4b: 面を狙う人の高さへ傾けられると選びやすい）
     */
    sweep: {
      windup: 1.6,
      /** 10-4b: 攻撃 2.5 → 3 秒・回る速さ 72 → 54°/秒・弾の間 0.035 → 0.025 秒（弾の筋を詰める）・1 発のダメージ ×damageMul（機銃 3 の 2 倍） */
      active: 3,
      recover: 1.4,
      spinDeg: 54,
      gap: 0.025,
      damageMul: 2,
      /**
       * 上下の散らばり（度）。10-4b: 機銃ごとに、狙う人の距離で輪の真ん中の高さに届く仰角へ揃える（gourai-attacks.ts の fireSweep）。
       * 10-4a は肩 +30m・腰 −8m の 2 つの高さの線がばらばらに飛び、輪の中にいても当たりにくかった
       */
      spreadDeg: 1,
      range: 1300,
      /** 危ない高さ（体の中心から。腰の機銃 −8m・肩の機銃 +30m に、射程の端での散らばり ±26m を足した幅） */
      bandLow: -45,
      bandHigh: 65,
      /**
       * 10-4b: 狙う人の高さへ傾ける（予兆の始めに、狙う人の仰角へ掃射の面を傾けて決める。予兆の筒もその高さへ広がる）。
       * 傾ける角度の下限・上限（度）。範囲の内なら選びやすい（重み 1 + levelWeight）。10-4a は水平だけで、同じ高さにいないと当たらなかった
       */
      pitchMin: -25,
      pitchMax: 40,
      levelWeight: 2,
    },
  },
  /**
   * 10-4b: 体の当たり（アルビオンと同じ扱い。通り抜けられない）: めり込んだら弾く・damage（高難度 ×damageScale）・stun 秒の操作不能・
   * invulnerable 秒は続けて当たらない。margin は自機の当たりの余裕、pushOut は面から外へ置く距離、speedKeep は弾いた後の速さの割合、
   * minExit は面から外への向きの成分の下限、sampleStep は移動の線分を調べる間隔（m）
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
  /** 弾のプール（同時に飛ぶ弾の上限。満杯なら撃たない） */
  // 10-4b: 360 → 480（回転掃射の弾の筋を詰めた分）
  shotCap: 480,
  /** フレアに乗り換える: ミサイルの向きから半分の角度 decoyDeg 以内・decoyRange m 以内のフレア */
  decoy: { deg: 50, range: 900 },
} as const;
