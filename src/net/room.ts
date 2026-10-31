// 部屋（5-1）: ホストが 6 文字の部屋コードを作り、PeerJS の ID（接頭辞 + コード）で待つ。クライアントはコードでつなぐ。
// 最大 4 人。名簿（welcome）・開始（event start）・終了（event end）・生存確認（ping）をここで扱い、
// ゲームのメッセージ（input / state / その他の event）は onMessage でゲーム側へ渡す。
// 時刻は tick(nowMs) で外から進める（ブラウザは setInterval、テストはインメモリのネットワークの時刻）。Three.js・DOM 非依存
import { NET_CONFIG } from '../data/net';
import { truncateChars } from '../progression/save';
import { netLoadout } from './loadout';
import { RoomBase, type PeerState } from './room-base';
import {
  encodeMessage,
  eventMsg,
  type GameSettings,
  type JoinMsg,
  type NetMessage,
  type UpgradeLevelsMsg,
  type WelcomeStatus,
} from './protocol';
import { TransportError, type Channel, type Transport, type TransportOpener } from './transport';

const C = NET_CONFIG.room;

/** 紛らわしい文字（0 / O / 1 / I）を含まない部屋コード */
export function generateRoomCode(rng: () => number = Math.random): string {
  const a = C.codeAlphabet;
  let s = '';
  for (let i = 0; i < C.codeLength; i++) s += a[Math.floor(rng() * a.length) % a.length] ?? 'A';
  return s;
}

/** 入力された部屋コードを整える（小文字・空白・ハイフンを許す）。形が違えば null */
export function normalizeRoomCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== C.codeLength) return null;
  for (const ch of s) if (!C.codeAlphabet.includes(ch)) return null;
  return s;
}

export function hostPeerId(code: string): string {
  return `${C.peerIdPrefix}${code}`;
}

export function clientPeerId(rng: () => number): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += Math.floor(rng() * 36).toString(36);
  return `${C.peerIdPrefix}c-${s}`;
}

/** 参加する人の情報（パイロット名と、ハンガーで選んだ機体・強化） */
export interface PlayerProfile {
  name: string;
  aircraftId: string;
  upgrades: UpgradeLevelsMsg;
}

export type RoomEndReason = 'host-left' | 'left';
export type JoinError =
  Exclude<WelcomeStatus, 'ok'> | 'not-found' | 'timeout' | 'network' | 'unsupported';

export class JoinFailure extends Error {
  constructor(readonly reason: JoinError) {
    super(reason);
  }
}

export interface RoomOptions {
  open: TransportOpener;
  profile: PlayerProfile;
  rng?: () => number;
  now?: () => number;
  settings?: GameSettings;
}

function maxHpOf(p: Readonly<PlayerProfile>): number {
  return netLoadout(p.aircraftId, p.upgrades).flight.hull.maxHp;
}

/** ホストの部屋。create() で部屋コードを決めて待ち受ける */
export class HostRoom extends RoomBase {
  readonly isHost = true;
  /** 参加したときの機体・強化（ホストがその機体で計算する） */
  readonly joinProfiles = new Map<number, JoinMsg>();
  private readonly peerOfPlayer = new Map<number, string>();
  private readonly leaveFns: ((playerId: number) => void)[] = [];
  /** ホスト自身の機体と強化（5-3。ホストの機体もこの数値で計算する） */
  readonly hostProfile: PlayerProfile;

  private constructor(
    transport: Transport,
    readonly code: string,
    profile: PlayerProfile,
    now: () => number,
    settings: GameSettings,
  ) {
    super(transport, now, settings);
    this.players = [
      { id: 0, name: profile.name, aircraftId: profile.aircraftId, maxHp: maxHpOf(profile) },
    ];
    this.hostProfile = profile;
    transport.onPeerJoin((peerId) => {
      this.peers.set(peerId, { lastHeard: this.now(), rttMs: null, playerId: null });
    });
    transport.onPeerLeave((peerId) => {
      this.removePeer(peerId);
    });
  }

