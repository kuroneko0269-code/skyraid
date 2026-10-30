// リング通過（2-4）: リングを順番に通る。次のリング以外は通っても数えない。
// rings / next は描画（src/render/ring-view.ts）と HUD の「次のリング」の印が読む
import type { RingObjective } from '../types';
import type { MissionWorld } from '../world';
import { Objective } from './objective';
import { createRing, crossesRing, type Ring } from './ring';

export class RingPassObjective extends Objective<RingObjective> {
  readonly target: number;
  readonly rings: readonly Ring[];

  constructor(def: RingObjective) {
    super(def);
    this.rings = def.rings.map((r) => createRing(r));
    this.target = this.rings.length;
  }

  /** 次に通るリング（全部通ったら null） */
  get next(): Ring | null {
    return this.rings[this.current] ?? null;
  }

  step(world: MissionWorld): void {
    if (!world.playerActive) return;
    const ring = this.next;
    if (ring && crossesRing(ring, world.playerPrevPosition, world.playerPosition))
      this.setProgress(this.current + 1);
  }
}
