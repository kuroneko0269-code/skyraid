// 勲章の名前（9-10c: すべて「〜した」の条件の文）と補足と段の短い名前: 9-10 からの勲章は表の badges.items.<id>、段階の数えは
// badges.ladder.<id>（{n} にしきい値）、組み合わせは badges.combo.<family>（{kaiju}・{diff}・{mission}・{aircraft}・{assist}・
// {course}・{map} に今の言語の名前）、収集は badges.collect。それぞれ name が名前、note（無くてもよい）が詳細の補足
import { formatInteger } from '../core/format';
import { hasMessage, t } from '../core/i18n';
import { findAircraftModel } from './aircraft';
import type { BadgeCombo, BadgeDef, BadgeStat, BadgeStep } from './badges-catalog';
import { COURSES } from './courses';
import { DEFENSE_MAPS } from './defense';
import { isRaidKaijuId, raidKaijuName } from './raid-kaiju';

/** 組み合わせの値 → 今の言語の名前 */
function word(kind: string, id: string): string {
  switch (kind) {
    case 'kaiju':
      return isRaidKaijuId(id) ? raidKaijuName(id) : id;
    case 'mission':
      return t(`missions.${id}.title`);
    case 'aircraft':
      return findAircraftModel(id)?.name ?? id;
    case 'course':
      return COURSES.find((c) => c.id === id)?.name ?? id;
    case 'map':
      return DEFENSE_MAPS.find((m) => m.mapId === id)?.name ?? id;
    default:
      return t(`badges.words.${kind}.${id}`);
  }
}

function comboParams(c: BadgeCombo): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.params)) out[k] = word(k, v);
  // 補助の組は名前に短い形も（「補助むずかしい」）
  if (c.params.assist !== undefined) out.assistShort = word('assistShort', c.params.assist);
  return out;
}

/** 段階の数えの表のキーと値（機体ごとは 1 つの文に機体の名前） */
function ladderParams(s: BadgeStat): { key: string; params: Record<string, string> } {
  const n = formatInteger(s.shown);
  if (s.ladder.startsWith('ac.'))
    return { key: 'ac', params: { n, aircraft: word('aircraft', s.ladder.slice(3)) } };
  return { key: s.ladder, params: { n } };
}

/** 表のキー（name・note の親）と値 */
function textOf(def: BadgeDef): { key: string; params: Record<string, string> } {
  if (def.stat) {
    const { key, params } = ladderParams(def.stat);
    return { key: `badges.ladder.${key}`, params };
  }
  if (def.combo) return { key: `badges.combo.${def.combo.family}`, params: comboParams(def.combo) };
  if (def.collect !== undefined)
    return { key: 'badges.collect', params: { pct: String(Math.round(def.collect * 100)) } };
  return { key: `badges.items.${def.id}`, params: {} };
}

export function badgeTitleOf(def: BadgeDef): string {
  const { key, params } = textOf(def);
  return t(`${key}.name`, params);
}

export function badgeNoteOf(def: BadgeDef): string {
  const { key, params } = textOf(def);
  return hasMessage(`${key}.note`) ? t(`${key}.note`, params) : '';
}

/** 段の短い名前（数は単位つき） */
export function stepText(step: BadgeStep): string {
  if ('key' in step) return t(step.key);
  if ('word' in step) return word(step.word, step.id);
  const n = formatInteger(step.n);
  return step.unit === 'count' ? n : t(`badges.unit.${step.unit}`, { n });
}

export function badgeStepOf(def: BadgeDef): string {
  return def.step ? stepText(def.step) : '';
}

/** 進み具合の数の表示（時間・km は単位を換算して切り捨て） */
export function statShown(s: BadgeStat, value: number): number {
  const scale = s.goal / Math.max(1e-9, s.shown);
  return Math.floor(value / scale);
}
