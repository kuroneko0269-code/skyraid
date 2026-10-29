import {
  QUALITY_CONFIG,
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  type QualityLevel,
  type QualityPreset,
} from '../data/quality';

/** localStorage のうち使う部分。テストでは偽物を渡す */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** 自動判定に使う端末情報 */
export interface DeviceInfo {
  /** 主ポインタがタッチ（スマホ・タブレット）か */
  touch: boolean;
  /** WebGL の RENDERER 文字列。取れなければ null */
  gpuRenderer: string | null;
}

export function isQualityLevel(value: unknown): value is QualityLevel {
  return typeof value === 'string' && (QUALITY_LEVELS as readonly string[]).includes(value);
}

/** 端末情報から初期品質を決める。タッチ端末か低性能 GPU なら low、それ以外は medium */
export function detectQuality(info: DeviceInfo): QualityLevel {
  if (info.touch) return QUALITY_CONFIG.touchLevel;
  const gpu = info.gpuRenderer;
  if (gpu && QUALITY_CONFIG.lowGpuPatterns.some((re) => re.test(gpu))) {
    return QUALITY_CONFIG.touchLevel;
  }
  return QUALITY_CONFIG.defaultLevel;
}

/** 保存された手動設定を読む。未保存・不正値・アクセス不可なら null */
export function loadSavedQuality(storage: StorageLike | null): QualityLevel | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(QUALITY_CONFIG.storageKey);
    return isQualityLevel(value) ? value : null;
  } catch {
    return null;
  }
}

/** 手動設定を保存する。失敗（容量超過・プライベートモード等）は false */
export function saveQuality(storage: StorageLike | null, level: QualityLevel): boolean {
  if (!storage) return false;
  try {
    storage.setItem(QUALITY_CONFIG.storageKey, level);
    return true;
  } catch {
    return false;
  }
}

/** 保存値があればそれを、なければ自動判定の結果を返す */
export function resolveInitialQuality(storage: StorageLike | null, info: DeviceInfo): QualityLevel {
  return loadSavedQuality(storage) ?? detectQuality(info);
}

export type QualityListener = (level: QualityLevel, preset: QualityPreset) => void;

/** 現在の品質設定を持ち、変更時に保存と通知を行う */
export class QualitySettings {
  private current: QualityLevel;
  private readonly listeners: QualityListener[] = [];

  constructor(
    private readonly storage: StorageLike | null,
    initial: QualityLevel,
  ) {
    this.current = initial;
  }

  get level(): QualityLevel {
    return this.current;
  }

  get preset(): QualityPreset {
    return QUALITY_PRESETS[this.current];
  }

  /** 手動で変更する。保存して購読者に通知する */
  set(level: QualityLevel): void {
    saveQuality(this.storage, level);
    if (level === this.current) return;
    this.current = level;
    for (const fn of this.listeners) fn(level, this.preset);
  }

  /** 変更を購読する。戻り値で解除 */
  onChange(fn: QualityListener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }
}

/** ブラウザの localStorage。アクセス自体が例外になる環境（ストレージ無効化など）では null */
export function getBrowserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 主ポインタが粗い（指）ならタッチ端末とみなす。タッチ対応ノートPCはマウスが主なので除外される */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}
