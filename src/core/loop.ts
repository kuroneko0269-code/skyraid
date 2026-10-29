import { LOOP_CONFIG } from '../data/loop';

export type UpdateFn = (dt: number) => void;
/** alpha: 直前の固定更新から次の更新までの補間係数（0〜1） */
export type RenderFn = (alpha: number) => void;

/** フレーム駆動の抽象。ブラウザでは requestAnimationFrame、テストでは偽物を注入する */
export interface FrameScheduler {
  /** 現在時刻（ミリ秒） */
  now(): number;
  request(cb: () => void): number;
  cancel(id: number): void;
}

export interface LoopOptions {
  updateHz?: number;
  maxFrameSeconds?: number;
}

export const browserScheduler: FrameScheduler = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => {
    cancelAnimationFrame(id);
  },
};

/**
 * 固定タイムステップ更新 + 可変描画のゲームループ。
 * update は常に一定の dt（既定 1/60 秒）で呼ばれ、render はフレームごとに1回呼ばれる。
 */
export class GameLoop {
  readonly stepSeconds: number;
  readonly maxFrameSeconds: number;

  private readonly updates: UpdateFn[] = [];
  private readonly renders: RenderFn[] = [];
  private accumulator = 0;
  private lastTimeMs: number | null = null;
  private frameId: number | null = null;
  private scheduler: FrameScheduler | null = null;
  private pausedFlag = false;

  constructor(options: LoopOptions = {}) {
    const hz = options.updateHz ?? LOOP_CONFIG.updateHz;
    if (hz <= 0) throw new Error('updateHz は正の値にする');
    this.stepSeconds = 1 / hz;
    this.maxFrameSeconds = options.maxFrameSeconds ?? LOOP_CONFIG.maxFrameSeconds;
  }

  /** 固定更新を登録する。戻り値で登録解除 */
  onUpdate(fn: UpdateFn): () => void {
    return addListener(this.updates, fn);
  }

  /** 描画を登録する。戻り値で登録解除 */
  onRender(fn: RenderFn): () => void {
    return addListener(this.renders, fn);
  }

  get running(): boolean {
    return this.frameId !== null;
  }

  get paused(): boolean {
    return this.pausedFlag;
  }

  /**
   * 一時停止中は固定更新を呼ばず、時間も貯めない（描画だけ続ける）。
   * 補間係数は止めた時点の値のままなので、描画も止まって見える
   */
  setPaused(paused: boolean): void {
    this.pausedFlag = paused;
  }

  /**
   * 実時間 frameSeconds だけ進める。固定更新を必要回数実行したあと描画を1回呼ぶ。
   * 戻り値は実行した固定更新の回数。
   */
  advance(frameSeconds: number): number {
    // 負値や NaN は 0、巨大値は上限でクランプ
    const dt = Number.isFinite(frameSeconds)
      ? Math.min(Math.max(frameSeconds, 0), this.maxFrameSeconds)
      : 0;
    if (!this.pausedFlag) this.accumulator += dt;

    // 浮動小数の誤差で 1/60 ちょうどが 0 回になるのを防ぐ許容値
    const epsilon = this.stepSeconds * 1e-6;
    let steps = 0;
    // update の中で一時停止されたら、そのフレームの残りの更新も行わない
    while (!this.pausedFlag && this.accumulator + epsilon >= this.stepSeconds) {
      for (const fn of this.updates) fn(this.stepSeconds);
      this.accumulator -= this.stepSeconds;
      steps++;
    }
    if (this.accumulator < 0) this.accumulator = 0;

    const alpha = this.accumulator / this.stepSeconds;
    for (const fn of this.renders) fn(alpha);
    return steps;
  }

  start(scheduler: FrameScheduler = browserScheduler): void {
    if (this.running) return;
    this.scheduler = scheduler;
    this.lastTimeMs = null;
    this.frameId = scheduler.request(this.tick);
  }

  stop(): void {
    if (this.scheduler && this.frameId !== null) this.scheduler.cancel(this.frameId);
    this.frameId = null;
    this.lastTimeMs = null;
  }

  private readonly tick = (): void => {
    const scheduler = this.scheduler;
    if (!scheduler) return;
    const now = scheduler.now();
    // 初回フレームは時間を進めず描画だけ行う
    const frameSeconds = this.lastTimeMs === null ? 0 : (now - this.lastTimeMs) / 1000;
    this.lastTimeMs = now;
    this.frameId = scheduler.request(this.tick);
    this.advance(frameSeconds);
  };
}

function addListener<T>(list: T[], fn: T): () => void {
  list.push(fn);
  return () => {
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
}
