// 勲章の一覧（9-10b・9-10c）の行の組み立て（DOM 非依存）: 番号・状態（取得・進行中・未着手）・隠し勲章の伏せ字・進み具合と、
// カテゴリ・状態の絞り込みと件数、並べ替え（番号順・取得日・進み具合・名前）
import { compareText, formatInteger } from '../core/format';
import { t } from '../core/i18n';
import { BADGE_GROUPS, BADGES, badgeName, type BadgeDef, type BadgeGroup } from '../data/badges';
import { earnedAt, recordBadges, type BadgeProgress } from '../progression/badges';
import type { SaveData } from '../progression/save';

export const BADGE_STATUSES = ['earned', 'progress', 'none'] as const;
export type BadgeStatus = (typeof BADGE_STATUSES)[number];
export const BADGE_SORTS = ['number', 'recent', 'progress', 'name'] as const;
export type BadgeSort = (typeof BADGE_SORTS)[number];

export interface BadgeFilter {
  group: BadgeGroup | 'all';
  status: BadgeStatus | 'all';
  sort: BadgeSort;
}

/** 選択の値を絞り込みに入れる（知らない値は無視） */
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
  readonly def: BadgeDef;
  /** 一覧の名前（隠し勲章は取るまで「？？？」） */
  readonly title: string;
  readonly status: BadgeStatus;
  /** 隠し勲章で取っていない（名前と条件を伏せる） */
  readonly masked: boolean;
  /** 記録から数えられるものの進み具合（取ったら null） */
  readonly progress: BadgeProgress | null;
  /** 取った時刻（取っていなければ 0） */
  readonly latest: number;
}

/** 全部の勲章の行（番号の順。絞り込みの前） */
export function allBadgeRows(data: Readonly<SaveData>): BadgeRow[] {
  const records = recordBadges(data);
  return BADGES.map((def) => {
    const at = earnedAt(data.badges, def.id);
    const progress = at > 0 ? null : (records[def.id]?.progress ?? null);
    const status: BadgeStatus =
      at > 0 ? 'earned' : progress && progress.current > 0 ? 'progress' : 'none';
    const masked = def.hidden === true && at === 0;
    return {
      id: def.id,
      def,
      title: masked ? t('badges.hidden') : badgeName(def.id),
      status,
      masked,
      progress,
      latest: at,
    };
  });
}

/** カテゴリごとの取った数と全部の数（'all' も） */
export function groupCounts(
  rows: readonly BadgeRow[],
): Record<BadgeGroup | 'all', { earned: number; total: number }> {
  const out = Object.fromEntries(
    ['all', ...BADGE_GROUPS].map((g) => [g, { earned: 0, total: 0 }]),
  ) as Record<BadgeGroup | 'all', { earned: number; total: number }>;
  for (const r of rows) {
    for (const g of ['all', r.def.group] as const) {
      out[g].total++;
      if (r.status === 'earned') out[g].earned++;
    }
  }
  return out;
}

/** 今のカテゴリの中の状態ごとの件数（'all' も） */
export function statusCounts(
  rows: readonly BadgeRow[],
  group: BadgeGroup | 'all',
): Record<BadgeStatus | 'all', number> {
  const out: Record<BadgeStatus | 'all', number> = { all: 0, earned: 0, progress: 0, none: 0 };
  for (const r of rows) {
    if (group !== 'all' && r.def.group !== group) continue;
    out.all++;
    out[r.status]++;
  }
  return out;
}

/** 一覧の行（絞り込み・並べ替えの後） */
export function badgeRows(data: Readonly<SaveData>, f: Readonly<BadgeFilter>): BadgeRow[] {
  return filterRows(allBadgeRows(data), f);
}

export function filterRows(rows: readonly BadgeRow[], f: Readonly<BadgeFilter>): BadgeRow[] {
  const out = rows.filter(
    (r) =>
      (f.group === 'all' || r.def.group === f.group) &&
      (f.status === 'all' || r.status === f.status),
  );
  return sortRows(out, f.sort);
}

const ratio = (r: BadgeRow): number =>
  r.progress ? r.progress.current / Math.max(1, r.progress.goal) : 0;
const STATUS_ORDER: Readonly<Record<BadgeStatus, number>> = { progress: 0, none: 1, earned: 2 };

function sortRows(rows: BadgeRow[], sort: BadgeSort): BadgeRow[] {
  const byNo = (a: BadgeRow, b: BadgeRow): number => a.def.no - b.def.no;
  switch (sort) {
    case 'recent':
      // 新しく取った順、取っていないものは番号の順で後ろに
      return rows.sort((a, b) => b.latest - a.latest || byNo(a, b));
    case 'progress':
      // 進行中（進んだ割合の大きい順）→ 未着手 → 取った
      return rows.sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || ratio(b) - ratio(a) || byNo(a, b),
      );
    case 'name':
      // 伏せたものは後ろに
      return rows.sort(
        (a, b) =>
          Number(a.masked) - Number(b.masked) || compareText(a.title, b.title) || byNo(a, b),
      );
    default:
      return rows.sort(byNo);
  }
}

/** 一覧の右端の進み具合（取ったら「済」・数えないものは空） */
export function rowValue(row: Pick<BadgeRow, 'status' | 'progress'>): string {
  if (row.status === 'earned') return t('badges.done');
  const p = row.progress;
  return p
    ? t('badges.progress', { current: formatInteger(p.current), goal: formatInteger(p.goal) })
    : '';
}
