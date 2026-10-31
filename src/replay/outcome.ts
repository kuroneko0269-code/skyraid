// リプレイの一覧に出す題と結果（7-B。Three.js・DOM 非依存）
import { findCourse } from '../data/courses';
import { findDefenseMap } from '../data/defense';
import { findMap } from '../data/maps';
import type { GamePlay } from '../missions/game-play';
import { missionStrings } from '../ui/mission-text';
import type { ReplayOutcome, ReplayStart } from './types';

/** 一覧の題（ミッション名・コース名・マップ名） */
export function replayTitle(s: ReplayStart): string {
  switch (s.mode) {
    case 'mission':
      return missionStrings(s.missionId ?? '', 'ja').title;
    case 'raid':
      return s.raidDifficulty === 'hard' ? 'ヴォルガス（高難度）' : 'ヴォルガス';
    case 'race':
      return findCourse(s.courseId ?? '')?.name ?? 'リングレース';
    case 'defense':
      return `${findDefenseMap(s.mapId).name}${s.defenseDifficulty === 'hard' ? '・高難度' : ''}`;
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

/** 今の飛行の結果（終わっていなければ「中断」。フリーフライトは撃墜数） */
export function replayOutcome(play: GamePlay, mode: ReplayStart['mode']): ReplayOutcome {
  const kills = play.session.combat.kills;
  switch (mode) {
    case 'mission':
    case 'raid': {
      const r = play.runner?.result;
      if (!r || r.outcome === 'aborted') return { label: '中断', success: false };
      if (r.outcome === 'success') return { label: `成功 ${r.rank ?? ''}`.trim(), success: true };
      return { label: '失敗', success: false };
    }
    case 'race': {
      const r = play.race?.result;
      if (!r) return { label: '中断', success: false };
      if (r.outcome === 'timeout') return { label: 'TIME OVER', success: false };
      return { label: `${formatRaceTime(r.time)} ${r.rank ?? ''}`.trim(), success: true };
    }
    case 'defense': {
      const d = play.defense;
      if (!d) return { label: '中断', success: false };
      if (d.phase === 'cleared') return { label: '防衛成功', success: true };
      if (d.phase === 'failed')
        return { label: `陥落（${String(d.wavesCleared)} 波）`, success: false };
      return { label: `中断（${String(d.wavesCleared)} 波）`, success: false };
    }
    default:
      return { label: `撃墜 ${String(kills)}`, success: true };
  }
}
