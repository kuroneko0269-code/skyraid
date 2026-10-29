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

/**
 * 端末情報から初期品質を決める。明らかに低性能な GPU（ソフトウェアレンダラー）なら low、
 * それ以外（タッチ端末を含む）は medium。info.touch は判定に使わない（記録用に残す）
 */
export function detectQuality(info: DeviceInfo): QualityLevel {
  const gpu = info.gpuRenderer;
  if (gpu && QUALITY_CONFIG.lowGpuPatterns.some((re) => re.test(gpu))) {
    return QUALITY_CONFIG.lowLevel;
  }
  return QUALITY_CONFIG.defaultLevel;
}

const AUTO_KEY = QUALITY_CONFIG.autoDowngrade.storageKey;

/** 保存された設定を読む（既定は手動設定のキー）。未保存・不正値・アクセス不可なら null */
export function loadSavedQuality(
  storage: StorageLike | null,
  key: string = QUALITY_CONFIG.storageKey,
): QualityLevel | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(key);
    return isQualityLevel(value) ? value : null;
  } catch {
    return null;
  }
}

/** 設定を保存する（既定は手動設定のキー）。失敗（容量超過・プライベートモード等）は false */
export function saveQuality(
  storage: StorageLike | null,
  level: QualityLevel,
  key: string = QUALITY_CONFIG.storageKey,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, level);
    return true;
  } catch {
    return false;
  }
}

/** 手動設定 > 自動ダウングレードの保存値 > 自動判定 の順で初期品質を決める */
export function resolveInitialQuality(storage: StorageLike | null, info: DeviceInfo): QualityLevel {
  return loadSavedQuality(storage) ?? loadSavedQuality(storage, AUTO_KEY) ?? detectQuality(info);
}

/** 一段低い品質。最低なら null */
export function lowerQuality(level: QualityLevel): QualityLevel | null {
  const i = QUALITY_LEVELS.indexOf(level);
  return i > 0 ? (QUALITY_LEVELS[i - 1] ?? null) : null;
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
    this.apply(level);
  }

  /** 手動設定が保存されているか（あれば自動ダウングレードしない） */
  get hasManual(): boolean {
    return loadSavedQuality(this.storage) !== null;
  }

  /**
   * 自動ダウングレード: 手動設定がなく最低でなければ一段下げ、自動用のキーに保存して通知する。
   * 下げた品質を返す。下げなかったら null
   */
  downgrade(): QualityLevel | null {
    if (this.hasManual) return null;
    const lower = lowerQuality(this.current);
    if (!lower) return null;
    saveQuality(this.storage, lower, AUTO_KEY);
    this.apply(lower);
    return lower;
  }

  private apply(level: QualityLevel): void {
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
