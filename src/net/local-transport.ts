// 同じブラウザのタブどうしの Transport（5-1。確認用）: BroadcastChannel で ID を宛先にしてやりとりする。
// ?net=local で PeerJS の代わりに使う（シグナリングサーバーなしで 1 台の PC の 2 タブで確かめられる）。
// 経路（reliable / unordered）の区別はなく、すべて順番どおり確実に届く
import { Listeners, TransportError, type Transport, type TransportOpener } from './transport';

const CHANNEL = 'skyraid-net-local';
/** ID が使われていないか確かめる待ち時間・接続の返事を待つ時間（ms） */
const PROBE_MS = 200;
const CONNECT_MS = 3000;

type Packet =
  | { kind: 'probe' | 'taken' | 'connect' | 'accept' | 'bye'; from: string; to: string }
  | { kind: 'data'; from: string; to: string; data: ArrayBuffer };

function isPacket(v: unknown): v is Packet {
  return typeof v === 'object' && v !== null && 'kind' in v && 'from' in v && 'to' in v;
}

export const openLocalTransport: TransportOpener = (localId) =>
  new Promise((resolve, reject) => {
    if (typeof BroadcastChannel === 'undefined') {
      reject(new TransportError('unsupported'));
      return;
    }
    const bc = new BroadcastChannel(CHANNEL);
    let taken = false;
    bc.onmessage = (e: MessageEvent<unknown>) => {
      if (isPacket(e.data) && e.data.kind === 'taken' && e.data.to === localId) taken = true;
    };
    bc.postMessage({ kind: 'probe', from: localId, to: localId } satisfies Packet);
    setTimeout(() => {
      if (taken) {
        bc.close();
        reject(new TransportError('id-taken', localId));
      } else resolve(new LocalTransport(bc, localId));
    }, PROBE_MS);
  });

class LocalTransport implements Transport {
  private readonly peers = new Set<string>();
  private readonly messages = new Listeners<[string, ArrayBuffer]>();
  private readonly joins = new Listeners<[string]>();
  private readonly leaves = new Listeners<[string]>();
  private readonly pending = new Map<string, () => void>();
  private closed = false;

  constructor(
    private readonly bc: BroadcastChannel,
    readonly localId: string,
  ) {
    bc.onmessage = (e: MessageEvent<unknown>) => {
      if (isPacket(e.data)) this.receive(e.data);
    };
  }

  private post(p: Packet): void {
    if (!this.closed) this.bc.postMessage(p);
  }

  private receive(p: Packet): void {
    const id = this.localId;
    if (p.kind === 'probe' && p.to === id && p.from === id) {
      this.post({ kind: 'taken', from: id, to: id });
      return;
    }
    if (p.to !== id) return;
    switch (p.kind) {
      case 'connect':
        this.post({ kind: 'accept', from: id, to: p.from });
        this.link(p.from);
        break;
      case 'accept':
        this.link(p.from);
        this.pending.get(p.from)?.();
        this.pending.delete(p.from);
        break;
      case 'data':
        if (this.peers.has(p.from)) this.messages.emit(p.from, p.data);
        break;
      case 'bye':
        if (this.peers.delete(p.from)) this.leaves.emit(p.from);
        break;
      default:
        break;
    }
  }

  private link(peerId: string): void {
    if (this.peers.has(peerId)) return;
    this.peers.add(peerId);
    this.joins.emit(peerId);
  }

  connect(peerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(peerId);
        reject(new TransportError('peer-unavailable', peerId));
      }, CONNECT_MS);
      this.pending.set(peerId, () => {
        clearTimeout(timer);
        resolve();
      });
      this.post({ kind: 'connect', from: this.localId, to: peerId });
    });
  }

  send(peerId: string, data: ArrayBuffer): void {
    if (this.peers.has(peerId)) this.post({ kind: 'data', from: this.localId, to: peerId, data });
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

  disconnect(peerId: string): void {
    if (!this.peers.delete(peerId)) return;
    this.post({ kind: 'bye', from: this.localId, to: peerId });
    this.leaves.emit(peerId);
  }

  close(): void {
    if (this.closed) return;
    for (const peerId of this.peers) this.post({ kind: 'bye', from: this.localId, to: peerId });
    this.closed = true;
    this.peers.clear();
    this.bc.close();
  }
}
