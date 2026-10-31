// PvP の 1 回の対戦（5-3。pvp-link.ts から分けた）: 通信のゲーム（ホスト / クライアント）と表示（PvpMirror）を
// 固定ステップ・描画フレームで進め、他機・名札・フィード・スコアボード・残り時間・?netdebug を出す。
// 対戦の終わり（over）は onOver で知らせる
import type { PerspectiveCamera } from 'three';
import type { CombatInput } from '../combat/combat-input';
import { accuracy, standings } from '../combat/pvp-rules';
import { PVP_CONFIG } from '../data/pvp';
import type { AircraftControls, GroundHeightFn } from '../entities/aircraft';
import type { FlightSession } from '../missions/flight-session';
import { ClientGame } from '../net/client-game';
import type { ClientRoom } from '../net/client-room';
import { HostGame } from '../net/host-game';
import type { NetGame } from '../net/net-game';
import type { PlayerInfo, ScoreMsg } from '../net/protocol';
import { PvpMirror } from '../net/pvp-mirror';
import { HostRoom } from '../net/room';
import type { PlayerView } from '../render/player-view';
import type { RemoteView } from '../render/remote-view';
import type { PvpBoard } from './pvp-board';
import type { PvpHud } from './pvp-hud';
import type { ResultView } from './pvp-result';

export interface PvpFlightDeps {
  readonly session: FlightSession;
  readonly playerView: PlayerView;
  readonly camera: PerspectiveCamera;
  readonly groundHeight: GroundHeightFn;
  readonly remotes: RemoteView;
  readonly hud: PvpHud;
  readonly board: PvpBoard;
  /** スコアボードの Tab（ターゲット切替のキー）を押しているか */
  readonly scoreKeyDown: () => boolean;
  /** 他プレイヤーの機銃の発射音（位置付き） */
  readonly otherGun: (x: number, y: number, z: number) => void;
}

export class PvpFlight {
  readonly net: NetGame;
  readonly mirror: PvpMirror;
  /** 対戦が終わった（次の固定ステップの後に onOver） */
  over = false;
  private score: ScoreMsg | null = null;
  private scoreAt = 0;
  private holdSeconds = 0;
  /** タッチ: レーダーのタップで開閉 */
  boardToggled = false;
  private lastFrameMs: number | null = null;
  private readonly players = new Map<number, PlayerInfo>();

  constructor(
    private readonly room: HostRoom | ClientRoom,
    private readonly deps: PvpFlightDeps,
  ) {
    const own = deps.session.aircraft;
    this.net =
      room instanceof HostRoom
        ? new HostGame(room, { own, groundHeight: deps.groundHeight })
        : new ClientGame(room, { own });
    this.mirror = new PvpMirror(deps.session, room.localPlayerId, deps.otherGun);
    this.syncRoster();
    this.net.onEvent((e) => {
      this.mirror.handleEvent(e);
      if (e.kind === 'over') this.over = true;
    });
    this.net.onScore((s) => {
      this.score = s;
      this.scoreAt = performance.now();
    });
  }

  syncRoster(): void {
    this.players.clear();
    for (const p of this.room.players) this.players.set(p.id, p);
    this.mirror.syncRoster(this.room.players);
  }

  /** 固定ステップ 1 回分 */
  step(controls: Readonly<AircraftControls>, combat: Readonly<CombatInput>, dt: number): void {
    if (this.over) return;
    const local = this.mirror.stepLocal(combat, dt);
    this.net.step(controls, local, dt);
    this.mirror.stepWorld(this.net, dt);
    this.holdSeconds = this.deps.scoreKeyDown() ? this.holdSeconds + dt : 0;
  }

  /** 描画フレームごと（pipeline.render の前） */
  render(alpha: number, width: number, height: number): void {
    const now = performance.now();
    const dt = this.lastFrameMs === null ? 0 : (now - this.lastFrameMs) / 1000;
    this.lastFrameMs = now;
    const d = this.deps;
    const net = this.net;
    const samples = net.samples(alpha, now);
    this.mirror.updateRivals(samples);
    const pools = this.mirror.rivalGuns();
    d.remotes.update(samples, dt, pools, alpha, d.camera.position);
    d.playerView.model.setOpacity(
      this.mirror.ownInvulnerable > 0 ? PVP_CONFIG.invulnerableOpacity : 1,
    );
    d.hud.updateTags(samples, this.players, d.camera, width, height);
    const open = this.boardToggled || this.holdSeconds >= PVP_CONFIG.scoreboardHoldSeconds;
    d.board.update(
      this.mirror.activeFeed(),
      this.score,
      this.remainingSeconds(now),
      this.players,
      net.localId,
      open,
    );
    d.hud.updateDebug(net.stats(now), net.localId, this.room.players.length, dt);
  }

  private remainingSeconds(now: number): number | null {
    const s = this.score;
    if (!s) return null;
    return s.over ? 0 : Math.max(0, s.remainingSeconds - (now - this.scoreAt) / 1000);
  }

  /** リザルトの表（最後に届いた成績から） */
  result(): ResultView {
    const players = this.score?.players ?? [];
    const rows = standings(players).map((s) => ({
      rank: s.rank,
      id: s.score.id,
      name: this.players.get(s.score.id)?.name ?? `P${s.score.id + 1}`,
      kills: s.score.kills,
      deaths: s.score.deaths,
      accuracy: accuracy(s.score),
    }));
    const reason = (this.score?.remainingSeconds ?? 0) > 0.05 ? 'score' : 'time';
    return { reason, localId: this.net.localId, rows };
  }

  /** 終わり: シングルプレイの判定・表示に PvP のものを残さない */
  dispose(): void {
    this.mirror.detach();
    this.deps.remotes.clear();
    this.deps.playerView.model.setOpacity(1);
    this.deps.hud.hide();
    this.deps.board.hide();
  }
}
