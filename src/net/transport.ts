// 通信の抽象（5-1）。部屋（room.ts）とゲームの同期はこの Transport だけを使い、実装は差し替えられる:
// PeerJS（peerjs-transport.ts。本番）と、遅延・揺らぎ・パケットロスを設定できるインメモリ（下の MemoryNetwork。テスト）。
// Three.js・DOM 非依存

/**
 * 送る経路。reliable: 確実に順番どおり届く（join / welcome / event）。
 * unordered: 順番を保証しない（input / state / ping）。古いものは受け手が seq / tick で捨てる。
 * インメモリ実装では unordered だけがロスする（PeerJS の reliable: false は順不同だが再送はする）
 */
export type Channel = 'reliable' | 'unordered';

export type Unsubscribe = () => void;

/** 1 つの端末（ホストかクライアント）の通信口 */
export interface Transport {
  /** 自分の ID（PeerJS の ID） */
  readonly localId: string;
  /** 相手につなぐ（クライアント → ホスト）。つながると両方で onPeerJoin が呼ばれる */
  connect(peerId: string): Promise<void>;
  /** つながっている相手へ送る。つながっていなければ捨てる */
  send(peerId: string, data: ArrayBuffer, channel: Channel): void;
  onMessage(fn: (peerId: string, data: ArrayBuffer) => void): Unsubscribe;
  onPeerJoin(fn: (peerId: string) => void): Unsubscribe;
  onPeerLeave(fn: (peerId: string) => void): Unsubscribe;
  /** すべての接続を閉じる。相手には onPeerLeave が届く */
  close(): void;
}

/** 自分の ID で通信口を開く。ID が使われていれば 'id-taken' で reject する */
export type TransportOpener = (localId: string) => Promise<Transport>;

export class TransportError extends Error {
  constructor(
    readonly code: 'id-taken' | 'peer-unavailable' | 'network' | 'unsupported' | 'closed',
    message: string = code,
  ) {
    super(message);
  }
}

/** 小さなイベントの入れ物（Transport の実装が使う） */
export class Listeners<A extends unknown[]> {
  private readonly fns = new Set<(...args: A) => void>();

  add(fn: (...args: A) => void): Unsubscribe {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  }

  emit(...args: A): void {
    for (const fn of [...this.fns]) fn(...args);
  }

  clear(): void {
    this.fns.clear();
  }
}

// ---- インメモリ実装（テスト用） ----

export interface MemoryNetworkOptions {
  /** 片道の遅延（ms） */
  latencyMs?: number;
  /** 遅延の揺らぎ（ms。0〜この値を足す。unordered だけ。reliable は順番を守る） */
  jitterMs?: number;
  /** unordered のパケットが失われる確率（0〜1） */
  lossRate?: number;
  /** 乱数（テストで固定する） */
  rng?: () => number;
}

interface Packet {
  due: number;
  order: number;
  run: () => void;
}

/**
 * インメモリのネットワーク。時刻は advance(ms) で進め、届く時刻になったパケットを順に配る（決定的）。
 * 同じネットワークに open した端末どうしがつながる
 */
export class MemoryNetwork {
  latencyMs: number;
  jitterMs: number;
  lossRate: number;
  private readonly rng: () => number;
  private readonly endpoints = new Map<string, MemoryTransport>();
  private queue: Packet[] = [];
  private order = 0;
  private time = 0;
  /** 経路ごとの最後の到着時刻（reliable の順番を守る） */
  private readonly lastReliable = new Map<string, number>();

  constructor(options: MemoryNetworkOptions = {}) {
    this.latencyMs = options.latencyMs ?? 0;
    this.jitterMs = options.jitterMs ?? 0;
    this.lossRate = options.lossRate ?? 0;
    this.rng = options.rng ?? Math.random;
  }

  get now(): number {
    return this.time;
  }

