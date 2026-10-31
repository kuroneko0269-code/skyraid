// 部屋のホスト・クライアント共通の部分（5-1）: 受信の振り分け、名簿・開始・終了・ゲームのメッセージの購読、
// ping（1Hz）による往復時間の計測と、黙った相手の切断扱い。Three.js・DOM 非依存
import { NET_CONFIG } from '../data/net';
import {
  decodeMessage,
  encodeMessage,
  type GameSettings,
  type NetMessage,
  type PlayerInfo,
} from './protocol';
import type { RoomEndReason } from './room-code';
import type { Channel, Transport } from './transport';

const C = NET_CONFIG.room;

export interface PeerState {
  /** 最後に何か届いた時刻（ms） */
  lastHeard: number;
  rttMs: number | null;
  /** プレイヤー ID（参加が済むまで null） */
  playerId: number | null;
}

/** ホストとクライアントで共通の部分 */
export abstract class RoomBase {
  players: PlayerInfo[] = [];
  settings: GameSettings;
  started = false;
  ended = false;
  localPlayerId = 0;
  protected readonly peers = new Map<string, PeerState>();
  private readonly rosterFns: (() => void)[] = [];
  private readonly startFns: (() => void)[] = [];
  private readonly endFns: ((reason: RoomEndReason) => void)[] = [];
  private readonly messageFns: ((playerId: number, msg: NetMessage) => void)[] = [];
  private readonly chatFns: ((from: number, phrase: number) => void)[] = [];
  private nextPing = 0;
  private nonce = 0;

  protected constructor(
    protected readonly transport: Transport,
    protected readonly now: () => number,
    settings: GameSettings,
  ) {
    this.settings = settings;
    transport.onMessage((peerId, data) => {
      const msg = decodeMessage(data);
      const peer = this.peers.get(peerId);
      if (!msg || !peer) return;
      peer.lastHeard = this.now();
      if (msg.type === 'ping') this.handlePing(peerId, peer, msg);
      else this.handle(peerId, peer, msg);
    });
  }

  abstract readonly isHost: boolean;

  /** 自分の通信口の ID（PeerJS の ID） */
  get transportId(): string {
    return this.transport.localId;
  }
  protected abstract handle(peerId: string, peer: PeerState, msg: NetMessage): void;
  protected abstract silent(peerId: string, peer: PeerState): void;

  onRoster(fn: () => void): void {
    this.rosterFns.push(fn);
  }

  onStart(fn: () => void): void {
    this.startFns.push(fn);
  }

  onEnd(fn: (reason: RoomEndReason) => void): void {
    this.endFns.push(fn);
  }

  /** 定型文（5-4。送った人と番号。自分の送ったものもホストを通って届く） */
  onChat(fn: (from: number, phrase: number) => void): void {
    this.chatFns.push(fn);
  }

  /** ゲームのメッセージ（input / state / start・end 以外の event）。開始前のものも届く */
  onMessage(fn: (playerId: number, msg: NetMessage) => void): void {
    this.messageFns.push(fn);
  }

  /** 相手との往復時間（ms）。クライアントはホストとの、ホストは指定したプレイヤーとの */
  rtt(playerId?: number): number | null {
    for (const p of this.peers.values()) {
      if (playerId === undefined || p.playerId === playerId) return p.rttMs;
    }
    return null;
  }

  /** 定期的に呼ぶ: ping を送り、黙った相手を切断扱いにする */
  tick(): void {
    if (this.ended) return;
    const t = this.now();
    if (t >= this.nextPing) {
      this.nextPing = t + 1000 / NET_CONFIG.rates.pingHz;
      const ping = encodeMessage({ type: 'ping', pong: false, nonce: this.nonce++, time: t });
      for (const id of this.peers.keys()) this.transport.send(id, ping, 'unordered');
    }
    for (const [id, p] of [...this.peers]) {
      if (t - p.lastHeard > C.silenceTimeoutSeconds * 1000) this.silent(id, p);
    }
  }

  protected sendRaw(peerId: string, msg: NetMessage, channel: Channel): void {
    this.transport.send(peerId, encodeMessage(msg), channel);
  }

  protected emitRoster(): void {
    for (const fn of this.rosterFns) fn();
  }

  protected emitStart(): void {
    if (this.started) return;
    this.started = true;
    for (const fn of this.startFns) fn();
  }

  protected emitChat(from: number, phrase: number): void {
    for (const fn of this.chatFns) fn(from, phrase);
  }

  protected emitMessage(playerId: number, msg: NetMessage): void {
    for (const fn of this.messageFns) fn(playerId, msg);
  }

  /** 終わる（自分から抜ける・ホストがいなくなった）。2 回目以降は何もしない */
  protected finish(reason: RoomEndReason): void {
    if (this.ended) return;
    this.ended = true;
    this.transport.close();
    for (const fn of this.endFns) fn(reason);
  }

  private handlePing(peerId: string, peer: PeerState, msg: NetMessage & { type: 'ping' }): void {
    if (msg.pong) peer.rttMs = Math.max(0, this.now() - msg.time);
    else this.sendRaw(peerId, { ...msg, pong: true }, 'unordered');
  }
}
