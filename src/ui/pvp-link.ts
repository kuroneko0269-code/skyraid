// PvP（5-1）の配線。main.ts が PvP を選んだとき・?room のときだけ import() で読む（シングルプレイでは読み込まない）。
// ロビー（部屋を作る / コードで参加 → 名簿 → 開始）→ 飛行（自機は FlightSession の機体、他機は RemoteView）→
// 終了（自分で退出・ホストの切断）。飛行中の Esc / ⏸ はゲームを止めずにメニューを出す。
// 5-3: 撃ち合い（1 回の対戦は pvp-flight.ts）、ロビーのルール設定、対戦の終わり → ロビーのリザルト →「もう一度」
import type { PerspectiveCamera, Scene } from 'three';
import type { GameState } from '../core/game-state';
import type { AircraftDetail } from '../data/aircraft-model';
import { SAVE_CONFIG } from '../data/save';
import type { CombatInput } from '../combat/combat-input';
import type { AircraftControls, GroundHeightFn } from '../entities/aircraft';
import type { FlightSession } from '../missions/flight-session';
import { ClientRoom } from '../net/client-room';
import { openLocalTransport } from '../net/local-transport';
import { openPeerTransport } from '../net/peerjs-transport';
import { HostRoom, JoinFailure, normalizeRoomCode, type JoinError } from '../net/room';
import type { RoomEndReason } from '../net/room';
import type { TransportOpener } from '../net/transport';
import type { Hangar } from '../progression/hangar';
import type { PlayerView } from '../render/player-view';
import { RemoteView, playerShape } from '../render/remote-view';
import { LobbyScreen } from './lobby';
import { PvpBoard, onRadarTap } from './pvp-board';
import { PvpFlight } from './pvp-flight';
import { PvpHud } from './pvp-hud';

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
  readonly aircraftDetail: AircraftDetail;
  /** ?netdebug */
  readonly debug: boolean;
  /** 通信口: PeerJS（本番）か、同じブラウザのタブどうし（?net=local。確認用） */
  readonly transport: 'peerjs' | 'local';
  /** スコアボードの Tab（ターゲット切替のキー）を押しているか（5-3） */
  readonly scoreKeyDown: () => boolean;
  /** 他プレイヤーの機銃の発射音（5-3。位置付き） */
  readonly otherGun: (x: number, y: number, z: number) => void;
}

const JOIN_ERRORS: Record<JoinError, string> = {
  'not-found': 'その部屋は見つかりません（コードを確かめてください）',
  full: '満員です（最大 4 人）',
  started: 'すでに始まっています',
  version: 'ホストとバージョンが違います（両方とも再読み込みしてください）',
  timeout: '応答がありません（時間切れ）',
  network: '接続できませんでした',
  unsupported: 'このブラウザは P2P 通信（WebRTC）に対応していません',
};

/** 部屋の tick（ping・無通信の検知）の間隔（ms） */
const ROOM_TICK_MS = 250;

export class PvpLink {
  private readonly lobby: LobbyScreen;
  private readonly hud: PvpHud;
  private readonly remotes: RemoteView;
  private readonly open: TransportOpener;
  private readonly board: PvpBoard;
  private room: HostRoom | ClientRoom | null = null;
  private flight: PvpFlight | null = null;
  private timer = 0;
  /** 接続中に取り消したら、つながっても抜ける */
  private attempt = 0;

  constructor(private readonly deps: PvpDeps) {
    this.open = deps.transport === 'local' ? openLocalTransport : openPeerTransport;
    this.lobby = new LobbyScreen(deps.parent, {
      onCreate: () => void this.create(),
      onJoin: (code) => void this.join(code),
      onStart: () => {
        if (this.room instanceof HostRoom) this.room.start();
      },
      onLeave: () => {
        this.leave();
      },
      onBack: () => {
        this.leave();
        deps.game.transition('mode_select');
      },
      onSettings: (scoreLimit, timeLimitSeconds) => {
        const room = this.room;
        if (room instanceof HostRoom)
          room.setSettings({ ...room.settings, scoreLimit, timeLimitSeconds });
      },
      onAgain: () => {
        this.refreshRoster(true);
      },
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
      },
      deps.debug,
    );
    this.board = new PvpBoard(deps.parent);
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

  /** ロビーを開く。code があればすぐ参加する（?room） */
  openLobby(code?: string): void {
    const game = this.deps.game;
    if (game.state !== 'mode_select') game.transition('mode_select');
    game.transition('lobby');
    if (code) {
      this.lobby.setCode(code);
      void this.join(code);
    } else if (!this.room) this.lobby.showMenu();
  }

  /** Esc（ロビー）: 接続中・部屋の中なら抜けて最初の選択へ、最初の選択ならモード選択へ */
  back(): void {
    if (this.lobby.currentView !== 'menu') this.leave();
    else this.deps.game.transition('mode_select');
  }

  /** Esc / ⏸（飛行中）: メニューを開閉する */
  toggleMenu(): void {
    this.hud.setMenuOpen(!this.hud.menuOpen);
  }

  private profile() {
    const h = this.deps.hangar;
    return {
      name: this.deps.pilotName() ?? SAVE_CONFIG.defaultPilotName,
      aircraftId: h.selectedId,
      upgrades: { ...h.levels(h.selectedId) },
    };
  }

  private async create(): Promise<void> {
    const attempt = ++this.attempt;
    this.lobby.showConnecting('部屋を作っています…');
    try {
      const room = await HostRoom.create({ open: this.open, profile: this.profile() });
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
    room.onRoster(() => {
      this.refreshRoster();
    });
    room.onStart(() => {
      if (this.deps.game.state === 'lobby') this.deps.game.transition('flight');
    });
    room.onEnd((reason) => {
      this.finish(reason);
    });
    this.timer = window.setInterval(() => {
      room.tick();
    }, ROOM_TICK_MS);
    this.refreshRoster();
  }

  /** 名簿が変わった。ロビーなら出し直す（リザルトの表示中はそのまま。force は「もう一度」） */
  private refreshRoster(force = false): void {
    const room = this.room;
    if (!room) return;
    this.flight?.syncRoster();
    if (this.deps.game.state === 'lobby' && (force || this.lobby.currentView !== 'result'))
      this.lobby.showRoom({
        code: room.code,
        isHost: room.isHost,
        localId: room.localPlayerId,
        players: room.players,
        mapName: room.settings.mapId === 'island' ? '海岸と島' : room.settings.mapId,
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
      session: d.session,
      playerView: d.playerView,
      camera: d.camera,
      groundHeight: d.groundHeight,
      remotes: this.remotes,
      hud: this.hud,
      board: this.board,
      scoreKeyDown: d.scoreKeyDown,
      otherGun: d.otherGun,
    });
    const model = d.hangar.selectedModel;
    const missiles = d.hangar.loadout().missiles;
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
    this.lobby.showResult(f.result());
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
    if (reason === 'host-left') {
      this.hud.notify('ホストが切断しました');
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
