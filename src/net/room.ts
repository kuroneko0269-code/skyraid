// 部屋（5-1）: ホストが 6 文字の部屋コードを作り、PeerJS の ID（接頭辞 + コード）で待つ。クライアントはコードでつなぐ。
// 最大 4 人。名簿（welcome）・開始（event start）・終了（event end）・生存確認（ping）をここで扱い、
// ゲームのメッセージ（input / state / その他の event）は onMessage でゲーム側へ渡す。
// 5-4: ロビーの準備（Ready）・機体変更・「もう一度」（lobby）、定型文（chat）、チームの割当、強化の無効と最大 HP、
// クライアントの一時的な切断（10 秒は枠と機体を残し、同じ ID と合言葉で戻れば続ける。自分から抜けたら bye ですぐ消す）。
// 時刻は tick(nowMs) で外から進める（ブラウザは setInterval、テストはインメモリのネットワークの時刻）。Three.js・DOM 非依存
import { NET_CONFIG } from '../data/net';
import { PVP_CONFIG, PVP_QUICK_PHRASES } from '../data/pvp';
import { truncateChars } from '../progression/save';
import { ChatGate, autoTeams, newPlayer, sameUpgrades, teamForNewcomer } from './lobby-rules';
import { netLoadout } from './loadout';
import { RoomBase, type PeerState } from './room-base';
import {
  NO_RESUME,
  encodeMessage,
  eventMsg,
  type GameSettings,
  type JoinMsg,
  type LobbyMsg,
  type NetMessage,
  type PlayerInfo,
  type WelcomeStatus,
} from './protocol';
import { generateRoomCode, hostPeerId, type PlayerProfile, type RoomOptions } from './room-code';
import { TransportError, type Channel, type Transport } from './transport';

export * from './room-code';

const C = NET_CONFIG.room;

export class HostRoom extends RoomBase {
  readonly isHost = true;
  /** 参加者の機体・強化（ホストがその機体で計算する。ロビーで機体を変えると書き換わる） */
  readonly joinProfiles = new Map<number, PlayerProfile>();
  private readonly peerOfPlayer = new Map<number, string>();
  /** 再接続の合言葉（プレイヤー ID → 乱数） */
  private readonly tokens = new Map<number, number>();
  /** 再接続を待っている人（プレイヤー ID → 気づいた時刻 ms） */
  private readonly awaySince = new Map<number, number>();
  private readonly chatGate = new ChatGate(PVP_CONFIG.chat.minIntervalSeconds * 1000);
  private readonly leaveFns: ((playerId: number) => void)[] = [];
  private readonly awayFns: ((playerId: number, away: boolean) => void)[] = [];

  private constructor(
    transport: Transport,
    readonly code: string,
    /** ホスト自身の機体と強化（5-3。ホストの機体もこの数値で計算する。5-4 からロビーで変えられる） */
    public hostProfile: PlayerProfile,
    now: () => number,
    settings: GameSettings,
    private readonly rng: () => number,
  ) {
    super(transport, now, settings);
    this.players = [newPlayer(0, hostProfile, this.maxHpOf(hostProfile), 0, true)];
    transport.onPeerJoin((peerId) => {
      this.peers.set(peerId, { lastHeard: this.now(), rttMs: null, playerId: null });
    });
    transport.onPeerLeave((peerId) => {
      this.markAway(peerId);
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
        return new HostRoom(t, code, options.profile, now, settings, rng);
      } catch (e) {
        if (!(e instanceof TransportError && e.code === 'id-taken') || i >= C.createRetries)
          throw e;
      }
    }
  }

  /** クライアントが抜けたとき（機体を消す。再接続の期限が過ぎたときも） */
  onPlayerLeave(fn: (playerId: number) => void): void {
    this.leaveFns.push(fn);
  }

  /** クライアントが切断した（away = true）/ 再接続した（false）とき（5-4） */
  onPlayerAway(fn: (playerId: number, away: boolean) => void): void {
    this.awayFns.push(fn);
  }

  /** 開始する（ロビーの「開始」。押せるかは lobby-rules.ts の startBlock で画面が決める）。全員に知らせる */
  start(tick = 0): void {
    if (this.started || this.ended) return;
    this.broadcast(eventMsg('start', 0, 0, tick), 'reliable');
    this.emitStart();
  }

