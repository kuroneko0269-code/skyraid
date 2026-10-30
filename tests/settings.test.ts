import { describe, expect, it, vi } from 'vitest';
import {
  QualitySettings,
  detectQuality,
  isQualityLevel,
  loadSavedQuality,
  lowerQuality,
  resolveInitialQuality,
  saveQuality,
  type StorageLike,
} from '../src/core/settings';
import { FpsWatch } from '../src/core/fps-watch';
import { QUALITY_CONFIG, QUALITY_LEVELS, QUALITY_PRESETS } from '../src/data/quality';
import { CLOUD_CONFIG } from '../src/data/clouds';
import { OCEAN_CONFIG } from '../src/data/ocean';

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
const AUTO = QUALITY_CONFIG.autoDowngrade.storageKey;
const desktop = { touch: false, gpuRenderer: 'ANGLE (NVIDIA GeForce RTX 3060 Direct3D11)' };

describe('detectQuality', () => {
  it('タッチ端末は medium（ソフトウェア GPU でなければ）', () => {
    expect(detectQuality({ touch: true, gpuRenderer: null })).toBe('medium');
    expect(detectQuality({ touch: true, gpuRenderer: 'Apple GPU' })).toBe('medium');
    expect(detectQuality({ touch: true, gpuRenderer: 'Google SwiftShader' })).toBe('low');
  });

  it('ソフトウェアレンダラーだけ low。モバイル GPU は名前では下げない', () => {
    for (const gpu of [
      'Google SwiftShader',
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
      'llvmpipe (LLVM 15.0.7, 256 bits)',
      'Microsoft Basic Render Driver',
    ]) {
      expect(detectQuality({ touch: false, gpuRenderer: gpu })).toBe('low');
    }
    for (const gpu of ['Mali-G78', 'Adreno (TM) 740', 'PowerVR Rogue GE8320']) {
      expect(detectQuality({ touch: true, gpuRenderer: gpu })).toBe('medium');
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
    expect(resolveInitialQuality(storage, { touch: false, gpuRenderer: 'llvmpipe' })).toBe('low');
    expect(resolveInitialQuality(storage, desktop)).toBe('medium');
  });

  it('ストレージが使えなければ自動判定', () => {
    expect(resolveInitialQuality(throwingStorage, desktop)).toBe('medium');
    expect(resolveInitialQuality(null, { touch: true, gpuRenderer: null })).toBe('medium');
  });

  it('手動設定 > 自動ダウングレードの保存値 > 自動判定', () => {
    expect(resolveInitialQuality(memoryStorage({ [AUTO]: 'low' }), desktop)).toBe('low');
    expect(resolveInitialQuality(memoryStorage({ [AUTO]: 'low', [KEY]: 'high' }), desktop)).toBe(
      'high',
    );
  });
});

describe('自動ダウングレード', () => {
  it('lowerQuality は一段下げ、最低なら null', () => {
    expect(lowerQuality('high')).toBe('medium');
    expect(lowerQuality('medium')).toBe('low');
    expect(lowerQuality('low')).toBeNull();
  });

  it('手動設定がなければ一段下げて自動用のキーに保存し、通知する', () => {
    const storage = memoryStorage();
    const settings = new QualitySettings(storage, 'high');
    const listener = vi.fn();
    settings.onChange(listener);
    expect(settings.downgrade()).toBe('medium');
    expect(settings.level).toBe('medium');
    expect(storage.data.get(AUTO)).toBe('medium');
    expect(storage.data.has(KEY)).toBe(false);
    expect(listener).toHaveBeenCalledWith('medium', QUALITY_PRESETS.medium);
    // 自動で下げても手動設定にはならない（次の飛行でもう一段下げられる）
    expect(settings.hasManual).toBe(false);
    expect(settings.downgrade()).toBe('low');
    expect(settings.downgrade()).toBeNull();
  });

  it('手動設定があれば下げない', () => {
    const storage = memoryStorage({ [KEY]: 'high' });
    const settings = new QualitySettings(storage, 'high');
    expect(settings.downgrade()).toBeNull();
    expect(settings.level).toBe('high');
    expect(storage.data.has(AUTO)).toBe(false);
  });

  it('FpsWatch: 5 秒間の平均が 30fps 未満のときだけ 1 回 true', () => {
    const slow = new FpsWatch(5, 30);
    expect(slow.record(1 / 20)).toBe(false); // start 前は測らない
    slow.start();
    let fired = 0;
    for (let i = 0; i < 200; i++) if (slow.record(1 / 25)) fired++;
    expect(fired).toBe(1);
    expect(slow.measuring).toBe(false);

    const fast = new FpsWatch(5, 30);
    fast.start();
    let fastFired = false;
    for (let i = 0; i < 400; i++) fastFired ||= fast.record(1 / 45);
    expect(fastFired).toBe(false);
    expect(fast.measuring).toBe(false);
  });

  it('FpsWatch: 起動時の 1 回のカクつきだけでは下げない', () => {
    const watch = new FpsWatch(5, 30);
    watch.start();
    let fired = false;
    fired ||= watch.record(0.5);
    for (let i = 0; i < 300; i++) fired ||= watch.record(1 / 60);
    expect(fired).toBe(false);
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

  it('雲の方式・海の層数・雲の影: 低はビルボード 1 層、中は疑似体積 2 層、高は 3 層 + 雲の影', () => {
    const { low, medium, high } = QUALITY_PRESETS;
    expect(low.cloudMode).toBe('billboard');
    expect(medium.cloudMode).toBe('volume');
    expect(high.cloudMode).toBe('volume');
    expect([low.oceanLayers, medium.oceanLayers, high.oceanLayers]).toEqual([1, 2, 3]);
    expect([low.cloudShadows, medium.cloudShadows, high.cloudShadows]).toEqual([
      false,
      false,
      true,
    ]);
    expect([low.oceanBoost, medium.oceanBoost, high.oceanBoost]).toEqual([false, false, true]);
    expect(low.oceanSimple).toBe(true);
    expect(medium.oceanSimple || high.oceanSimple).toBe(false);
  });

  it('雲の歩数はシェーダーの上限（定数）以下で、画質が上がるほど増える。海の層数は定義の数以下', () => {
    for (const level of QUALITY_LEVELS) {
      const p = QUALITY_PRESETS[level];
      expect(p.oceanLayers).toBeGreaterThanOrEqual(1);
      expect(p.oceanLayers).toBeLessThanOrEqual(OCEAN_CONFIG.normalLayers.length);
      if (p.cloudMode === 'volume') {
        expect(p.cloudSteps).toBeGreaterThanOrEqual(8);
        expect(p.cloudSteps).toBeLessThanOrEqual(CLOUD_CONFIG.volume.maxSteps);
      }
    }
    expect(CLOUD_CONFIG.volume.maxSteps).toBeLessThanOrEqual(12);
    expect(QUALITY_PRESETS.high.cloudSteps).toBeGreaterThan(QUALITY_PRESETS.medium.cloudSteps);
  });
});
