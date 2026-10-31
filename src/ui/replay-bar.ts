// リプレイの再生中の操作バー（7-B）: 画面の下に小さく（4-10 のデザインの部品）。再生 / 一時停止・10 秒戻る / 進む・速さ・
// 時刻とシークバー・カメラ（追従 / 自由 / 敵視点 / シネマ）・敵視点の相手の切替・撮影（フォトモード）・UI を隠す・一覧へ。
// キー: Space 再生 / 一時停止、← → 10 秒、↑ ↓ 速さ、C カメラ、H UI を隠す、P 撮影、Esc 一覧へ
import { REPLAY_CONFIG } from '../data/replay';
import { formatClock } from '../replay/outcome';
import {
  REPLAY_CAMERAS,
  REPLAY_CAMERA_LABELS,
  type ReplayCameraMode,
} from '../render/replay-camera';
import { el } from './hud-dom';
import { createButton } from './screen';
import './replay.css';

export interface ReplayBarHandlers {
  readonly togglePause: () => void;
  readonly skip: (seconds: number) => void;
  readonly setSpeed: (index: number) => void;
  /** 0〜1 の位置へ */
  readonly seek: (fraction: number) => void;
  readonly setCamera: (mode: ReplayCameraMode) => void;
  readonly nextTarget: () => void;
  readonly photo: () => void;
  readonly hideUi: () => void;
  readonly exit: () => void;
}

export class ReplayBar {
  readonly root: HTMLDivElement;
  private readonly play: HTMLButtonElement;
  private readonly time: HTMLSpanElement;
  private readonly range: HTMLInputElement;
  private readonly speed: HTMLSelectElement;
  private readonly camera: HTMLSelectElement;
  private readonly target: HTMLButtonElement;
  private readonly status: HTMLSpanElement;
  private dragging = false;

  constructor(parent: HTMLElement, h: ReplayBarHandlers) {
    const root = el('div', 'ui-panel replay-bar', parent);
    root.hidden = true;
    const row = el('div', 'replay-bar-row', root);
    createButton(row, 'ui-button replay-btn', '−10s', () => {
      h.skip(-REPLAY_CONFIG.skipSeconds);
    }).title = '10 秒戻る（←）';
    this.play = createButton(
      row,
      'ui-button is-primary replay-btn replay-play',
      '❚❚',
      h.togglePause,
    );
    this.play.title = '再生 / 一時停止（Space）';
    createButton(row, 'ui-button replay-btn', '+10s', () => {
      h.skip(REPLAY_CONFIG.skipSeconds);
    }).title = '10 秒進む（→）';
    this.speed = el('select', 'ui-field replay-select', row);
    this.speed.title = '速さ（↑ ↓）';
    REPLAY_CONFIG.speeds.forEach((s, i) => {
      const o = el('option', '', this.speed, `×${String(s)}`);
      o.value = String(i);
    });
    this.speed.addEventListener('change', () => {
      h.setSpeed(Number(this.speed.value));
      this.speed.blur();
    });
    this.time = el('span', 'replay-time', row, '0:00 / 0:00');
    this.status = el('span', 'replay-status', row);
    const row2 = el('div', 'replay-bar-row', root);
    this.range = el('input', 'replay-range', row2);
    this.range.type = 'range';
    this.range.min = '0';
    this.range.max = '1000';
    this.range.value = '0';
    this.range.setAttribute('aria-label', 'シーク');
    this.range.addEventListener('input', () => {
      this.dragging = true;
    });
    this.range.addEventListener('change', () => {
      this.dragging = false;
      h.seek(Number(this.range.value) / 1000);
      this.range.blur();
    });
    const row3 = el('div', 'replay-bar-row', root);
    this.camera = el('select', 'ui-field replay-select', row3);
    this.camera.title = 'カメラ（C）';
    for (const m of REPLAY_CAMERAS) {
      const o = el('option', '', this.camera, REPLAY_CAMERA_LABELS[m]);
      o.value = m;
    }
    this.camera.addEventListener('change', () => {
      const m = REPLAY_CAMERAS.find((x) => x === this.camera.value);
      if (m) h.setCamera(m);
      this.camera.blur();
    });
    this.target = createButton(row3, 'ui-button replay-btn', '次の敵', h.nextTarget);
    createButton(row3, 'ui-button replay-btn', '撮影', h.photo).title = 'フォトモード（P）';
    createButton(row3, 'ui-button replay-btn', 'UI を隠す', h.hideUi).title = 'UI を隠す（H）';
    createButton(row3, 'ui-button is-ghost replay-btn', '一覧へ', h.exit).title =
      '一覧へ戻る（Esc）';
    this.root = root;
  }

  setShown(shown: boolean): void {
    this.root.hidden = !shown;
  }

  /** 描画フレームごと */
  update(o: {
    seconds: number;
    duration: number;
    paused: boolean;
    speedIndex: number;
    camera: ReplayCameraMode;
    status: string;
  }): void {
    this.time.textContent = `${formatClock(o.seconds)} / ${formatClock(o.duration)}`;
    if (!this.dragging)
      this.range.value = String(Math.round((o.seconds / Math.max(1e-6, o.duration)) * 1000));
    this.play.textContent = o.paused ? '▶' : '❚❚';
    if (this.speed.value !== String(o.speedIndex)) this.speed.value = String(o.speedIndex);
    if (this.camera.value !== o.camera) this.camera.value = o.camera;
    this.target.hidden = o.camera !== 'enemy';
    this.status.textContent = o.status;
  }

  setTargetLabel(text: string): void {
    this.target.textContent = `次の敵（${text}）`;
  }
}
