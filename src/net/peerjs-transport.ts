// PeerJS による Transport（5-1）。シグナリングは PeerJS の公開サーバー（0.peerjs.com）、NAT 越えは Google の STUN。
// 相手ごとに DataConnection を 2 本（label 'r': 確実・順番どおり / 'u': 順不同）張り、両方開いたら onPeerJoin。
// データは ArrayBuffer のまま送る（serialization: 'raw'）。このファイルだけが peerjs を読む
import Peer, { type DataConnection, type PeerError } from 'peerjs';
import {
  Listeners,
  TransportError,
  type Channel,
  type Transport,
  type TransportOpener,
} from './transport';

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
/** close() から Peer の破棄までの待ち（最後のメッセージを送り切る） */
const DESTROY_DELAY_MS = 500;
const LABEL: Record<Channel, string> = { reliable: 'r', unordered: 'u' };

interface PeerLink {
  reliable: DataConnection | null;
  unordered: DataConnection | null;
  joined: boolean;
}

/** PeerJS の ID で通信口を開く。ID が使用中なら TransportError('id-taken') */
export const openPeerTransport: TransportOpener = (localId) =>
  new Promise((resolve, reject) => {
    if (typeof RTCPeerConnection === 'undefined') {
      reject(new TransportError('unsupported', 'WebRTC に対応していないブラウザです'));
      return;
    }
    const peer = new Peer(localId, { config: { iceServers: ICE_SERVERS } });
    let opened = false;
    peer.on('open', () => {
      opened = true;
      resolve(new PeerJsTransport(peer, localId));
    });
    peer.on('error', (err: PeerError<string>) => {
      if (opened) return;
      peer.destroy();
      reject(toTransportError(err));
    });
  });

function toTransportError(err: PeerError<string>): TransportError {
  switch (err.type) {
    case 'unavailable-id':
      return new TransportError('id-taken', err.message);
    case 'peer-unavailable':
      return new TransportError('peer-unavailable', err.message);
    case 'browser-incompatible':
      return new TransportError('unsupported', err.message);
    default:
      return new TransportError('network', err.message);
  }
}

function toArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return copy.buffer;
  }
  return null;
}

class PeerJsTransport implements Transport {
  private readonly links = new Map<string, PeerLink>();
  private readonly messages = new Listeners<[string, ArrayBuffer]>();
  private readonly joins = new Listeners<[string]>();
  private readonly leaves = new Listeners<[string]>();
  private readonly pending = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  private closed = false;

  constructor(
    private readonly peer: Peer,
    readonly localId: string,
  ) {
    peer.on('connection', (conn) => {
      this.attach(conn);
    });
    peer.on('error', (err: PeerError<string>) => {
      // つなぐ相手がいない（部屋コードの間違い）は connect の reject にする
      if (err.type === 'peer-unavailable') {
        for (const [id, p] of this.pending) {
          if (err.message.includes(id)) {
            this.pending.delete(id);
            p.reject(toTransportError(err));
          }
        }
      }
    });
    // シグナリングサーバーとの接続が切れても、張った DataConnection は生きている。新しい参加のために再接続する
    peer.on('disconnected', () => {
      if (!this.closed && !peer.destroyed) peer.reconnect();
    });
  }

  connect(peerId: string): Promise<void> {
    if (this.closed) return Promise.reject(new TransportError('closed'));
    return new Promise((resolve, reject) => {
      this.pending.set(peerId, { resolve, reject });
      for (const channel of ['reliable', 'unordered'] as const) {
        const conn = this.peer.connect(peerId, {
          label: LABEL[channel],
          reliable: channel === 'reliable',
          serialization: 'raw',
        });
        this.attach(conn);
      }
    });
  }

  private attach(conn: DataConnection): void {
    const channel: Channel | null =
      conn.label === LABEL.reliable
        ? 'reliable'
        : conn.label === LABEL.unordered
          ? 'unordered'
          : null;
    if (!channel) {
      conn.close();
      return;
    }
    const id = conn.peer;
    let link = this.links.get(id);
    if (!link) {
      link = { reliable: null, unordered: null, joined: false };
      this.links.set(id, link);
    }
    link[channel] = conn;
    const current = link;
    conn.on('open', () => {
      if (!current.joined && current.reliable?.open && current.unordered?.open) {
        current.joined = true;
        this.pending.get(id)?.resolve();
        this.pending.delete(id);
        this.joins.emit(id);
      }
    });
    conn.on('data', (data) => {
      const buf = toArrayBuffer(data);
      if (buf) this.messages.emit(id, buf);
    });
    conn.on('close', () => {
      this.drop(id);
    });
    conn.on('error', () => {
      this.drop(id);
    });
  }

  private drop(id: string): void {
    const link = this.links.get(id);
    if (!link) return;
    this.links.delete(id);
    // 送りかけのメッセージ（ホストの終了の知らせなど）を流してから閉じる
    link.reliable?.close({ flush: true });
    link.unordered?.close();
    const p = this.pending.get(id);
    if (p) {
      this.pending.delete(id);
      p.reject(new TransportError('network', '接続が閉じられました'));
    }
    if (link.joined) this.leaves.emit(id);
  }

  send(peerId: string, data: ArrayBuffer, channel: Channel): void {
    const link = this.links.get(peerId);
    const conn = link?.joined ? link[channel] : null;
    if (conn?.open) void conn.send(data);
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
    for (const id of [...this.links.keys()]) this.drop(id);
    this.messages.clear();
    this.joins.clear();
    this.leaves.clear();
    // flush の送信を待ってからシグナリングごと破棄する
    const peer = this.peer;
    setTimeout(() => {
      peer.destroy();
    }, DESTROY_DELAY_MS);
  }
}
