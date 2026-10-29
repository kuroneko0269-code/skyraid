import './debug-overlay.css';

export interface DebugOverlayStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
}

/** 画面左上のデバッグ表示（fps / frame ms / draw calls / triangles） */
export class DebugOverlay {
  private readonly el: HTMLDivElement;
  private shown = false;
  private last: DebugOverlayStats | null = null;

  constructor(parent: HTMLElement, visible: boolean) {
    this.el = document.createElement('div');
    this.el.className = 'debug-overlay';
    parent.appendChild(this.el);
    this.setVisible(visible);
  }

  get visible(): boolean {
    return this.shown;
  }

  setVisible(visible: boolean): void {
    this.shown = visible;
    this.el.hidden = !visible;
    if (visible) this.draw();
  }

  toggle(): void {
    this.setVisible(!this.shown);
  }

  /** 表示内容を更新する。DOM 書き換えを減らすため、呼ぶのは集計値が変わったときだけにする */
  update(stats: DebugOverlayStats): void {
    this.last = stats;
    if (this.shown) this.draw();
  }

  private draw(): void {
    const stats = this.last;
    if (!stats) {
      this.el.textContent = 'fps --';
      return;
    }
    this.el.textContent =
      `fps ${stats.fps.toFixed(1)}\n` +
      `frame ${stats.frameMs.toFixed(2)} ms\n` +
      `draw calls ${stats.drawCalls}\n` +
      `triangles ${stats.triangles.toLocaleString('en-US')}`;
  }
}
