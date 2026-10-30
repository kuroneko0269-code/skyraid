// ミッションの表示用の文字列（HUD・ブリーフィング・リザルト。2-4）。DOM 非依存の純関数
import type { Locale } from '../core/locale';
import en from '../data/i18n/en.json';
import ja from '../data/i18n/ja.json';
import { DIFFICULTIES, DIFFICULTY_SHORT_LABELS, type Difficulty } from '../data/ai';
import type { FailCondition, MissionDef, ObjectiveDef, ObjectiveType } from '../missions/types';

/** 言語ごとの文（src/data/i18n/*.json）。ミッションの文は missions[id] */
export interface MissionStrings {
  readonly title: string;
  readonly briefing: readonly string[];
}

interface LocaleStrings {
  readonly missions: Readonly<Record<string, MissionStrings | undefined>>;
}

const STRINGS: Record<Locale, LocaleStrings> = { ja, en };

/** ミッションのタイトルとブリーフィング文（その言語になければ日本語、それもなければ id） */
export function missionStrings(id: string, locale: Locale): MissionStrings {
  return STRINGS[locale].missions[id] ?? STRINGS.ja.missions[id] ?? { title: id, briefing: [] };
}

/** 目標の種類ごとの既定の表示名（定義の label で上書きできる） */
const OBJECTIVE_LABELS: Record<ObjectiveType, string> = {
  kill: '敵機撃墜',
  survive: '生存',
  rings: 'リング通過',
  escort: '護衛',
  destroy: '目標破壊',
  kaiju: '怪獣撃退',
};

export const FAIL_REASON_TEXT: Record<FailCondition, string> = {
  playerDown: '撃墜された',
  escortLost: '護衛対象を失った',
  timeUp: '時間切れ',
  outOfBounds: '戦域を離脱した',
};

export function objectiveLabel(def: ObjectiveDef): string {
  if (def.label) return def.label;
  if (def.type === 'kill' && def.target !== 'enemyFighter') {
    const names = { target: '的', drone: 'ドローン', groundTarget: '地上目標', any: '目標' };
    return `${names[def.target]}撃墜`;
  }
  return OBJECTIVE_LABELS[def.type];
}

/** 進み具合の表示。例「敵機撃墜 1 / 3」「生存 12 / 60 秒」 */
export function objectiveProgressText(def: ObjectiveDef, current: number, target: number): string {
  const unit =
    def.type === 'survive' ? ' 秒' : def.type === 'kaiju' || def.type === 'escort' ? ' %' : '';
  return `${objectiveLabel(def)} ${current} / ${target}${unit}`;
}

/** ブリーフィングの目標の説明。例「リング通過 10」「敵機撃墜 2」「生存 60 秒」 */
export function objectiveSummary(def: ObjectiveDef): string {
  const label = objectiveLabel(def);
  switch (def.type) {
    case 'kill':
      return `${label} ${def.count}`;
    case 'rings':
      return `${label} ${def.rings.length}`;
    case 'survive':
      return `${label} ${def.seconds} 秒`;
    case 'destroy':
      return `${label} ${def.count}`;
    case 'escort':
      return label;
    case 'kaiju':
      return `${label} ${Math.round(def.damageRatio * 100)} %`;
  }
}

/**
 * ミッション一覧の難易度の表記（4-12）。敵機と対空砲の難易度の最も低いものから最も高いもの。
 * 例「入門」「易〜普」。敵機も対空砲もいなければ空文字
 */
export function missionDifficultyText(def: MissionDef): string {
  const order: readonly Difficulty[] = DIFFICULTIES;
  let lo = order.length;
  let hi = -1;
  for (const s of def.spawns) {
    const d =
      s.kind === 'enemyFighter'
        ? s.difficulty
        : s.kind === 'groundTarget' && s.targetType === 'aaa'
          ? (s.difficulty ?? 'normal')
          : null;
    if (!d) continue;
    const i = order.indexOf(d);
    lo = Math.min(lo, i);
    hi = Math.max(hi, i);
  }
  const a = order[lo];
  const b = order[hi];
  if (!a || !b) return '';
  return a === b
    ? DIFFICULTY_SHORT_LABELS[a]
    : `${DIFFICULTY_SHORT_LABELS[a]}〜${DIFFICULTY_SHORT_LABELS[b]}`;
}

/** 時間の表示「m:ss」（切り上げ。残り時間が 0.2 秒なら 0:01） */
export function formatClock(seconds: number, roundUp = false): string {
  const s = Math.max(0, roundUp ? Math.ceil(seconds - 1e-6) : Math.floor(seconds + 1e-6));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** クレジットの表示（3 桁区切り） */
export function formatCredits(credits: number): string {
  return `${Math.round(credits).toLocaleString('en-US')} CR`;
}
