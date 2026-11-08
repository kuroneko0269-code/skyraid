// 10-5a: UFO「ゼノリス（Xenolith）」の数値。10-5b でボットの手応えの表と人の目安から決めた（docs/kaiju-roster.md の「10-5b」）。
// 設計は docs/kaiju-roster.md の「UFO」。
// 動きは src/entities/xenolith/（Three.js 非依存）、攻撃・バリア・瞬間移動・部位は src/ai/xenolith-*.ts、形は src/render/xenolith-model/。
// 10-5b で公開（起動時には読まない。遅延チャンク xenolith-runtime。レイドの前に読む）。
// 距離は m、時間は秒、角度は度、速さは m/s。座標はワールド（前 = 体の向き heading。src/ai/raid-kit/frame.ts）
import type { BeamSpec } from '../ai/raid-kit/beam';
import type { ShotSpec } from '../ai/raid-kit/shots';
import type { PartSpec } from '../ai/raid-kit/parts';

/** 部位（PartSet の順）。縁の発光体 4・下の発生器 3 は番号の並び */
export const XENOLITH_PARTS = [
  'hull',
  'dome',
  'cannon',
  'emitter0',
  'emitter1',
  'emitter2',
  'emitter3',
  'gen0',
  'gen1',
  'gen2',
] as const;
export type XenolithPart = (typeof XENOLITH_PARTS)[number];

export const XENOLITH_EMITTERS: readonly XenolithPart[] = [
  'emitter0',
  'emitter1',
  'emitter2',
  'emitter3',
];
export const XENOLITH_GENS: readonly XenolithPart[] = ['gen0', 'gen1', 'gen2'];

/** 攻撃 2 種（光線）: なぎ払い / ロック警告の後の溜め撃ち。瞬間移動とバリアは別の時計で動く */
export const XENOLITH_ATTACKS = ['sweep', 'charged'] as const;
export type XenolithAttack = (typeof XENOLITH_ATTACKS)[number];
/** 当たりの種類（光線 2 種と、10-5b の光の弾のばらまき） */
export type XenolithHitKind = XenolithAttack | 'orbs';

/** 動き方: 回る（巡航）/ 急停止 / 急加速 / 止まる（光線の間） */
export const XENOLITH_MOVES = ['cruise', 'stop', 'dash', 'hold'] as const;
export type XenolithMove = (typeof XENOLITH_MOVES)[number];

/**
 * 部位の HP（全体 HP の割合）と効き目。上のドームは弱点 ×1.8（壊すと瞬間移動の予兆が 1.5 倍長く・最終段階の続けて撃つが無くなる）、
 * 下の砲口は ×1.2（壊すと溜め撃ちを使わない）、縁の発光体は 1 つにつき瞬間移動の間隔 +3 秒（4 つで瞬間移動しない。数は本体で数える）、
 * 下の発生器は 1 つにつきバリアの外れている時間 ×1.5（3 つで瞬間移動の後にも外れる）
 */
export const XENOLITH_PART_SPECS: readonly PartSpec[] = [
  { id: 'hull', hpShare: 1, breakable: false },
  {
    id: 'dome',
    hpShare: 0.12,
    breakable: true,
    bodyFactor: 1.8,
    effects: { disable: ['combo'], mul: { warpTelegraph: 1.5 } },
  },
  {
    id: 'cannon',
    hpShare: 0.08,
    breakable: true,
    bodyFactor: 1.2,
    effects: { disable: ['charged'] },
  },
  ...[0, 1, 2, 3].map((i) => ({ id: `emitter${String(i)}`, hpShare: 0.04, breakable: true })),
  ...[0, 1, 2].map((i) => ({
    id: `gen${String(i)}`,
    hpShare: 0.05,
    breakable: true,
    effects: { mul: { barrierDown: 1.5 } },
  })),
];

/**
 * 判定の球（体の中心から。前・右・上 m）。縁の発光体は回る輪に付くので、方位 ringDeg（輪の回った角度を足す）と半径で置く。
 * 胴は真ん中 1 + 輪 6（直径 160m の円盤を覆う）。砲口は真ん中の球から下へはみ出す（下から撃てば砲口に当たる）
 */
export interface XenolithSphere {
  readonly forward: number;
  readonly right: number;
  readonly up: number;
  readonly radius: number;
  readonly part: XenolithPart;
  /** 回る輪に付く（縁の発光体）: 方位（度）と輪の半径 */
  readonly ring?: { readonly deg: number; readonly r: number };
}

const ringSpheres = (n: number, r: number, radius: number): XenolithSphere[] =>
  Array.from({ length: n }, (_, i) => {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    return { forward: Math.cos(a) * r, right: Math.sin(a) * r, up: 0, radius, part: 'hull' };
  });

