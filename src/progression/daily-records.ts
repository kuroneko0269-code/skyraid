// 日替わりチャレンジ（9-9）の記録（Three.js・DOM 非依存）: 日ごとのその日の最高（条件の見出し・値・補助の組・挑戦の回数・
// 送った値）と、続けて遊んだ日数。records.daily に v9 のまま足した（無いセーブは空として読む）。
// 古い日は DAILY_CONFIG.keepDays を超えたら捨てる（連続日数は streak に別に持つので消えない）
import { DAILY_CONFIG, isDailyKind, type DailyKind } from '../data/daily';
import { dailyBetter } from '../missions/daily/setup';
import { parseDailyDayKey } from '../missions/daily/schedule';
import { isObject } from './save-settings';

/** 補助の組（かんたん / ふつう / むずかしい / カスタム。キーボード・パッドはカスタム） */
export const DAILY_PRESETS = ['easy', 'normal', 'hard', 'custom'] as const;
export type DailyPreset = (typeof DAILY_PRESETS)[number];

export function isDailyPreset(v: unknown): v is DailyPreset {
  return typeof v === 'string' && (DAILY_PRESETS as readonly string[]).includes(v);
}

export interface DailyEntry {
  /** 条件の見出し（dailySpecKey） */
  readonly spec: string;
  readonly kind: DailyKind;
  /** その日の最高（的の課題はスコア、レースはタイムのミリ秒。完走していなければ null） */
  readonly best: number | null;
  /** 最高を出したときの補助の組 */
  readonly preset: DailyPreset | null;
  /** 最高を出した時刻（ミリ秒） */
  readonly at: number | null;
  /** 挑戦した回数（結果まで進んだ回） */
  readonly attempts: number;
  /** サーバーに送った最高（送っていなければ null。best と違えば送り直す） */
  readonly sent: number | null;
}

export interface DailyRecords {
  /** 日（YYYY-MM-DD）→ その日の記録 */
  days: Record<string, DailyEntry>;
  /** 続けて遊んだ日数: 最後に遊んだ日と、その日までの連続の数 */
  streak: { last: string | null; count: number };
}

export function defaultDailyRecords(): DailyRecords {
  return { days: {}, streak: { last: null, count: 0 } };
}

export interface DailyRecordOutcome {
  /** その日の最高を更新した（初めての記録も） */
  readonly newBest: boolean;
  /** 前の最高（無ければ null） */
  readonly previous: number | null;
  readonly entry: DailyEntry;
  /** 今の連続日数 */
  readonly streak: number;
}

/** 1 回の結果を記録する（value が null は完走していない回。挑戦の回数と連続日数だけ数える） */
export function recordDaily(
  r: DailyRecords,
  play: {
    day: string;
    spec: string;
    kind: DailyKind;
    value: number | null;
    preset: DailyPreset;
    at: number;
  },
): DailyRecordOutcome {
  const prev = r.days[play.day];
  // 条件が違う（版をまたいだ・壊れた）記録は今日の記録として扱わない
  const same = prev !== undefined && prev.spec === play.spec ? prev : null;
  const previous = same?.best ?? null;
  const newBest =
    play.value !== null && (previous === null || dailyBetter(play.kind, play.value, previous));
  const entry: DailyEntry = {
    spec: play.spec,
    kind: play.kind,
    best: newBest ? play.value : previous,
    preset: newBest ? play.preset : (same?.preset ?? null),
    at: newBest ? play.at : (same?.at ?? null),
    attempts: (same?.attempts ?? 0) + 1,
    sent: same?.sent ?? null,
  };
  r.days[play.day] = entry;
  bumpStreak(r, play.day);
  pruneDays(r);
  return { newBest, previous, entry, streak: r.streak.count };
}

/** 連続日数を進める（同じ日は数えない・前の日の続きなら +1・それ以外は 1 から） */
function bumpStreak(r: DailyRecords, day: string): void {
  const n = parseDailyDayKey(day);
  const last = r.streak.last === null ? null : parseDailyDayKey(r.streak.last);
  if (n === null) return;
  if (last !== null && n <= last) return;
  r.streak = { last: day, count: last !== null && n === last + 1 ? r.streak.count + 1 : 1 };
}

/** 今の連続日数（最後に遊んだ日が今日か昨日なら続いている。それより前なら途切れて 0） */
export function currentStreak(r: Readonly<DailyRecords>, today: string): number {
  const n = parseDailyDayKey(today);
  const last = r.streak.last === null ? null : parseDailyDayKey(r.streak.last);
  if (n === null || last === null) return 0;
  return n - last <= 1 && n >= last ? r.streak.count : 0;
}

/** 古い日を捨てる（新しい順に keepDays 日） */
function pruneDays(r: DailyRecords): void {
  const keys = Object.keys(r.days).sort();
  if (keys.length <= DAILY_CONFIG.keepDays) return;
  r.days = Object.fromEntries(
    keys.slice(-DAILY_CONFIG.keepDays).flatMap((k) => {
      const e = r.days[k];
      return e ? [[k, e] as const] : [];
    }),
  );
}

/** まだ送っていない最高（送り直す日数の中だけ。古い順） */
export function unsentDaily(
  r: Readonly<DailyRecords>,
  today: string,
): { day: string; entry: DailyEntry }[] {
  const n = parseDailyDayKey(today);
  if (n === null) return [];
  return Object.entries(r.days)
    .filter(([day, e]) => {
      const d = parseDailyDayKey(day);
      return (
        d !== null &&
        n - d < DAILY_CONFIG.sendDays &&
        d <= n &&
        e.best !== null &&
        e.best !== e.sent
      );
    })
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, entry]) => ({ day, entry }));
}

/** 送れた（送った値を残す。そのあいだに最高が変わっていれば次にまた送る） */
export function markDailySent(r: DailyRecords, day: string, value: number): boolean {
  const e = r.days[day];
  if (!e || e.sent === value) return false;
  r.days[day] = { ...e, sent: value };
  return true;
}

const intOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

/** 読み込んだ値を確かめる（壊れた日は捨てる） */
export function normalizeDailyRecords(raw: unknown): DailyRecords {
  const out = defaultDailyRecords();
  if (!isObject(raw)) return out;
  if (isObject(raw.days))
    for (const [day, e] of Object.entries(raw.days)) {
      if (parseDailyDayKey(day) === null || !isObject(e)) continue;
      if (typeof e.spec !== 'string' || e.spec.length > 64 || !isDailyKind(e.kind)) continue;
      out.days[day] = {
        spec: e.spec,
        kind: e.kind,
        best: intOrNull(e.best),
        preset: isDailyPreset(e.preset) ? e.preset : null,
        at: intOrNull(e.at),
        attempts: intOrNull(e.attempts) ?? 0,
        sent: intOrNull(e.sent),
      };
    }
  pruneDays(out);
  if (isObject(raw.streak)) {
    const last = raw.streak.last;
    const count = intOrNull(raw.streak.count) ?? 0;
    if (typeof last === 'string' && parseDailyDayKey(last) !== null && count > 0)
      out.streak = { last, count };
  }
  return out;
}
