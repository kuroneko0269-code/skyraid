// PvP（5-1）の配線。main.ts が PvP を選んだとき・?room のときだけ import() で読む（シングルプレイでは読み込まない）。
// ロビー（部屋を作る / コードで参加 → 名簿 → 開始）→ 飛行（自機は FlightSession の機体、他機は RemoteView）→
// 終了（自分で退出・ホストの切断）。飛行中の Esc / ⏸ はゲームを止めずにメニューを出す。
// 5-3: 撃ち合い（1 回の対戦は pvp-flight.ts）、ロビーのルール設定、対戦の終わり → ロビーのリザルト →「もう一度」。
// 5-4: 準備・ハンガー・共有・定型文・チーム（ロビーの操作は pvp-lobby-actions.ts）、全員の「もう一度」でロビーへ、
// 切断と再接続のお知らせ、強化の無効を反映した装備
import type { PerspectiveCamera, Scene } from 'three';
import type { GameState } from '../core/game-state';
import type { AircraftDetail } from '../data/aircraft-model';
import type { CombatInput } from '../combat/combat-input';
import type { AircraftControls, GroundHeightFn } from '../entities/aircraft';
import type { FlightSession } from '../missions/flight-session';
import { ClientRoom } from '../net/client-room';
import { allAgain, initialSettings, mapName } from '../net/lobby-rules';
import { openLocalTransport } from '../net/local-transport';
import { openPeerTransport } from '../net/peerjs-transport';
import { HostRoom, JoinFailure, normalizeRoomCode } from '../net/room';
import type { PlayerProfile, RoomEndReason } from '../net/room';
import type { TransportOpener } from '../net/transport';
import type { Hangar } from '../progression/hangar';
import type { Loadout } from '../progression/loadout';
import type { PlayerView } from '../render/player-view';
import { RemoteView, playerShape } from '../render/remote-view';
import { findAircraftModel } from '../data/aircraft';
import { LobbyScreen } from './lobby';
import { JOIN_ERRORS, lobbyActions, rosterNotices, type RosterSnapshot } from './pvp-lobby-actions';
import { PvpBoard, onRadarTap } from './pvp-board';
import { PvpFlight, type KaijuSource, type PvpFlightDeps, type PvpSound } from './pvp-flight';
import { PvpHud } from './pvp-hud';
import { PvpOverlay } from './pvp-overlay';
import { RaidBriefing } from './raid-briefing';
import { pilotProfile, roomLoadout, rosterAircraftId } from './pvp-profile';
import { buildJoinUrl } from './pvp-entry';
import { QUICK_PHRASES } from '../data/pvp';

export interface PvpDeps {
  readonly parent: HTMLElement;
  readonly game: GameState;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly session: FlightSession;
  readonly playerView: PlayerView;
  readonly hangar: Hangar;
  readonly pilotName: () => string | null;
  readonly groundHeight: GroundHeightFn;
  /** 守れた建物の割合（%）と高層の建物の衝突（6-4） */
  readonly protectedBuildings: () => number | null;
  readonly obstacles: PvpFlightDeps['obstacles'];
  readonly aircraftDetail: AircraftDetail;
  /** ?netdebug */
  readonly debug: boolean;
  /** 通信口: PeerJS（本番）か、同じブラウザのタブどうし（?net=local。確認用） */
  readonly transport: 'peerjs' | 'local';
  /** スコアボードの Tab（ターゲット切替のキー）を押しているか（5-3） */
  readonly scoreKeyDown: () => boolean;
  /** 他プレイヤーの機銃の発射音（5-3。位置付き） */
  readonly otherGun: (x: number, y: number, z: number) => void;
  /** カウントダウン・GO・残り時間の警告の音（5-4） */
  readonly sound: (kind: PvpSound) => void;
  /** レイドの怪獣の表示元（6-2） */
  readonly kaijuSource: (src: KaijuSource | null) => void;
  /** 街の建物（6-6。協力レイドはホストだけが壊して配る） */
  readonly buildings: PvpFlightDeps['buildings'];
  /** 報酬をセーブに足す（6-6） */
  readonly addCredits: (credits: number) => void;
  /** 協力レイドのブリーフィングを前に見たか・見た印を付ける（6-6） */
  readonly briefingSeen: () => boolean;
  readonly markBriefingSeen: () => void;
}

/** 部屋の tick（ping・無通信の検知・再接続）の間隔（ms） */
const ROOM_TICK_MS = 250;

export class PvpLink {
  private readonly lobby: LobbyScreen;
  private readonly hud: PvpHud;
  private readonly overlay: PvpOverlay;
  private readonly remotes: RemoteView;
  private readonly open: TransportOpener;
  private readonly board: PvpBoard;
  private readonly briefing: RaidBriefing;
  private room: HostRoom | ClientRoom | null = null;
  private flight: PvpFlight | null = null;
  private timer = 0;
  /** 接続中に取り消したら、つながっても抜ける */
  private attempt = 0;
  /** 直前の名簿（切断・再接続・離脱のお知らせ） */
  private roster: RosterSnapshot = new Map();
  /** モード選択の「レイド」の「協力」から開いた（部屋を作るときレイドの設定にする。6-2） */
  private raidLobby = false;