export const XENOLITH_TARGET_SPHERES: readonly XenolithSphere[] = [
  { forward: 0, right: 0, up: 4, radius: 26, part: 'hull' },
  ...ringSpheres(6, 56, 24),
  { forward: 0, right: 0, up: 24, radius: 19, part: 'dome' },
  { forward: 0, right: 0, up: -24, radius: 12, part: 'cannon' },
  ...XENOLITH_EMITTERS.map((part, i) => ({
    forward: 0,
    right: 0,
    up: 0,
    radius: 10,
    part,
    ring: { deg: 45 + i * 90, r: 80 },
  })),
  ...XENOLITH_GENS.map((part, i) => {
    const a = (i / 3) * Math.PI * 2;
    return { forward: Math.cos(a) * 40, right: Math.sin(a) * 40, up: -50, radius: 9, part };
  }),
];

/** なぎ払う光線（Beam の sweep）: 予兆 1.5（線の始めと終わりが薄く光る）/ 撃つ 1.2 / 硬直 1.0。10-5b で 35 → 45 */
export const XENOLITH_SWEEP: BeamSpec = {
  warn: 1.5,
  charge: 0,
  fire: 1.2,
  recover: 1,
  length: 2200,
  radius: 10,
  damage: 45,
};

/** ロック警告の後の溜め撃ち（Beam の charged）: ロック 1.5（進む先を追う）/ 溜め 1.5（向きが止まる = 避けどき。10-5b で 0.8 → 1.5）/ 撃つ 1.2 / 硬直 1.2。10-5b で 60 → 40 */
export const XENOLITH_CHARGED: BeamSpec = {
  warn: 1.5,
  charge: 1.5,
  fire: 1.2,
  recover: 1.2,
  length: 2600,
  radius: 12,
  damage: 40,
};

/**
 * 10-5b: 光の弾（ShotPool の 'gun' の形でまっすぐ飛ぶ。'missile' は使わない）。光線の間（約 8 秒）が暇にならないように、
 * 前の縁から狙う人の進む先へ格子にばらまく。遅い（360 m/s。機銃の弾の 4 割）ので見てから曲がれば外れる
 */
export const XENOLITH_ORB_SHOT: ShotSpec = {
  speed: 360,
  life: 7,
  damage: 10,
  radius: 7,
  turnDeg: 0,
};

