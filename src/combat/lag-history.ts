// 遅延補償（5-3）の位置の履歴: 機体ごとに固定ステップ（ホストの tick）ごとの位置を一定数だけ覚える。
// ホストは機銃の判定で、撃った人が見ていた tick の位置へ対象を巻き戻す。Three.js 非依存
import type { Vec3 } from '../flight/math';

export class LagHistory {
  private readonly ticks: Int32Array;
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly zs: Float64Array;

  constructor(readonly size: number) {
    this.ticks = new Int32Array(size).fill(-1);
    this.xs = new Float64Array(size);
    this.ys = new Float64Array(size);
    this.zs = new Float64Array(size);
  }

  record(tick: number, p: Readonly<Vec3>): void {
    const i = tick % this.size;
    this.ticks[i] = tick;
    this.xs[i] = p.x;
    this.ys[i] = p.y;
    this.zs[i] = p.z;
  }

  /** 忘れる（復帰で位置が飛んだとき。飛ぶ前の位置へ巻き戻さない） */
  clear(): void {
    this.ticks.fill(-1);
  }

  /**
   * tick の位置を out に書く。覚えていなければ、覚えている中で tick に最も近い（古すぎれば最古、新しすぎれば最新）位置。
   * 何もなければ false（呼び出し側は今の位置を使う）
   */
  sample(tick: number, out: Vec3): boolean {
    let best = -1;
    let bestGap = Infinity;
    for (let i = 0; i < this.size; i++) {
      const t = this.ticks[i] ?? -1;
      if (t < 0) continue;
      const gap = Math.abs(t - tick);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    if (best < 0) return false;
    out.x = this.xs[best] ?? 0;
    out.y = this.ys[best] ?? 0;
    out.z = this.zs[best] ?? 0;
    return true;
  }
}