  /**
   * ゲーム設定を変える（ロビーでホストが選ぶ）。全員に名簿と一緒に送り直す。
   * 強化の無効で最大 HP が変わる。チーム戦に切り替えたらチームを自動で割り当てる
   */
  setSettings(settings: GameSettings): void {
    if (this.started || this.ended) return;
    const toTeam = settings.mode === 'team' && this.settings.mode !== 'team';
    this.settings = settings;
    if (toTeam) this.assignTeams(autoTeams(this.players));
    this.refreshHp();
    this.sendRoster();
  }

  /** チームを割り当てる（ホストの操作。5-4） */
  setTeam(playerId: number, team: number): void {
    this.assignTeams(new Map([[playerId, team === 1 ? 1 : 0]]));
    this.sendRoster();
  }

  /** チームを自動で分ける（ID 順に A・B・A・B） */
  autoAssignTeams(): void {
    this.assignTeams(autoTeams(this.players));
    this.sendRoster();
  }

  /** ホスト自身の機体を変える・「もう一度」を押す（5-4） */
  updateHost(change: { profile?: PlayerProfile; again?: boolean }): void {
    const me = this.players.find((p) => p.id === 0);
    if (!me) return;
    if (change.profile && !this.started) {
      this.hostProfile = change.profile;
      me.aircraftId = change.profile.aircraftId;
    }
    if (change.again) me.again = true;
    this.refreshHp();
    this.sendRoster();
  }

  /** 定型文を送る（ホスト自身。5-4） */
  chat(phrase: number): void {
    this.relayChat(0, phrase);
  }