  constructor(private readonly deps: PvpDeps) {
    this.open = deps.transport === 'local' ? openLocalTransport : openPeerTransport;
    this.lobby = new LobbyScreen(deps.parent, {
      onCreate: () => void this.create(),
      onJoin: (code) => void this.join(code),
      onLeave: () => {
        this.leave();
      },
      onBack: () => {
        this.leave();
        deps.game.transition('mode_select');
      },
      ...lobbyActions({
        room: () => this.room,
        hangar: deps.hangar,
        lobby: () => this.lobby,
        profile: (aircraftId) => this.profile(aircraftId),
      }),
    });
    this.hud = new PvpHud(
      deps.parent,
      {
        onContinue: () => {
          this.hud.setMenuOpen(false);
        },
        onLeave: () => {
          this.leave();
        },
        onChat: (phrase) => this.room?.chat(phrase),
      },
      deps.debug,
    );
    this.briefing = new RaidBriefing(deps.parent, () => this.flight?.net.skipBriefing());
    this.board = new PvpBoard(deps.parent);
    this.overlay = new PvpOverlay(deps.parent);
    this.remotes = new RemoteView(deps.scene, deps.aircraftDetail);
    // タッチ: レーダーをタップするとスコアボードを開閉する
    onRadarTap(() => {
      if (this.flight && deps.game.state === 'flight')
        this.flight.boardToggled = !this.flight.boardToggled;
    });
    deps.game.onChange(({ to }) => {
      this.lobby.setShown(to === 'lobby');
      if (to !== 'flight') this.hud.setMenuOpen(false);
    });
  }

  /** PvP の飛行中か（main の固定ステップがこちらを進める） */
  get flying(): boolean {
    return this.flight !== null;
  }

  /** ロビーを開く。code があればすぐ参加する（?room）。raid はレイドの協力（6-2）として部屋を作る */
  openLobby(code?: string, raid = false): void {
    this.raidLobby = raid;
    const game = this.deps.game;
    if (game.state !== 'mode_select') game.transition('mode_select');
    game.transition('lobby');
    if (code) {
      this.lobby.setCode(code);
      void this.join(code);
    } else if (!this.room) this.lobby.showMenu();
  }

  /** Esc（ロビー）: ダイアログを閉じる → 接続中・部屋の中なら抜けて最初の選択へ、最初の選択ならモード選択へ */
  back(): void {
    if (this.lobby.closeDialog()) return;
    if (this.lobby.currentView !== 'menu') this.leave();
    else this.deps.game.transition('mode_select');
  }

  /** Esc / ⏸（飛行中）: メニューを開閉する */
  toggleMenu(): void {
    this.hud.setMenuOpen(!this.hud.menuOpen);
  }

  /** 自分のプロフィール（パイロット名・機体・シングルの強化 Lv。強化の無効はホストが決める） */
  private profile(aircraftId = this.deps.hangar.selectedId): PlayerProfile {
    return pilotProfile(this.deps.hangar, this.deps.pilotName, aircraftId);
  }

  /** PvP の飛行の装備（ホストが強化を無効にしていれば Lv 0。5-4） */
  // 部屋のマップ（6-4。ロビーのホスト設定。レイドは港湾都市）
  get mapId(): string {
    return this.room?.settings.mapId ?? 'island';
  }

  loadout(): Loadout {
    return roomLoadout(this.room, this.deps.hangar);
  }

  private async create(): Promise<void> {
    const attempt = ++this.attempt;
    this.lobby.showConnecting('部屋を作っています…');
    try {
      const settings = initialSettings(this.raidLobby);
      const room = await HostRoom.create({ open: this.open, profile: this.profile(), settings });
      if (attempt !== this.attempt) {
        room.leave();
        return;
      }
      this.attach(room);
    } catch {
      if (attempt === this.attempt)
        this.lobby.showMenu('部屋を作れませんでした（ネットワークを確かめてください）');
    }
  }

  private async join(input: string): Promise<void> {
    const code = normalizeRoomCode(input);
    if (!code) {
      this.lobby.showMenu('部屋コードは 6 文字です（0・O・1・I は使いません）');
      return;
    }
    const attempt = ++this.attempt;
    this.lobby.showConnecting(`${code} に接続中…`);
    try {
      const room = await ClientRoom.join(code, { open: this.open, profile: this.profile() });
      if (attempt !== this.attempt) {
        room.leave();
        return;
      }
      this.attach(room);
    } catch (e) {
      if (attempt !== this.attempt) return;
      this.lobby.showMenu(JOIN_ERRORS[e instanceof JoinFailure ? e.reason : 'network']);
    }
  }

