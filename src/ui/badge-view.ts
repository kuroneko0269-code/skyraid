// 勲章の一覧（9-10b）の行の組み立て（DOM 非依存）: 状態（取った・進行中・未着手）・印の色・隠し勲章の伏せ字・進み具合と、
// カテゴリ・状態の絞り込み、並べ替え（標準・取った日・進み具合・名前）
import { compareText } from '../core/format';
import { t } from '../core/i18n';
import { BADGE_GROUPS, BADGES, badgeName, badgeTiers, type BadgeGroup } from '../data/badges';
import { earnedTier, recordBadges, type BadgeProgress } from '../progression/badges';
import type { SaveData } from '../progression/save';

export const BADGE_STATUSES = ['earned', 'progress', 'none'] as const;
export type BadgeStatus = (typeof BADGE_STATUSES)[number];
export const BADGE_SORTS = ['default', 'recent', 'progress', 'name'] as const;
export type BadgeSort = (typeof BADGE_SORTS)[number];

export interface BadgeFilter {
  group: BadgeGroup | 'all';
  status: BadgeStatus | 'all';
  sort: BadgeSort;
}

/** 選択の箱の値を絞り込みに入れる（知らない値は無視） */
export function parseBadgeFilter(f: BadgeFilter, key: keyof BadgeFilter, value: string): void {
  const pick = <T extends string>(list: readonly T[]): T | undefined =>
    list.find((x) => x === value);
  if (key === 'group') f.group = value === 'all' ? 'all' : (pick(BADGE_GROUPS) ?? f.group);
  else if (key === 'status')
    f.status = value === 'all' ? 'all' : (pick(BADGE_STATUSES) ?? f.status);
  else f.sort = pick(BADGE_SORTS) ?? f.sort;
}

export interface BadgeRow {
  readonly id: string;
  /** 一覧の名前（隠し勲章は取るまで「？？？」） */
  readonly title: string;
  readonly status: BadgeStatus;
  /** 印の色（0 = 取っていない、1〜3 = 銅・銀・金。段階なしは取ったら金） */
  readonly markTier: number;
  /** 隠し勲章で取っていない（名前と条件を伏せる） */
  readonly masked: boolean;
  /** 記録から数えられるものの進み具合（取り終えたら null） */
  readonly progress: BadgeProgress | null;
  /** 最後に取った時刻（取っていなければ 0） */
  readonly latest: number;
  /** 表の順 */
  readonly order: number;
}

/** 一覧の行（絞り込み・並べ替えの後） */
export function badgeRows(data: Readonly<SaveData>, f: Readonly<BadgeFilter>): BadgeRow[] {
  const records = recordBadges(data);
  const rows: BadgeRow[] = [];
  BADGES.forEach((def, order) => {
    if (f.group !== 'all' && def.group !== f.group) return;
    const tiers = badgeTiers(def);
    const have = earnedTier(data.badges, def.id);
    const progress = have >= tiers ? null : (records[def.id]?.progress ?? null);
    const status: BadgeStatus =
      have > 0 ? 'earned' : progress && progress.current > 0 ? 'progress' : 'none';
    if (f.status !== 'all' && status !== f.status) return;
    const masked = def.hidden === true && have === 0;
    const times = data.badges.earned[def.id] ?? [];
    rows.push({
      id: def.id,
      title: masked ? t('badges.hidden') : badgeName(def.id),
      status,
      markTier: tiers > 1 ? have : have > 0 ? 3 : 0,
      masked,
      progress,
      latest: times.length > 0 ? Math.max(...times) : 0,
      order,
    });
  });
  return sortRows(rows, f.sort);
}

const ratio = (r: BadgeRow): number =>
  r.progress ? r.progress.current / Math.max(1, r.progress.goal) : 0;
const STATUS_ORDER: Readonly<Record<BadgeStatus, number>> = { progress: 0, none: 1, earned: 2 };

function sortRows(rows: BadgeRow[], sort: BadgeSort): BadgeRow[] {
  const byOrder = (a: BadgeRow, b: BadgeRow): number => a.order - b.order;
  switch (sort) {
    case 'recent':
      // 新しく取った順、取っていないものは表の順で後ろに
      return rows.sort((a, b) => b.latest - a.latest || byOrder(a, b));
    case 'progress':
      // 進行中（進んだ割合の大きい順）→ 未着手 → 取った
      return rows.sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || ratio(b) - ratio(a) || byOrder(a, b),
      );
    case 'name':
      // 伏せたものは後ろに
      return rows.sort(
        (a, b) =>
          Number(a.masked) - Number(b.masked) || compareText(a.title, b.title) || byOrder(a, b),
      );
    default:
      return rows.sort(byOrder);
  }
}
