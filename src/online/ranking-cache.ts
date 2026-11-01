// ランキングの 5 分キャッシュ（7-4、DOM・Supabase 非依存）。タブを行き来しても 5 分は取り直さない（転送量の上限を守る）
import { ONLINE_CONFIG } from '../data/online';
import type { RankingQuery, RankingRow } from './backend';

export function rankingCacheKey(q: RankingQuery): string {
  return `${q.kind}|${q.key}|${q.kind === 'race' ? (q.aircraftId ?? '') : ''}`;
}

export class RankingCache {
  private readonly entries = new Map<string, { at: number; rows: readonly RankingRow[] }>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs: number = ONLINE_CONFIG.rankingCacheMs,
  ) {}

  /** キャッシュにあれば返し、無い・古ければ fetch して入れる。fetch の失敗はそのまま投げる（キャッシュは変えない） */
  async get(
    q: RankingQuery,
    fetch: (q: RankingQuery) => Promise<RankingRow[]>,
  ): Promise<readonly RankingRow[]> {
    const key = rankingCacheKey(q);
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.rows;
    const rows = await fetch(q);
    this.entries.set(key, { at: this.now(), rows });
    return rows;
  }

  /** 自分の記録を送った後など、そのランキングだけ取り直させる */
  invalidate(q: RankingQuery): void {
    this.entries.delete(rankingCacheKey(q));
  }

  clear(): void {
    this.entries.clear();
  }
}
