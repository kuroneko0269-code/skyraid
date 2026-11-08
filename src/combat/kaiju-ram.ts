// 10-4c: レイドの怪獣の体への衝突（体当たり）の共通の部品（Three.js 非依存・決まった計算）。めり込んだかは怪獣ごとの形の判定
// （albion-hull / gourai-hull / xenolith-hull）が決め、ここはダメージと「続けて当たらない間」だけを持つ。跳ね返さない（10-3c・10-4b の
// 弾く扱いはやめた）。ソロ（missions/*-dev.ts）と協力のホスト（net/*-coop.ts）で同じものを使う
import { KAIJU_RAM } from '../data/kaiju-ram';

export interface RamSpec {
  readonly hpShare: number;
  readonly invulnerable: number;
}

/** ぶつかったときのダメージ（最大 HP の約 8 割。残りが足りなければ撃墜） */
export function ramDamage(maxHp: number, spec: RamSpec = KAIJU_RAM): number {
  return maxHp * spec.hpShare;
}

/** 人ごとの「続けて当たらない」残り秒（ソロは id 0 だけ） */
export class RamGrace {
  private readonly left = new Map<number, number>();

  constructor(private readonly spec: RamSpec = KAIJU_RAM) {}

  /** 1 ステップ進める（当たっていなくても毎ステップ） */
  tick(dt: number): void {
    for (const [id, s] of this.left) this.left.set(id, Math.max(0, s - dt));
  }

  /** めり込んだときに呼ぶ。ダメージを入れるなら true（続けて当たらない間を始める）。間の中なら false */
  hit(id: number): boolean {
    if ((this.left.get(id) ?? 0) > 0) return false;
    this.left.set(id, this.spec.invulnerable);
    return true;
  }

  /** 残り秒（値の表示・テスト） */
  remaining(id: number): number {
    return this.left.get(id) ?? 0;
  }

  clear(): void {
    this.left.clear();
  }
}

/** 10-4c: ぶつかった知らせ（ダメージの前に自機の位置で）。火花・破片・揺れ・音・振動の演出が購読する（CombatSystem.ram） */
export class RamEvents {
  private readonly listeners: ((x: number, y: number, z: number) => void)[] = [];

  on(fn: (x: number, y: number, z: number) => void): void {
    this.listeners.push(fn);
  }

  report(x: number, y: number, z: number): void {
    for (const fn of this.listeners) fn(x, y, z);
  }
}
