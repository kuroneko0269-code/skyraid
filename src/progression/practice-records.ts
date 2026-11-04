// 練習場（9-5）の記録（Three.js・DOM 非依存）: 課題ごとに「設定の組み合わせ × 機体」ごとの最高スコアを端末のセーブに持つ
// （records.practice。v9 のまま足した: 無いセーブは空として読む）。設定は入力系統と、タッチなら方式・狙いの補助・自動射撃・カーブ。
// クレジットは出さず、オンラインのランキングにも送らない（稼ぎ場にしない・設定で条件が違う）
import type { InputDevice } from '../core/input';
import type { ControlSettings } from '../core/control-settings';
import { AIM_ASSIST_LEVELS } from '../data/assist';
import { isPracticeDrill, PRACTICE_CONFIG, type PracticeDrill } from '../data/practice';
import { STEER_MODES, STICK_CURVES, type SteerMode, type StickCurve } from '../data/steer';
import type { PracticeResult } from '../missions/practice/score';
import { isObject } from './save-settings';

/** 練習のときの設定（記録の見出し）。aimAssist の off は設定の「エイムアシスト」（4-12）が OFF */
export interface PracticeSettings {
  readonly device: InputDevice;
  /** タッチのときだけ（キーボード・パッドは null） */
  readonly touch: {
    readonly steerMode: SteerMode;
    readonly aimAssist: (typeof AIM_ASSIST_LEVELS)[number] | 'off';
    readonly autoFire: boolean;
    readonly curve: StickCurve;
  } | null;
}

export interface PracticeEntry {
  /** practiceSettingsKey（設定）と機体 */
  readonly settings: string;
  readonly aircraftId: string;
  readonly score: number;
  readonly kills: number;
  /** 命中率（0〜1。撃っていなければ null） */
  readonly accuracy: number | null;
  /** 記録した時刻（ミリ秒） */
  readonly date: number;
}

export type PracticeRecords = Partial<Record<PracticeDrill, PracticeEntry[]>>;

/**
 * 今の設定（device は始めた時点で最後に操作した入力系統、steerMode は効いている方式（傾きの許可を待つ間は direct）、
 * aimOn は設定の「エイムアシスト」（4-12））
 */
export function practiceSettingsOf(
  c: Readonly<ControlSettings>,
  device: InputDevice,
  steerMode: SteerMode,
  aimOn: boolean,
): PracticeSettings {
  if (device !== 'touch') return { device, touch: null };
  return {
    device,
    touch: {
      steerMode,
      aimAssist: aimOn ? c.aimAssist : 'off',
      autoFire: c.autoFire,
      curve: c.stickCurve,
    },
  };
}

/** 記録の見出しの文字列（「touch:direct:normal:1:1.5」「keyboard」） */
export function practiceSettingsKey(s: Readonly<PracticeSettings>): string {
  const t = s.touch;
  if (!t) return s.device;
  return [s.device, t.steerMode, t.aimAssist, t.autoFire ? '1' : '0', String(t.curve)].join(':');
}

/** 見出しの文字列を読む（読めなければ null） */
export function parsePracticeSettings(key: string): PracticeSettings | null {
  const [device, mode, assist, auto, curve, ...rest] = key.split(':');
  if (device === 'keyboard' || device === 'gamepad')
    return mode === undefined ? { device, touch: null } : null;
  if (device !== 'touch' || rest.length > 0) return null;
  const steerMode = STEER_MODES.find((m) => m === mode);
  const aimAssist = [...AIM_ASSIST_LEVELS, 'off' as const].find((a) => a === assist);
  const c = STICK_CURVES.find((v) => String(v) === curve);
  if (!steerMode || !aimAssist || c === undefined || (auto !== '0' && auto !== '1')) return null;
  return { device, touch: { steerMode, aimAssist, autoFire: auto === '1', curve: c } };
}

export interface PracticeRecordOutcome {
  /** 課題の中の最高を更新した（初めての記録も） */
  readonly newBest: boolean;
  /** この設定・機体の最高を更新した（初めても） */
  readonly newSettingsBest: boolean;
  /** 更新の前の、この設定・機体の最高（無ければ null） */
  readonly previous: PracticeEntry | null;
  /** 課題の中の最高（更新した後） */
  readonly best: PracticeEntry | null;
}

/** 課題の記録（スコアの高い順） */
export function practiceEntries(
  r: Readonly<PracticeRecords>,
  drill: PracticeDrill,
): PracticeEntry[] {
  return [...(r[drill] ?? [])].sort((a, b) => b.score - a.score || a.date - b.date);
}

/** 結果を記録する（この設定・機体の最高のときだけ書く。課題ごとに maxEntries 個まで。低いものから捨てる） */
export function recordPractice(
  r: PracticeRecords,
  result: Readonly<PracticeResult>,
  settings: string,
  aircraftId: string,
  date: number,
): PracticeRecordOutcome {
  const list = practiceEntries(r, result.drill);
  const top = list[0] ?? null;
  const previous = list.find((e) => e.settings === settings && e.aircraftId === aircraftId) ?? null;
  const entry: PracticeEntry = {
    settings,
    aircraftId,
    score: result.score,
    kills: result.kills,
    accuracy: result.accuracy === null ? null : Math.round(result.accuracy * 1000) / 1000,
    date,
  };
  const newSettingsBest = previous === null || entry.score > previous.score;
  if (newSettingsBest) {
    const next = list.filter((e) => e !== previous);
    next.push(entry);
    r[result.drill] = practiceEntries({ [result.drill]: next }, result.drill).slice(
      0,
      PRACTICE_CONFIG.maxEntries,
    );
  }
  const newBest = top === null || entry.score > top.score;
  return { newBest, newSettingsBest, previous, best: practiceEntries(r, result.drill)[0] ?? null };
}

/** 読み込んだ値を確かめる（壊れた行・知らない課題は捨てる） */
export function normalizePracticeRecords(raw: unknown): PracticeRecords {
  const out: PracticeRecords = {};
  if (!isObject(raw)) return out;
  const n = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  for (const [drill, rows] of Object.entries(raw)) {
    if (!isPracticeDrill(drill) || !Array.isArray(rows)) continue;
    const list: PracticeEntry[] = [];
    for (const row of rows as unknown[]) {
      if (!isObject(row)) continue;
      const { settings, aircraftId, score, kills, accuracy, date } = row;
      if (typeof settings !== 'string' || !parsePracticeSettings(settings)) continue;
      if (typeof aircraftId !== 'string' || !n(score) || !n(kills) || !n(date)) continue;
      if (accuracy !== null && !(n(accuracy) && accuracy <= 1)) continue;
      list.push({ settings, aircraftId, score, kills, accuracy, date });
    }
    if (list.length > 0)
      out[drill] = practiceEntries({ [drill]: list }, drill).slice(0, PRACTICE_CONFIG.maxEntries);
  }
  return out;
}
