// 機体ごとの飛行パラメータ。速度は m/s 相当、角速度は 度/秒
// docs/spec.md「4. 飛行モデル」に各数値の意味を書いている
import {
  BASTION_SHAPE,
  KESTREL_SHAPE,
  SWIFT_SHAPE,
  VECTOR_SHAPE,
  type AircraftShape,
} from './aircraft-shapes';

export type { AircraftShape } from './aircraft-shapes';

/** 速度 → 旋回率の係数（折れ線）。speed は昇順 */
export interface TurnCurvePoint {
  readonly speed: number;
  readonly factor: number;
}

export interface AircraftSpec {
  readonly id: string;
  readonly name: string;
  readonly speed: {
    /** これを下回ると失速 */
    readonly stall: number;
    /** 起動時・リセット時の速度 */
    readonly cruise: number;
    /** スロットル 0 で落ち着く速度（失速より低いので、絞り続けると失速する） */
    readonly idle: number;
    /** スロットル 1（アフターバーナーなし）で落ち着く速度 */
    readonly military: number;
    /** アフターバーナー中に落ち着く速度（spec の最高速度） */
    readonly afterburner: number;
    /** 降下などで到達できる絶対上限 */
    readonly limit: number;
    /** 目標速度へ近づく速さ（1/秒）。大きいほどスロットルへの反応が速い */
    readonly response: number;
    /** アフターバーナー中の response */
    readonly afterburnerResponse: number;
    /** エンジンによる加速の上限（m/s²）。重力より小さいので垂直上昇は必ず減速する */
    readonly maxAccel: number;
    /** アフターバーナー中の maxAccel */
    readonly afterburnerMaxAccel: number;
    /** スロットルを絞ったときの減速の上限（m/s²） */
    readonly maxDecel: number;
  };
  readonly rates: {
    /** 係数 1.0 のときの最大ピッチ角速度 */
    readonly pitch: number;
    /** 係数 1.0 のときの最大ロール角速度 */
    readonly roll: number;
    /** 係数 1.0 のときの最大ヨー角速度 */
    readonly yaw: number;
    /** ロールが速度の影響を受ける割合（0 = 常に最大、1 = ピッチと同じだけ落ちる） */
    readonly rollSpeedSensitivity: number;
  };
  readonly turnCurve: readonly TurnCurvePoint[];
  /** 機体の耐久と当たり判定（2-3）。プレイヤー・敵機で共通 */
  readonly hull: {
    readonly maxHp: number;
    /** 当たり判定の球の半径（m） */
    readonly hitRadius: number;
    /** 見た目の大きさ（撃墜の破片を散らす半径、m） */
    readonly visualRadius: number;
  };
  readonly afterburner: {
    /** 満タンから空になるまでの秒数 */
    readonly durationSeconds: number;
    /** 空から満タンまで回復する秒数 */
    readonly rechargeSeconds: number;
    /** 離してから回復が始まるまでの秒数 */
    readonly rechargeDelaySeconds: number;
    /** 空になったあと、再点火できるゲージ量（0〜1） */
    readonly restartThreshold: number;
  };
}

/**
 * 初期機 Kestrel（バランス型。3-4 で名前を付けた。1-1〜2-3 の数値のまま）。
 * ハンガーの機体（AIRCRAFT_MODELS）はこの値に倍率を掛けて作る（src/progression/loadout.ts）
 */
export const STARTER_AIRCRAFT: AircraftSpec = {
  id: 'kestrel',
  name: 'Kestrel',
  speed: {
    stall: 80,
    cruise: 250,
    idle: 60,
    military: 330,
    afterburner: 400,
    limit: 460,
    response: 0.45,
    afterburnerResponse: 0.9,
    maxAccel: 15,
    afterburnerMaxAccel: 35,
    maxDecel: 20,
  },
  rates: {
    pitch: 75,
    roll: 200,
    yaw: 22,
    rollSpeedSensitivity: 0.5,
  },
  turnCurve: [
    { speed: 0, factor: 0.2 },
    { speed: 80, factor: 0.35 },
    { speed: 180, factor: 0.9 },
    { speed: 220, factor: 1.0 },
    { speed: 300, factor: 1.0 },
    { speed: 400, factor: 0.7 },
    { speed: 460, factor: 0.55 },
  ],
  // 敵の機銃（5/発）で 40 発、敵のミサイル（直撃 約 125〜150）なら 2 発で落ちる
  hull: { maxHp: 200, hitRadius: 6, visualRadius: 5 },
  afterburner: {
    durationSeconds: 6,
    rechargeSeconds: 10,
    rechargeDelaySeconds: 1,
    restartThreshold: 0.15,
  },
};

