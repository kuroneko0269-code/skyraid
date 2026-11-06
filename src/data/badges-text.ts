// 9-10b で足した勲章の名前と条件の文: 段階の数えは表の badges.ladder.<id>（{n} にしきい値）、組み合わせは badges.combo.<family>
// （{kaiju}・{diff}・{mission}・{aircraft}・{assist}・{course}・{map} に今の言語の名前）から組み立てる
import { formatInteger } from '../core/format';
import { t } from '../core/i18n';
import { findAircraftModel } from './aircraft';
import type { BadgeCombo, BadgeStat } from './badges-catalog';
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

export function comboName(c: BadgeCombo): string {
  return t(`badges.combo.${c.family}.name`, comboParams(c));
}

export function comboNote(c: BadgeCombo): string {
  return t(`badges.combo.${c.family}.note`, comboParams(c));
}

/** 段階の数えの表のキーと値（機体ごとは 1 つの文に機体の名前） */
function ladderParams(s: BadgeStat): { key: string; params: Record<string, string> } {
  const n = formatInteger(s.shown);
  if (s.ladder.startsWith('ac.'))
    return { key: 'ac', params: { n, aircraft: word('aircraft', s.ladder.slice(3)) } };
  return { key: s.ladder, params: { n } };
}

export function ladderName(s: BadgeStat): string {
  const { key, params } = ladderParams(s);
  return t(`badges.ladder.${key}.name`, params);
}

export function ladderNote(s: BadgeStat): string {
  const { key, params } = ladderParams(s);
  return t(`badges.ladder.${key}.note`, params);
}

/** 進み具合の数の表示（時間・km は単位を換算して切り捨て） */
export function statShown(s: BadgeStat, value: number): number {
  const scale = s.goal / Math.max(1e-9, s.shown);
  return Math.floor(value / scale);
}
