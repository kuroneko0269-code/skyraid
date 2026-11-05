// 日替わりチャレンジ（9-9）の決めた数値: 日の切り替え（日本時間の 0 時）・課題の種類 4 つと難しさ ★1〜3 ごとの差・天候と機体の候補・
// スコアの範囲・セーブに残す日数。条件の選び方は src/missions/daily/schedule.ts（決まった計算）、組み立ては src/missions/daily/setup.ts。
// 決定は docs/decisions.md の 9-9
import { t } from '../core/i18n';
import type { Difficulty } from './ai';

/** 課題の種類。targets: 的あて（止まった的）/ drones: 動く的 / gauntlet: 敵機の連戦 / race: 海岸周回のリングレース（周回） */
export const DAILY_KINDS = ['targets', 'drones', 'gauntlet', 'race'] as const;
export type DailyKind = (typeof DAILY_KINDS)[number];

/** 難しさ（★の数） */
export const DAILY_TIERS = [1, 2, 3] as const;
export type DailyTier = (typeof DAILY_TIERS)[number];

export const DAILY_CONFIG = {
  /**
   * 日の切り替え: 日本時間（UTC+9。夏時間なし）の 0 時。端末の時間帯・言語によらず、時刻（UTC のミリ秒）に 9 時間を足して日で割る。
   * 端末の時計が狂っていると日付がずれる（サーバーの時刻は使わない: オフラインでも遊べるように）
   */
  dayOffsetMs: 9 * 60 * 60 * 1000,
  /** 条件の計算の版（選び方を変えたら上げる。同じ日でも版が違えば別の課題としてランキングを分ける） */
  version: 1,
  /**
   * 1 回の長さ（秒）。練習場（60 / 75 / 90 秒）より長い 2〜2.5 分。レースは周回の数で 2〜4 分（下の race.laps）
   */
  durations: { targets: 120, drones: 120, gauntlet: 150 },
  /** 的あて: 同時に出ている的の数（★1 は練習場と同じ 10。少ないほど探す時間が増える） */
  targetCount: { 1: 10, 2: 7, 3: 5 } satisfies Record<DailyTier, number>,
  /** 動く的: ドローンの速さの倍率（練習場の 110 m/s に掛ける） */
  droneSpeed: { 1: 1, 2: 1.2, 3: 1.4 } satisfies Record<DailyTier, number>,
  /** 敵機の連戦: 模擬の敵の飛び方（撃ち返さない・HP ×0.6 は練習場と同じ） */
  gauntletDifficulty: { 1: 'rookie', 2: 'easy', 3: 'normal' } satisfies Record<
    DailyTier,
    Difficulty
  >,
  /**
   * リングレース: 海岸周回（coast。最後のリングから最初のリングまで約 1.7km のまっすぐ）を周回する。
   * 周回の数は ★1 = 2 周・★2 = 3 周・★3 = 4 周（ゴールドタイム 48 秒 × 周回 + 戻りの区間で 1.8〜3.6 分、ふつうは 2〜4.5 分）
   */
  race: { courseId: 'coast', laps: { 1: 2, 2: 3, 3: 4 } satisfies Record<DailyTier, number> },
  /**
   * 天候の候補（種類ごと）。的が見えなくなるほどの霧・雨の夜は的の課題から外す（レースはリングが光るので夜も入れる）
   */
  weathers: {
    targets: ['day-clear', 'dawn-clear', 'evening-clear', 'day-overcast', 'day-rain'],
    drones: ['day-clear', 'dawn-clear', 'evening-clear', 'day-overcast', 'day-rain'],
    gauntlet: ['day-clear', 'dawn-clear', 'evening-clear', 'day-overcast', 'night-clear'],
    race: ['day-clear', 'dawn-clear', 'evening-clear', 'night-clear', 'day-overcast', 'dawn-fog'],
  } satisfies Record<DailyKind, readonly string[]>,
  /** 機体の候補（ハンガーの 4 機。強化はすべて Lv0 = 全員同じ。持っていない機体でも乗れる） */
  aircraft: ['kestrel', 'swift', 'bastion', 'vector'],
  /** 難しさの重み（★1・★2・★3 の出やすさ。合計で割る） */
  tierWeights: { 1: 3, 2: 4, 3: 3 } satisfies Record<DailyTier, number>,
  /** セーブに残す日数（その日の最高。古い日から捨てる。連続日数は別に持つ） */
  keepDays: 14,
  /** つながったときに送り直す日数（今日を含めて。サーバーも同じ日数より古い日を拒否する） */
  sendDays: 7,
  /** スコアの範囲（的の課題。サーバーの check と同じ）。撃墜 ×（100 + 命中率%）で、2.5 分では届かない上限 */
  scoreMax: 50000,
  /** ランキングに出す数（ビューの上位と同じ） */
  rankingTop: 50,
} as const;

/** 種類の名前と説明（表の daily.kinds.<kind>） */
export function dailyKindLabel(kind: DailyKind): { name: string; note: string } {
  return { name: t(`daily.kinds.${kind}.name`), note: t(`daily.kinds.${kind}.note`) };
}

export function isDailyKind(v: unknown): v is DailyKind {
  return typeof v === 'string' && (DAILY_KINDS as readonly string[]).includes(v);
}

export function isDailyTier(v: unknown): v is DailyTier {
  return v === 1 || v === 2 || v === 3;
}

/** スコアが大きいほど良い種類か（レースはタイムなので小さいほど良い） */
export function dailyHigherIsBetter(kind: DailyKind): boolean {
  return kind !== 'race';
}
