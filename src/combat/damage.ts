// HP と被弾（Three.js 非依存）。機体・的・怪獣の部位などで共通に使う

/** 被弾して壊れるもの */
export interface Damageable {
  readonly hp: number;
  readonly maxHp: number;
  /** ダメージを与える。この被弾で破壊されたら true（すでに破壊済みなら何もせず false） */
  applyDamage(amount: number): boolean;
  readonly isDestroyed: boolean;
}

/** HP を持つ基本の実装。HP は 0 未満にならない */
export class Health implements Damageable {
  private current: number;

  constructor(readonly maxHp: number) {
    if (!(maxHp > 0)) throw new Error('maxHp は正の値にする');
    this.current = maxHp;
  }

  get hp(): number {
    return this.current;
  }

  get isDestroyed(): boolean {
    return this.current <= 0;
  }

  applyDamage(amount: number): boolean {
    if (this.isDestroyed || !(amount > 0)) return false;
    this.current = Math.max(0, this.current - amount);
    return this.isDestroyed;
  }

  /** 満タンに戻す（再出現・リスポーン） */
  reset(): void {
    this.current = this.maxHp;
  }
}