  /** 部屋コードを作って待ち受ける。コードが使用中なら作り直す */
  static async create(options: RoomOptions): Promise<HostRoom> {
    const rng = options.rng ?? Math.random;
    const now = options.now ?? (() => performance.now());
    const settings = options.settings ?? { ...NET_CONFIG.defaultSettings };
    for (let i = 0; ; i++) {
      const code = generateRoomCode(rng);
      try {
        const t = await options.open(hostPeerId(code));
        return new HostRoom(t, code, options.profile, now, settings);
      } catch (e) {
        if (!(e instanceof TransportError && e.code === 'id-taken') || i >= C.createRetries)
          throw e;
      }
    }
  }

  /** クライアントが抜けたとき（機体を消す） */
  onPlayerLeave(fn: (playerId: number) => void): void {
    this.leaveFns.push(fn);
  }

  /** 開始する（ロビーの「開始」）。全員に知らせる */
  start(tick = 0): void {
    if (this.started || this.ended) return;
    this.broadcast(eventMsg('start', 0, 0, tick), 'reliable');
    this.emitStart();
  }

  /** ゲーム設定を変える（ロビーでホストが撃墜数・時間を選ぶ。5-3）。全員に名簿と一緒に送り直す */
  setSettings(settings: GameSettings): void {
    if (this.started || this.ended) return;
    this.settings = settings;
    this.sendRoster();
  }

  /** 対戦の終わり（5-3）: 全員に知らせ、ロビーに戻す（もう一度「開始」できる・参加を受け付ける） */
  endMatch(tick: number): void {
    if (!this.started || this.ended) return;
    this.broadcast(eventMsg('over', 0, 0, tick), 'reliable');
    this.started = false;
  }

  /** 抜ける（部屋を閉じる）。全員に終了を知らせてから閉じる */
  leave(): void {
    if (this.ended) return;
    this.broadcast(eventMsg('end', 0, 0, 0), 'reliable');
    this.finish('left');
  }

  /** 参加済みの全員へ送る */
  broadcast(msg: NetMessage, channel: Channel): void {
    const data = encodeMessage(msg);
    for (const peerId of this.peerOfPlayer.values()) this.transport.send(peerId, data, channel);
  }

  sendTo(playerId: number, msg: NetMessage, channel: Channel): void {
    const peerId = this.peerOfPlayer.get(playerId);
    if (peerId) this.sendRaw(peerId, msg, channel);
  }

  protected handle(peerId: string, peer: PeerState, msg: NetMessage): void {
    if (msg.type === 'join') {
      this.handleJoin(peerId, peer, msg);
      return;
    }
    if (peer.playerId !== null) this.emitMessage(peer.playerId, msg);
  }

  protected silent(peerId: string): void {
    this.removePeer(peerId);
  }

  private handleJoin(peerId: string, peer: PeerState, msg: JoinMsg): void {
    if (peer.playerId !== null) return;
    let status: WelcomeStatus = 'ok';
    let id = -1;
    if (msg.version !== NET_CONFIG.protocolVersion) status = 'version';
    else if (this.started) status = 'started';
    else {
      for (let i = 1; i < NET_CONFIG.maxPlayers && id < 0; i++) {
        if (!this.players.some((p) => p.id === i)) id = i;
      }
      if (id < 0) status = 'full';
    }
    if (status !== 'ok') {
      this.sendRaw(peerId, this.welcome(status, 0), 'reliable');
      return;
    }
    peer.playerId = id;
    this.peerOfPlayer.set(id, peerId);
    const name = truncateChars(msg.name, NET_CONFIG.nameMaxLength);
    this.players.push({ id, name, aircraftId: msg.aircraftId, maxHp: maxHpOf(msg) });
    this.players.sort((a, b) => a.id - b.id);
    this.joinProfiles.set(id, msg);
    this.sendRoster();
  }

  private removePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    const id = peer.playerId;
    if (id === null) return;
    this.peerOfPlayer.delete(id);
    this.joinProfiles.delete(id);
    this.players = this.players.filter((p) => p.id !== id);
    this.sendRoster();
    for (const fn of this.leaveFns) fn(id);
  }

  private welcome(status: WelcomeStatus, yourId: number): NetMessage {
    return { type: 'welcome', status, yourId, settings: this.settings, players: this.players };
  }

  private sendRoster(): void {
    for (const [id, peerId] of this.peerOfPlayer) {
      this.sendRaw(peerId, this.welcome('ok', id), 'reliable');
    }
    this.emitRoster();
  }
}
