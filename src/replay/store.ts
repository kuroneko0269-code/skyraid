// リプレイの保存（7-B）: IndexedDB（localStorage は容量が足りない）。直近 autoKeep 本を自動で残し（古いものから消す）、
// 名前を付けた保存は savedMax 本まで（消さない）。中身は .skyreplay と同じバイト列（src/replay/codec.ts）。
// DOM・Three.js 非依存（IDBFactory を受け取るので、テストは fake-indexeddb を渡す）
import { REPLAY_CONFIG } from '../data/replay';
import type { ReplayHeader } from './types';

export type ReplayKind = 'auto' | 'saved';

/** 一覧の 1 行（中身のバイト列は get で読む） */
export interface ReplayEntry {
  readonly id: number;
  readonly kind: ReplayKind;
  readonly name: string;
  readonly header: ReplayHeader;
  /** バイト数 */
  readonly size: number;
}

interface StoredRow {
  id?: number;
  kind: ReplayKind;
  name: string;
  header: ReplayHeader;
  size: number;
  bytes: Uint8Array;
}

export interface ReplayUsage {
  readonly savedCount: number;
  readonly savedBytes: number;
  readonly autoCount: number;
  readonly autoBytes: number;
}

export type SaveOutcome = 'ok' | 'full' | 'missing';

const STORE = 'replays';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => {
      resolve(r.result);
    };
    r.onerror = () => {
      reject(r.error ?? new Error('IndexedDB request failed'));
    };
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('IndexedDB write failed'));
    };
    tx.onabort = () => {
      reject(tx.error ?? new Error('IndexedDB write aborted'));
    };
  });
}

function toEntry(r: StoredRow): ReplayEntry {
  return { id: r.id ?? 0, kind: r.kind, name: r.name, header: r.header, size: r.size };
}

export class ReplayStore {
  private constructor(private readonly db: IDBDatabase) {}

  static open(
    factory: IDBFactory = indexedDB,
    name: string = REPLAY_CONFIG.dbName,
  ): Promise<ReplayStore> {
    return new Promise((resolve, reject) => {
      const r = factory.open(name, REPLAY_CONFIG.dbVersion);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE))
          r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      };
      r.onsuccess = () => {
        resolve(new ReplayStore(r.result));
      };
      r.onerror = () => {
        reject(r.error ?? new Error('Cannot open IndexedDB'));
      };
    });
  }

  close(): void {
    this.db.close();
  }

  private async rows(): Promise<StoredRow[]> {
    const tx = this.db.transaction(STORE, 'readonly');
    return (await request(tx.objectStore(STORE).getAll())) as StoredRow[];
  }

  /** 一覧（新しい順） */
  async list(): Promise<ReplayEntry[]> {
    const rows = await this.rows();
    return rows.map(toEntry).sort((a, b) => b.id - a.id);
  }

  async usage(): Promise<ReplayUsage> {
    const rows = await this.rows();
    let savedCount = 0;
    let savedBytes = 0;
    let autoCount = 0;
    let autoBytes = 0;
    for (const r of rows) {
      if (r.kind === 'saved') {
        savedCount++;
        savedBytes += r.size;
      } else {
        autoCount++;
        autoBytes += r.size;
      }
    }
    return { savedCount, savedBytes, autoCount, autoBytes };
  }

  /** 中身（なければ null） */
  async get(id: number): Promise<{ entry: ReplayEntry; bytes: Uint8Array } | null> {
    const tx = this.db.transaction(STORE, 'readonly');
    const r = (await request(tx.objectStore(STORE).get(id))) as StoredRow | undefined;
    return r ? { entry: toEntry(r), bytes: r.bytes } : null;
  }

  /** 自動保存に足し、直近 autoKeep 本を超えた古いものを消す。足した id */
  async addAuto(header: ReplayHeader, bytes: Uint8Array): Promise<number> {
    const tx = this.db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    const row: StoredRow = { kind: 'auto', name: header.title, header, size: bytes.length, bytes };
    const id = Number(await request(os.add(row)));
    const all = (await request(os.getAll())) as StoredRow[];
    const autos = all.filter((r) => r.kind === 'auto').sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    for (const r of autos.slice(REPLAY_CONFIG.autoKeep)) if (r.id !== undefined) os.delete(r.id);
    await done(tx);
    return id;
  }

  /** 自動保存の 1 本に名前を付けて永久保存にする（上限 savedMax 本） */
  async save(id: number, name: string): Promise<SaveOutcome> {
    const tx = this.db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    const all = (await request(os.getAll())) as StoredRow[];
    const row = all.find((r) => r.id === id);
    if (!row) return 'missing';
    if (
      row.kind !== 'saved' &&
      all.filter((r) => r.kind === 'saved').length >= REPLAY_CONFIG.savedMax
    )
      return 'full';
    row.kind = 'saved';
    row.name = cleanName(name, row.header.title);
    os.put(row);
    await done(tx);
    return 'ok';
  }

  /** ファイルから読んだ記録を永久保存に足す（上限 savedMax 本）。足した id か 'full' */
  async importSaved(
    header: ReplayHeader,
    bytes: Uint8Array,
    name: string,
  ): Promise<number | 'full'> {
    const tx = this.db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    const all = (await request(os.getAll())) as StoredRow[];
    if (all.filter((r) => r.kind === 'saved').length >= REPLAY_CONFIG.savedMax) return 'full';
    const row: StoredRow = {
      kind: 'saved',
      name: cleanName(name, header.title),
      header,
      size: bytes.length,
      bytes,
    };
    const id = Number(await request(os.add(row)));
    await done(tx);
    return id;
  }

  async rename(id: number, name: string): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    const row = (await request(os.get(id))) as StoredRow | undefined;
    if (row) {
      row.name = cleanName(name, row.header.title);
      os.put(row);
    }
    await done(tx);
  }

  async remove(id: number): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await done(tx);
  }
}

/** 名前の空白を詰めて長さを抑える（空なら fallback） */
export function cleanName(name: string, fallback: string): string {
  const s = name.replace(/\s+/g, ' ').trim().slice(0, REPLAY_CONFIG.nameMax);
  return s || fallback.slice(0, REPLAY_CONFIG.nameMax);
}
