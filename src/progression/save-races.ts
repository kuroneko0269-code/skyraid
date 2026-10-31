// セーブのリングレース（7-1。v6 から）の記録: コースごとに最高ランク・完走回数・ベスト 5（機体名・日付・装備のハッシュ）・
// ゴースト 1 本。形の確認（normalizeRaces）は細かい不正値を捨てて読む（Three.js・DOM 非依存）
import { RACE_CONFIG } from '../data/race';
import { RANKS, type Rank } from '../data/ranking';
import { isObject, isOneOf } from './save-settings';

/** ベスト 5 の 1 行。loadoutHash は機体と強化 Lv のハッシュ（7-4 のランキングで機体別・強化別に分ける用） */
export interface RaceTimeEntry {
  time: number;
  aircraftId: string;
  aircraftName: string;
  /** 記録した日（ローカルの YYYY-MM-DD） */
  date: string;
  loadoutHash: string;
  /** 未通過のリングの数 */
  missed: number;
}

/** ベストタイムの走行のゴースト（位置・姿勢 15Hz を base64。src/missions/race/ghost.ts） */
export interface RaceGhost {
  time: number;
  aircraftId: string;
  hz: number;
  data: string;
  /** 各リングのタイム（ゴーストとの差・スプリットに使う） */
  ringTimes: number[];
}

export interface RaceRecord {
  bestRank: Rank | null;
  clears: number;
  /** 速い順、最大 RACE_CONFIG.bestTimes 件 */
  times: RaceTimeEntry[];
  ghost: RaceGhost | null;
}

export function emptyRaceRecord(): RaceRecord {
  return { bestRank: null, clears: 0, times: [], ghost: null };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function normalizeEntry(v: unknown): RaceTimeEntry | null {
  if (!isObject(v)) return null;
  const { time, aircraftId, aircraftName, date, loadoutHash, missed } = v;
  if (!isNum(time) || time < 0 || !isStr(aircraftId) || !isStr(aircraftName)) return null;
  return {
    time,
    aircraftId,
    aircraftName: aircraftName.slice(0, 32),
    date: isStr(date) ? date.slice(0, 10) : '',
    loadoutHash: isStr(loadoutHash) ? loadoutHash.slice(0, 16) : '',
    missed: isNum(missed) && missed >= 0 ? Math.round(missed) : 0,
  };
}

function normalizeGhost(v: unknown): RaceGhost | null {
  if (!isObject(v)) return null;
  const { time, aircraftId, hz, data, ringTimes } = v;
  if (!isNum(time) || !isStr(aircraftId) || !isNum(hz) || hz <= 0 || !isStr(data)) return null;
  if (!Array.isArray(ringTimes) || !ringTimes.every(isNum)) return null;
  return { time, aircraftId, hz, data, ringTimes: [...ringTimes] };
}

/** 読み込んだ races を確かめる。オブジェクトでなければ空。壊れた行・ゴーストはその項目だけ捨てる */
export function normalizeRaces(v: unknown): Record<string, RaceRecord> {
  const out: Record<string, RaceRecord> = {};
  if (!isObject(v)) return out;
  for (const [id, r] of Object.entries(v)) {
    if (!isObject(r)) continue;
    const times = Array.isArray(r.times)
      ? r.times
          .map(normalizeEntry)
          .filter((e): e is RaceTimeEntry => e !== null)
          .sort((a, b) => a.time - b.time)
          .slice(0, RACE_CONFIG.bestTimes)
      : [];
    out[id] = {
      bestRank: isOneOf(RANKS, r.bestRank) ? r.bestRank : null,
      clears: isNum(r.clears) && r.clears >= 0 ? Math.round(r.clears) : 0,
      times,
      ghost: normalizeGhost(r.ghost),
    };
  }
  return out;
}
