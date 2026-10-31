// 開始前（5-4 のカウントダウン + 6-6 の協力レイドのブリーフィング）。ホストもクライアントも飛行の始めから数える:
// ブリーフィング briefingSeconds → カウントダウン countdownSeconds。その間は全機を止めて操作を無視する。
// ブリーフィングは、全員がスキップを押すとホストが早く終わらせ（brief の event）、その時点からカウントダウンになる。Three.js 非依存
import { Countdown } from '../combat/pvp-rules';

export class PreStart {
  private readonly countdown: Countdown;
  private readonly countdownTicks: number;
  /** スキップを押した人（ホストが数える） */
  readonly skips = new Set<number>();

  constructor(
    briefingSeconds: number,
    countdownSeconds: number,
    private readonly tickHz = 60,
  ) {
    this.countdownTicks = Math.round(countdownSeconds * tickHz);
    this.countdown = new Countdown(briefingSeconds + countdownSeconds, tickHz);
  }

  get active(): boolean {
    return this.countdown.active;
  }

  /** カウントダウン（3・2・1）の残り秒数。ブリーフィング中はカウントダウンの長さ */
  get countdownRemaining(): number {
    return Math.min(this.countdown.remainingSeconds, this.countdownTicks / this.tickHz);
  }

  /** ブリーフィングの残り秒数（0 は終わった） */
  get briefingRemaining(): number {
    return Math.max(0, this.countdown.remainingSeconds - this.countdownTicks / this.tickHz);
  }

  /** 1 ステップ進める。止めているステップなら true */
  step(): boolean {
    return this.countdown.step();
  }

  /** ブリーフィングを終わらせてカウントダウンへ（残り ticks。既に短ければそのまま）。変わったら true */
  endBriefing(ticks = this.countdownTicks): boolean {
    if (this.countdown.remainingSeconds * this.tickHz <= ticks) return false;
    this.countdown.setRemainingTicks(ticks);
    return true;
  }

  /** 残りのカウントダウンの tick（brief の event の n） */
  get remainingTicks(): number {
    return Math.round(this.countdown.remainingSeconds * this.tickHz);
  }
}
