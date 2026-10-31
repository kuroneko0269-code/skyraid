// 協力の防衛戦（7-2）の飛行の部分（pvp-flight.ts から呼ぶ）: 表示の写し（DefenseMirror）を固定ステップで進め、HUD（ソロと同じ）・
// 音・大きな文字につなぎ、索敵の対象に敵を入れる。準備のスキップは全員がそろうとホストが次の波へ。リザルトの要約と報酬。
import type { Object3D, PerspectiveCamera } from 'three';
import { FACILITY_KINDS, type DefenseSoundKind } from '../data/defense';
import { defenseSummary, type DefenseSummary } from '../net/defense-result';
import type { FlightSession } from '../missions/flight-session';
import { DEFENSE_OUTCOME, DEFENSE_PHASES } from '../net/defense-host';
import { DefenseMirror } from '../net/defense-mirror';
import type { NetGame } from '../net/net-game';
import type { EventMsg, ScoreEntry } from '../net/protocol';
import type { PvpMirror } from '../net/pvp-mirror';
import { DefenseHudLink } from '../render/defense-hud-link';
import type { DefenseHud, DefenseHudState } from './defense-hud';
import { forecastText } from '../missions/defense/waves';
import { bindDefenseFeedback } from './defense-link';

export interface DefenseFlightDeps {
  readonly session: FlightSession;
  readonly defenseHud: DefenseHud;
  readonly playDefense: (kind: DefenseSoundKind) => void;
  readonly camera: PerspectiveCamera;
  readonly aircraftObject: Object3D;
}

export class DefenseFlight {
  readonly mirror: DefenseMirror;
  private readonly hudLink: DefenseHudLink;
  private version = -1;
  /** 終わりの event（結果: a = 施設のビット、b = 結果、xyz = クリアした波・司令部の HP・最大 HP） */
  private over: EventMsg | null = null;
  private readonly hud: { -readonly [K in keyof DefenseHudState]: DefenseHudState[K] } = {
    phase: 'intermission',
    wave: 1,
    remaining: 0,
    intermissionLeft: 0,
    hqHp: 0,
    hqMaxHp: 1,
    aliveBits: 0,
    forecast: null,
    supplied: false,
    skipped: false,
  };

  constructor(
    private readonly net: NetGame,
    pvp: PvpMirror,
    private readonly settings: { readonly mapId: string; readonly hard: boolean },
    private readonly deps: DefenseFlightDeps,
  ) {
    this.mirror = new DefenseMirror(deps.session, settings, net.localId);
    pvp.setDefenseTargets(this.mirror.targets);
    bindDefenseFeedback(
      this.mirror,
      deps.defenseHud,
      { playDefense: deps.playDefense },
      (id) => id === net.localId,
    );
    deps.defenseHud.onSkip = () => {
      this.skip();
    };
    this.hudLink = new DefenseHudLink(
      deps.defenseHud,
      deps.camera,
      deps.aircraftObject,
      deps.session.props.cruiseMissiles,
    );
  }

  handleEvent(e: Readonly<EventMsg>): void {
    this.mirror.handleEvent(e);
    if (e.kind === 'over') this.over = { ...e };
  }

  step(dt: number): void {
    const net = this.net;
    const s = net.defenseState;
    if (s && net.defenseVersion !== this.version) {
      this.version = net.defenseVersion;
      this.mirror.onState(s, net.defenseTick);
    }
    this.mirror.step(dt, net.viewTick);
  }

  render(width: number, height: number, flying: boolean): void {
    const hud = this.deps.defenseHud;
    hud.setShown(flying && this.mirror.state !== null);
    if (!flying) return;
    hud.update(this.hudState());
    this.hudLink.update(width, height);
  }

  /** HUD に出す値（最新の state から） */
  private hudState(): DefenseHudState {
    const s = this.mirror.state;
    const h = this.hud;
    if (!s) return h;
    const id = this.net.localId;
    h.phase = DEFENSE_PHASES[s.phase] ?? 'intermission';
    h.wave = s.wave;
    h.remaining = s.remaining;
    h.intermissionLeft = s.intermission;
    h.hqHp = s.hqHp;
    h.hqMaxHp = s.hqMaxHp;
    h.aliveBits = s.aliveBits;
    const radar = (s.aliveBits & (1 << FACILITY_KINDS.indexOf('radar'))) !== 0;
    const dir = this.mirror.map.approaches[s.approach]?.label ?? '';
    const counts = { fighter: s.fighters, bomber: s.bombers, cruise: s.cruise };
    h.forecast = radar ? forecastText(dir, counts) : null;
    h.supplied = (s.supplyMask & (1 << id)) !== 0;
    h.skipped = (s.skipMask & (1 << id)) !== 0;
    return h;
  }

  /** 準備のスキップ（全員がそろうとホストが次の波へ） */
  skip(): void {
    this.net.skipBriefing();
  }

  get cleared(): boolean {
    return this.over?.b === DEFENSE_OUTCOME.cleared;
  }

  /** リザルト（終わりの event の結果と、全員の成績から。全員で一致する） */
  summary(players: readonly ScoreEntry[]): DefenseSummary {
    return defenseSummary(this.over, players, this.settings);
  }

  dispose(): void {
    this.deps.defenseHud.setShown(false);
    this.mirror.dispose();
  }
}
