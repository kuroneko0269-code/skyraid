// リングレース（7-1）の結果をセーブに記録する（Three.js・DOM 非依存）: ベスト 5（機体名・日付・装備のハッシュ）、
// ベストを更新したらゴーストを差し替え、最高ランクと報酬（初クリアはランクの額・ランク更新は差額・以降は 300 CR）
import { RACE_CONFIG } from '../data/race';
import type { Rank } from '../data/ranking';
import type { RaceResult } from '../missions/race/runner';
import { betterRank, raceReward } from '../missions/race/score';
import { emptyRaceRecord, type RaceGhost, type RaceRecord } from './save-races';
import type { UpgradeLevels } from './save';
import type { SaveStore } from './save-store';

/** 走った機体（装備のハッシュに使う） */
export interface RaceMachine {
  readonly aircraftId: string;
  readonly aircraftName: string;
  readonly levels: Readonly<UpgradeLevels>;
}

export interface RaceRecordOutcome {
  /** 獲得クレジット（時間切れは 0） */
  readonly credits: number;
  /** ベストタイムを更新した（初完走も） */
  readonly newBest: boolean;
  /** ベスト 5 の中の順位（1 始まり。入らなければ null） */
  readonly place: number | null;
  /** この走行の前の最高ランク */
  readonly previousRank: Rank | null;
  /** 記録の後のコースの記録 */
  readonly record: Readonly<RaceRecord>;
}

/**
 * 機体と強化 Lv のハッシュ（FNV-1a 32 bit の 16 進 8 桁）。同じ機体・同じ強化なら同じ値。
 * 7-4 のランキングで機体別・強化の状態別に分ける用
 */
export function loadoutHash(aircraftId: string, levels: Readonly<UpgradeLevels>): string {
  const text = `${aircraftId}|e${levels.engine}a${levels.airframe}w${levels.weapons}v${levels.avionics}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** ローカルの日付「YYYY-MM-DD」 */
export function localDate(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** コースの記録（なければ空） */
export function raceRecord(save: SaveStore, courseId: string): Readonly<RaceRecord> {
  return save.snapshot.races[courseId] ?? emptyRaceRecord();
}

/**
 * 結果を記録して保存し、報酬を残高に足す。ghostData はこの走行のゴースト（base64）。
 * 時間切れは何も記録しない（報酬 0）
 */
export function recordRace(
  save: SaveStore,
  result: RaceResult,
  machine: RaceMachine,
  ghostData: string,
  now: Date = new Date(),
): RaceRecordOutcome {
  const before = raceRecord(save, result.courseId);
  const previousRank = before.bestRank;
  if (result.outcome !== 'finished' || result.rank === null)
    return { credits: 0, newBest: false, place: null, previousRank, record: before };
  const rank = result.rank;
  const credits = raceReward(rank, previousRank);
  const best = before.times[0]?.time ?? Infinity;
  const newBest = result.time < best;
  let record: RaceRecord = before;
  let place: number | null = null;
  save.transact((data) => {
    const rec = (data.races[result.courseId] ??= emptyRaceRecord());
    rec.clears += 1;
    if (betterRank(rank, rec.bestRank)) rec.bestRank = rank;
    const entry = {
      time: result.time,
      aircraftId: machine.aircraftId,
      aircraftName: machine.aircraftName,
      date: localDate(now),
      loadoutHash: loadoutHash(machine.aircraftId, machine.levels),
      missed: result.missed,
    };
    // 同じタイムなら先の記録を上に
    let i = rec.times.findIndex((e) => e.time > entry.time);
    if (i < 0) i = rec.times.length;
    if (i < RACE_CONFIG.bestTimes) {
      rec.times.splice(i, 0, entry);
      rec.times.length = Math.min(rec.times.length, RACE_CONFIG.bestTimes);
      place = i + 1;
    }
    if (newBest) {
      const ghost: RaceGhost = {
        time: result.time,
        aircraftId: machine.aircraftId,
        hz: RACE_CONFIG.ghostHz,
        data: ghostData,
        ringTimes: [...result.ringTimes],
      };
      rec.ghost = ghost;
    }
    data.credits += credits;
    record = rec;
    return true;
  });
  return { credits, newBest, place, previousRank, record };
}
