// 協力レイドの 1 回の飛行（6-2 の pvp-flight.ts のレイドの部分を 6-6 で分けた）: 怪獣の表示元（ホストは本体、
// クライアントは state の写し）、岩・ブレイクの event、役割分担の HUD（他プレイヤーのロックの印・攻撃の対象・
// ブレイクの貢献者）、開始前のブリーフィング、リザルト（全員の与ダメージ・ブレイク・復帰・MVP・報酬）
import type { KaijuBodyView, KaijuEffectsView, KaijuPartView } from '../entities/kaiju-display';
import type { FlightSession } from '../missions/flight-session';
import { HostGame } from '../net/host-game';
import { KaijuMirror } from '../net/kaiju-mirror';
import type { NetGame } from '../net/net-game';
import type { EventMsg, ScoreEntry } from '../net/protocol';
import type { PvpMirror } from '../net/pvp-mirror';
import { RAID_OUTCOME } from '../net/raid-host';
import { raidSummary, type RaidSummary } from '../net/raid-result';
import type { KaijuCoopFrame } from './kaiju-coop-hud';
import type { KaijuHudFrame } from './kaiju-hud';
import { playerColorCss } from './lobby-colors';
import type { RaidBriefing } from './raid-briefing';

/** レイドの怪獣の表示元（6-2） */
export interface KaijuSource {
  readonly body: KaijuBodyView;
  readonly fx: KaijuEffectsView;
  readonly hud: () => KaijuHudFrame;
}

export interface RaidFlightDeps {
  readonly session: FlightSession;
  /** 守れた建物の割合（%。街がなければ null。6-4） */
  readonly protectedBuildings: () => number | null;
  /** レイドの怪獣の表示元を差し替える（描画・HUD・音。null で戻す） */
  readonly kaijuSource: (src: KaijuSource | null) => void;
  /** 協力レイドのブリーフィングと、前に見たか・見た印 */
  readonly briefing: RaidBriefing;
  readonly briefingSeen: () => boolean;
  readonly markBriefingSeen: () => void;
}

export class RaidFlight {
  private kaijuMirror: KaijuMirror | null = null;
  private kaijuVersion = -1;
  private kaijuAt = 0;
  private outcome = 0;
  /** クリア時間（over の n。カウントダウンの後からの tick） */
  private ticks = 0;
  /** 直近のブレイクの貢献者の名前 */
  private breakBy = '';
  private readonly canSkip: boolean;
  private briefingDone = false;
  private readonly marks: string[][] = [[], [], [], [], []];
  private readonly coop = { marks: this.marks, ownPart: -1, targeted: false, breakBy: '' };

  constructor(
    private readonly net: NetGame,
    private readonly mirror: PvpMirror,
    private readonly playerIds: () => Iterable<number>,
    private readonly nameOf: (id: number) => string,
    private readonly deps: RaidFlightDeps,
  ) {
    this.canSkip = deps.briefingSeen();
    deps.briefing.reset();
    this.attachKaiju();
  }

  /** 怪獣の表示元を、ホストは本体、クライアントは写しにし、部位をロックの対象にする */
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
      coop: null as KaijuCoopFrame | null,
    };
    this.deps.kaijuSource({
      body,
      fx,
      hud: () => {
        const sel = s.combat.targeting.selected;
        const index = sel && 'kaijuIndex' in sel ? Number(sel.kaijuIndex) : -1;
        frame.body = body.visible ? body : null;
        frame.locked = body.parts[index] ?? null;
        frame.stun = this.mirror.ownStun;
        frame.coop = this.coopFrame(index);
        return frame;
      },
    });
  }

  /** 役割分担の HUD: 他プレイヤーのロックの印・自分が対象か・ブレイクの貢献者 */
  private coopFrame(ownPart: number): KaijuCoopFrame {
    for (const m of this.marks) m.length = 0;
    for (const id of this.playerIds()) {
      if (id === this.net.localId) continue;
      const part = this.net.lockPartOf(id);
      if (part >= 0) this.marks[part]?.push(playerColorCss(id));
    }
    this.coop.ownPart = ownPart;
    this.coop.targeted = this.net.kaijuTarget === this.net.localId;
    this.coop.breakBy = this.breakBy;
    return this.coop;
  }

  /** できごと: 終わり（結果とクリア時間）・岩・ブレイクの貢献者 */
  handleEvent(e: Readonly<EventMsg>): void {
    if (e.kind === 'over') {
      this.outcome = e.b;
      this.ticks = e.n;
    } else if (e.kind === 'rock') this.kaijuMirror?.handleRock(e);
    else if (e.kind === 'break') {
      const names: string[] = [];
      for (let id = 0; id < 8; id++) if (e.b & (1 << id)) names.push(this.nameOf(id));
      this.breakBy = names.join(' + ');
    }
  }

  /** 固定ステップ: クライアントの怪獣の写しを進める（新しい state が来たら写す） */
  step(dt: number): void {
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

  /** 描画フレーム: ブリーフィングの残りを出し、終わったら「見た」印を付ける（次から自分はスキップできる） */
  render(): void {
    const left = this.net.briefingRemaining;
    this.deps.briefing.update(left, this.canSkip);
    if (left <= 0 && !this.briefingDone) {
      this.briefingDone = true;
      this.deps.markBriefingSeen();
    }
  }

  get cleared(): boolean {
    return this.outcome === RAID_OUTCOME.clear;
  }

  /** リザルト（最後に届いた成績から。全員が同じ値になる） */
  summary(players: readonly ScoreEntry[], hard: boolean): RaidSummary {
    return raidSummary(players, {
      cleared: this.cleared,
      difficulty: hard ? 'hard' : 'normal',
      seconds: this.ticks / 60,
      protectedBuildings: this.deps.protectedBuildings(),
    });
  }

  dispose(): void {
    this.deps.kaijuSource(null);
    this.deps.briefing.hide();
  }
}
