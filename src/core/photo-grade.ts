// フォトモード（7-A）の画面の調整（Three.js 非依存）: 露出・コントラスト・彩度・ビネット・グレイン・色温度・フィルター。
// 値の範囲は src/data/photo.ts、シェーダーは src/render/post-grade.ts。フォトモードを出たら入る前の値へ戻す
import {
  PHOTO_FILTERS,
  PHOTO_GRADE_LOOK,
  PHOTO_GRADE_RANGE,
  filterIndex,
  type PhotoFilter,
} from '../data/photo';

export type GradeKey = keyof typeof PHOTO_GRADE_RANGE;

export const GRADE_KEYS: readonly GradeKey[] = [
  'exposure',
  'contrast',
  'saturation',
  'vignette',
  'grain',
  'temperature',
];

export type GradeSettings = Record<GradeKey, number> & { filter: PhotoFilter };

/** いつもの画面（何も上書きしない）と同じ値 */
export function defaultGrade(): GradeSettings {
  const r = PHOTO_GRADE_RANGE;
  return {
    exposure: r.exposure.default,
    contrast: r.contrast.default,
    saturation: r.saturation.default,
    vignette: r.vignette.default,
    grain: r.grain.default,
    temperature: r.temperature.default,
    filter: 'none',
  };
}

export function copyGrade(src: Readonly<GradeSettings>, out: GradeSettings): GradeSettings {
  Object.assign(out, src);
  return out;
}

/** 値を範囲に収めて入れる（数でなければ変えない） */
export function setGradeValue(g: GradeSettings, key: GradeKey, value: number): GradeSettings {
  if (!Number.isFinite(value)) return g;
  const r = PHOTO_GRADE_RANGE[key];
  g[key] = Math.min(r.max, Math.max(r.min, value));
  return g;
}

export function setGradeFilter(g: GradeSettings, filter: string): GradeSettings {
  if ((PHOTO_FILTERS as readonly string[]).includes(filter)) g.filter = filter as PhotoFilter;
  return g;
}

/** シェーダーに渡す値 */
export interface GradeUniforms {
  /** 露出の倍率（2^EV） */
  exposureScale: number;
  contrast: number;
  saturation: number;
  vignette: number;
  /** グレインの振幅（線形の明るさの割合） */
  grain: number;
  /** 色温度で掛ける RGB */
  tint: [number, number, number];
  filter: number;
}

export function createGradeUniforms(): GradeUniforms {
  return {
    exposureScale: 1,
    contrast: 1,
    saturation: 1,
    vignette: PHOTO_GRADE_RANGE.vignette.default,
    grain: 0,
    tint: [1, 1, 1],
    filter: 0,
  };
}

export function gradeUniforms(g: Readonly<GradeSettings>, out: GradeUniforms): GradeUniforms {
  out.exposureScale = Math.pow(2, g.exposure);
  out.contrast = g.contrast;
  out.saturation = g.saturation;
  out.vignette = g.vignette;
  out.grain = g.grain * PHOTO_GRADE_LOOK.grainAmplitude;
  const t = g.temperature;
  const to = t < 0 ? PHOTO_GRADE_LOOK.warm : PHOTO_GRADE_LOOK.cool;
  const k = Math.abs(t);
  for (let i = 0; i < 3; i++) out.tint[i] = 1 + ((to[i] ?? 1) - 1) * k;
  out.filter = filterIndex(g.filter);
  return out;
}

/** 何も上書きしていない値か（シェーダーの重い分岐を飛ばす判断） */
export function isNeutralGrade(g: Readonly<GradeSettings>): boolean {
  const d = defaultGrade();
  return GRADE_KEYS.every((k) => g[k] === d[k]) && g.filter === d.filter;
}

/** 画面の調整を入れる先（RenderPipeline.setGrade） */
export interface GradeTarget {
  setGrade(g: Readonly<GradeUniforms> | null): void;
}

/**
 * フォトモードの間だけの画面の調整: begin で既定値から始め、変えるたびに target へ入れ、end で上書きを外す
 * （いつもの画面に戻る）
 */
export class GradeOverride {
  readonly settings: GradeSettings = defaultGrade();
  private readonly uniforms: GradeUniforms = createGradeUniforms();
  private activeFlag = false;

  constructor(private readonly target: GradeTarget) {}

  get active(): boolean {
    return this.activeFlag;
  }

  begin(): void {
    this.activeFlag = true;
    this.reset();
  }

  set(key: GradeKey, value: number): void {
    setGradeValue(this.settings, key, value);
    this.push();
  }

  setFilter(filter: string): void {
    setGradeFilter(this.settings, filter);
    this.push();
  }

  /** すべて既定値へ（上書きは続ける） */
  reset(): void {
    copyGrade(defaultGrade(), this.settings);
    this.push();
  }

  end(): void {
    if (!this.activeFlag) return;
    this.activeFlag = false;
    copyGrade(defaultGrade(), this.settings);
    this.target.setGrade(null);
  }

  private push(): void {
    if (!this.activeFlag) return;
    // 既定値のままならシェーダーの調整を通さない（いつもの画面と同じ）
    this.target.setGrade(
      isNeutralGrade(this.settings) ? null : gradeUniforms(this.settings, this.uniforms),
    );
  }
}
