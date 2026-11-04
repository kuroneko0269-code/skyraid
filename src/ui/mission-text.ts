// ミッションの表示用の文字列（HUD・ブリーフィング・リザルト。2-4）。DOM 非依存の純関数
import { formatCredits as formatCreditsText } from '../core/format';
import { hasMessage, t, tList } from '../core/i18n';
import { DIFFICULTIES, DIFFICULTY_SHORT_LABELS, type Difficulty } from '../data/ai';
import { raidVariantByMission } from '../missions/raid-variants';
import type { FailCondition, MissionDef, ObjectiveDef, ObjectiveType } from '../missions/types';

/** 言語ごとの文（src/data/i18n/*.json）。ミッションの文は missions[id] */
export interface MissionStrings {
  readonly title: string;
  readonly briefing: readonly string[];
}

/** ミッションのタイトルとブリーフィング文（今の言語。なければ id） */
export function missionStrings(id: string): MissionStrings {
  if (!hasMessage(`missions.${id}.title`))
    return raidVariantByMission(id)?.strings() ?? { title: id, briefing: [] };
  return { title: t(`missions.${id}.title`), briefing: tList(`missions.${id}.briefing`) };
}

/** 目標の種類ごとの既定の表示名（定義の label で上書きできる） */
function defaultObjectiveLabel(type: ObjectiveType): string {
  return t(`objectives.label.${type}`);
}

export const FAIL_REASON_TEXT: Record<FailCondition, string> = {
  get playerDown() {
    return t('objectives.fail.playerDown');
  },
  get escortLost() {
    return t('objectives.fail.escortLost');
  },
  get timeUp() {
    return t('objectives.fail.timeUp');
  },
  get kaijuReachedCity() {
    return t('objectives.fail.kaijuReachedCity');
  },
  get outOfBounds() {
    return t('objectives.fail.outOfBounds');
  },
};

export function objectiveLabel(def: ObjectiveDef): string {
  if (def.label) return def.label;
  if (def.type === 'kill' && def.target !== 'enemyFighter') {
    return t(`objectives.killTarget.${def.target}`);
  }
  // 9-5c: チュートリアルの課題は課題ごとの名前
  if (def.type === 'task') return t(`objectives.task.${def.task}`);
  return defaultObjectiveLabel(def.type);
}

/** 進み具合の表示。例「敵機撃墜 1 / 3」「生存 12 / 60 秒」 */
export function objectiveProgressText(def: ObjectiveDef, current: number, target: number): string {
  const label = objectiveLabel(def);
  if (def.type === 'survive') return t('objectives.progressSeconds', { label, current, target });
  if (def.type === 'task' && target <= 1) return label;
  const unit =
    def.type === 'speed' ? ' m/s' : def.type === 'kaiju' || def.type === 'escort' ? ' %' : '';
  return `${label} ${current} / ${target}${unit}`;
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
      return t('objectives.summarySeconds', { label, seconds: def.seconds });
    case 'destroy':
      return `${label} ${def.count}`;
    case 'escort':
      return label;
    case 'kaiju':
      return `${label} ${Math.round(def.damageRatio * 100)} %`;
    case 'speed':
      return `${label} ${def.speed} m/s`;
    case 'task':
      return def.count > 1 ? `${label} ${def.count}` : label;
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
    : t('difficulty.range', { from: DIFFICULTY_SHORT_LABELS[a], to: DIFFICULTY_SHORT_LABELS[b] });
}

/** 時間の表示「m:ss」（切り上げ。残り時間が 0.2 秒なら 0:01） */
export function formatClock(seconds: number, roundUp = false): string {
  const s = Math.max(0, roundUp ? Math.ceil(seconds - 1e-6) : Math.floor(seconds + 1e-6));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** クレジットの表示（3 桁区切り） */
export function formatCredits(credits: number): string {
  return formatCreditsText(credits);
}