  private attach(room: HostRoom | ClientRoom): void {
    this.room = room;
    this.roster = new Map();
    room.onRoster(() => {
      this.refreshRoster();
    });
    room.onStart(() => {
      if (this.deps.game.state === 'lobby') this.deps.game.transition('flight');
    });
    room.onEnd((reason) => {
      this.finish(reason);
    });
    room.onChat((from, phrase) => {
      if (this.lobby.currentView === 'room') this.lobby.showChat(from, phrase);
      else if (this.deps.game.state === 'lobby' || this.deps.game.state === 'flight') {
        // リザルトの画面と、飛行中（6-6: レイドの定型文）は上のお知らせに出す
        const name = room.players.find((p) => p.id === from)?.name ?? '';
        this.hud.notify(`${name}: ${QUICK_PHRASES[phrase] ?? ''}`, 3);
      }
    });
    if (room instanceof ClientRoom) {
      room.onReconnect((reconnecting) => {
        if (reconnecting && this.deps.game.state === 'lobby')
          this.lobby.showConnecting('接続が途切れました。再接続しています…');
      });
    }
    this.timer = window.setInterval(() => {
      room.tick();
    }, ROOM_TICK_MS);
    this.refreshRoster();
  }

  /** 名簿が変わった: お知らせ、ロビーの描き直し（リザルトは全員が「もう一度」を押すまでそのまま） */
  private refreshRoster(): void {
    const room = this.room;
    if (!room) return;
    this.flight?.syncRoster();
    const notices = rosterNotices(this.roster, room.players, room.localPlayerId);
    this.roster = new Map(room.players.map((p) => [p.id, { name: p.name, away: p.away }]));
    if (notices.length > 0) this.hud.notify(notices.join(' / '));
    if (this.deps.game.state !== 'lobby') return;
    if (this.lobby.currentView === 'result') {
      this.lobby.updateAgain(room.players, room.localPlayerId);
      if (!allAgain(room.players)) return;
    }
    this.lobby.showRoom({
      code: room.code,
      joinUrl: buildJoinUrl(window.location.href, room.code),
      isHost: room.isHost,
      localId: room.localPlayerId,
      players: room.players,
      mapName: mapName(room.settings.mapId),
      settings: room.settings,
    });
  }

  /**
   * 飛行を始める（main が lobby → flight の遷移で、自機の装備を入れて世界を空にした後に呼ぶ）。
   * 自機を開始位置へ置き、見た目をプレイヤーの色にする
   */
  beginFlight(): void {
    const room = this.room;
    if (!room) return;
    const d = this.deps;
    this.flight = new PvpFlight(room, {
      ...d,
      remotes: this.remotes,
      hud: this.hud,
      board: this.board,
      overlay: this.overlay,
      briefing: this.briefing,
    });
    const model = findAircraftModel(rosterAircraftId(room, d.hangar)) ?? d.hangar.selectedModel;
    const missiles = this.loadout().missiles;
    d.playerView.setModel({ ...model, shape: playerShape(model, room.localPlayerId) }, missiles);
    d.playerView.respawn(d.session.aircraft);
  }

  /** 固定ステップ 1 回分。対戦が終わったらロビーのリザルトへ */
  step(controls: Readonly<AircraftControls>, combat: Readonly<CombatInput>, dt: number): void {
    const f = this.flight;
    if (!f) return;
    f.step(controls, combat, dt);
    if (!f.over) return;
    this.endFlight();
    const game = this.deps.game;
    if (game.state === 'flight') game.transition('lobby');
    const room = this.room;
    const result = f.result();
    // 6-6: レイドの報酬（全員同じ額）をセーブに足す
    if (result.raid) this.deps.addCredits(result.raid.credits);
    if (room) this.lobby.showResult(result, room.players);
  }

  /** 描画フレームごと（pipeline.render の前）。他機・名札・成績・?netdebug */
  render(alpha: number): void {
    if (this.deps.game.state !== 'flight') return;
    this.flight?.render(alpha, window.innerWidth, window.innerHeight);
  }

  private endFlight(): void {
    this.flight?.dispose();
    this.flight = null;
  }

  setAircraftDetail(detail: AircraftDetail): void {
    this.remotes.setDetail(detail);
  }

  /** 自分から抜ける（ロビーの退出・接続の取り消し・飛行中のメニューの「退出する」） */
  private leave(): void {
    this.attempt++;
    if (this.room) this.room.leave();
    else this.lobby.showMenu();
  }

  private finish(reason: RoomEndReason): void {
    window.clearInterval(this.timer);
    this.room = null;
    this.endFlight();
    const game = this.deps.game;
    if (reason !== 'left') {
      this.hud.notify(
        reason === 'host-left'
          ? 'ホストが切断しました'
          : '接続が切れました（再接続できませんでした）',
      );
      if (game.state === 'flight' || game.state === 'lobby') game.transition('mode_select');
      this.lobby.showMenu();
      return;
    }
    if (game.state === 'flight') game.transition('mode_select');
    this.lobby.showMenu();
  }
}

export function createPvpLink(deps: PvpDeps): PvpLink {
  return new PvpLink(deps);
}
