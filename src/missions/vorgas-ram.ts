// 10-6: ヴォルガスの体への衝突（ソロのレイド。協力はホストの net/raid-host.ts）。ほかの 3 体と同じ共通の扱い（src/combat/kaiju-ram.ts:
// 最大 HP の約 8 割・足りなければ撃墜・跳ねない・1.5 秒は続けて当たらない）。形は src/ai/kaiju-hull/vorgas-hull.ts。
// キャンペーンの M5（遭遇）は今までどおり通り抜けられる（レイドだけ）
import { VorgasHull } from '../ai/kaiju-hull/vorgas-hull';
import { RamGrace, ramDamage } from '../combat/kaiju-ram';
import { TEAM_ENEMY } from '../combat/target';
import type { Kaiju } from '../entities/kaiju';
import type { Vec3 } from '../flight/math';
import type { FlightSession } from './flight-session';

/** 衝突を調べるソロの飛行（FlightSession） */
export type RamSession = Pick<FlightSession, 'aircraft' | 'player' | 'combat' | 'props'>;

export class VorgasRam {
  readonly hull = new VorgasHull();
  readonly grace = new RamGrace();
  /** ぶつかった回数（値の表示・テスト） */
  hits = 0;

  reset(): void {
    this.grace.clear();
    this.hits = 0;
  }

  /**
   * 1 ステップ分（怪獣と自機を動かした後）。ダメージを入れる衝突なら true（ぶつかった所は hull.point）。
   * レイドで、撃てる間（上陸中・陸の上）だけ
   */
  step(
    dt: number,
    k: Kaiju,
    active: boolean,
    aPrev: Readonly<Vec3>,
    aNow: Readonly<Vec3>,
    id = 0,
  ): boolean {
    this.grace.tick(dt);
    if (!k.raid || !k.targetable || !active) return false;
    this.hull.pose(k.pose);
    if (!this.hull.contact(k, aPrev, aNow)) return false;
    if (!this.grace.hit(id)) return false;
    this.hits++;
    return true;
  }

  /** ソロの飛行（FlightSession）: ぶつかったら火花・揺れ・音の知らせと、最大 HP の約 8 割のダメージ（跳ねない） */
  collide(dt: number, s: RamSession): void {
    const a = s.aircraft;
    if (!this.step(dt, s.props.kaiju, s.player.active, a.prevPosition, a.state.position)) return;
    const p = a.state.position;
    s.combat.ramListeners.report(p.x, p.y, p.z);
    s.combat.dealDamage(s.player, ramDamage(s.player.maxHp), TEAM_ENEMY);
  }
}
