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
     * 回転掃射: 予兆は止まって機銃が赤く光り、危ない高さの輪が広がる。攻撃の間は生きている機銃 1 つずつが、水平に spinDeg/秒 で回り
     * ながら gap 秒ごとに 1 発。狙う人が range m 以内のときだけ選ぶ（10-4b: 面を狙う人の高さへ傾けられると選びやすい）。
     * 10-4c: 輪を上下 2 つにした（rings。狙う人の高さを 0 とした上下の幅 m）。狙う人は「近い輪」の中にいて、すき間（近い輪と遠い輪の
     * 間）へ動くか、近い輪の外側へ動けば当たらない。すき間の向き（上 / 下）は予兆の始めに決める（side。床に近ければ上）。
     * 弾は輪の中の段（layers）を順に回って撃つ（輪の縦の幅いっぱいに弾が来る。10-4b は輪の真ん中の高さへ揃え、縦 ±17m ほどだった）
     */
    sweep: {
      windup: 1.6,
      /** 10-4b: 攻撃 2.5 → 3 秒・回る速さ 72 → 54°/秒・1 発のダメージ ×damageMul（機銃 3 の倍）。10-4c: 弾の間 0.025 → gap 秒（段を回る分を詰めた） */
      active: 3,
      recover: 1.4,
      spinDeg: 54,
      gap: 0.005,
      damageMul: 3,
      /** 段の中の上下の散らばり（度） */
      spreadDeg: 0.3,
      range: 1300,
      /**
       * 10-4c: 2 つの輪（狙う人の高さ = 0 からの上下 m。side が −1 なら上下を反対に）と段の数。近い輪 −45〜+20（狙う人は中）・
       * すき間 +20〜+80（60m）・遠い輪 +80〜+135。すき間へは約 30〜70m、近い輪の外へは約 55m 動けば外れる（自機の当たりの球 6m と
       * 弾の当たり 3m の分も入れて）。高さは体から settle m より外で、距離で変わらない
       */
      near: [-45, 20] as readonly [number, number],
      far: [80, 135] as readonly [number, number],
      layersNear: 5,
      layersFar: 4,
      /** 10-4c: 弾は狙う人の距離 + beyond m（予兆の輪の端）で消える（輪の外へ離れても外れる） */
      beyond: 250,
      /** 10-4c: 弾は機銃から水平に settle m で段の高さへ寄せ、その後は傾きの面に沿って飛ぶ（輪の高さが距離で変わらない） */
      settle: 80,
      /** 狙う人が床からこの高さ m より低ければ、すき間を上に（海へ下がらせない） */
      lowFloor: 160,
      /**
       * 10-4b: 狙う人の高さへ傾ける（予兆の始めに、狙う人の仰角へ掃射の面を傾けて決める。予兆の輪もその高さへ広がる）。
       * 傾ける角度の下限・上限（度）。範囲の内なら選びやすい（重み 1 + levelWeight）。10-4a は水平だけで、同じ高さにいないと当たらなかった
       */
      pitchMin: -25,
      pitchMax: 40,
      levelWeight: 2,
    },
  },
  /**
   * 10-4b: 体の当たり（通り抜けられない）。margin は自機の当たりの余裕、sampleStep は移動の線分を調べる間隔（m）。
   * 10-4c: ぶつかったときの扱いは共通の KAIJU_RAM（src/data/kaiju-ram.ts。最大 HP の約 8 割・跳ねない・1.5 秒は続けて当たらない）。
   * 10-4b の弾く扱い（30・弾く・0.5 秒の操作不能）はやめた
   */
  collision: {
    margin: 6,
    sampleStep: 4,
  },
  /** 弾のプール（同時に飛ぶ弾の上限。満杯なら撃たない） */
  // 10-4b: 360 → 480（回転掃射の弾の筋を詰めた分）。10-4c: 480 → 1,200（回転掃射の弾を 2 つの輪の縦の幅いっぱいに散らした分）
  shotCap: 2400,
  /** フレアに乗り換える: ミサイルの向きから半分の角度 decoyDeg 以内・decoyRange m 以内のフレア */
  decoy: { deg: 50, range: 900 },
} as const;
