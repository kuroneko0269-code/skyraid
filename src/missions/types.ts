// ミッション定義の型（2-4。データ駆動）。定義そのものは src/data/missions.ts に TS のデータとして置き、ロジックを含めない。
// ミッションを増やすときはデータを足すだけで済むよう、出現物・目標・失敗条件・報酬をすべてここで表す。
// 表示する文（タイトル・ブリーフィング）は言語ごとに src/data/i18n/*.json に置き、ミッションの id で引く（2-5）
import type { Difficulty, PatrolPoint } from '../data/ai';
import type { Rank } from '../data/ranking';

/** 位置と向き（機首の向きは -Z から右回り、度。真上から見て時計回り） */
export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly headingDeg: number;
}

/** 水平の位置（地表に置くもの・水平の円の中心） */
export interface Point2 {
  readonly x: number;
  readonly z: number;
}

/** 空間の位置 */
export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// ---- 出現物 ----

/** 出現のタイミング */
export type SpawnTrigger =
  /** ミッション開始時 */
  | { readonly type: 'start' }
  /** 開始から seconds 秒後 */
  | { readonly type: 'time'; readonly seconds: number }
  /** 目標 objective が始まったとき（順番の目標の「次」に合わせて出す） */
  | { readonly type: 'objectiveActive'; readonly objective: string }
  /** 目標 objective を達成したとき */
  | { readonly type: 'objectiveComplete'; readonly objective: string };

/** 敵機。count 機を positions（足りなければ先頭から使い回す）に出し、patrol を巡回させる。撃墜されても再出現しない */
export interface EnemyFighterSpawn {
  readonly kind: 'enemyFighter';
  /** 目標（撃墜数）から数える単位 */
  readonly group: string;
  readonly count: number;
  readonly difficulty: Difficulty;
  readonly trigger: SpawnTrigger;
  readonly positions: readonly Pose[];
  readonly patrol: readonly PatrolPoint[];
  /**
   * 狙う相手（2-5）。player（省略時）: プレイヤー機 / transport: 輸送機を優先して狙い、輸送機がいなければプレイヤー機。
   * 飛び方・撃ち方（AI の数値）は同じで、相手の選び方だけが変わる
   */
  readonly attack?: 'player' | 'transport';
}

/** 射撃練習用の的（風船。位置は src/data/targets.ts の出現地点の先頭から count 個）。再出現しない */
export interface TargetSpawn {
  readonly kind: 'targets';
  readonly count: number;
  readonly trigger: SpawnTrigger;
}

/** 周回ドローン（軌道は src/data/targets.ts の先頭から count 機）。再出現しない */
export interface DroneSpawn {
  readonly kind: 'drones';
  readonly count: number;
  readonly trigger: SpawnTrigger;
}

/**
 * 地上目標。positions の地表に 1 つずつ置く。
 * 2-6 で種類（建物・車両など）と見た目を作るまでは、どの種類も「静止した大きな的」（placeholder）で出す（2-5）
 */
export interface GroundTargetSpawn {
  readonly kind: 'groundTarget';
  readonly group: string;
  /** 種類。2-6 までは 'placeholder' だけ */
  readonly targetType: string;
  readonly trigger: SpawnTrigger;
  readonly positions: readonly Point2[];
}

/** 輸送機（護衛対象、2-5）。from から to へ直線で一定速度（src/data/mission-props.ts）で飛ぶ。陣営はプレイヤー側 */
export interface TransportSpawn {
  readonly kind: 'transport';
  /** 護衛の目標から参照する名前 */
  readonly group: string;
  readonly trigger: SpawnTrigger;
  readonly from: Point3;
  readonly to: Point3;
}

/**
 * 怪獣（仮実装、2-5。6-1 で本実装）。position の海から浮かび上がり、walkTo へ歩く。
 * HP の retreatDamageRatio を削られると海へ引き返す
 */
export interface KaijuSpawn {
  readonly kind: 'kaiju';
  readonly trigger: SpawnTrigger;
  readonly position: Point2;
  readonly walkTo: Point2;
  readonly retreatDamageRatio: number;
}

export type SpawnDef =
  EnemyFighterSpawn | TargetSpawn | DroneSpawn | GroundTargetSpawn | TransportSpawn | KaijuSpawn;
export type SpawnKind = SpawnDef['kind'];

// ---- 目標 ----

/**
 * 目標の始まり方（順序）。最初の目標は開始時に始まる。
 * withPrevious: 直前の目標と同時に始まる / afterPrevious: それまでの必須目標をすべて達成してから始まる
 */