  /** 対戦の終わり（5-3）: 全員に知らせ、ロビーに戻す。準備と「もう一度」は全員やり直し（5-4） */
  /** outcome はレイドの結果（6-2。raid-host.ts の RAID_OUTCOME。PvP は 0） */
  endMatch(tick: number, outcome = 0): void {
    if (!this.started || this.ended) return;
    this.broadcast(eventMsg('over', 0, outcome, tick), 'reliable');
    this.started = false;
    for (const p of this.players) {
      p.ready = p.id === 0;
      p.again = false;
    }
    this.sendRoster();
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

  /** 定期的に呼ぶ: ping・黙った相手の切断扱いと、再接続の期限切れ */
  override tick(): void {
    super.tick();
    if (this.ended) return;
    const limit = NET_CONFIG.reconnect.graceSeconds * 1000;
    for (const [id, since] of [...this.awaySince]) {
      if (this.now() - since > limit) this.removePlayer(id);
    }
  }

  protected handle(peerId: string, peer: PeerState, msg: NetMessage): void {
    if (msg.type === 'join') {
      this.handleJoin(peerId, peer, msg);
      return;
    }
    const id = peer.playerId;
    if (id === null) return;
    if (msg.type === 'lobby') this.handleLobby(id, msg);
    else if (msg.type === 'chat') this.relayChat(id, msg.phrase);
    else if (msg.type === 'event' && msg.kind === 'bye') {
      this.peers.delete(peerId);
      this.removePlayer(id);
    } else this.emitMessage(id, msg);
  }

  /** 黙った: 接続を切って再接続を待つ */
  protected silent(peerId: string): void {
    this.markAway(peerId);
    this.transport.disconnect(peerId);
  }

  private maxHpOf(p: Readonly<PlayerProfile>): number {
    return netLoadout(p.aircraftId, this.settings.noUpgrades ? undefined : p.upgrades).flight.hull
      .maxHp;
  }

  private refreshHp(): void {
    for (const p of this.players) {
      const prof = p.id === 0 ? this.hostProfile : this.joinProfiles.get(p.id);
      if (prof) p.maxHp = this.maxHpOf(prof);
    }
  }

  private assignTeams(teams: ReadonlyMap<number, number>): void {
    for (const p of this.players) {
      const t = teams.get(p.id);
      if (t !== undefined) p.team = t;
    }
  }

  private handleJoin(peerId: string, peer: PeerState, msg: JoinMsg): void {
    if (msg.resumeId !== NO_RESUME) {
      this.handleResume(peerId, peer, msg);
      return;
    }
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
    this.tokens.set(id, (Math.floor(this.rng() * 0xfffffffe) + 1) >>> 0);
    const profile: PlayerProfile = {
      name: truncateChars(msg.name, NET_CONFIG.nameMaxLength),
      aircraftId: msg.aircraftId,
      upgrades: msg.upgrades,
    };
    this.joinProfiles.set(id, profile);
    this.players.push(
      newPlayer(id, profile, this.maxHpOf(profile), teamForNewcomer(this.players), false),
    );
    this.players.sort((a, b) => a.id - b.id);
    this.sendRoster();
  }

  /** 再接続（5-4）: 同じ ID と合言葉なら同じ枠に戻す */
  private handleResume(peerId: string, peer: PeerState, msg: JoinMsg): void {
    const id = msg.resumeId;
    const ok = msg.version === NET_CONFIG.protocolVersion && this.tokens.get(id) === msg.token;
    if (ok && peer.playerId === id) {
      // 古い接続が残ったままつなぎ直してきた: 名簿を送り直すだけ
      this.sendRaw(peerId, this.welcome('ok', id), 'reliable');
      return;
    }
    if (!ok || !this.awaySince.has(id) || peer.playerId !== null) {
      this.sendRaw(peerId, this.welcome('expired', 0), 'reliable');
      return;
    }
    peer.playerId = id;
    this.peerOfPlayer.set(id, peerId);
    this.awaySince.delete(id);
    const p = this.players.find((x) => x.id === id);
    if (p) p.away = false;
    this.sendRoster();
    for (const fn of this.awayFns) fn(id, false);
  }

  private handleLobby(id: number, msg: LobbyMsg): void {
    const p = this.players.find((x) => x.id === id);
    if (!p || this.started) return;
    p.ready = msg.ready;
    if (msg.again) p.again = true;
    const prof = this.joinProfiles.get(id);
    if (
      prof &&
      (prof.aircraftId !== msg.aircraftId || !sameUpgrades(prof.upgrades, msg.upgrades))
    ) {
      const next = { ...prof, aircraftId: msg.aircraftId, upgrades: msg.upgrades };
      this.joinProfiles.set(id, next);
      p.aircraftId = msg.aircraftId;
      p.maxHp = this.maxHpOf(next);
    }
    this.sendRoster();
  }

  /** 定型文を全員へ（同じ人は minIntervalSeconds に 1 回まで） */
  private relayChat(from: number, phrase: number): void {
    if (!Number.isInteger(phrase) || phrase < 0 || phrase >= PVP_QUICK_PHRASES.length) return;
    if (!this.chatGate.allow(from, this.now())) return;
    this.broadcast({ type: 'chat', from, phrase }, 'reliable');
    this.emitChat(from, phrase);
  }

  /** 接続が切れた・黙った: 参加済みなら再接続を待つ（機体は止まる）。参加前なら忘れる */
  private markAway(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    const id = peer.playerId;
    if (id === null) return;
    if (this.peerOfPlayer.get(id) === peerId) this.peerOfPlayer.delete(id);
    this.awaySince.set(id, this.now());
    const p = this.players.find((x) => x.id === id);
    if (p) p.away = true;
    this.sendRoster();
    for (const fn of this.awayFns) fn(id, true);
  }

  private removePlayer(id: number): void {
    const peerId = this.peerOfPlayer.get(id);
    if (peerId !== undefined) this.peers.delete(peerId);
    this.peerOfPlayer.delete(id);
    this.joinProfiles.delete(id);
    this.tokens.delete(id);
    this.awaySince.delete(id);
    this.players = this.players.filter((p) => p.id !== id);
    this.sendRoster();
    for (const fn of this.leaveFns) fn(id);
  }

  private welcome(status: WelcomeStatus, yourId: number): NetMessage {
    return {
      type: 'welcome',
      status,
      yourId,
      yourToken: status === 'ok' ? (this.tokens.get(yourId) ?? 0) : 0,
      inMatch: this.started,
      settings: this.settings,
      players: this.players,
    };
  }

  private sendRoster(): void {
    for (const [id, peerId] of this.peerOfPlayer) {
      this.sendRaw(peerId, this.welcome('ok', id), 'reliable');
    }
    this.emitRoster();
  }
}

export type { PlayerInfo };
