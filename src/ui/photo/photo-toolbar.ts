// フォトモード（7-A）の UI: 画面下の横スクロールのツールバー（カメラ / 画面 / 表示 / 天候 / 撮影）と、
// その上に開くパネル、右下の撮影ボタン、右上の「UI を隠す」「閉じる」。スマホ横画面で右手の親指で届く配置
import './photo-mode.css';
import { formatHour } from '../../core/photo-format';
import {
  PHOTO_RESOLUTION_LABELS,
  PHOTO_SHOW_ITEMS,
  type PhotoResolution,
  type PhotoShowKind,
} from '../../data/photo';
import { WEATHER_PRESETS, weatherLabel } from '../../data/weather';
import {
  createChip,
  createChoice,
  createRow,
  createSlider,
  createToggle,
  type Choice,
  type Slider,
  type Toggle,
} from './photo-controls';
import { CameraTab, GradeTab, type CameraTabHandlers, type GradeTabHandlers } from './photo-tabs';

export type { PhotoShowKind } from '../../data/photo';

export interface PhotoToolbarHandlers extends CameraTabHandlers, GradeTabHandlers {
  readonly show: (kind: PhotoShowKind, on: boolean) => void;
  readonly step: () => void;
  readonly weather: (id: string) => void;
  readonly weatherRestore: () => void;
  readonly hour: (h: number) => void;
  readonly resolution: (r: PhotoResolution) => void;
  readonly watermark: (on: boolean) => void;
  readonly shoot: () => void;
  readonly hideUi: () => void;
  readonly close: () => void;
}

const TABS = [
  { value: 'camera', label: 'カメラ' },
  { value: 'grade', label: '画面' },
  { value: 'show', label: '表示' },
  { value: 'weather', label: '天候' },
  { value: 'shot', label: '撮影' },
] as const;
type TabId = (typeof TABS)[number]['value'];

export class PhotoToolbar {
  readonly root: HTMLDivElement;
  private readonly panels = new Map<TabId, HTMLDivElement>();
  private readonly tabs: Choice<TabId>;
  private open: TabId | null = 'camera';
  /** 「カメラ」「画面」のパネル（値の同期は photo-link から直接呼ぶ） */
  readonly camera: CameraTab;
  readonly grade: GradeTab;
  private readonly shows = new Map<PhotoShowKind, Toggle>();
  private readonly weather: Choice<string>;
  private readonly hour: Slider;
  private readonly resolution: Choice<PhotoResolution>;
  private readonly watermark: Toggle;

  constructor(
    parent: HTMLElement,
    h: PhotoToolbarHandlers,
    resolutions: readonly PhotoResolution[],
  ) {
    const root = document.createElement('div');
    root.className = 'photo-ui';
    root.dataset.silent = '';
    root.hidden = true;
    parent.appendChild(root);
    this.root = root;

    const top = document.createElement('div');
    top.className = 'photo-top';
    root.appendChild(top);
    createChip(top, 'UI を隠す', h.hideUi);
    createChip(top, '閉じる ✕', h.close).classList.add('is-danger');

    const shutter = document.createElement('button');
    shutter.type = 'button';
    shutter.className = 'photo-shutter';
    shutter.setAttribute('aria-label', '撮影');
    shutter.addEventListener('click', h.shoot);
    root.appendChild(shutter);

    const sheet = document.createElement('div');
    sheet.className = 'photo-sheet';
    root.appendChild(sheet);
    const bar = document.createElement('div');
    bar.className = 'photo-bar';
    root.appendChild(bar);
    const panel = (id: TabId): HTMLDivElement => {
      const p = document.createElement('div');
      p.className = 'ui-panel photo-panel';
      sheet.appendChild(p);
      this.panels.set(id, p);
      return p;
    };
    this.tabs = createChoice(bar, TABS, this.open, (id) => {
      this.setTab(this.open === id ? null : id);
    });

    this.camera = new CameraTab(panel('camera'), h);
    this.grade = new GradeTab(panel('grade'), h);

    // 表示: HUD / タッチ操作 / 機体 / 敵・怪獣 / エフェクト、コマ送り
    const show = createRow(panel('show'));
    for (const item of PHOTO_SHOW_ITEMS) {
      const initial = item.kind !== 'hud' && item.kind !== 'touch';
      this.shows.set(
        item.kind,
        createToggle(show, item.label, initial, (on) => {
          h.show(item.kind, on);
        }),
      );
    }
    createChip(show, 'コマ送り ▶|', h.step);

    // 天候: 7-5 のプリセット・元に戻す・時刻
    const wp = panel('weather');
    const presetsRow = createRow(wp);
    this.weather = createChoice(
      presetsRow,
      WEATHER_PRESETS.map((p) => ({ value: p.id, label: weatherLabel(p.id) })),
      null,
      h.weather,
    );
    createChip(presetsRow, '元に戻す', h.weatherRestore);
    this.hour = createSlider(
      createRow(wp),
      { label: '時刻', min: 0, max: 24, step: 0.25, value: 12, format: formatHour },
      h.hour,
    );

    // 撮影: 解像度・透かし・撮影
    const shot = createRow(panel('shot'));
    this.resolution = createChoice(
      shot,
      resolutions.map((r) => ({ value: r, label: PHOTO_RESOLUTION_LABELS[r] })),
      'screen',
      h.resolution,
    );
    this.watermark = createToggle(shot, '透かし', true, h.watermark);
    createChip(shot, '撮影', h.shoot).classList.add('is-primary');
    this.setTab(this.open);
  }

  setShown(shown: boolean): void {
    this.root.hidden = !shown;
  }

  setTab(id: TabId | null): void {
    this.open = id;
    this.tabs.select(id);
    for (const [tab, p] of this.panels) p.hidden = tab !== id;
  }

  syncShow(kind: PhotoShowKind, on: boolean): void {
    this.shows.get(kind)?.set(on);
  }

  syncWeather(id: string | null, hour: number): void {
    this.weather.select(id);
    this.hour.set(hour);
  }

  syncShot(resolution: PhotoResolution, watermark: boolean): void {
    this.resolution.select(resolution);
    this.watermark.set(watermark);
  }
}
