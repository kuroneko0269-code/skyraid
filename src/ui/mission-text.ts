// ミッションの表示用の文字列（HUD・ブリーフィング・リザルト。2-4）。DOM 非依存の純関数
import type { FailCondition, ObjectiveDef, ObjectiveType } from '../missions/types';

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
  const unit = def.type === 'survive' ? ' 秒' : def.type === 'kaiju' ? ' %' : '';
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
    case 'kaiju':
      return label;
  }
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
