// キャンペーンの進み具合（2-5、Three.js・DOM 非依存）: ミッションの解放とクリア済みのランク。
// ミッションは並び順に 1 本ずつ解放する（前のミッションを成功すると次が選べる）。
// 3-1 からセーブ（SaveStore）に記録し、ページを開き直しても残る
import type { Rank } from '../data/ranking';
import type { SaveStore } from './save-store';

export class CampaignProgress {
  constructor(
    readonly missionIds: readonly string[],
    private readonly save: SaveStore,
    /** true ならすべて解放（開発用の ?unlockAll。セーブには書かない） */
    private readonly unlockAll = false,
  ) {}

  /** 成功したミッションのランクを記録し（前より良いときだけ上書き）、次のミッションを解放して保存する */
  recordClear(missionId: string, rank: Rank): void {
    const i = this.missionIds.indexOf(missionId);
    const next = i >= 0 ? (this.missionIds[i + 1] ?? null) : null;
    this.save.recordClear(missionId, rank, next);
  }

  isCleared(missionId: string): boolean {
    return this.bestRank(missionId) !== null;
  }

  /** クリア済みの最高ランク（未クリアは null） */
  bestRank(missionId: string): Rank | null {
    return this.save.mission(missionId)?.bestRank ?? null;
  }

  /** 選べるか: 先頭のミッション、解放済み（前のミッションをクリア）、またはクリア済み */
  isUnlocked(missionId: string): boolean {
    const i = this.missionIds.indexOf(missionId);
    if (i < 0) return false;
    if (i === 0 || this.unlockAll) return true;
    const rec = this.save.mission(missionId);
    if (rec?.unlocked || rec?.bestRank) return true;
    // 解放の記録がなくても前のミッションをクリア済みなら選べる（ミッションを途中に足したとき）
    const prev = this.missionIds[i - 1];
    return prev !== undefined && this.isCleared(prev);
  }
}
