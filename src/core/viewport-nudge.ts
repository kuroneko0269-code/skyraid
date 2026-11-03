// 8-6e / 8-6f / v1.0.1: iOS のホーム画面から横向きで起動して、描かれる高さが足りない（isShortStandalone）ときの測り直しの試み。
// viewport の meta の viewport-fit を一度 auto にして cover に戻し、iOS に安全領域と表示の大きさを測り直させる（実機では 2 回目で直った）。
// その間は黒い幕でチラつきを隠す。DOM・タイマーは deps で受け取る（テストする）。
//
// v1.0.1 の直し: 8-6f までは「起動の最初」と「起動 0.6 秒（atMs[0]）」の 2 回だけ短いかを見ていた。実機（v1.0.0）では起動直後の値が
// 縦（402×812）で、横の短い値（812×340）になったのは 1.3 秒後だったため、0.6 秒の判定で「短くない」として試みも幕も無しで終わり、
// 下の黒い余白が残った（記録にも cover / nudge の行が無い）。起動から watchMs の間は測るたびに見張り、短くなった時に幕を出して試みを始める
import { VIEWPORT_CONFIG } from '../data/app';

export interface NudgeDeps {
  /** 今の時刻（ms） */
  now(): number;
  /** 描かれる高さが足りないか（isShortStandalone(sampleViewport())） */
  isShort(): boolean;
  /** viewport の meta に viewport-fit=cover があるか（切り替えられるか） */
  canNudge(): boolean;
  /** 記録に出す今の値（「inner 874x340」など） */
  describe(): string;
  /** viewport-fit を auto（true）/ cover（false）に */
  setFitAuto(auto: boolean): void;
  /** 測り直して CSS 変数に書く（fitRoot） */
  refit(): void;
  later(fn: () => void, ms: number): void;
  showCover(): void;
  extendCover(): void;
  hideCover(reason: string): void;
  log(kind: 'startup' | 'nudge', text: string): void;
}

export interface NudgeConfig {
  readonly atMs: readonly number[];
  readonly maxTries: number;
  readonly restoreMs: number;
  readonly checkMs: number;
  readonly watchMs: number;
  readonly settleMs: number;
}

const sec = (ms: number): string => `${(ms / 1000).toFixed(2)}s`;

export class StartupNudge {
  private state: 'watching' | 'running' | 'done' = 'watching';
  private tries = 0;
  private readonly start: number;

  constructor(
    private readonly d: NudgeDeps,
    private readonly c: NudgeConfig = VIEWPORT_CONFIG.nudge,
  ) {
    this.start = d.now();
    d.log('startup', `watch ${sec(c.watchMs)}`);
    d.later(() => {
      this.endWatch();
    }, c.watchMs);
  }

  /** 状態（テスト・点検） */
  get phase(): 'watching' | 'running' | 'done' {
    return this.state;
  }

  /** 測るたびに呼ぶ。見張る間に短くなったら幕を出し、試みを始める */
  check(): void {
    if (this.state !== 'watching') return;
    const elapsed = this.d.now() - this.start;
    if (elapsed > this.c.watchMs) {
      this.endWatch();
      return;
    }
    if (!this.d.isShort()) return;
    this.state = 'running';
    this.d.log('startup', `short +${sec(elapsed)} (${this.d.describe()})`);
    this.d.showCover();
    // 起動直後に見つけたら 8-6f と同じ atMs[0]。遅れて見つけたら、値が落ち着くのを settleMs 待つ
    const first = this.c.atMs[0] ?? 0;
    this.d.later(
      () => {
        this.attempt();
      },
      Math.max(first - elapsed, this.c.settleMs),
    );
  }

  private endWatch(): void {
    if (this.state !== 'watching') return;
    this.state = 'done';
    this.d.log('startup', 'end: never short (no cover, no nudge)');
  }

  private finish(reason: string): void {
    this.state = 'done';
    this.d.hideCover(reason);
  }

  private attempt(): void {
    if (this.tries >= this.c.maxTries) {
      this.finish('tries done');
      return;
    }
    if (!this.d.isShort()) {
      this.finish('fixed');
      return;
    }
    if (!this.d.canNudge()) {
      this.finish('no viewport-fit=cover');
      return;
    }
    this.tries++;
    const n = this.tries;
    this.d.extendCover();
    this.d.log('nudge', `#${n} auto (${this.d.describe()})`);
    this.d.setFitAuto(true);
    this.d.later(() => {
      this.d.setFitAuto(false);
      this.d.later(() => {
        this.d.refit();
        this.d.log('nudge', `#${n} after (${this.d.describe()})`);
        const next = this.c.atMs[n];
        const prev = this.c.atMs[n - 1] ?? 0;
        if (!this.d.isShort()) this.finish('fixed');
        else if (next === undefined || n >= this.c.maxTries) this.finish('tries done');
        else
          this.d.later(
            () => {
              this.attempt();
            },
            Math.max(0, next - prev - this.c.restoreMs - this.c.checkMs),
          );
      }, this.c.checkMs);
    }, this.c.restoreMs);
  }
}
