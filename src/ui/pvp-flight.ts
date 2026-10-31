// PvP の 1 回の対戦（5-3。pvp-link.ts から分けた）: 通信のゲーム（ホスト / クライアント）と表示（PvpMirror）を
// 固定ステップ・描画フレームで進め、他機・名札・フィード・スコアボード・残り時間・?netdebug を出す。
// 5-4: カウントダウン・残り時間の警告（音つき）・撃墜の画面・無敵・再接続中（pvp-overlay.ts）、チーム戦の敵味方の色と
// チームの合計、リザルトのベストプレイヤー・最長連続撃墜。対戦の終わり（over）で over が立つ
import type { PerspectiveCamera } from 'three';
import { createCombatInput, type CombatInput } from '../combat/combat-input';
import { accuracy, bestPlayer, standings, teamTotals } from '../combat/pvp-rules';
import { PVP_CONFIG, PVP_TEAM } from '../data/pvp';
import { createControls, type AircraftControls, type GroundHeightFn } from '../entities/aircraft';
import type { KaijuBodyView, KaijuEffectsView, KaijuPartView } from '../entities/kaiju-display';
import { KaijuMirror } from '../net/kaiju-mirror';
import { RAID_OUTCOME } from '../net/raid-host';
import type { KaijuHudFrame } from './kaiju-hud';
import type { FlightSession } from '../missions/flight-session';
import { ClientGame } from '../net/client-game';
import { ClientRoom } from '../net/client-room';
import { HostGame } from '../net/host-game';
import type { NetGame } from '../net/net-game';
import type { PlayerInfo, ScoreMsg } from '../net/protocol';
import { PvpMirror } from '../net/pvp-mirror';
import { HostRoom } from '../net/room';
import type { PlayerView } from '../render/player-view';
import type { RemoteView } from '../render/remote-view';
import { playerColorCss } from './lobby-colors';
import type { PvpBoard } from './pvp-board';
import type { PvpHud } from './pvp-hud';
import type { PvpOverlay } from './pvp-overlay';
import type { ResultView } from './pvp-result';

export type PvpSound = 'countdown' | 'go' | 'alert';

export interface PvpFlightDeps {
  readonly session: FlightSession;
  readonly playerView: PlayerView;
  readonly camera: PerspectiveCamera;
  readonly groundHeight: GroundHeightFn;
  readonly remotes: RemoteView;
  readonly hud: PvpHud;
  readonly board: PvpBoard;
  readonly overlay: PvpOverlay;
  /** スコアボードの Tab（ターゲット切替のキー）を押しているか */
  readonly scoreKeyDown: () => boolean;
  /** 他プレイヤーの機銃の発射音（位置付き） */
  readonly otherGun: (x: number, y: number, z: number) => void;
  /** カウントダウン・GO・残り時間の警告の音（5-4） */
  readonly sound: (kind: PvpSound) => void;
  /** レイドの怪獣の表示元を差し替える（6-2。描画・HUD・音。null で戻す） */
  readonly kaijuSource: (src: KaijuSource | null) => void;
}

/** レイドの怪獣の表示元（6-2） */
export interface KaijuSource {
  readonly body: KaijuBodyView;
  readonly fx: KaijuEffectsView;
  readonly hud: () => KaijuHudFrame;
}

