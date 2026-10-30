import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/event-bus';
import { loadEnemySettings, saveEnemySettings } from '../src/core/enemy-settings';
import { QualitySettings, resolveInitialQuality } from '../src/core/settings';
import { loadTouchMode } from '../src/core/touch-settings';
import { ENEMY_SETTINGS_KEYS } from '../src/data/ai';
import { QUALITY_CONFIG } from '../src/data/quality';
import { rankScore, RANKING_CONFIG } from '../src/data/ranking';
import { SAVE_CONFIG } from '../src/data/save';
import { TOUCH_CONFIG } from '../src/data/touch';
import type { MissionEvents, MissionResult } from '../src/missions/events';
import { CampaignProgress } from '../src/progression/campaign-progress';
import { bindMissionRewards } from '../src/progression/mission-rewards';
import {
  createInitialSave,
  decodeSave,
  encodeSave,
  migrateSave,
  sanitizePilotName,
} from '../src/progression/save';
import { SaveStore, type SaveStorage } from '../src/progression/save-store';

/** localStorage の偽物。fail を true にすると読み書きで例外 */
class FakeStorage implements SaveStorage {
  readonly map = new Map<string, string>();
  fail = false;
  getItem(key: string): string | null {
    if (this.fail) throw new Error('denied');
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.fail) throw new Error('denied');
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const KEY = SAVE_CONFIG.storageKey;
const DEVICE = { touch: false, gpuRenderer: null };

describe('セーブの保存と読み込み', () => {
  it('初回はセーブなし（パイロット名の入力が要る）。何かを保存するまで書かない', () => {
    const storage = new FakeStorage();
    const { store, status } = SaveStore.open(storage);
    expect(status).toBe('new');
    expect(store.needsPilotName).toBe(true);
    expect(store.credits).toBe(0);
    expect(storage.map.has(KEY)).toBe(false);
  });

  it('保存した内容を開き直すとそのまま読める（往復）', () => {
    const storage = new FakeStorage();
    const a = SaveStore.open(storage).store;
    a.setPilotName('  スカイ ');
    a.addCredits(1500);
    a.recordClear('m1', 'A', 'm2');
    a.setSetting('hud', false);
    a.settingsStorage.setItem(QUALITY_CONFIG.storageKey, 'high');
    const { store: b, status } = SaveStore.open(storage);
    expect(status).toBe('loaded');
    expect(b.snapshot).toEqual(a.snapshot);
    expect(b.pilotName).toBe('スカイ');
    expect(b.mission('m1')).toEqual({ unlocked: true, bestRank: 'A' });
    expect(b.mission('m2')).toEqual({ unlocked: true, bestRank: null });
    expect(b.settings.hud).toBe(false);
    expect(b.settings.quality).toBe('high');
    // 所持機体は初期機だけ、強化は Lv1
    expect(Object.keys(b.snapshot.aircraft.owned)).toEqual(['starter']);
    expect(b.snapshot.aircraft.owned.starter?.engine).toBe(1);
  });

  it('パイロット名は 8 文字まで（漢字・絵文字も 1 文字）、空なら既定の名前', () => {
    expect(sanitizePilotName('ABCDEFGHIJ')).toBe('ABCDEFGH');
    expect(sanitizePilotName('空の王者ラプター隊長')).toBe('空の王者ラプター');
    expect(sanitizePilotName('🛩️'.repeat(10))).toBe('🛩️'.repeat(8));
    expect(sanitizePilotName('   ')).toBe(SAVE_CONFIG.defaultPilotName);
    expect(sanitizePilotName('a\u0000b\nc')).toBe('abc');
  });

  it('ストレージが使えなくても初期値で動く（保存は失敗するだけ）', () => {
    const storage = new FakeStorage();
    storage.fail = true;
    const { store, status } = SaveStore.open(storage);
    expect(status).toBe('new');
    expect(store.addCredits(100)).toBe(100);
    expect(store.persist()).toBe(false);
    expect(SaveStore.open(null).store.credits).toBe(0);
  });
});

describe('壊れたセーブデータの復旧', () => {
  it.each([
    ['JSON でない', '{oops'],
    ['オブジェクトでない', '[1,2,3]'],
    ['クレジットが文字列', JSON.stringify({ ...createInitialSave(), credits: 'many' })],
    ['設定がない', JSON.stringify({ ...createInitialSave(), settings: null })],
    ['未知の新しい版', JSON.stringify({ ...createInitialSave(), version: 99 })],
  ])('%s → 初期値にして上書き（status reset）', (_label, text) => {
    const storage = new FakeStorage();
    storage.map.set(KEY, text);
    const { store, status } = SaveStore.open(storage);
    expect(status).toBe('reset');
    expect(store.snapshot).toEqual(createInitialSave());
    // 次に開いたときはもう壊れていない
    expect(SaveStore.open(storage).status).toBe('loaded');
  });

  it('骨組みが正しければ細かい不正値だけ既定値に直す', () => {
    const data = createInitialSave() as unknown as Record<string, unknown>;
    data.credits = -50;
    data.missions = { m1: { unlocked: true, bestRank: 'Z' }, m2: 'bad' };
    data.settings = { quality: 'ultra', touchControls: 'on', hud: 'yes' };
    data.aircraft = { selected: 'ghost', owned: { starter: { engine: 9, weapons: 0 } } };
    const save = migrateSave(data);
    expect(save).not.toBeNull();
    expect(save?.credits).toBe(0);
    expect(save?.missions).toEqual({ m1: { unlocked: true, bestRank: null } });
    expect(save?.settings.quality).toBeNull();
    expect(save?.settings.touchControls).toBe('on');
    expect(save?.settings.hud).toBe(true);
    expect(save?.aircraft.selected).toBe('starter');
    expect(save?.aircraft.owned.starter).toEqual({
      engine: 5,
      airframe: 1,
      weapons: 1,
      avionics: 1,
    });
  });
});

describe('バージョン移行の仕組み', () => {
  it('版番号のない v0（ダミー）を v1 に移行して読む', () => {
    const v0 = { credits: 2500, ranks: { training: 'S', 'first-sortie': 'B' } };
    const save = migrateSave(v0);
    expect(save?.version).toBe(1);
    expect(save?.credits).toBe(2500);
    expect(save?.missions.training).toEqual({ unlocked: true, bestRank: 'S' });
    expect(save?.missions['first-sortie']?.bestRank).toBe('B');
  });

  it('移行は 1 版ずつ順に通す。途中の移行がなければ壊れている扱い', () => {
    const calls: number[] = [];
    const migrations = {
      0: (d: Record<string, unknown>) => (calls.push(0), { ...d, a: 1 }),
      1: (d: Record<string, unknown>) => (calls.push(1), { ...createInitialSave(), credits: d.a }),
    };
    // 今の版を 2 とみなす。v0 → v1 → v2 の順に通り、最後に normalize（版 1 として）されるので null
    expect(migrateSave({ version: 0 }, migrations, 2)).toBeNull();
    expect(calls).toEqual([0, 1]);
    expect(migrateSave({ version: 0 }, {}, 1)).toBeNull();
  });

  it('既存ユーザーの設定（1-6 / 2-3 の別キー）をセーブに移し、古いキーを消す', () => {
    const storage = new FakeStorage();
    storage.map.set(QUALITY_CONFIG.storageKey, 'low');
    storage.map.set(QUALITY_CONFIG.autoDowngrade.storageKey, 'medium');
    storage.map.set(TOUCH_CONFIG.storageKey, 'off');
    storage.map.set(ENEMY_SETTINGS_KEYS.enabled, 'off');
    storage.map.set(ENEMY_SETTINGS_KEYS.difficulty, 'hard');
    const { store, status } = SaveStore.open(storage);
    expect(status).toBe('migrated');
    expect(store.settings).toMatchObject({
      quality: 'low',
      qualityAuto: 'medium',
      touchControls: 'off',
      enemies: false,
      difficulty: 'hard',
    });
    expect([...storage.map.keys()]).toEqual([KEY]);
    // 移した後もパイロット名はまだ（初回起動の流れは出す）
    expect(store.needsPilotName).toBe(true);
    // 設定の部品は今までどおりの関数で読める
    const s = store.settingsStorage;
    expect(resolveInitialQuality(s, DEVICE)).toBe('low');
    expect(loadTouchMode(s)).toBe('off');
    expect(loadEnemySettings(s)).toEqual({ enabled: false, difficulty: 'hard' });
  });

  it('設定の部品の書き込みはセーブに入り、開き直しても残る', () => {
    const storage = new FakeStorage();
    const store = SaveStore.open(storage).store;
    new QualitySettings(store.settingsStorage, 'medium').set('high');
    saveEnemySettings(store.settingsStorage, { enabled: false, difficulty: 'easy' });
    store.settingsStorage.setItem(TOUCH_CONFIG.storageKey, 'nonsense');
    const again = SaveStore.open(storage).store;
    expect(again.settings).toMatchObject({
      quality: 'high',
      enemies: false,
      difficulty: 'easy',
      touchControls: 'auto',
    });
    expect(storage.map.has(QUALITY_CONFIG.storageKey)).toBe(false);
  });
});

describe('クレジット', () => {
  const result = (credits: number, outcome: 'success' | 'failed' = 'success'): MissionResult => ({
    missionId: 'a',
    outcome,
    failReason: outcome === 'failed' ? 'timeUp' : null,
    elapsedSeconds: 100,
    damageTaken: 0,
    maxHp: 200,
    objectives: [],
    rank: outcome === 'success' ? 'S' : null,
    credits,
  });

  it('報酬のイベントで残高に足して保存し、成功でランクと次の解放を記録する', () => {
    const storage = new FakeStorage();
    const store = SaveStore.open(storage).store;
    const progress = new CampaignProgress(['a', 'b'], store);
    const bus = new EventBus<MissionEvents>();
    const off = bindMissionRewards(bus, store, progress);
    store.addCredits(3000);
    const r = result(1500);
    bus.emit('mission:end', { result: r });
    bus.emit('mission:reward', { missionId: 'a', credits: 1500, rank: 'S' });
    expect(store.credits).toBe(4500);
    expect(progress.bestRank('a')).toBe('S');
    expect(progress.isUnlocked('b')).toBe(true);
    expect(SaveStore.open(storage).store.credits).toBe(4500);
    // 失敗はランク・解放なし（報酬のイベントも来ない）
    bus.emit('mission:end', { result: result(0, 'failed') });
    expect(store.credits).toBe(4500);
    off();
    bus.emit('mission:reward', { missionId: 'a', credits: 1500, rank: 'S' });
    expect(store.credits).toBe(4500);
  });

  it('残高は 0 未満にならず、上限で止まる', () => {
    const store = SaveStore.open(null).store;
    expect(store.addCredits(-10)).toBe(0);
    expect(store.addCredits(SAVE_CONFIG.maxCredits * 2)).toBe(SAVE_CONFIG.maxCredits);
  });
});

describe('エクスポート / インポート', () => {
  it('文字列（base64）にして戻すと同じデータ。日本語の名前も壊れない', () => {
    const a = SaveStore.open(new FakeStorage()).store;
    a.setPilotName('隼');
    a.addCredits(4200);
    a.recordClear('training', 'S', 'first-sortie');
    const text = a.exportString();
    expect(text).toMatch(/^[A-Za-z0-9+/=]+$/);
    const storage = new FakeStorage();
    const b = SaveStore.open(storage).store;
    // 改行・空白が混ざっても読める（メモ帳経由など）
    expect(b.importString(`  ${text.slice(0, 20)}\n${text.slice(20)}  `)).toBe(true);
    expect(b.snapshot).toEqual(a.snapshot);
    expect(SaveStore.open(storage).store.pilotName).toBe('隼');
  });

  it('読めない文字列は何も変えずに false', () => {
    const storage = new FakeStorage();
    const store = SaveStore.open(storage).store;
    store.addCredits(100);
    expect(store.importString('not base64!!')).toBe(false);
    expect(store.importString(btoa('{"version":1}'))).toBe(false);
    expect(store.credits).toBe(100);
    expect(decodeSave(encodeSave(createInitialSave()))).toEqual(createInitialSave());
  });

  it('削除すると初期値（パイロット名の入力から）', () => {
    const storage = new FakeStorage();
    const store = SaveStore.open(storage).store;
    store.setPilotName('ACE');
    store.clear();
    expect(storage.map.has(KEY)).toBe(false);
    expect(SaveStore.open(storage).status).toBe('new');
  });
});

describe('評価の任意目標の加点（3-2）', () => {
  it('任意目標がなければ今までと同じ。すべて達成で +optionalWeight、100 点で頭打ち', () => {
    const w = RANKING_CONFIG.optionalWeight;
    expect(rankScore(72, 60, 40, 200)).toBeCloseTo(80, 5);
    expect(rankScore(72, 60, 40, 200, { completed: 0, total: 0 })).toBeCloseTo(80, 5);
    expect(rankScore(72, 60, 40, 200, { completed: 0, total: 2 })).toBeCloseTo(80, 5);
    expect(rankScore(72, 60, 40, 200, { completed: 1, total: 2 })).toBeCloseTo(80 + w / 2, 5);
    expect(rankScore(72, 60, 40, 200, { completed: 2, total: 2 })).toBeCloseTo(80 + w, 5);
    expect(rankScore(60, 60, 0, 200, { completed: 1, total: 1 })).toBe(100);
  });
});