  readonly open: TransportOpener = (localId) => {
    if (this.endpoints.has(localId)) return Promise.reject(new TransportError('id-taken', localId));
    const t = new MemoryTransport(this, localId);
    this.endpoints.set(localId, t);
    return Promise.resolve(t);
  };

  /** @internal */
  endpoint(id: string): MemoryTransport | undefined {
    return this.endpoints.get(id);
  }

  /** @internal */
  remove(id: string): void {
    this.endpoints.delete(id);
  }

  /** @internal 送る。届く時刻を決めて並べる */
  deliver(from: string, to: string, channel: Channel | 'control', run: () => void): void {
    if (channel === 'unordered' && this.rng() < this.lossRate) return;
    let due = this.time + this.latencyMs;
    if (channel === 'unordered') due += this.rng() * this.jitterMs;
    else {
      const key = `${from}>${to}`;
      due = Math.max(due, this.lastReliable.get(key) ?? 0);
      this.lastReliable.set(key, due);
    }
    this.queue.push({ due, order: this.order++, run });
  }

  /** 時刻を ms 進め、その間に届くパケットを届く順に配る */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      let next: Packet | null = null;
      for (const p of this.queue) {
        if (p.due > end) continue;
        if (!next || p.due < next.due || (p.due === next.due && p.order < next.order)) next = p;
      }
      if (!next) break;
      const picked = next;
      this.queue = this.queue.filter((p) => p !== picked);
      this.time = Math.max(this.time, picked.due);
      picked.run();
    }
    this.time = end;
  }
}

class MemoryTransport implements Transport {
  private readonly peers = new Set<string>();
  private readonly messages = new Listeners<[string, ArrayBuffer]>();
  private readonly joins = new Listeners<[string]>();
  private readonly leaves = new Listeners<[string]>();
  private closed = false;

  constructor(
    private readonly net: MemoryNetwork,
    readonly localId: string,
  ) {}

  connect(peerId: string): Promise<void> {
    const remote = this.net.endpoint(peerId);
    if (this.closed) return Promise.reject(new TransportError('closed'));
    if (!remote) return Promise.reject(new TransportError('peer-unavailable', peerId));
    return new Promise((resolve) => {
      // 接続の確立も片道の遅延 1 回ぶんかかる
      this.net.deliver(this.localId, peerId, 'control', () => {
        remote.linkFrom(this.localId);
        this.linkFrom(peerId);
        resolve();
      });
    });
  }

  /** @internal */
  linkFrom(peerId: string): void {
    if (this.closed || this.peers.has(peerId)) return;
    this.peers.add(peerId);
    this.joins.emit(peerId);
  }

  /** @internal */
  unlinkFrom(peerId: string): void {
    if (!this.peers.delete(peerId)) return;
    this.leaves.emit(peerId);
  }

  send(peerId: string, data: ArrayBuffer, channel: Channel): void {
    if (this.closed || !this.peers.has(peerId)) return;
    const copy = data.slice(0);
    this.net.deliver(this.localId, peerId, channel, () => {
      const remote = this.net.endpoint(peerId);
      if (remote?.peers.has(this.localId)) remote.messages.emit(this.localId, copy);
    });
  }

  onMessage(fn: (peerId: string, data: ArrayBuffer) => void) {
    return this.messages.add(fn);
  }

  onPeerJoin(fn: (peerId: string) => void) {
    return this.joins.add(fn);
  }

  onPeerLeave(fn: (peerId: string) => void) {
    return this.leaves.add(fn);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const peerId of this.peers) {
      this.net.deliver(this.localId, peerId, 'control', () => {
        this.net.endpoint(peerId)?.unlinkFrom(this.localId);
      });
    }
    this.peers.clear();
    this.net.remove(this.localId);
  }

  /** テスト用: 通知なしに消える（ブラウザのタブが落ちた）。相手は無通信の時間切れで気づく */
  crash(): void {
    this.closed = true;
    this.peers.clear();
    this.net.remove(this.localId);
  }
}

export type { MemoryTransport };
