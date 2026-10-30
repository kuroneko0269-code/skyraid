// クライアントの部屋（5-1）: 部屋コードでホストにつなぎ、join を送って welcome を待つ。
// ホストの終了の知らせ・接続が切れた・黙った（ping も届かない）のどれでも「ホストが切断した」で終わる。Three.js・DOM 非依存
import { NET_CONFIG } from '../data/net';

const C = NET_CONFIG.room;
import type { NetMessage } from './protocol';
import { RoomBase, type PeerState } from './room-base';
import {
  JoinFailure,
  clientPeerId,
  hostPeerId,
  type JoinError,
  type PlayerProfile,
  type RoomOptions,
} from './room';
import { TransportError, type Channel, type Transport } from './transport';

/** クライアントの部屋。join() でホストにつなぎ、welcome を待つ */
export class ClientRoom extends RoomBase {
  readonly isHost = false;
  private hostId = '';
  private joinWait: {
    deadline: number;
    resolve: () => void;
    reject: (e: JoinFailure) => void;
  } | null = null;

  private constructor(
    transport: Transport,
    readonly code: string,
    now: () => number,
  ) {
    super(transport, now, { ...NET_CONFIG.defaultSettings });
    transport.onPeerLeave((peerId) => {
      if (peerId === this.hostId) this.hostGone();
    });
  }

  /** 部屋コードでつなぐ。失敗は JoinFailure（理由つき） */
  static async join(code: string, options: RoomOptions): Promise<ClientRoom> {
    const rng = options.rng ?? Math.random;
    const now = options.now ?? (() => performance.now());
    let transport: Transport;
    try {
      transport = await options.open(clientPeerId(rng));
    } catch (e) {
      throw new JoinFailure(
        e instanceof TransportError && e.code === 'unsupported' ? 'unsupported' : 'network',
      );
    }
    const room = new ClientRoom(transport, code, now);
    await room.connect(options.profile);
    return room;
  }

  private async connect(profile: PlayerProfile): Promise<void> {
    const hostId = hostPeerId(this.code);
    this.hostId = hostId;
    const waitJoin = new Promise<void>((resolve, reject) => {
      this.joinWait = { deadline: this.now() + C.joinTimeoutSeconds * 1000, resolve, reject };
    });
    try {
      await this.transport.connect(hostId);
    } catch (e) {
      this.joinWait = null;
      this.transport.close();
      this.ended = true;
      throw new JoinFailure(
        e instanceof TransportError && e.code === 'peer-unavailable' ? 'not-found' : 'network',
      );
    }
    this.peers.set(hostId, { lastHeard: this.now(), rttMs: null, playerId: 0 });
    this.sendRaw(
      hostId,
      { type: 'join', version: NET_CONFIG.protocolVersion, ...profile },
      'reliable',
    );
    await waitJoin;
  }

  /** ホストへ送る */
  send(msg: NetMessage, channel: Channel): void {
    this.sendRaw(this.hostId, msg, channel);
  }

  leave(): void {
    this.failJoin('network');
    this.finish('left');
  }

  override tick(): void {
    const w = this.joinWait;
    if (w && this.now() > w.deadline) {
      this.failJoin('timeout');
      this.ended = true;
      this.transport.close();
      return;
    }
    super.tick();
  }

  protected handle(_peerId: string, _peer: PeerState, msg: NetMessage): void {
    if (msg.type === 'welcome') {
      if (msg.status !== 'ok') {
        this.failJoin(msg.status);
        this.ended = true;
        this.transport.close();
        return;
      }
      this.localPlayerId = msg.yourId;
      this.players = msg.players;
      this.settings = msg.settings;
      const w = this.joinWait;
      this.joinWait = null;
      w?.resolve();
      this.emitRoster();
      return;
    }
    if (msg.type === 'event' && msg.kind === 'start') this.emitStart();
    else if (msg.type === 'event' && msg.kind === 'end') this.hostGone();
    else this.emitMessage(0, msg);
  }

  protected silent(): void {
    this.hostGone();
  }

  private hostGone(): void {
    if (this.joinWait) {
      this.failJoin('network');
      this.ended = true;
      this.transport.close();
      return;
    }
    this.finish('host-left');
  }

  private failJoin(reason: JoinError): void {
    const w = this.joinWait;
    this.joinWait = null;
    w?.reject(new JoinFailure(reason));
  }
}
