// リプレイ（7-B）の型（Three.js・DOM 非依存）: 記録の初期状態（ヘッダ）・1 ステップの入力（フレーム）・外部の操作（コマンド）
import type { Difficulty } from '../data/ai';
import type { DefenseDifficulty } from '../data/defense';
import type { RaidDifficulty } from '../data/raid';
import type { UpgradeLevels } from '../progression/save';

/** 記録するモード（シングルプレイだけ。チュートリアル・PvP・協力は記録しない） */
export const REPLAY_MODES = ['free', 'mission', 'raid', 'race', 'defense'] as const;
export type ReplayMode = (typeof REPLAY_MODES)[number];

export const REPLAY_MODE_LABELS: Readonly<Record<ReplayMode, string>> = {
  free: 'フリーフライト',
  mission: 'キャンペーン',
  raid: 'ソロレイド',
  race: 'リングレース',
  defense: '防衛戦',
};

/** 再生で同じ世界を作り直すための初期状態 */
export interface ReplayStart {
  readonly mode: ReplayMode;
  /** 飛ぶマップ（フリーフライトはモード選択で選んだもの、ほかは定義から決まる） */
  readonly mapId: string;
  /** キャンペーンのミッション id（mission のとき） */
  readonly missionId?: string;
  /** ソロレイドの難易度（raid のとき） */
  readonly raidDifficulty?: RaidDifficulty;
  /** レースのコース id と、ベストの各リングのタイム（race のとき。ゴーストとの差の表示だけに使う） */
  readonly courseId?: string;
  readonly raceReference?: readonly number[] | null;
  /** 防衛戦の難易度（defense のとき。マップは mapId） */
  readonly defenseDifficulty?: DefenseDifficulty;
  readonly aircraftId: string;
  readonly upgrades: Readonly<UpgradeLevels>;
  /** フリーフライトの敵の設定（ほかのモードでも次のフリーフライト用に残す） */
  readonly enemies: {
    readonly enabled: boolean;
    readonly difficulty: Difficulty;
    readonly count: number;
  };
  /** 判定の乱数のシード */
  readonly seed: number;
  /** 天候（7-5。見た目だけ。再生で同じ空にする） */
  readonly weatherId: string;
  /**
   * 記録したときの塗装（7-3。見た目だけ。progression/paint.ts の 14 バイトの 16 進）。7-3 より前の記録にはない
   * （機体の初期の塗装で再生する）
   */
  readonly paint?: string;
}

/** 記録の結果（一覧の「結果」） */
export interface ReplayOutcome {
  /** 一覧に出す短い文（「成功 S」「1:23.456」「10 波クリア」など） */
  readonly label: string;
  /** 成功・完走か（色分け） */
  readonly success: boolean;
}

/** 記録のヘッダ（JSON で保存） */
export interface ReplayHeader extends ReplayStart {
  /** 記録の形式の版 */
  readonly format: number;
  /** ゲームの判定の版（判定が変わると古い記録は再現できない。src/data/replay.ts） */
  readonly simVersion: number;
  /** 記録した時刻（ISO 8601） */
  readonly date: string;
  readonly pilotName: string;
  /** 一覧に出す題（ミッション名・コース名など） */
  readonly title: string;
  /** 記録したステップ数（60Hz） */
  readonly steps: number;
  readonly outcome: ReplayOutcome | null;
  /** 飛行を始めた直後の状態ハッシュ（再生で同じ世界から始められたかの確認） */
  readonly startHash: string;
}

/**
 * 1 ステップの入力（量子化した整数）。操縦は ±127、スロットル目標は 0〜1000（-1 は指定なし）。
 * buttons: 1 AB / 2 機銃 / 4 ミサイル / 8 フレア / 16 ターゲット切替 / 32 ロケット / 64 爆弾 / 128 爆弾の長押し。
 * flags: 1 オートレベル / 2 ピッチ反転 / 4 エイムアシスト（機銃の判定の拡大）
 */
export interface ReplayFrame {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  throttleTarget: number;
  buttons: number;
  flags: number;
}

export const FRAME_CHANNELS = [
  'pitch',
  'roll',
  'yaw',
  'throttle',
  'throttleTarget',
  'buttons',
  'flags',
] as const satisfies readonly (keyof ReplayFrame)[];

export function createFrame(): ReplayFrame {
  return { pitch: 0, roll: 0, yaw: 0, throttle: 0, throttleTarget: -1, buttons: 0, flags: 0 };
}

/**
 * 外部の操作（固定ステップの外で判定を変えるもの）。step のステップの前に効く。
 * select: HUD のタップでの対象の選択（CombatSystem.allTargets の添字、-1 は解除）/ skip: 防衛戦の準備のスキップ /
 * enemies: フリーフライトの敵の設定の変更
 */
export type ReplayCommand =
  | { readonly step: number; readonly kind: 'select'; readonly target: number }
  | { readonly step: number; readonly kind: 'skip' }
  | {
      readonly step: number;
      readonly kind: 'enemies';
      readonly enabled: boolean;
      readonly difficulty: Difficulty;
      readonly count: number;
    };

/** 記録 1 本（メモリ上の形） */
export interface ReplayData {
  readonly header: ReplayHeader;
  /** チャンネルごとのステップの値（FRAME_CHANNELS の順。長さは header.steps） */
  readonly channels: readonly Int16Array[];
  readonly commands: readonly ReplayCommand[];
}