/**
 * 敵戦闘機（2-3）。初期機より少し遅く、曲がりにくい（AI が最大 G でさらに抑える）。
 * HP 120: 初期機の機銃（10/発）で 12 発、ミサイルは信管が近くで働けば 1 発
 */
export const ENEMY_FIGHTER: AircraftSpec = {
  id: 'enemy-fighter',
  name: 'XF-7 Hornet',
  speed: {
    stall: 80,
    cruise: 240,
    idle: 60,
    military: 320,
    afterburner: 385,
    limit: 450,
    response: 0.45,
    afterburnerResponse: 0.85,
    maxAccel: 14,
    afterburnerMaxAccel: 32,
    maxDecel: 20,
  },
  rates: {
    pitch: 70,
    roll: 180,
    yaw: 20,
    rollSpeedSensitivity: 0.5,
  },
  turnCurve: STARTER_AIRCRAFT.turnCurve,
  hull: { maxHp: 120, hitRadius: 6, visualRadius: 5 },
  afterburner: {
    durationSeconds: 5,
    rechargeSeconds: 12,
    rechargeDelaySeconds: 1,
    restartThreshold: 0.2,
  },
};

/** 被弾・撃墜まわり（2-3）。HP と当たり判定は各機体の hull */
export const AIRCRAFT_COMBAT = {
  /** プレイヤーが撃墜されてから初期位置へ戻るまでの時間（フリーフライトでは何度でも） */
  playerRespawnSeconds: 3,
  /** プレイヤーの被弾で画面を赤く光らせる時間（濃さは src/data/hud.ts） */
  playerHitFlashSeconds: 0.35,
  /** 敵機が被弾で白く光る時間 */
  enemyHitFlashSeconds: 0.08,
} as const;

// ---- 3-4: ハンガーの機体 4 種。数値は Kestrel（STARTER_AIRCRAFT・初期機の武装）に対する倍率 ----

/**
 * 4 パラメータ（Kestrel = 1）。変換は src/progression/loadout.ts
 * - speed: 最高速（military / afterburner / limit と巡航より上の turnCurve の速度）とエンジンの加速
 * - turn: ピッチ・ロール・ヨーの最大角速度
 * - durability: 最大 HP
 * - payload: ミサイル・ロケット・爆弾・フレアの数
 */
export interface AircraftStats {
  readonly speed: number;
  readonly turn: number;
  readonly durability: number;
  readonly payload: number;
}

export interface AircraftModel {
  readonly id: string;
  readonly name: string;
  /** ハンガーの一覧に出す一言 */
  readonly role: string;
  readonly stats: AircraftStats;
  /** 購入価格（CR）。0 は初期所持 */
  readonly price: number;
  /** 解放条件: このミッションをクリアすると買える（null は最初から買える） */
  readonly unlockMission: string | null;
  /** 機体モデルの形（4-3。src/data/aircraft-shapes.ts） */
  readonly shape: AircraftShape;
}

/** ハンガーの機体の並び順。先頭が初期機 */
export const AIRCRAFT_MODELS: readonly AircraftModel[] = [
  {
    id: STARTER_AIRCRAFT.id,
    name: 'Kestrel',
    role: 'バランス型',
    stats: { speed: 1, turn: 1, durability: 1, payload: 1 },
    price: 0,
    unlockMission: null,
    shape: KESTREL_SHAPE,
  },
  {
    // 最高速 +12%・旋回 +15%。HP 140（敵の機銃 28 発）、ミサイル 3・ロケット 8・爆弾 3・フレア 4
    id: 'swift',
    name: 'Swift',
    role: '軽量・高速',
    stats: { speed: 1.12, turn: 1.15, durability: 0.7, payload: 0.7 },
    price: 8000,
    unlockMission: null,
    shape: SWIFT_SHAPE,
  },
  {
    // 最高速 −8%・旋回 −15%。HP 320（敵の機銃 64 発）、ミサイル 6・ロケット 18・爆弾 6・フレア 9
    id: 'bastion',
    name: 'Bastion',
    role: '重武装・高耐久',
    stats: { speed: 0.92, turn: 0.85, durability: 1.6, payload: 1.5 },
    price: 12000,
    unlockMission: null,
    shape: BASTION_SHAPE,
  },
  {
    // 最高速 +15%・旋回 +12%。HP 250、ミサイル 5・ロケット 14・爆弾 5・フレア 7。M4（strike）クリアで解放
    id: 'vector',
    name: 'Vector',
    role: '高性能',
    stats: { speed: 1.15, turn: 1.12, durability: 1.25, payload: 1.2 },
    price: 25000,
    unlockMission: 'strike',
    shape: VECTOR_SHAPE,
  },
];

export function findAircraftModel(id: string): AircraftModel | null {
  return AIRCRAFT_MODELS.find((m) => m.id === id) ?? null;
}
