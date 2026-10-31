// 弾数とクールダウン（Three.js 非依存）。ミサイルの残弾・フレアの回数で共通に使う

export class Magazine {
  private remaining: number;
  private cooldownLeft = 0;

  constructor(
    private size: number,
    /** 1 回使ってから次に使えるまでの時間（秒） */
    readonly interval: number,
  ) {
    this.remaining = size;
  }

  /** 満タンの数 */
  get capacity(): number {
    return this.size;
  }

  /** 満タンの数を変えて満タンにする（3-3。機体の積載・強化） */
  setCapacity(capacity: number): void {
    this.size = Math.max(0, Math.floor(capacity));
    this.refill();
  }

  get count(): number {
    return this.remaining;
  }

  /** クールダウンの残り（秒） */
  get cooldown(): number {
    return this.cooldownLeft;
  }

  /** 今使えるか（残りがあり、クールダウン中でない） */
  get ready(): boolean {
    return this.remaining > 0 && this.cooldownLeft <= 0;
  }

  /** 使えるなら 1 つ減らしてクールダウンを始め、true を返す */
  tryUse(): boolean {
    if (!this.ready) return false;
    this.remaining--;
    this.cooldownLeft = this.interval;
    return true;
  }

  step(dt: number): void {
    if (this.cooldownLeft <= 0) return;
    // 浮動小数の誤差で interval ちょうどのステップ数で使えなくなるのを防ぐ
    this.cooldownLeft -= dt;
    if (this.cooldownLeft < 1e-9) this.cooldownLeft = 0;
  }

  /** 満タンに戻す（補給。今はフリーフライト開始時） */
  refill(): void {
    this.remaining = this.capacity;
    this.cooldownLeft = 0;
  }

  /** 満タンの fraction（切り上げ）だけ足す（7-2: 燃料タンクを失った後の防衛戦の補給） */
  refillPart(fraction: number): void {
    this.remaining = Math.min(this.capacity, this.remaining + Math.ceil(this.capacity * fraction));
    this.cooldownLeft = 0;
  }
}
