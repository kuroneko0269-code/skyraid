// 固定容量のオブジェクトプール（Three.js 非依存）。要素は最初に全部作り、以後は使い回す

/**
 * 使用中の要素は items の先頭 [0, count) に詰めて並ぶ。release は末尾の要素と入れ替えるので O(1)。
 * 走査しながら解放するときは後ろから回すこと
 */
export class Pool<T> {
  private readonly items: T[];
  private activeCount = 0;

  constructor(
    readonly capacity: number,
    create: () => T,
  ) {
    this.items = Array.from({ length: capacity }, create);
  }

  get count(): number {
    return this.activeCount;
  }

  /** 空いている要素を使用中にして返す。満杯なら null（呼び出し側で初期化すること） */
  acquire(): T | null {
    if (this.activeCount >= this.capacity) return null;
    const item = this.items[this.activeCount];
    if (item === undefined) return null;
    this.activeCount++;
    return item;
  }

  /** 使用中の i 番目を返す（0 ≤ i < count） */
  get(i: number): T {
    const item = this.items[i];
    if (item === undefined || i >= this.activeCount)
      throw new RangeError(`Pool: ${i} は使用中でない`);
    return item;
  }

  /** 使用中の i 番目を解放する。末尾の使用中要素が i 番目に移る */
  release(i: number): void {
    if (i < 0 || i >= this.activeCount) return;
    const last = this.activeCount - 1;
    const a = this.items[i];
    const b = this.items[last];
    if (a !== undefined && b !== undefined) {
      this.items[i] = b;
      this.items[last] = a;
    }
    this.activeCount = last;
  }

  clear(): void {
    this.activeCount = 0;
  }
}
