import { QUALITY_CONFIG } from '../data/quality';

/**
 * 自動ダウングレードの判定。飛行開始（start）から sampleSeconds 秒間の平均 fps を測り、
 * minFps 未満なら 1 回だけ true を返す。ポーズ中は record を呼ばない（測定を止める）
 */
export class FpsWatch {
  private elapsed = 0;
  private frames = 0;
  private active = false;

  constructor(
    private readonly sampleSeconds: number = QUALITY_CONFIG.autoDowngrade.sampleSeconds,
    private readonly minFps: number = QUALITY_CONFIG.autoDowngrade.minFps,
  ) {}

  /** 測定を始め直す（飛行開始のたび） */
  start(): void {
    this.elapsed = 0;
    this.frames = 0;
    this.active = true;
  }

  /** 1 描画フレームの実時間（秒）を記録する。測定が終わって平均が minFps 未満なら true */
  record(frameSeconds: number): boolean {
    if (!this.active || !Number.isFinite(frameSeconds) || frameSeconds <= 0) return false;
    this.elapsed += frameSeconds;
    this.frames++;
    if (this.elapsed < this.sampleSeconds) return false;
    this.active = false;
    return this.frames / this.elapsed < this.minFps;
  }

  /** 測定中か */
  get measuring(): boolean {
    return this.active;
  }
}
