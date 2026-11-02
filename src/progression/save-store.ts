// セーブデータの読み書き（3-1、Three.js・DOM 非依存）: localStorage の 1 つのキーに JSON で置く。
// 保存はイベント駆動（ミッション終了・設定の変更・パイロット名・ハンガーの操作）で、毎フレームは書かない。
// 1-6 / 2-3 の設定（画質・タッチ・敵・難易度）は別々のキーにあったので、初回に読み込んでセーブに移し、古いキーは消す。
// 設定の部品（QualitySettings など）は今までどおり StorageLike で読み書きし、settingsStorage がそれをセーブに振り分ける
import type { ControlSettings } from '../core/control-settings';
import type { StorageLike } from '../core/settings';
import { RANKS, type Rank } from '../data/ranking';
import { SAVE_CONFIG } from '../data/save';
import {
  clampCredits,
  createInitialSave,
  parseSave,
  sanitizePilotName,
  type MissionRecord,
  type SaveData,
  type SaveFlag,
  type SaveSettings,
} from './save';
import { SETTING_KEYS } from './save-legacy-keys';

/** セーブに使う localStorage の部分（古いキーを消すので removeItem も） */
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * 読み込みの結果。new: セーブなし（初回起動）/ loaded: 読めた / migrated: 古い設定のキーから作った /
 * reset: 壊れていたので初期値に戻した（HUD にお知らせを出す）
 */
export type SaveLoadStatus = 'new' | 'loaded' | 'migrated' | 'reset';

export class SaveStore {
  private data: SaveData;
  /** 保存のたびに呼ぶ（7-4: オンライン連携のセーブの送信。登録は起動の後） */
  private readonly persistListeners: (() => void)[] = [];
  /** 8-3: 書けなかったときに 1 回だけ呼ぶ（容量超過・プライベートブラウズ・ストレージ無効） */
  private writeFailListener: (() => void) | null = null;
  private writeFailed = false;
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

  /** 一度だけの案内の記録（4-11） */
  flag(key: SaveFlag): boolean {
    return this.data.flags[key];
  }

  /** 案内を出した・チュートリアルを完了したことを記録して保存する */
  setFlag(key: SaveFlag): void {
    if (this.data.flags[key]) return;
    this.data.flags[key] = true;
    this.persist();
  }

  /** 操作の設定（4-11）を変えて保存する */
  updateControls(fn: (c: ControlSettings) => void): void {
    fn(this.data.settings.controls);
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

  /**
   * サーバーのセーブ（7-4）で置き換えて保存する。版の移行と値の確かめはエクスポートの読み込みと同じ（parseSave）。
   * 読めなければ何もせず false
   */
  replaceWith(raw: unknown): boolean {
    let data: SaveData | null;
    try {
      data = parseSave(JSON.stringify(raw));
    } catch {
      data = null;
    }
    if (!data) return false;
    this.data = data;
    return this.persist();
  }

  /** 保存のたびに呼ぶ関数を足す（7-4） */
  onPersist(fn: () => void): void {
    this.persistListeners.push(fn);
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

  /** 書けなかったときの知らせ先（8-3。最初の 1 回だけ呼ぶ。ストレージが無ければ登録した時点で呼ぶ） */
  onWriteFail(fn: () => void): void {
    this.writeFailListener = fn;
    if (!this.storage) this.failWrite();
  }

  /** 保存する。書けなければ（容量超過・プライベートモード等）false */
  persist(): boolean {
    for (const fn of this.persistListeners) fn();
    if (!this.storage) return this.failWrite();
    try {
      this.storage.setItem(SAVE_CONFIG.storageKey, JSON.stringify(this.data));
      return true;
    } catch {
      return this.failWrite();
    }
  }

  private failWrite(): false {
    if (!this.writeFailed) {
      this.writeFailed = true;
      this.writeFailListener?.();
    }
    return false;
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

// ---------------------------------------------------------------- エクスポート / インポート
// 端末を変えるとき用の文字列: JSON を UTF-8 にして base64（パイロット名に日本語が入っても壊れない）

export function encodeSave(data: SaveData): string {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** エクスポートした文字列を読む。前後・途中の空白と改行は無視する。読めなければ null */
export function decodeSave(text: string): SaveData | null {
  try {
    const binary = atob(text.replace(/\s+/g, ''));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return parseSave(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}
