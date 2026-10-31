// 怪獣の全体 HP の式と、与ダメージ・ブレイクの記録（6-6。Three.js 非依存）: 攻撃した人（プレイヤー ID）ごとの部位別の与ダメージ
// （全体 HP を実際に減らした量。倍率込み）と、ブレイクに貢献した回数。協力のリザルト（MVP）とテストが読む
import { KAIJU_CONFIG, KAIJU_PARTS } from '../data/kaiju';
import { RAID_RULES } from '../data/raid';

/** 全体 HP の人数スケール（1 人は solo の倍率。6-1b）。6-6: 高難度は ×1.4 */
export function kaijuMaxHp(
  players: number,
  base: number = KAIJU_CONFIG.baseHp,
  hard = false,
): number {
  const s = KAIJU_CONFIG.hpScale;
  const n = Math.min(4, Math.max(1, Math.round(players)));
  const h = hard ? RAID_RULES.hard.hpScale : 1;
  return Math.round(base * (n === 1 ? s.solo : s.constant + s.perPlayer * n) * h);
}

export class KaijuStats {
  /** プレイヤー ID → 部位ごと（KAIJU_PARTS の順）の与ダメージ */
  readonly damage = new Map<number, number[]>();
  /** プレイヤー ID → ブレイクに貢献した回数 */
  readonly breaks = new Map<number, number>();
  /** ブレイクの記録（部位の番号と貢献者。成立順） */
  readonly breakLog: { readonly part: number; readonly by: readonly number[] }[] = [];

  reset(): void {
    this.damage.clear();
    this.breaks.clear();
    this.breakLog.length = 0;
  }

  addDamage(attacker: number, part: number, amount: number): void {
    if (!(amount > 0)) return;
    let row = this.damage.get(attacker);
    if (!row) {
      row = KAIJU_PARTS.map(() => 0);
      this.damage.set(attacker, row);
    }
    row[part] = (row[part] ?? 0) + amount;
  }

  addBreak(part: number, by: readonly number[]): void {
    this.breakLog.push({ part, by: [...by] });
    for (const id of by) this.breaks.set(id, (this.breaks.get(id) ?? 0) + 1);
  }

  /** 1 人の部位別の与ダメージ（記録がなければ 0 の並び） */
  damageOf(attacker: number): number[] {
    return [...(this.damage.get(attacker) ?? KAIJU_PARTS.map(() => 0))];
  }

  totalOf(attacker: number): number {
    return (this.damage.get(attacker) ?? []).reduce((s, v) => s + v, 0);
  }
}
