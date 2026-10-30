// デバッグ表示（0-3）の配線: fps・draw call・地形の三角形数を 0.5 秒ごとに出す（main.ts から分けた）
import { FrameStats } from '../core/frame-stats';
import { DebugOverlay } from '../ui/debug-overlay';
import type { RenderPipeline } from './pipeline';
import type { World } from './scene';

export class DebugLink {
  private readonly overlay: DebugOverlay;
  private readonly frameStats = new FrameStats();

  constructor(
    parent: HTMLElement,
    visible: boolean,
    private readonly pipeline: RenderPipeline,
    private readonly world: World,
  ) {
    this.overlay = new DebugOverlay(parent, visible);
  }

  toggle(): void {
    this.overlay.toggle();
  }

  /** 描画フレームごとに呼ぶ（frameSeconds は前のフレームからの実時間） */
  record(frameSeconds: number): void {
    if (!this.frameStats.record(frameSeconds)) return;
    const { triangleCount: terrainTriangles, visibleChunks: terrainChunks } = this.world.terrain;
    this.overlay.update({
      ...this.frameStats.latest,
      ...this.pipeline.lastStats,
      terrainTriangles,
      terrainChunks,
    });
  }
}
