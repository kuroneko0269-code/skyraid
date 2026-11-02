// 記録カード（8-5）の中身: 結果（core/card-source.ts）から、カードに載せる文と共有の文面を今の言語で組み立てる（DOM 非依存）。
// 載せるのはゲーム名・モード・ステージ・評価・スコアまたはタイム・機体と塗装・パイロット名（選んだときだけ）・日付・遊べる URL
import type { CardModel } from '../../core/card-layout';
import type { CardSource } from '../../core/card-source';
import { formatDate, formatInteger } from '../../core/format';
import { t } from '../../core/i18n';
import { findAircraftModel } from '../../data/aircraft';
import { APP_MANIFEST } from '../../data/app';
import { CARD_CONFIG } from '../../data/card';
import { findCourse } from '../../data/courses';
import { DEFENSE_CONFIG, findDefenseMap } from '../../data/defense';
import { SKIN_PALETTE, findSkinPattern } from '../../data/skins';
import { formatRaceTime } from '../../missions/race/score';
import type { Paint } from '../../progression/paint';
import { formatClock, missionStrings } from '../mission-text';

export interface CardOptions {
  readonly includePilot: boolean;
  /** 遊べる URL（https://…/） */
  readonly url: string;
}

/** https:// と末尾の / を外した表示用の URL */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function skinLabel(paint: Readonly<Paint> | null): string {
  if (!paint) return t('card.skinDefault');
  const pattern = findSkinPattern(paint.pattern)?.name ?? paint.pattern;
  const color = SKIN_PALETTE[paint.base]?.name;
  return color ? t('card.skin', { pattern, color }) : pattern;
}

export function buildCardModel(s: CardSource, o: CardOptions): CardModel {
  const common = {
    gameName: APP_MANIFEST.name,
    aircraft: findAircraftModel(s.aircraftId)?.name ?? s.aircraftId,
    skin: skinLabel(s.paint),
    pilot: o.includePilot && s.pilotName ? s.pilotName : null,
    date: formatDate(s.date),
    url: displayUrl(o.url),
  };
  switch (s.mode) {
    case 'mission':
      return {
        ...common,
        mode: t('card.mode.mission'),
        stage: missionStrings(s.missionId).title,
        headline: s.success ? 'MISSION COMPLETE' : 'MISSION FAILED',
        success: s.success,
        rank: s.success ? s.rank : null,
        metric: { label: t('card.metric.time'), value: formatClock(s.seconds) },
        facts: [],
      };
    case 'raid':
      return {
        ...common,
        mode: t('card.mode.raid'),
        stage: t(s.difficulty === 'hard' ? 'replay.title.raidHard' : 'replay.title.raidNormal'),
        headline: s.success ? 'MISSION COMPLETE' : 'MISSION FAILED',
        success: s.success,
        rank: s.success ? s.rank : null,
        metric: {
          label: t(s.success ? 'card.metric.clearTime' : 'card.metric.elapsed'),
          value: formatClock(s.seconds),
        },
        facts:
          s.protectedBuildings === null
            ? []
            : [{ label: t('card.fact.protected'), value: `${s.protectedBuildings}%` }],
      };
    case 'race':
      return {
        ...common,
        mode: t('card.mode.race'),
        stage: findCourse(s.courseId)?.name ?? s.courseId,
        headline: s.finished ? 'FINISH' : 'TIME OVER',
        success: s.finished,
        rank: s.finished ? s.rank : null,
        metric: { label: t('card.metric.time'), value: formatRaceTime(s.time) },
        facts: s.newBest ? [{ label: t('card.fact.newBest'), value: '' }] : [],
      };
    case 'defense': {
      const map = findDefenseMap(s.mapId).name;
      const difficulty = t(
        s.difficulty === 'hard' ? 'defense.difficulty.hard' : 'defense.difficulty.normal',
      );
      return {
        ...common,
        mode: t('card.mode.defense'),
        stage: t('defense.result.info', { map, difficulty }),
        headline: t(s.cleared ? 'defense.outcome.cleared' : 'defense.outcome.fallen'),
        success: s.cleared,
        rank: null,
        metric: { label: t('card.metric.waves'), value: `${s.waves} / ${DEFENSE_CONFIG.waves}` },
        facts: [{ label: t('card.fact.kills'), value: formatInteger(s.kills) }],
      };
    }
  }
}

/** 共有の文面（今の言語）。1 行目に結果、2 行目に URL */
export function cardShareText(m: CardModel, url: string): string {
  const sep = t('card.sep');
  const parts = [m.headline];
  if (m.rank) parts.push(t('card.resultRank', { rank: m.rank }));
  parts.push(`${m.metric.label} ${m.metric.value}`);
  const line = t('card.shareText', {
    game: m.gameName,
    mode: m.mode,
    stage: m.stage,
    result: parts.join(sep),
    hashtag: CARD_CONFIG.hashtag,
  });
  return `${line}\n${url}`;
}
