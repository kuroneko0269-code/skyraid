// クライアントの部屋（5-1）: 部屋コードでホストにつなぎ、join を送って welcome を待つ。
// ホストの終了の知らせはすぐ「ホストが切断した」で終わる。5-4: 接続が切れた・黙ったときは 10 秒の間つなぎ直し
// （同じ ID と合言葉で join し直す）、戻れば続ける。ホストの ID が消えていれば（ホストのタブが閉じた）すぐ終わり、
// 期限を過ぎたら「接続が切れた」で終わる。ロビーの準備・機体・「もう一度」（lobby）と定型文（chat）を送る。Three.js・DOM 非依存
import { NET_CONFIG } from '../data/net';
import { NO_RESUME, eventMsg, type LobbyMsg, type NetMessage, type WelcomeMsg } from './protocol';
import { RoomBase, type PeerState } from './room-base';
import {
  JoinFailure,
  clientPeerId,
  hostPeerId,
  type JoinError,
  type PlayerProfile,
  type RoomOptions,
} from './room-code';
import { TransportError, type Channel, type Transport } from './transport';

const C = NET_CONFIG.room;
const R = NET_CONFIG.reconnect;

/** クライアントの部屋。join() でホストにつなぎ、welcome を待つ */
export class ClientRoom extends RoomBase {
  readonly isHost = false;
  /** ロビーで送っている自分の状態（5-4） */
  ready = false;
  again = false;
  private hostId = '';
  private token = 0;
  private joinWait: {
    deadline: number;
    resolve: () => void;
    reject: (e: JoinFailure) => void;
  } | null = null;
  /** つなぎ直している間の期限（ms）。null はつながっている */
  private reconnectUntil: number | null = null;
  private nextAttempt = 0;
  private readonly reconnectFns: ((reconnecting: boolean) => void)[] = [];

