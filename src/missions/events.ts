// ミッションランナーが流すイベント（2-4）。HUD・リザルト画面・報酬の受け皿（フェーズ3 で保存）が購読する
import type { Rank } from '../data/ranking';
import type { ObjectiveStatus } from './objectives';
import type { FailCondition, MissionDef, ObjectiveDef } from './types';

export type MissionOutcome = 'success' | 'failed' | 'aborted';

export interface ObjectiveResult {
  readonly id: string;
  readonly def: ObjectiveDef;
  readonly status: ObjectiveStatus;
  readonly current: number;
  readonly target: number;
}

export interface MissionResult {
  readonly missionId: string;
  readonly outcome: MissionOutcome;
  readonly failReason: FailCondition | null;
  /** 開始から終わるまで（秒） */
  readonly elapsedSeconds: number;
  /** 受けたダメージの合計（HP の単位）と最大 HP */
  readonly damageTaken: number;
  readonly maxHp: number;
  readonly objectives: readonly ObjectiveResult[];
  /** 成功したときだけランクが付く */
  readonly rank: Rank | null;
  /** 獲得クレジット（失敗・中断は 0） */
  readonly credits: number;
}

export interface MissionEvents extends Record<string, unknown> {
  'mission:start': { readonly def: MissionDef };
  /** 目標が始まった（順番が来た） */
  'objective:activate': { readonly index: number; readonly id: string };
  /** 進み具合が変わった（始まったときにも 1 回） */
  'objective:progress': {
    readonly index: number;
    readonly id: string;
    readonly current: number;
    readonly target: number;
  };
  'objective:complete': { readonly index: number; readonly id: string };
  /** 戦域の境界の外に出た・戻った・カウントの整数が変わった */
  'boundary:change': { readonly outside: boolean; readonly secondsLeft: number };
  /** 成功 / 失敗が決まった */
  'mission:end': { readonly result: MissionResult };
  /** 中断した */
  'mission:abort': { readonly result: MissionResult };
  /** 獲得クレジット（保存・残高はフェーズ3。今は知らせるだけ） */
  'mission:reward': {
    readonly missionId: string;
    readonly credits: number;
    readonly rank: Rank | null;
  };
}