/** 「GO!」を出しておく秒数 */
const GO_SECONDS = 0.8;

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
  private readonly team: boolean;
  private localTeam: number | undefined;
  private readonly noInput = createCombatInput();
  private lastCount = 0;
  private goUntil = 0;
  private lastRemaining: number | null = null;
  private warning = '';
  private warningUntil = 0;
  /** レイド（6-2）: クライアントの怪獣の写しと、終わり方 */
  private readonly raid: boolean;
  private kaijuMirror: KaijuMirror | null = null;
  private kaijuVersion = -1;
  private kaijuAt = 0;
  private raidOutcome = 0;
  private readonly stunned = createControls();

  constructor(
    private readonly room: HostRoom | ClientRoom,
    private readonly deps: PvpFlightDeps,
  ) {
    const own = deps.session.aircraft;
    this.team = room.settings.mode === 'team';
    this.net =
      room instanceof HostRoom
        ? new HostGame(room, { own, groundHeight: deps.groundHeight })
        : new ClientGame(room, { own });
    this.mirror = new PvpMirror(deps.session, room.localPlayerId, deps.otherGun);
    this.raid = room.settings.mode === 'raid';
    if (this.raid) this.attachKaiju();
    this.syncRoster();
    this.net.onEvent((e) => {
      this.mirror.handleEvent(e);
      if (e.kind === 'over') {
        this.over = true;
        this.raidOutcome = e.b;
      }
    });
    this.net.onScore((s) => {
      this.score = s;
      this.scoreAt = performance.now();
    });
  }

  syncRoster(): void {
    // 抜けた人の名前はリザルトのために残す（名簿にいる人は新しい値で上書き）
    for (const p of this.room.players) this.players.set(p.id, p);
    this.localTeam = this.team ? this.players.get(this.net.localId)?.team : undefined;
    this.mirror.syncRoster(this.room.players, this.localTeam);
  }

  /**
   * レイド（6-2）: 怪獣の表示元を、ホストは本体、クライアントは写しにし、部位をロックの対象にする
   */
  private attachKaiju(): void {
    const host = this.net instanceof HostGame ? this.net.raid : null;
    const mirror = host ? null : new KaijuMirror();
    this.kaijuMirror = mirror;
    const body = host ? host.kaiju : mirror;
    const fx = host ? host.ai : mirror;
    if (!body || !fx) return;
    this.mirror.setKaijuTargets(body.parts);
    const s = this.deps.session;
    const frame = {
      body: body as KaijuBodyView | null,
      locked: null as KaijuPartView | null,
      stun: 0,
    };
    this.deps.kaijuSource({
      body,
      fx,
      hud: () => {
        const sel = s.combat.targeting.selected;
        frame.body = body.visible ? body : null;
        frame.locked =
          sel && 'kaijuIndex' in sel ? (body.parts[Number(sel.kaijuIndex)] ?? null) : null;
        frame.stun = this.mirror.ownStun;
        return frame;
      },
    });
  }

  /** 固定ステップ 1 回分。カウントダウン・再接続中・スタン中（6-2）は戦闘の操作を使わない */
  step(controls: Readonly<AircraftControls>, combat: Readonly<CombatInput>, dt: number): void {
    if (this.over) return;
    const stun = this.mirror.ownStun > 0;
    const blocked = this.net.inputBlocked || stun;
    const local = this.mirror.stepLocal(blocked ? this.noInput : combat, dt);
    this.net.step(stun ? this.stunned : controls, local, dt);
    this.mirror.stepWorld(this.net, dt);
    this.stepKaiju(dt);
    this.holdSeconds = this.deps.scoreKeyDown() ? this.holdSeconds + dt : 0;
  }

  /** クライアントの怪獣の写しを進める（新しい state が来たら写す） */
  private stepKaiju(dt: number): void {
    const m = this.kaijuMirror;
    if (!m) return;
    this.kaijuAt += dt;
    const k = this.net.kaiju;
    if (k && this.net.kaijuVersion !== this.kaijuVersion) {
      this.kaijuVersion = this.net.kaijuVersion;
      m.receive(k, this.kaijuAt);
      this.kaijuAt = 0;
    }
    m.step(dt);
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
    const allyOf = this.team ? (id: number) => this.players.get(id)?.team === this.localTeam : null;
    d.hud.updateTags(samples, this.players, d.camera, width, height, allyOf);
    const open = this.boardToggled || this.holdSeconds >= PVP_CONFIG.scoreboardHoldSeconds;
    // レイド（6-2）の残り時間は怪獣の HUD（最終フェーズ）に出す
    const remaining = this.raid ? null : this.remainingSeconds(now);
    d.board.update(
      this.mirror.activeFeed(),
      this.score,
      remaining,
      this.players,
      net.localId,
      open,
      this.teamScoreText(),
    );
    this.updateOverlay(now, remaining);
    d.hud.updateDebug(net.stats(now), net.localId, this.room.players.length, dt);
  }

  /** カウントダウン（3・2・1・GO と音）、残り時間の警告、撃墜の画面、無敵・初心者保護、再接続中 */
  private updateOverlay(now: number, remaining: number | null): void {
    const d = this.deps;
    const cd = this.net.countdownRemaining;
    if (cd > 0) {
      const n = Math.ceil(cd - 1e-6);
      if (n !== this.lastCount) {
        this.lastCount = n;
        d.sound('countdown');
      }
    } else if (this.lastCount > 0) {
      this.lastCount = 0;
      this.goUntil = now + GO_SECONDS * 1000;
      d.sound('go');
    }
    if (cd <= 0 && remaining !== null) {
      const prev = this.lastRemaining;
      for (const t of PVP_CONFIG.timeWarnings) {
        if (prev !== null && prev > t && remaining <= t && remaining > 0) {
          this.warning = `残り ${t} 秒`;
          this.warningUntil = now + PVP_CONFIG.timeWarningShowSeconds * 1000;
          d.sound('alert');
        }
      }
      this.lastRemaining = remaining;
    }
    const m = this.mirror;
    const downed =
      !d.session.player.active && m.downedBy !== undefined
        ? {
            killer: m.downedBy === null ? null : this.nameOf(m.downedBy),
            color: m.downedBy === null ? '' : playerColorCss(m.downedBy),
            remaining: m.downedAt + PVP_CONFIG.respawnSeconds - m.time,
          }
        : null;
    const room = this.room;
    d.overlay.update({
      countdown: cd,
      go: now < this.goUntil,
      warning: now < this.warningUntil ? this.warning : '',
      downed,
      invulnerable: m.ownInvulnerable,
      boosted: m.ownBoosted && d.session.player.active,
      reconnect: room instanceof ClientRoom && room.reconnecting ? room.reconnectRemaining : null,
    });
  }

  private nameOf(id: number): string {
    return this.players.get(id)?.name ?? `P${id + 1}`;
  }

  /** チーム戦の合計（「A 3 − 2 B」。個人戦は空） */
  private teamScoreText(): string {
    if (!this.team || !this.score) return '';
    const t = teamTotals(this.score.players, (id) => this.players.get(id)?.team);
    return `${PVP_TEAM.names[0]} ${t.get(0) ?? 0} − ${t.get(1) ?? 0} ${PVP_TEAM.names[1]}`;
  }

  private remainingSeconds(now: number): number | null {
    const s = this.score;
    if (!s) return null;
    if (s.over) return 0;
    // カウントダウン中は時計を止めて見せる（ホストの時計もまだ動いていない）
    if (this.net.countdownRemaining > 0) return s.remainingSeconds;
    return Math.max(0, s.remainingSeconds - (now - this.scoreAt) / 1000);
  }

  /** リザルトの表（最後に届いた成績から） */
  result(): ResultView {
    const players = this.score?.players ?? [];
    const teamOf = (id: number): number | undefined => this.players.get(id)?.team;
    const rows = standings(players).map((s) => ({
      rank: s.rank,
      id: s.score.id,
      name: this.nameOf(s.score.id),
      kills: s.score.kills,
      deaths: s.score.deaths,
      accuracy: accuracy(s.score),
      bestStreak: s.score.bestStreak,
      team: this.team ? (teamOf(s.score.id) ?? 0) : null,
    }));
    const reason = this.raid
      ? this.raidOutcome === RAID_OUTCOME.clear
        ? 'raidClear'
        : 'raidFail'
      : (this.score?.remainingSeconds ?? 0) > 0.05
        ? 'score'
        : 'time';
    const best = bestPlayer(players);
    const totals = this.team ? teamTotals(players, teamOf) : null;
    return {
      reason,
      localId: this.net.localId,
      rows,
      best: best ? { id: best.id, name: this.nameOf(best.id), kills: best.kills } : null,
      teamTotals: totals ? [totals.get(0) ?? 0, totals.get(1) ?? 0] : null,
    };
  }

  /** 終わり: シングルプレイの判定・表示に PvP のものを残さない */
  dispose(): void {
    if (this.raid) this.deps.kaijuSource(null);
    this.mirror.detach();
    this.deps.remotes.clear();
    this.deps.playerView.model.setOpacity(1);
    this.deps.hud.hide();
    this.deps.board.hide();
    this.deps.overlay.hide();
  }
}
