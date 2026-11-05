// 協力レイドの 1 回の飛行（6-2 の pvp-flight.ts のレイドの部分を 6-6 で分けた）: 怪獣の表示元（ホストは本体、
// クライアントは state の写し）、岩・ブレイクの event、役割分担の HUD（他プレイヤーのロックの印・攻撃の対象・
// ブレイクの貢献者）、開始前のブリーフィング、リザルト（全員の与ダメージ・ブレイク・復帰・MVP・報酬）。
// 9-6c: ネフィルガ（設定の raidKaiju）: ホストは Kaiju2Host の本体、クライアントは state の写し（Kaiju2Mirror）を
// 遅延チャンクの表示（kaiju2Source）に渡し、部位をロックの対象にする
import type { KaijuBodyView, KaijuEffectsView, KaijuPartView } from '../entities/kaiju-display';
import type { FlightSession } from '../missions/flight-session';
import { HostGame } from '../net/host-game';
import { KaijuMirror } from '../net/kaiju-mirror';
import type { NetGame } from '../net/net-game';
import type { EventMsg, ScoreEntry } from '../net/protocol';
import type { PvpMirror } from '../net/pvp-mirror';
import { RAID_OUTCOME } from '../net/raid-host';
import { KAIJU2_OUTCOME } from '../net/kaiju2-host';
import { Kaiju2Mirror } from '../net/kaiju2-mirror';
import { RAID_RULES } from '../data/raid';
import { KAIJU2_TARGETS } from '../data/kaiju2-raid';
import { k2list, k2t } from '../data/kaiju2-text';
import { NEPHIRGA_ID, raidKaijuOf, type RaidKaijuId } from '../data/raid-kaiju';
import type { Kaiju2Raid } from '../missions/kaiju2-raid';
import type { Kaiju2CoopFrame } from './kaiju2-hud';
import { raidSummary, type RaidSummary } from '../net/raid-result';
import type { KaijuCoopFrame } from './kaiju-coop-hud';
import type { KaijuHudFrame } from './kaiju-hud';
import { playerColorCss } from './lobby-colors';
import type { RaidBriefing } from './raid-briefing';

/** 9-6c: ネフィルガの表示元（遅延チャンクの kaiju2-runtime.ts が描画・HUD・音に出す） */
export interface Kaiju2Source {
  readonly raid: Kaiju2Raid;
  readonly frame: () => Kaiju2CoopFrame;
  /** 自機のスタン（煽られて操作できない）の残り秒数（画面のノイズ） */
  readonly stun: () => number;
}

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
  /** 高難度（ブリーフィングの文を難易度で変える。8-6c） */
  readonly hard: boolean;
  /** 9-6c: レイドの怪獣（設定の raidKaiju の番号）と、ネフィルガの表示元を差し替える（null で戻す） */
  readonly raidKaiju: number;
  readonly kaiju2Source: (src: Kaiju2Source | null) => void;
  /** 9-6c: ネフィルガが避ける高さ（写しの止まり木の見た目） */
  readonly kaijuGround: (x: number, z: number) => number;
}

export class RaidFlight {
  private kaijuMirror: KaijuMirror | null = null;
  /** 9-6c: ネフィルガの写し（クライアント） */
  private kaiju2Mirror: Kaiju2Mirror | null = null;
  readonly kaiju: RaidKaijuId;
  private readonly marks2: string[][] = KAIJU2_TARGETS.map(() => []);
  private readonly coop2 = {
    marks: this.marks2 as readonly (readonly string[])[],
    targeted: false,
  };
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
    this.kaiju = raidKaijuOf(deps.raidKaiju);
    if (this.kaiju === NEPHIRGA_ID) {
      deps.briefing.reset(deps.hard, { title: k2t('briefingTitle'), lines: k2list('briefing') });
      this.attachKaiju2();
    } else {
      deps.briefing.reset(deps.hard);
      this.attachKaiju();
    }
  }

  /** 9-6c: ネフィルガ: ホストは本体、クライアントは写しを表示元にし、部位をロックの対象にする */
  private attachKaiju2(): void {
    const host = this.net instanceof HostGame ? this.net.raid2 : null;
    const mirror = host ? null : new Kaiju2Mirror(this.deps.kaijuGround);
    this.kaiju2Mirror = mirror;
    const raid = host?.raid ?? mirror?.raid;
    if (!raid) return;
    this.mirror.setKaijuTargets(raid.targets);
    this.deps.kaiju2Source({
      raid,
      frame: () => {
        for (const m of this.marks2) m.length = 0;
        for (const id of this.playerIds()) {
          if (id === this.net.localId) continue;
          const part = this.net.lockPartOf(id);
          if (part >= 0) this.marks2[part]?.push(playerColorCss(id));
        }
        this.coop2.targeted = this.net.kaijuTarget === this.net.localId;
        return this.coop2;
      },
      stun: () => this.mirror.ownStun,
    });
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
    const m2 = this.kaiju2Mirror;
    if (m2) {
      const k2 = this.net.kaiju2;
      if (k2 && this.net.kaijuVersion !== this.kaijuVersion) {
        this.kaijuVersion = this.net.kaijuVersion;
        m2.receive(k2);
      }
      m2.step(dt);
      return;
    }
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

  /** 9-6c: 失敗の理由（ネフィルガの嵐 / 全体の時間切れ・9-6d: 全員の残機切れ。それ以外・成功は null） */
  get failReason(): 'storm' | 'total' | 'lives' | null {
    if (this.outcome === RAID_OUTCOME.livesOut) return 'lives';
    if (this.outcome === KAIJU2_OUTCOME.stormFail) return 'storm';
    if (this.outcome === KAIJU2_OUTCOME.totalFail) return 'total';
    return null;
  }

  /** リザルト（最後に届いた成績から。全員が同じ値になる） */
  summary(players: readonly ScoreEntry[], hard: boolean): RaidSummary {
    return raidSummary(players, {
      cleared: this.cleared,
      difficulty: hard ? 'hard' : 'normal',
      seconds: this.ticks / 60,
      // 9-6c: ネフィルガは建物を壊さない
      protectedBuildings: this.kaiju === NEPHIRGA_ID ? null : this.deps.protectedBuildings(),
      kaiju: this.kaiju,
    });
  }

  dispose(): void {
    if (this.kaiju === NEPHIRGA_ID) this.deps.kaiju2Source(null);
    this.deps.kaijuSource(null);
    this.deps.briefing.hide();
  }
}

/** 9-6d: 協力レイドの自分の残機（今の機体を含む。成績の撃墜数から） */
export function coopLivesLeft(
  players: readonly { readonly id: number; readonly deaths: number }[] | undefined,
  localId: number,
  hard: boolean,
): number {
  const me = players?.find((p) => p.id === localId);
  return Math.max(0, RAID_RULES.lives[hard ? 'hard' : 'normal'] - (me?.deaths ?? 0));
}
