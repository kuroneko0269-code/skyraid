// フォトモード（7-A）のツールバーの「カメラ」「画面」のパネルの中身（photo-toolbar.ts から分けた）
import type { GradeKey, GradeSettings } from '../../core/photo-grade';
import { GRADE_KEYS } from '../../core/photo-grade';
import { focusFromSlider, focusToSlider } from '../../core/photo-format';
import {
  PHOTO_FILTER_LABELS,
  PHOTO_FILTERS,
  PHOTO_FOCUS,
  PHOTO_GRADE_LABELS,
  PHOTO_GRADE_RANGE,
  PHOTO_ORBIT,
  PHOTO_PRESETS,
  type PhotoFilter,
} from '../../data/photo';
import {
  createChip,
  createChoice,
  createNote,
  createRow,
  createSlider,
  createToggle,
  type Choice,
  type Slider,
  type Toggle,
} from './photo-controls';

export interface CameraTabHandlers {
  readonly preset: (id: string) => void;
  readonly cameraReset: () => void;
  readonly fov: (v: number) => void;
  readonly roll: (v: number) => void;
  readonly focusAuto: (on: boolean) => void;
  readonly focusDistance: (m: number) => void;
  readonly blur: (v: number) => void;
}

const degrees = (v: number): string => `${v}°`;

/** カメラ: プリセット 6 種・画角・ロール・フォーカス（AF・距離・ボケ。ボケは画質「高」のみ） */
export class CameraTab {
  private readonly fov: Slider;
  private readonly roll: Slider;
  private readonly focusAuto: Toggle;
  private readonly focusDistance: Slider;
  private readonly blur: Slider;
  private readonly note: HTMLParagraphElement;

  constructor(panel: HTMLElement, h: CameraTabHandlers) {
    const presets = createRow(panel, '角度');
    for (const p of PHOTO_PRESETS) {
      createChip(presets, p.label, () => {
        h.preset(p.id);
      });
    }
    createChip(presets, 'リセット', h.cameraReset);
    const lens = createRow(panel);
    const o = PHOTO_ORBIT;
    const fov = { label: '画角', min: o.minFov, max: o.maxFov, step: 1, value: o.initial.fov };
    this.fov = createSlider(lens, { ...fov, format: degrees }, h.fov);
    const roll = { label: 'ロール', min: -o.maxRoll, max: o.maxRoll, step: 1, value: 0 };
    this.roll = createSlider(lens, { ...roll, format: degrees }, h.roll);
    const focus = createRow(panel, 'フォーカス');
    this.focusAuto = createToggle(focus, 'AF', true, h.focusAuto);
    const distance = { label: '距離', min: 0, max: 1000, step: 1, value: focusToSlider(30) };
    const meters = (v: number): string => `${Math.round(focusFromSlider(v))}m`;
    this.focusDistance = createSlider(focus, { ...distance, format: meters }, (v) => {
      // 距離を動かしたら AF を切る
      this.focusAuto.set(false);
      h.focusAuto(false);
      h.focusDistance(focusFromSlider(v));
    });
    const blur = { label: 'ボケ', min: 0, max: 1, step: 0.05, value: PHOTO_FOCUS.defaultBlur };
    this.blur = createSlider(focus, { ...blur, format: (v) => v.toFixed(2) }, h.blur);
    this.note = createNote(panel, 'ボケは画質「高」のみ');
  }

  /** カメラの値を UI に合わせる（プリセット・リセットの後） */
  syncCamera(fov: number, roll: number): void {
    this.fov.set(fov);
    this.roll.set(roll);
  }

  syncFocus(auto: boolean, distance: number, blur: number, available: boolean): void {
    this.focusAuto.set(auto);
    this.focusDistance.set(focusToSlider(distance));
    this.blur.set(blur);
    for (const c of [this.focusDistance, this.blur]) c.setDisabled(!available);
    this.focusAuto.button.disabled = !available;
    this.note.hidden = available;
  }

  /** オートフォーカスの距離を表示に出す（スライダーだけ動かす） */
  showFocusDistance(distance: number): void {
    this.focusDistance.set(focusToSlider(distance));
  }
}

export interface GradeTabHandlers {
  readonly grade: (key: GradeKey, v: number) => void;
  readonly filter: (f: PhotoFilter) => void;
  readonly gradeReset: () => void;
}

/** 画面: 露出・コントラスト・彩度・ビネット・グレイン・色温度・フィルター 5 種（露出以外は画質「中」以上） */
export class GradeTab {
  private readonly sliders = new Map<GradeKey, Slider>();
  private readonly filter: Choice<PhotoFilter>;
  private readonly note: HTMLParagraphElement;

  constructor(panel: HTMLElement, h: GradeTabHandlers) {
    const row = createRow(panel);
    for (const key of GRADE_KEYS) {
      const r = PHOTO_GRADE_RANGE[key];
      const format =
        key === 'exposure'
          ? (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}EV`
          : (v: number) => v.toFixed(2);
      const spec = { label: PHOTO_GRADE_LABELS[key], min: r.min, max: r.max, step: r.step };
      const slider = createSlider(row, { ...spec, value: r.default, format }, (v) => {
        h.grade(key, v);
      });
      this.sliders.set(key, slider);
    }
    const filters = createRow(panel, 'フィルター');
    const items = PHOTO_FILTERS.map((f) => ({ value: f, label: PHOTO_FILTER_LABELS[f] }));
    this.filter = createChoice(filters, items, 'none', h.filter);
    createChip(filters, 'リセット', h.gradeReset);
    this.note = createNote(panel, '露出以外は画質「中」以上');
  }

  sync(g: Readonly<GradeSettings>, available: boolean): void {
    for (const [key, s] of this.sliders) {
      s.set(g[key]);
      s.setDisabled(!available && key !== 'exposure');
    }
    this.filter.select(g.filter);
    for (const b of this.filter.buttons.values()) b.disabled = !available;
    this.note.hidden = available;
  }
}
