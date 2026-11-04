// 撃墜までの秒数（9-3。`--assist` の表）: 選んだ対象が KILL_RANGE m 内に入ったステップを覚え、撃墜が増えたステップで
// 落ちていた対象の秒数を数える。ControlAnalyzer（metrics.ts）の集計に足す形（TimedAnalyzer）
import type { CombatTarget } from '../../src/combat/target';
import type { FlightSession } from '../../src/missions/flight-session';
import type { GamePlay } from '../../src/missions/game-play';
import { ControlAnalyzer, type AnalyzerOptions } from './metrics';
import type { Totals } from './totals';

/** 数え始め（選んだ対象との距離 m） */
const KILL_RANGE = 2000;

export class KillTimer {
  private readonly engagedAt = new Map<CombatTarget, number>();
  private killsSeen: number;
  private steps = 0;

  constructor(
    private readonly session: FlightSession,
    private readonly out: number[],
  ) {
    this.killsSeen = session.combat.kills;
  }

  /** 判定を 1 ステップ進めた後 */
  step(): void {
    const step = ++this.steps;
    const s = this.session;
    const sel = s.combat.targeting.selected;
    if (sel?.active && !this.engagedAt.has(sel)) {
      const p = s.aircraft.state.position;
      const q = sel.position;
      if (Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) <= KILL_RANGE) this.engagedAt.set(sel, step);
    }
    if (s.combat.kills <= this.killsSeen) return;
    this.killsSeen = s.combat.kills;
    for (const [target, at] of this.engagedAt) {
      if (target.active) continue;
      this.out.push((step - at) / 60);
      this.engagedAt.delete(target);
    }
  }
}

/** ControlAnalyzer に撃墜までの秒数（Totals.killSeconds）を足したもの */
export class TimedAnalyzer extends ControlAnalyzer {
  private readonly seconds: number[] = [];
  private readonly timer: KillTimer;

  constructor(play: GamePlay, options: AnalyzerOptions) {
    super(play, options);
    this.timer = new KillTimer(play.session, this.seconds);
  }

  override after(): void {
    super.after();
    this.timer.step();
  }

  override finish(): Totals {
    const t = super.finish();
    t.killSeconds.push(...this.seconds);
    return t;
  }
}
