// リングレース（7-1）のコース定義の型（データは src/data/courses.ts。ロジックを含めない）
import type { Pose } from '../types';

/**
 * リングの種類: 通常 / ブースト（通過でアフターバーナーが無料で効く）/ 細い（半径半分・タイムボーナス）/
 * 必須チェックポイント（飛ばせない。スプリットタイムを取る）。最後のリング（ゴール）は種類によらずチェックポイント扱い
 */
export const RING_KINDS = ['normal', 'boost', 'thin', 'checkpoint'] as const;
export type RingKind = (typeof RING_KINDS)[number];

export interface CourseRingDef {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 通り抜ける向き（機首の方位。0 = −Z（北）、90 = +X（東））と上向きの角度（度） */
  readonly headingDeg: number;
  readonly pitchDeg: number;
  readonly kind: RingKind;
  /** 見た目の半径（m）。省略は 2-4 のリングと同じ 40。細いリングはさらに RACE_CONFIG.thinRadiusScale 倍 */
  readonly radius?: number;
}

export interface CourseDef {
  readonly id: string;
  readonly name: string;
  /** 一覧に出す一言と難易度 */
  readonly note: string;
  readonly level: string;
  readonly mapId: string;
  readonly weatherId: string;
  /** スタート地点（ここに止めてカウントダウン） */
  readonly start: Pose;
  readonly rings: readonly CourseRingDef[];
  /** 制限時間（走行の時計。超えると時間切れ） */
  readonly timeLimitSeconds: number;
  /** ゴールドタイム（目標。ランク S の基準。ボットの結果から決めた: tests/race-bot.test.ts） */
  readonly goldTimeSeconds: number;
}
