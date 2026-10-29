import { DEBUG_OVERLAY_CONFIG } from '../data/quality';

export interface FrameStatsSnapshot {
  fps: number;
  frameMs: number;
}

/**
 * フレーム時間を一定期間ごとに平均して fps と frame ms を出す。
 * 毎フレームの値は揺れて読めないため、sampleSeconds ごとにまとめる
 */
export class FrameStats {
  private elapsed = 0;
  private frames = 0;
  private snapshot: FrameStatsSnapshot = { fps: 0, frameMs: 0 };

  constructor(private readonly sampleSeconds: number = DEBUG_OVERLAY_CONFIG.sampleSeconds) {}

  /** 1フレーム分の実時間（秒）を記録する。集計値が更新されたら true */
  record(frameSeconds: number): boolean {
    if (!Number.isFinite(frameSeconds) || frameSeconds <= 0) return false;
    this.elapsed += frameSeconds;
    this.frames++;
    if (this.elapsed < this.sampleSeconds) return false;
    this.snapshot = {
      fps: this.frames / this.elapsed,
      frameMs: (this.elapsed / this.frames) * 1000,
    };
    this.elapsed = 0;
    this.frames = 0;
    return true;
  }

  get latest(): Readonly<FrameStatsSnapshot> {
    return this.snapshot;
  }
}
