// 10-6: ヴォルガスのボット（tests/kaiju-raid-bots.ts の簡易な機体）の体への衝突: 前のステップの位置 → 今の位置で体の当たり
// （src/ai/kaiju-hull/vorgas-hull.ts）を調べ、最大 HP の約 8 割（1.5 秒は続けて当たらない）。count は当てずに数えるだけ（変更前の表）
import { VorgasHull } from '../src/ai/kaiju-hull/vorgas-hull';
import { RamGrace, ramDamage } from '../src/combat/kaiju-ram';
import type { Kaiju } from '../src/entities/kaiju';
import type { Vec3 } from '../src/flight/math';

interface RamBot {
  readonly id: number;
  readonly position: Vec3;
  readonly maxHp: number;
  readonly active: boolean;
}

export class VorgasBotRam {
  hits = 0;
  downs = 0;
  private readonly hull = new VorgasHull();
  private readonly grace = new RamGrace();
  private readonly prev: Vec3[];
  private first = true;

  constructor(
    count: number,
    private readonly countOnly: boolean,
  ) {
    this.prev = Array.from({ length: count }, () => ({ x: 0, y: 0, z: 0 }));
  }

  /** ボットと怪獣を動かした後（最初のステップは前の位置を覚えるだけ）。hurt はダメージを入れる（撃墜したら true） */
  after(
    k: Kaiju,
    bots: readonly RamBot[],
    dt: number,
    hurt: (id: number, amount: number) => boolean,
  ): void {
    this.grace.tick(dt);
    if (k.targetable) this.hull.pose(k.pose);
    const first = this.first;
    this.first = false;
    bots.forEach((b, i) => {
      const p0 = this.prev[i];
      if (!p0) return;
      const hit = !first && k.targetable && b.active && this.hull.contact(k, p0, b.position);
      // 次のステップの「前の位置」
      Object.assign(p0, b.position);
      if (!hit || !this.grace.hit(b.id)) return;
      this.hits++;
      if (!this.countOnly && hurt(b.id, ramDamage(b.maxHp))) this.downs++;
    });
  }

  /** 結果の欄 */
  counts(): { ramHits: number; ramDowns: number } {
    return { ramHits: this.hits, ramDowns: this.downs };
  }
}
