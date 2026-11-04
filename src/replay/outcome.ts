// リプレイの一覧に出す題と結果（7-B。Three.js・DOM 非依存）
import { t, tn } from '../core/i18n';
import { findCourse } from '../data/courses';
import { findDefenseMap } from '../data/defense';
import { findMap } from '../data/maps';
import { isPracticeDrill, PRACTICE_DRILL_LABELS } from '../data/practice';
import type { DefenseRunner } from '../missions/defense/runner';
import type { GamePlay } from '../missions/game-play';
import { missionStrings } from '../ui/mission-text';
import {
  isOtherGameVersion,
  replayGameVersion,
  type ReplayHeader,
  type ReplayOutcome,
  type ReplayResult,
  type ReplayStart,
} from './types';

/** 一覧の題（ミッション名・コース名・マップ名） */
export function replayTitle(s: ReplayStart): string {
  switch (s.mode) {
    case 'mission':
      return missionStrings(s.missionId ?? '').title;
    case 'raid':
      return t(s.raidDifficulty === 'hard' ? 'replay.title.raidHard' : 'replay.title.raidNormal');
    case 'race':
      return findCourse(s.courseId ?? '')?.name ?? t('replay.title.race');
    case 'defense': {
      const map = findDefenseMap(s.mapId).name;
      return s.defenseDifficulty === 'hard' ? t('replay.title.defenseHard', { map }) : map;
    }
    case 'practice':
      return isPracticeDrill(s.practiceDrill)
        ? PRACTICE_DRILL_LABELS[s.practiceDrill].name
        : t('replay.modes.practice');
    default:
      return findMap(s.mapId).name;
  }
}

/** 秒 → 「1:23.456」 */
export function formatRaceTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m)}:${s.toFixed(3).padStart(6, '0')}`;
}

/** 秒 → 「12:34」 */
export function formatClock(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(t / 60))}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * 今の飛行の結果（終わっていなければ「中断」。フリーフライトは撃墜数）。
 * lastDefense: ポーズメニューの中断は記録を終える前に防衛戦を捨てるので、直前の防衛戦（波数の表示に使う。7-C）
 */
export function replayOutcome(
  play: GamePlay,
  mode: ReplayStart['mode'],
  lastDefense: DefenseRunner | null = null,
): ReplayOutcome {
  const [result, success] = outcomeResult(play, mode, lastDefense);
  return { label: resultLabel(result), success, result };
}

function outcomeResult(
  play: GamePlay,
  mode: ReplayStart['mode'],
  lastDefense: DefenseRunner | null,
): [ReplayResult, boolean] {
  switch (mode) {
    case 'mission':
    case 'raid': {
      const r = play.runner?.result;
      if (!r || r.outcome === 'aborted') return [{ kind: 'aborted' }, false];
      if (r.outcome === 'success') return [{ kind: 'success', rank: r.rank }, true];
      return [{ kind: 'failed' }, false];
    }
    case 'race': {
      const r = play.race?.result;
      if (!r) return [{ kind: 'aborted' }, false];
      if (r.outcome === 'timeout') return [{ kind: 'timeout' }, false];
      return [{ kind: 'race', time: r.time, rank: r.rank }, true];
    }
    case 'defense': {
      const d = play.defense ?? lastDefense;
      if (!d) return [{ kind: 'aborted' }, false];
      if (d.phase === 'cleared') return [{ kind: 'defended' }, true];
      if (d.phase === 'failed') return [{ kind: 'fallen', count: d.wavesCleared }, false];
      return [{ kind: 'abortedWaves', count: d.wavesCleared }, false];
    }
    case 'practice': {
      const r = play.practice?.result;
      if (!r) return [{ kind: 'aborted' }, false];
      return [{ kind: 'practice', score: r.score, kills: r.kills }, true];
    }
    default:
      return [{ kind: 'kills', count: play.session.combat.kills }, true];
  }
}

/** 結果の短い文（今の言語） */
function resultLabel(r: ReplayResult): string {
  switch (r.kind) {
    case 'aborted':
      return t('replay.outcome.aborted');
    case 'failed':
      return t('replay.outcome.failed');
    case 'defended':
      return t('replay.outcome.defended');
    case 'timeout':
      return 'TIME OVER';
    case 'success':
      return t('replay.outcome.success', { rank: r.rank ?? '' }).trim();
    case 'race':
      return `${formatRaceTime(r.time)} ${r.rank ?? ''}`.trim();
    case 'fallen':
      return tn('replay.outcome.fallen', r.count);
    case 'abortedWaves':
      return tn('replay.outcome.abortedWaves', r.count);
    case 'kills':
      return tn('replay.outcome.kills', r.count);
    case 'practice':
      return t('replay.outcome.practice', { score: String(r.score), kills: String(r.kills) });
  }
}

/**
 * 一覧・詳細に出す結果の文（8-5）: 種類と数値があれば今の言語で組み立て、無い（8-5 より前の記録）・読めない
 * （読み込んだファイルの中身がおかしい）ときは記録した文字列をそのまま出す
 */
export function replayOutcomeLabel(o: ReplayOutcome | null | undefined): string | null {
  if (!o) return null;
  const r = validResult(o.result);
  return r ? resultLabel(r) : typeof o.label === 'string' ? o.label : null;
}

const RANK_RE = /^[A-Z]{1,2}$/;

/** 読み込んだ記録の result を確かめる（インポートしたファイルは信用しない） */
function validResult(v: unknown): ReplayResult | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const count = (x: unknown): x is number =>
    typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 1e6;
  const rank = (x: unknown): x is string | null =>
    x === null || (typeof x === 'string' && RANK_RE.test(x));
  switch (r.kind) {
    case 'aborted':
    case 'failed':
    case 'defended':
    case 'timeout':
      return { kind: r.kind };
    case 'success':
      return rank(r.rank) ? { kind: 'success', rank: r.rank } : null;
    case 'race':
      return typeof r.time === 'number' && Number.isFinite(r.time) && r.time >= 0 && rank(r.rank)
        ? { kind: 'race', time: r.time, rank: r.rank }
        : null;
    case 'fallen':
    case 'abortedWaves':
    case 'kills':
      return count(r.count) ? { kind: r.kind, count: r.count } : null;
    case 'practice':
      return count(r.score) && count(r.kills)
        ? { kind: 'practice', score: r.score, kills: r.kills }
        : null;
    default:
      return null;
  }
}

/**
 * 今の版と違う版の記録の断り（8-7。版を持たない古い記録も「0.9.0 以前」として出す）。同じ版なら null。
 * 再生は止めない（数値の調整で結果が変わることがあるだけ）
 */
export function replayVersionNotice(header: ReplayHeader, current: string): string | null {
  if (!isOtherGameVersion(header, current)) return null;
  const version = replayGameVersion(header) ?? t('replay.status.unknownGameVersion');
  return t('replay.status.otherGameVersion', { version });
}

/**
 * 再生中に記録の毎秒の丸めたハッシュと違った（9-4）ときの断り。同じ版なら別の端末の記録（数学関数の最後の桁の違い）、
 * 違う版なら版の違い。再生は止めない
 */
export function replayDivergeNotice(
  header: ReplayHeader,
  current: string,
  seconds: number,
): string {
  const key = isOtherGameVersion(header, current) ? 'divergedVersion' : 'diverged';
  return t(`replay.status.${key}`, { seconds: String(seconds) });
}
