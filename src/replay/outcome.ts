// リプレイの一覧に出す題と結果（7-B。Three.js・DOM 非依存）
import { t, tn } from '../core/i18n';
import { findCourse } from '../data/courses';
import { findDefenseMap } from '../data/defense';
import { findMap } from '../data/maps';
import type { DefenseRunner } from '../missions/defense/runner';
import type { GamePlay } from '../missions/game-play';
import { missionStrings } from '../ui/mission-text';
import type { ReplayOutcome, ReplayStart } from './types';

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
  const kills = play.session.combat.kills;
  switch (mode) {
    case 'mission':
    case 'raid': {
      const r = play.runner?.result;
      if (!r || r.outcome === 'aborted')
        return { label: t('replay.outcome.aborted'), success: false };
      if (r.outcome === 'success')
        return { label: t('replay.outcome.success', { rank: r.rank ?? '' }).trim(), success: true };
      return { label: t('replay.outcome.failed'), success: false };
    }
    case 'race': {
      const r = play.race?.result;
      if (!r) return { label: t('replay.outcome.aborted'), success: false };
      if (r.outcome === 'timeout') return { label: 'TIME OVER', success: false };
      return { label: `${formatRaceTime(r.time)} ${r.rank ?? ''}`.trim(), success: true };
    }
    case 'defense': {
      const d = play.defense ?? lastDefense;
      if (!d) return { label: t('replay.outcome.aborted'), success: false };
      if (d.phase === 'cleared') return { label: t('replay.outcome.defended'), success: true };
      if (d.phase === 'failed')
        return { label: tn('replay.outcome.fallen', d.wavesCleared), success: false };
      return { label: tn('replay.outcome.abortedWaves', d.wavesCleared), success: false };
    }
    default:
      return { label: tn('replay.outcome.kills', kills), success: true };
  }
}
