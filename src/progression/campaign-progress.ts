// キャンペーンの進み具合（2-5、Three.js・DOM 非依存）: ミッションの解放とクリア済みのランク。
// ミッションは並び順に 1 本ずつ解放する（前のミッションを成功すると次が選べる）。
// 今はセッション内（ページを開いている間）だけ覚える。保存（localStorage）はフェーズ3
import { RANKS, type Rank } from '../data/ranking';

export class CampaignProgress {
  /** ミッション id → 最高ランク（クリア済みのものだけ） */
  private readonly best = new Map<string, Rank>();

  constructor(
    readonly missionIds: readonly string[],
    /** true ならすべて解放（開発用の ?unlockAll） */
    private readonly unlockAll = false,
  ) {}

  /** 成功したミッションのランクを記録する（前より良いときだけ上書き） */
  recordClear(missionId: string, rank: Rank): void {
    const prev = this.best.get(missionId);
    if (prev === undefined || RANKS.indexOf(rank) < RANKS.indexOf(prev))
      this.best.set(missionId, rank);
  }

  isCleared(missionId: string): boolean {
    return this.best.has(missionId);
  }

  /** クリア済みの最高ランク（未クリアは null） */
  bestRank(missionId: string): Rank | null {
    return this.best.get(missionId) ?? null;
  }

  /** 選べるか: 先頭のミッション、または前のミッションをクリア済み */
  isUnlocked(missionId: string): boolean {
    const i = this.missionIds.indexOf(missionId);
    if (i < 0) return false;
    if (i === 0 || this.unlockAll) return true;
    const prev = this.missionIds[i - 1];
    return prev !== undefined && this.isCleared(prev);
  }
}
