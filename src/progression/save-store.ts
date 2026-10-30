// セーブデータの読み書き（3-1、Three.js・DOM 非依存）: localStorage の 1 つのキーに JSON で置く。
// 保存はイベント駆動（ミッション終了・設定の変更・パイロット名・ハンガーの操作）で、毎フレームは書かない。
// 1-6 / 2-3 の設定（画質・タッチ・敵・難易度）は別々のキーにあったので、初回に読み込んでセーブに移し、古いキーは消す。
// 設定の部品（QualitySettings など）は今までどおり StorageLike で読み書きし、settingsStorage がそれをセーブに振り分ける
import type { StorageLike } from '../core/settings';
import { DIFFICULTIES, ENEMY_SETTINGS_KEYS } from '../data/ai';
import { ASSIST_SETTINGS_KEYS, type AssistKind } from '../data/assist';
import { QUALITY_CONFIG, QUALITY_LEVELS } from '../data/quality';
import { RANKS, type Rank } from '../data/ranking';
import { SAVE_CONFIG } from '../data/save';
import { TOUCH_CONFIG, TOUCH_MODES } from '../data/touch';
import {
  clampCredits,
  createInitialSave,
  decodeSave,
  encodeSave,
  parseSave,
  sanitizePilotName,
  type MissionRecord,
  type SaveData,
  type SaveSettings,
} from './save';

/** セーブに使う localStorage の部分（古いキーを消すので removeItem も） */
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * 読み込みの結果。new: セーブなし（初回起動）/ loaded: 読めた / migrated: 古い設定のキーから作った /
 * reset: 壊れていたので初期値に戻した（HUD にお知らせを出す）
 */
export type SaveLoadStatus = 'new' | 'loaded' | 'migrated' | 'reset';

/** 古い設定のキー → セーブの設定の項目。値の文字列は古いキーと同じ */
interface SettingKey {
  readonly key: string;
  read(s: SaveSettings): string | null;
  /** 正しい値なら書いて true */
  write(s: SaveSettings, value: string): boolean;
}

function oneOf<T extends string>(list: readonly T[], v: string): v is T {
  return (list as readonly string[]).includes(v);
}

export const SETTING_KEYS: readonly SettingKey[] = [
  {
    key: QUALITY_CONFIG.storageKey,
    read: (s) => s.quality,
    write: (s, v) => {
      if (!oneOf(QUALITY_LEVELS, v)) return false;
      s.quality = v;
      return true;
    },
  },
  {
    key: QUALITY_CONFIG.autoDowngrade.storageKey,
    read: (s) => s.qualityAuto,
    write: (s, v) => {
      if (!oneOf(QUALITY_LEVELS, v)) return false;
      s.qualityAuto = v;
      return true;
    },
  },
  {
    key: TOUCH_CONFIG.storageKey,
    read: (s) => s.touchControls,
    write: (s, v) => {
      if (!oneOf(TOUCH_MODES, v)) return false;
      s.touchControls = v;
      return true;
    },
  },
  {
    key: ENEMY_SETTINGS_KEYS.enabled,
    read: (s) => (s.enemies ? 'on' : 'off'),
    write: (s, v) => {
      if (!(v === 'on' || v === 'off')) return false;
      s.enemies = v === 'on';
      return true;
    },
  },
  {
    key: ENEMY_SETTINGS_KEYS.difficulty,
    read: (s) => s.difficulty,
    write: (s, v) => {
      if (!oneOf(DIFFICULTIES, v)) return false;
      s.difficulty = v;
      return true;
    },
  },
  assistKey('aim'),
  assistKey('camera'),
  assistKey('hud'),
];

/** 操作補助（4-12）の ON/OFF。値は 'on' / 'off' */
function assistKey(kind: AssistKind): SettingKey {
  return {
    key: ASSIST_SETTINGS_KEYS[kind],
    read: (s) => (s.assist[kind] ? 'on' : 'off'),
    write: (s, v) => {
      if (!(v === 'on' || v === 'off')) return false;
      s.assist[kind] = v === 'on';
      return true;
    },
  };
}

export class SaveStore {
  private data: SaveData;
  /** 設定の部品に渡す StorageLike。古いキーで読み書きすると、セーブの設定に振り分けて保存する */
  readonly settingsStorage: StorageLike;

  private constructor(
    private readonly storage: SaveStorage | null,
    data: SaveData,
  ) {
    this.data = data;
    this.settingsStorage = {
      getItem: (key) => SETTING_KEYS.find((k) => k.key === key)?.read(this.data.settings) ?? null,
      setItem: (key, value) => {
        const k = SETTING_KEYS.find((s) => s.key === key);
        if (k?.write(this.data.settings, value)) this.persist();
      },
    };
  }

