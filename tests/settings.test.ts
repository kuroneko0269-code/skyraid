import { describe, expect, it, vi } from 'vitest';
import {
  QualitySettings,
  detectQuality,
  isQualityLevel,
  loadSavedQuality,
  resolveInitialQuality,
  saveQuality,
  type StorageLike,
} from '../src/core/settings';
import { QUALITY_CONFIG, QUALITY_LEVELS, QUALITY_PRESETS } from '../src/data/quality';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

/** プライベートモードや容量超過を模した、常に例外を投げるストレージ */
const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

const KEY = QUALITY_CONFIG.storageKey;
const desktop = { touch: false, gpuRenderer: 'ANGLE (NVIDIA GeForce RTX 3060 Direct3D11)' };

describe('detectQuality', () => {
  it('タッチ端末は low', () => {
    expect(detectQuality({ touch: true, gpuRenderer: null })).toBe('low');
    expect(detectQuality({ ...desktop, touch: true })).toBe('low');
  });

  it('ソフトウェアレンダラー・モバイル GPU は low', () => {
    for (const gpu of [
      'Google SwiftShader',
      'llvmpipe (LLVM 15.0.7, 256 bits)',
      'Mali-G78',
      'Adreno (TM) 640',
      'PowerVR Rogue GE8320',
    ]) {
      expect(detectQuality({ touch: false, gpuRenderer: gpu })).toBe('low');
    }
  });

  it('それ以外（GPU 名不明を含む）は medium', () => {
    expect(detectQuality(desktop)).toBe('medium');
    expect(detectQuality({ touch: false, gpuRenderer: 'Intel(R) Iris(R) Xe Graphics' })).toBe(
      'medium',
    );
    expect(detectQuality({ touch: false, gpuRenderer: null })).toBe('medium');
  });
});

describe('保存の読み書き', () => {
  it('保存した値を読み戻せる', () => {
    const storage = memoryStorage();
    for (const level of QUALITY_LEVELS) {
      expect(saveQuality(storage, level)).toBe(true);
      expect(storage.data.get(KEY)).toBe(level);
      expect(loadSavedQuality(storage)).toBe(level);
    }
  });

  it('未保存なら null', () => {
    expect(loadSavedQuality(memoryStorage())).toBeNull();
    expect(loadSavedQuality(null)).toBeNull();
  });

  it('不正な保存値は null', () => {
    for (const bad of ['ultra', 'LOW', '', ' medium', '1', '{"level":"high"}']) {
      expect(loadSavedQuality(memoryStorage({ [KEY]: bad }))).toBeNull();
    }
  });

  it('ストレージが例外を投げても落ちない', () => {
    expect(loadSavedQuality(throwingStorage)).toBeNull();
    expect(saveQuality(throwingStorage, 'high')).toBe(false);
    expect(saveQuality(null, 'high')).toBe(false);
  });
});

describe('resolveInitialQuality', () => {
  it('保存した手動設定が自動判定より優先される', () => {
    const storage = memoryStorage({ [KEY]: 'high' });
    expect(resolveInitialQuality(storage, { touch: true, gpuRenderer: null })).toBe('high');
  });

  it('不正な保存値は自動判定にフォールバックする', () => {
    const storage = memoryStorage({ [KEY]: 'ultra' });
    expect(resolveInitialQuality(storage, { touch: true, gpuRenderer: null })).toBe('low');
    expect(resolveInitialQuality(storage, desktop)).toBe('medium');
  });

  it('ストレージが使えなければ自動判定', () => {
    expect(resolveInitialQuality(throwingStorage, desktop)).toBe('medium');
    expect(resolveInitialQuality(null, { touch: true, gpuRenderer: null })).toBe('low');
  });
});

describe('QualitySettings', () => {
  it('変更すると保存して通知し、preset が切り替わる', () => {
    const storage = memoryStorage();
    const settings = new QualitySettings(storage, 'medium');
    const listener = vi.fn();
    settings.onChange(listener);

    settings.set('high');
    expect(settings.level).toBe('high');
    expect(settings.preset).toBe(QUALITY_PRESETS.high);
    expect(storage.data.get(KEY)).toBe('high');
    expect(listener).toHaveBeenCalledWith('high', QUALITY_PRESETS.high);
  });

  it('同じ値なら通知しないが、手動設定として保存はする', () => {
    const storage = memoryStorage();
    const settings = new QualitySettings(storage, 'low');
    const listener = vi.fn();
    settings.onChange(listener);
    settings.set('low');
    expect(listener).not.toHaveBeenCalled();
    expect(storage.data.get(KEY)).toBe('low');
  });

  it('保存に失敗しても設定の変更と通知は行う', () => {
    const settings = new QualitySettings(throwingStorage, 'medium');
    const listener = vi.fn();
    const off = settings.onChange(listener);
    settings.set('low');
    expect(settings.level).toBe('low');
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    settings.set('high');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('QUALITY_PRESETS', () => {
  it('isQualityLevel は定義済みの段階だけ受け付ける', () => {
    for (const level of QUALITY_LEVELS) expect(isQualityLevel(level)).toBe(true);
    expect(isQualityLevel('ultra')).toBe(false);
    expect(isQualityLevel(null)).toBe(false);
  });

  it('段階が上がるほど描画距離・ピクセル比が下がらない', () => {
    for (let i = 1; i < QUALITY_LEVELS.length; i++) {
      const prev = QUALITY_PRESETS[QUALITY_LEVELS[i - 1] ?? 'low'];
      const cur = QUALITY_PRESETS[QUALITY_LEVELS[i] ?? 'low'];
      expect(cur.drawDistance).toBeGreaterThanOrEqual(prev.drawDistance);
      expect(cur.maxPixelRatio).toBeGreaterThanOrEqual(prev.maxPixelRatio);
    }
  });

  it('霧は描画距離の内側に収まる', () => {
    expect(QUALITY_CONFIG.fogNearRatio).toBeLessThan(QUALITY_CONFIG.fogFarRatio);
    expect(QUALITY_CONFIG.fogFarRatio).toBeLessThanOrEqual(1);
  });
});