  private constructor(
    transport: Transport,
    readonly code: string,
    private profile: PlayerProfile,
    now: () => number,
  ) {
    super(transport, now, { ...NET_CONFIG.defaultSettings });
    transport.onPeerLeave((peerId) => {
      if (peerId === this.hostId) this.lostHost();
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
    const room = new ClientRoom(transport, code, options.profile, now);
    await room.connect();
    return room;
  }

  /** つなぎ直している（5-4） */
  get reconnecting(): boolean {
    return this.reconnectUntil !== null;
  }

  /** つなぎ直しの残り秒数 */
  get reconnectRemaining(): number {
    return this.reconnectUntil === null
      ? 0
      : Math.max(0, (this.reconnectUntil - this.now()) / 1000);
  }

  /** つなぎ直しを始めた（true）・戻った（false）とき */
  onReconnect(fn: (reconnecting: boolean) => void): void {
    this.reconnectFns.push(fn);
  }

  private async connect(): Promise<void> {
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
    this.sendJoin(false);
    await waitJoin;
  }

  private sendJoin(resume: boolean): void {
    this.sendRaw(
      this.hostId,
      {
        type: 'join',
        version: NET_CONFIG.protocolVersion,
        ...this.profile,
        resumeId: resume ? this.localPlayerId : NO_RESUME,
        token: resume ? this.token : 0,
      },
      'reliable',
    );
  }

  /** ホストへ送る */
  send(msg: NetMessage, channel: Channel): void {
    this.sendRaw(this.hostId, msg, channel);
  }

  /** ロビーの状態を変えて送る（準備・「もう一度」・機体。5-4） */
  setLobby(change: { ready?: boolean; again?: boolean; profile?: PlayerProfile }): void {
    if (change.ready !== undefined) this.ready = change.ready;
    if (change.again !== undefined) this.again = change.again;
    if (change.profile) this.profile = change.profile;
    const msg: LobbyMsg = {
      type: 'lobby',
      ready: this.ready,
      again: this.again,
      aircraftId: this.profile.aircraftId,
      upgrades: this.profile.upgrades,
    };
    this.send(msg, 'reliable');
  }

  /** 定型文を送る（ホストが全員へ配る） */
  chat(phrase: number): void {
    this.send({ type: 'chat', from: this.localPlayerId, phrase }, 'reliable');
  }

  /** 自分から抜ける: ホストに知らせて（再接続を待たせない）閉じる */
  leave(): void {
    this.failJoin('network');
    if (!this.reconnecting) this.send(eventMsg('bye', this.localPlayerId, 0, 0), 'reliable');
    this.finish('left');
  }

  override tick(): void {
    const w = this.joinWait;
    const t = this.now();
    if (w && t > w.deadline) {
      this.failJoin('timeout');
      this.ended = true;
      this.transport.close();
      return;
    }
    if (this.reconnectUntil !== null && !this.ended) {
      if (t > this.reconnectUntil) {
        this.finish('lost');
        return;
      }
      if (t >= this.nextAttempt) this.attempt();
    }
    super.tick();
  }

  protected handle(_peerId: string, _peer: PeerState, msg: NetMessage): void {
    if (msg.type === 'welcome') {
      this.handleWelcome(msg);
      return;
    }
    if (msg.type === 'chat') this.emitChat(msg.from, msg.phrase);
    else if (msg.type === 'event' && msg.kind === 'start') this.emitStart();
    else if (msg.type === 'event' && msg.kind === 'end') this.hostGone();
    else {
      // 対戦の終わり（5-3）: ロビーに戻る（ホストの次の「開始」を受ける）
      if (msg.type === 'event' && msg.kind === 'over') this.started = false;
      this.emitMessage(0, msg);
    }
  }

  private handleWelcome(msg: WelcomeMsg): void {
    if (msg.status !== 'ok') {
      if (this.reconnecting) {
        this.finish('lost');
        return;
      }
      this.failJoin(msg.status);
      this.ended = true;
      this.transport.close();
      return;
    }
    this.localPlayerId = msg.yourId;
    this.token = msg.yourToken;
    this.players = msg.players;
    this.settings = msg.settings;
    const me = msg.players.find((p) => p.id === msg.yourId);
    if (me) {
      this.ready = me.ready;
      this.again = me.again;
    }
    const w = this.joinWait;
    this.joinWait = null;
    w?.resolve();
    if (this.reconnectUntil !== null) {
      this.reconnectUntil = null;
      for (const fn of this.reconnectFns) fn(false);
    }
    this.emitRoster();
    // つなぎ直している間に対戦が終わっていた（over を受け取れなかった）
    if (this.started && !msg.inMatch) {
      this.started = false;
      this.emitMessage(0, eventMsg('over', 0, 0, 0));
    }
  }

  protected silent(): void {
    this.lostHost();
  }

  /** ホストとの接続が切れた・黙った: 参加済みならつなぎ直す（5-4） */
  private lostHost(): void {
    if (this.joinWait) {
      this.hostGone();
      return;
    }
    if (this.ended || this.reconnectUntil !== null) return;
    this.peers.delete(this.hostId);
    this.transport.disconnect(this.hostId);
    this.reconnectUntil = this.now() + R.graceSeconds * 1000;
    this.nextAttempt = this.now();
    for (const fn of this.reconnectFns) fn(true);
  }

  private attempt(): void {
    this.nextAttempt = this.now() + R.retrySeconds * 1000;
    this.transport.connect(this.hostId).then(
      () => {
        if (this.ended || this.reconnectUntil === null) return;
        if (!this.peers.has(this.hostId))
          this.peers.set(this.hostId, { lastHeard: this.now(), rttMs: null, playerId: 0 });
        this.sendJoin(true);
      },
      (e: unknown) => {
        // ホストの ID が消えた（ホストのタブが閉じた）: 待たずに終わる
        if (e instanceof TransportError && e.code === 'peer-unavailable') this.hostGone();
      },
    );
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