  /**
   * localStorage から読む。セーブがなければ古い設定のキーから移す（あれば保存して古いキーを消す）。
   * 壊れていれば初期値にして上書きする。ストレージが使えなければ初期値（保存しない）
   */
  static open(storage: SaveStorage | null): { store: SaveStore; status: SaveLoadStatus } {
    let text: string | null;
    try {
      text = storage?.getItem(SAVE_CONFIG.storageKey) ?? null;
    } catch {
      text = null;
    }
    if (text !== null) {
      const data = parseSave(text);
      const store = new SaveStore(storage, data ?? createInitialSave());
      if (data) {
        // 移行・値の直し（難易度の一度だけの easy など）で中身が変わったら書き戻す
        if (JSON.stringify(data) !== text) store.persist();
        return { store, status: 'loaded' };
      }
      store.persist();
      return { store, status: 'reset' };
    }
    const store = new SaveStore(storage, createInitialSave());
    const migrated = store.migrateLegacySettings();
    return { store, status: migrated ? 'migrated' : 'new' };
  }

  /** 今のデータ（書き換えはメソッドで） */
  get snapshot(): Readonly<SaveData> {
    return this.data;
  }

  get credits(): number {
    return this.data.credits;
  }

  get pilotName(): string | null {
    return this.data.pilotName;
  }

  /** パイロット名がまだない（初回起動）。タイトルの後に入力画面を出す */
  get needsPilotName(): boolean {
    return this.data.pilotName === null;
  }

  get settings(): Readonly<SaveSettings> {
    return this.data.settings;
  }

  mission(id: string): Readonly<MissionRecord> | null {
    return this.data.missions[id] ?? null;
  }

  /** パイロット名を決めて保存する。整えた名前を返す */
  setPilotName(name: string): string {
    this.data.pilotName = sanitizePilotName(name);
    this.persist();
    return this.data.pilotName;
  }

  /** クレジットを足して保存する（ミッションの報酬）。足した後の残高を返す */
  addCredits(amount: number): number {
    this.data.credits = clampCredits(this.data.credits + amount);
    this.persist();
    return this.data.credits;
  }

  /**
   * ミッションの成功を記録して保存する: 最高ランクを更新し（良いときだけ）、次のミッションを解放する
   */
  recordClear(missionId: string, rank: Rank, nextMissionId: string | null): void {
    const rec = this.ensureMission(missionId);
    rec.unlocked = true;
    if (rec.bestRank === null || RANKS.indexOf(rank) < RANKS.indexOf(rec.bestRank))
      rec.bestRank = rank;
    if (nextMissionId !== null) this.ensureMission(nextMissionId).unlocked = true;
    this.persist();
  }

  /** 設定の項目を変えて保存する（古いキーのない新しい設定。今は HUD） */
  setSetting<K extends keyof SaveSettings>(key: K, value: SaveSettings[K]): void {
    if (this.data.settings[key] === value) return;
    this.data.settings[key] = value;
    this.persist();
  }

  /** データを書き換える（ハンガーの購入・強化・選択。3-3）。fn が true を返したら保存する */
  transact(fn: (data: SaveData) => boolean): boolean {
    if (!fn(this.data)) return false;
    this.data.credits = clampCredits(this.data.credits);
    this.persist();
    return true;
  }

  /** エクスポート用の文字列（base64） */
  exportString(): string {
    return encodeSave(this.data);
  }

  /** エクスポートした文字列で置き換えて保存する。読めなければ何もせず false */
  importString(text: string): boolean {
    const data = decodeSave(text);
    if (!data) return false;
    this.data = data;
    return this.persist();
  }

  /** セーブデータを消して初期値に戻す（ポーズメニューの「セーブデータを削除」） */
  clear(): void {
    this.data = createInitialSave();
    try {
      this.storage?.removeItem(SAVE_CONFIG.storageKey);
    } catch {
      // 消せなくても初期値で続ける
    }
  }

  /** 保存する。書けなければ（容量超過・プライベートモード等）false */
  persist(): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(SAVE_CONFIG.storageKey, JSON.stringify(this.data));
      return true;
    } catch {
      return false;
    }
  }

  private ensureMission(id: string): MissionRecord {
    const rec = (this.data.missions[id] ??= { unlocked: false, bestRank: null });
    return rec;
  }

  /** 古い設定のキーを読み込む。1 つでもあれば保存して古いキーを消し、true */
  private migrateLegacySettings(): boolean {
    const storage = this.storage;
    if (!storage) return false;
    const found: string[] = [];
    for (const k of SETTING_KEYS) {
      try {
        const value = storage.getItem(k.key);
        if (value !== null) {
          found.push(k.key);
          k.write(this.data.settings, value);
        }
      } catch {
        // 読めないキーは既定値のまま
      }
    }
    if (found.length === 0 || !this.persist()) return false;
    for (const key of found) {
      try {
        storage.removeItem(key);
      } catch {
        // 残っても次からはセーブを読むので害はない
      }
    }
    return true;
  }
}