export const XENOLITH_CONFIG = {
  /** 大きさ（見た目と判定）: 円盤の直径・縁から真ん中の厚さ・ドームの半径（全高はドームと砲口・発生器を入れて約 100m） */
  size: { diameter: 160, thickness: 30, dome: 26 },
  /** 全体の HP（ソロ通常。10-5b で 6,000 → 13,000。バリアで半分ほどの時間は殻の中に効かない。ゴウライ 5,500・アルビオン 8,000） */
  hp: 13000,
  /**
   * 動き方: 狙う人の周りを半径 orbitMin〜orbitMax で回る（巡航 cruise）。maneuverMin〜Max 秒ごとに急停止（stopDecel で止まり stopHold 秒浮く）
   * → 急加速（dash の速さで dashSeconds 秒。半分の確率で回る向きを変え、半径と高さも選び直す）。光線の間は止まる（hold）
   */
  move: {
    cruise: 150,
    accel: 140,
    dash: 320,
    dashAccel: 360,
    dashSeconds: 1.1,
    stopDecel: 340,
    stopHold: 0.7,
    maneuverMin: 4.5,
    maneuverMax: 7.5,
    orbitMin: 620,
    orbitMax: 1000,
    /** 狙う人からの高さ（下限・上限） */
    altMin: -80,
    altMax: 220,
    /** 半径・高さへ寄せる強さ（1/秒） */
    radialGain: 0.8,
    verticalGain: 1.2,
    climbMax: 160,
    /** 体の向き（砲口・光線の基準）を狙う人へ回す速さ（度/秒） */
    turnDeg: 240,
    /** 見た目: 円盤の回る速さ（ラジアン/秒）・縁の発光体の輪の回る速さ（度/秒。判定の球も回る） */
    spin: 0.9,
    ringDeg: 40,
  },
  /**
   * 10-5b: ぶつけさせない: 人（協力は全員）が ahead 秒以内に水平 miss m・上下 band m 以内を通る進路なら、上か下へ speed m/s で避ける
   * （加速 accel m/s²。急停止・光線で止まった所へ後ろから追いつかれても、ぶつかる前に退く。光線の向きは変えない）
   */
  dodge: { ahead: 1.4, miss: 140, band: 70, speed: 140, accel: 420 },
  /** 高さ: 床（地面・屋根・海面の高い方）から体の中心までの下限（発生器の下 −59m も床に付かない）・天井・先の床を見る秒数 */
  floor: { min: 90, ceiling: 3200, lookahead: [0.5, 1.2] as readonly number[] },
  /** 戦域（中心からの水平の半径）。soft の外では内へ寄せ、hard で押し戻す（島・港湾の戦域 6000m の内側） */
  arena: { soft: 4300, hard: 5000 },
  /** 段階: 体力 stage2 未満で瞬間移動の間隔 ×warpMul2・速さ ×speedMul2、stage3 未満で溜め撃ちの後に続けてなぎ払う */
  stages: { stage2: 0.6, stage3: 0.3, warpMul2: 0.6, speedMul2: 1.15, intervalMul3: 0.85 },
  /** 光線の間隔（秒。硬直の後から）と、最初の光線までの秒数 */
  attackInterval: 8,
  firstAttack: 6,
  /** 光線を選ぶ距離（なぎ払い・溜め撃ち）と、なぎ払いを選びやすい距離（重み ×2） */
  attackRange: { sweep: 2000, charged: 2400, sweepNear: 1200 },
  /**
   * なぎ払いの方位の幅（狙う人の向きから ± 度）・仰角の範囲。10-5b: 線の高さは狙う人の上下の動きを leadY 秒見越す（上り・下りを
   * 続けると当たる。予兆を見て上か下へ離れれば外れる）
   */
  sweep: { halfDeg: 60, pitchMin: -60, pitchMax: 45, leadY: 1.5 },
  /**
   * 10-5b: 溜め撃ちのロックは狙う人の進む先（lead 秒先）を追う。溜めで線が止まったとき、まっすぐ飛び続けると撃つ間に線を横切って当たる
   * （線が止まったら向きを変えれば外れる）
   */
  charged: { lead: 1.9 },
  /**
   * バリア（Barrier）: ふだんは張っていて当たらない（当たると青い波紋。下の発生器だけは殻の外で当たる）。光線を撃つ flicker 秒前に揺らいで、
   * 撃つ間と硬直の間は外れたまま、その後 down 秒で張り直す（発生器 1 つにつき ×1.5）。殻は円盤を包む楕円体（水平の半径 rx・上下 ry・中心 up）
   */
  barrier: { flicker: 0.6, down: 4, rx: 96, ry: 44, up: 6 },
  /**
   * 瞬間移動（Warp）: interval 秒ごと（縁の発光体 1 つにつき +perEmitter 秒。4 つで使わない）。予兆 telegraph 秒の間、移る先が光る
   * （白い柱と地上の輪）。狙う人の周りの輪（ringMin〜ringMax・高さは狙う人から altMin〜altMax）の上で、狙う人から keepAway 以上。
   * 移った直後 afterWarp 秒は光線を始めない
   */
  warp: {
    interval: 13,
    first: 10,
    perEmitter: 3,
    telegraph: 1.2,
    cooldown: 1,
    ringMin: 650,
    ringMax: 1000,
    altMin: -100,
    altMax: 260,
    keepAway: 500,
    afterWarp: 1,
  },
  /**
   * 体の当たり（通り抜けられない）: 円盤の楕円体（水平 discA・上下 discB）とドームの球（中心 domeUp・半径 domeR）。
   * 10-5b: 10-4c の扱い: めり込んだら最大 HP の hpShare（約 8 割）のダメージ（残りが足りなければ撃墜）。弾かない（跳ねない）・操作不能も無し。
   * invulnerable 秒は続けて当たらない（通り抜ける間に何度も当たらない）。体も速く動くので、体から見た自機の動き（相対）で調べる。
   * damage・pushOut・speedKeep・minExit・stun は 10-5a の弾く扱いの値（今は使わない。比べのために残す）
   */
  collision: {
    discA: 80,
    discB: 15,
    domeUp: 12,
    domeR: 26,
    damage: 30,
    hpShare: 0.8,
    margin: 6,
    pushOut: 10,
    speedKeep: 0.7,
    minExit: 0.4,
    stun: 0.5,
    invulnerable: 1.5,
    sampleStep: 4,
  },
  /**
   * 10-5b: 光の弾のばらまき（光線の間の圧）: 光線をしていない間に interval 秒ごと（最初は first 秒）。次の光線まで minCooldown 秒より
   * 残っているときだけ始める（光線と重ならない）。予兆 warn 秒（縁の帯と発光体が白く強く光る）の後、前の縁から狙う人の進む先
   * （弾が届くまでの秒 × lead だけ先）を真ん中に、横 cols × 縦 rows（段階 3 は横 cols3）の格子に spreadDeg 度ずつ開いて撃つ
   * （まっすぐ飛び続けると真ん中に当たり、曲がれば外れる）。range m より遠い人には撃たない
   */
  orbs: {
    interval: 5.5,
    first: 3,
    warn: 0.7,
    cols: 3,
    cols3: 5,
    rows: 3,
    spreadDeg: 3.5,
    lead: 1,
    minCooldown: 2,
    range: 2400,
    cap: 64,
  },
  /** 確かめる場: 開始位置の前方の距離（最初の位置）・種の塩 */
  dev: { ahead: 1800, seedSalt: 0x7e11 },
} as const;