export type ObjectiveStart = 'withPrevious' | 'afterPrevious';

interface ObjectiveBase {
  /** ミッション内で一意。出現のタイミング・HUD・リザルトで参照する */
  readonly id: string;
  /** true: 成功に必要 / false: 任意（達成しなくても成功できる） */
  readonly required: boolean;
  readonly start: ObjectiveStart;
  /** HUD・ブリーフィングの表示名。省略すると種類ごとの既定（src/ui/mission-text.ts） */
  readonly label?: string;
}

/** 撃墜数: target の種類（group を指定すればその出現物だけ）を count 機落とす。目標が始まってからの数だけ数える */
export interface KillObjective extends ObjectiveBase {
  readonly type: 'kill';
  readonly target: DestroyableKind;
  readonly group?: string;
  readonly count: number;
}

/** 生存時間: 目標が始まってから seconds 秒、撃墜されずに飛ぶ */
export interface SurviveObjective extends ObjectiveBase {
  readonly type: 'survive';
  readonly seconds: number;
}

/** リングの位置と向き（輪の面の法線の向き。pitchDeg は上向きが正、省略で水平） */
export interface RingDef {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly headingDeg: number;
  readonly pitchDeg?: number;
}

/** リング通過: rings を順番に通る（次のリング以外は通っても数えない） */
export interface RingObjective extends ObjectiveBase {
  readonly type: 'rings';
  readonly rings: readonly RingDef[];
}

/**
 * 護衛（2-5）: group の輸送機が destination（水平の円）に入るまで守る。
 * 失うと失敗条件の escortLost（定義の failConditions に入れる）
 */
export interface EscortObjective extends ObjectiveBase {
  readonly type: 'escort';
  readonly group: string;
  readonly destination: { readonly x: number; readonly z: number; readonly radius: number };
}

/** 破壊（2-5）: group の地上目標を count 個壊す（出現物の数と同じにすれば「全部」） */
export interface DestroyObjective extends ObjectiveBase {
  readonly type: 'destroy';
  readonly group: string;
  readonly count: number;
}

/** 怪獣（2-5。部位 HP はフェーズ6）: 怪獣の全体の HP の damageRatio だけダメージを与える（撤退させる） */
export interface KaijuObjective extends ObjectiveBase {
  readonly type: 'kaiju';
  readonly damageRatio: number;
}

export type ObjectiveDef =
  | KillObjective
  | SurviveObjective
  | RingObjective
  | EscortObjective
  | DestroyObjective
  | KaijuObjective;
export type ObjectiveType = ObjectiveDef['type'];

/** 撃墜数で数えられるものの種類（any は全部） */
export type DestroyableKind = 'enemyFighter' | 'target' | 'drone' | 'groundTarget' | 'any';

// ---- 成功・失敗・報酬 ----

/** 成功条件。今は「必須の目標をすべて達成」だけ */
export type SuccessCondition = 'allRequiredObjectives';

/**
 * 失敗条件。playerDown: 自機撃墜（地面・海面への墜落も） / escortLost: 護衛対象の喪失 /
 * timeUp: 制限時間超過（timeLimitSeconds があるとき） / outOfBounds: 戦域離脱（境界の外で猶予を過ぎる）
 */
export type FailCondition = 'playerDown' | 'escortLost' | 'timeUp' | 'outOfBounds';

export interface RewardDef {
  /** クレジットの基本額 */
  readonly baseCredits: number;
  /** ランク別の倍率。省略で src/data/ranking.ts の既定 */
  readonly rankMultipliers?: Readonly<Record<Rank, number>>;
}

export interface MissionDef {
  /** 一意な id。タイトル・ブリーフィング文は src/data/i18n/*.json の missions[id] */
  readonly id: string;
  /** src/data/maps.ts のマップ id */
  readonly mapId: string;
  /** 自機の開始位置と向き */
  readonly start: Pose;
  /** 制限時間（秒）。省略で無制限 */
  readonly timeLimitSeconds?: number;
  /** 評価の基準時間（秒）。これ以内のクリアで時間の減点 0（src/data/ranking.ts） */
  readonly parTimeSeconds: number;
  readonly spawns: readonly SpawnDef[];
  readonly objectives: readonly ObjectiveDef[];
  readonly success: SuccessCondition;
  readonly failConditions: readonly FailCondition[];
  readonly reward: RewardDef;
}
