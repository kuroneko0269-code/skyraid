// 遅延読み込み（8-2）の土台。DOM 非依存: タイトルに要らない部分（マルチ・レイドの怪獣・リプレイ・フォトモード・情報画面・
// オンライン連携）を import() で別のチャンクにし、1 回だけ読む。失敗したら覚えず、次に使うときにやり直す
// （ただし Chrome などは読めなかったチャンクを覚えていて、再読み込みするまで同じ失敗を返す。お知らせは再読み込みを勧める）

/** 読み込みに失敗した理由: 通信できない / 通信できるのに読めない（デプロイ直後で古いチャンクが消えた等） */
export type ChunkFailure = 'offline' | 'stale';

/** 失敗の理由（navigator.onLine が false ならオフライン、それ以外は古いチャンクとみなす） */
export function classifyChunkFailure(online: boolean): ChunkFailure {
  return online ? 'stale' : 'offline';
}

export interface LazyChunk<T> {
  /** 読み込む（読み込み済み・読み込み中なら同じもの）。失敗は次の呼び出しでやり直す */
  (): Promise<T>;
  /** 読み込み済みならそのモジュール、まだなら null（同期で使う側） */
  readonly loaded: () => T | null;
}

/** import() を包む: 1 回だけ読み、失敗したら覚えない */
export function lazyChunk<T>(load: () => Promise<T>): LazyChunk<T> {
  let pending: Promise<T> | null = null;
  let module: T | null = null;
  const get = (): Promise<T> => {
    pending ??= load().then(
      (m) => {
        module = m;
        return m;
      },
      (e: unknown) => {
        pending = null;
        throw e;
      },
    );
    return pending;
  };
  return Object.assign(get, { loaded: () => module });
}

export interface LoadStatusHooks {
  /** 読み込みが delayMs を超えた（「読み込み中…」を出す） */
  readonly slow: () => void;
  /** 読み込みが終わった（成功・失敗とも。出していれば消す） */
  readonly done: () => void;
  readonly failed: (why: ChunkFailure) => void;
  readonly online: () => boolean;
  readonly delayMs: number;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (id: unknown) => void;
}

/**
 * 読み込みの表示付きで読む: delayMs を超えたら slow、終われば done、失敗したら failed を呼んで null を返す
 * （使う側は null なら何もしない。ゲームは今の画面のまま）
 */
export async function loadWithStatus<T>(
  chunk: () => Promise<T>,
  hooks: LoadStatusHooks,
): Promise<T | null> {
  const timer = hooks.setTimer(hooks.slow, hooks.delayMs);
  try {
    return await chunk();
  } catch {
    hooks.failed(classifyChunkFailure(hooks.online()));
    return null;
  } finally {
    hooks.clearTimer(timer);
    hooks.done();
  }
}
