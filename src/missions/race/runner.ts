// リングレース（7-1）の進行（Three.js 非依存）: カウントダウン → 走行 → ゴール（または時間切れ）。
// リングは「次のリング〜次の飛ばせないリング（チェックポイント・ゴール）」の窓で判定し、窓の先のリングを通ったら
// 飛ばしたリングは未通過（+5 秒。戻らなくて良い）。チェックポイントは飛ばせないので、通るまで先のリングは数えない。
// 自機を止める・ブーストを効かせる・墜落後に戻すのは GamePlay（イベントと respawnPose を使う）
import { EventBus } from '../../core/event-bus';
import { RACE_CONFIG } from '../../data/race';
import type { Rank } from '../../data/ranking';
import type { Quat, Vec3 } from '../../flight/math';
import { crossesRing } from '../objectives/ring';
import type { Pose } from '../types';
import { anglesOf, buildRaceRings, type RaceRing } from './course';
import { GhostRecorder } from './ghost';
import { raceRank, raceTime } from './score';
import type { CourseDef } from './types';

export type RacePhase = 'countdown' | 'racing' | 'finished';
export type RingStatus = 'pending' | 'passed' | 'missed';
export type RaceOutcome = 'finished' | 'timeout';

/** レースが読む世界（実体は FlightSession） */
export interface RaceWorld {
  readonly playerPosition: Readonly<Vec3>;
  readonly playerPrevPosition: Readonly<Vec3>;
  readonly playerOrientation: Readonly<Quat>;
  readonly playerActive: boolean;
}

export interface RaceResult {
  readonly courseId: string;
  readonly outcome: RaceOutcome;
  /** 走行の時計（ペナルティ・ボーナスなし） */
  readonly rawSeconds: number;
  /** タイム（時計 + ペナルティ − ボーナス）。時間切れは時計のまま */
  readonly time: number;
  readonly missed: number;
  readonly thinPassed: number;
  readonly penaltySeconds: number;
  readonly bonusSeconds: number;
  /** 完走したときだけ */
  readonly rank: Rank | null;
  /** 各リングを通った（未通過は飛ばしたと分かった）ときのタイム。ゴーストとの差に使う */
  readonly ringTimes: readonly number[];
}

/** 比べる走行（ベストのゴーストの ringTimes）。なければ差は出さない */
export interface RaceReference {
  readonly ringTimes: readonly number[];
}

export interface RaceEvents extends Record<string, unknown> {
  /** カウントダウンの 3・2・1 */
  'race:countdown': { count: number };
  'race:start': Record<string, never>;
  'race:ring': { ring: RaceRing; time: number };
  /** 飛ばしたリング（まとめて） */
  'race:miss': { rings: readonly RaceRing[] };
  /** チェックポイント（ゴールも）のスプリット。delta は比べる走行との差（なければ null） */
  'race:split': { ring: RaceRing; time: number; delta: number | null };
  'race:finish': { result: RaceResult };
}

export class RaceRunner {
  readonly bus = new EventBus<RaceEvents>();
  readonly rings: readonly RaceRing[];
  readonly status: RingStatus[];
  readonly recorder = new GhostRecorder();
  phase: RacePhase = 'countdown';
  countdownLeft: number = RACE_CONFIG.countdownSeconds;
  /** 走行の時計（GO から） */
  elapsed = 0;
  /** 次に通るリングの番号（全部終われば rings.length） */
  next = 0;
  missed = 0;
  thinPassed = 0;
  result: RaceResult | null = null;
  /** 最後に分かったゴーストとの差（秒。比べる走行がなければ null） */
  ghostDelta: number | null = null;
  /** 描画（render/ring-view.ts の RingTrack）に渡す形: 次のリングの番号と、そのリング */
  readonly track = ((race: RaceRunner) => ({
    get rings(): readonly RaceRing[] {
      return race.rings;
    },
    get current(): number {
      return race.next;
    },
    get next(): RaceRing | null {
      return race.nextRing;
    },
  }))(this);
  private readonly ringTimes: number[] = [];
  private finishTimer = 0;
  /** 最後に知らせたカウント（3・2・1） */
  private lastCount = -1;

  constructor(
    readonly course: CourseDef,
    readonly reference: RaceReference | null = null,
  ) {
    this.rings = buildRaceRings(course);
    this.status = this.rings.map(() => 'pending');
  }

  /** 今のタイム（時計 + ペナルティ − ボーナス。丸めない） */
  get currentTime(): number {
    const c = RACE_CONFIG;
    return this.elapsed + this.missed * c.missPenaltySeconds - this.thinPassed * c.thinBonusSeconds;
  }

  get nextRing(): RaceRing | null {
    return this.phase === 'finished' ? null : (this.rings[this.next] ?? null);
  }

  /** 窓の終わり（次の飛ばせないリング）の番号 */
  get windowEnd(): number {
    for (let i = this.next; i < this.rings.length; i++) if (this.rings[i]?.required) return i;
    return this.rings.length - 1;
  }

  /** ゴールの後、大きな文字を出し終えた */
  get readyForResult(): boolean {
    return this.phase === 'finished' && this.finishTimer >= RACE_CONFIG.finishBannerSeconds;
  }

  /** 固定ステップ 1 回分 */
  step(dt: number, world: RaceWorld): void {
    if (this.phase === 'finished') {
      this.finishTimer += dt;
      return;
    }
    if (this.phase === 'countdown') {
      if (this.lastCount < 0) this.emitCount();
      this.countdownLeft -= dt;
      if (this.countdownLeft <= 1e-6) {
        this.countdownLeft = 0;
        this.phase = 'racing';
        this.recorder.record(0, world.playerPosition, world.playerOrientation);
        this.bus.emit('race:start', {});
      } else if (Math.ceil(this.countdownLeft - 1e-6) !== this.lastCount) this.emitCount();
      return;
    }
    this.elapsed += dt;
    if (world.playerActive) {
      const end = this.windowEnd;
      for (let j = this.next; j <= end; j++) {
        const ring = this.rings[j];
        if (ring && crossesRing(ring, world.playerPrevPosition, world.playerPosition)) {
          this.pass(j);
          break;
        }
      }
    }
    // ゴールしたら記録を止める（pass の中で finish する）
    if (this.result) return;
    this.recorder.record(this.elapsed, world.playerPosition, world.playerOrientation);
    if (this.elapsed >= this.course.timeLimitSeconds) this.finish('timeout');
  }

  /**
   * 墜落の後に戻す位置: 最後に通った（飛ばした）リング（まだなければ開始位置）。機首は次のリングの水平の向き
   */
  respawnPose(): Pose {
    const from = this.rings[this.next - 1]?.position ?? this.course.start;
    const to = this.rings[this.next]?.position;
    if (!to) return { x: from.x, y: from.y, z: from.z, headingDeg: this.course.start.headingDeg };
    const d = { x: to.x - from.x, y: 0, z: to.z - from.z };
    const headingDeg = Math.hypot(d.x, d.z) < 1 ? 0 : anglesOf(d).headingDeg;
    return { x: from.x, y: from.y, z: from.z, headingDeg };
  }

  private emitCount(): void {
    this.lastCount = Math.ceil(this.countdownLeft - 1e-6);
    this.bus.emit('race:countdown', { count: this.lastCount });
  }

  private pass(j: number): void {
    const skipped: RaceRing[] = [];
    for (let k = this.next; k < j; k++) {
      const r = this.rings[k];
      if (!r) continue;
      this.status[k] = 'missed';
      this.missed++;
      skipped.push(r);
      this.ringTimes[k] = this.currentTime;
    }
    if (skipped.length > 0) this.bus.emit('race:miss', { rings: skipped });
    const ring = this.rings[j];
    if (!ring) return;
    this.status[j] = 'passed';
    if (ring.kind === 'thin') this.thinPassed++;
    const time = this.currentTime;
    this.ringTimes[j] = time;
    this.next = j + 1;
    const ref = this.reference?.ringTimes[j];
    const delta = ref === undefined ? null : time - ref;
    if (delta !== null) this.ghostDelta = delta;
    this.bus.emit('race:ring', { ring, time });
    if (ring.required) this.bus.emit('race:split', { ring, time, delta });
    if (j === this.rings.length - 1) this.finish('finished');
  }

  private finish(outcome: RaceOutcome): void {
    const c = RACE_CONFIG;
    const done = outcome === 'finished';
    const time = done ? raceTime(this.elapsed, this.missed, this.thinPassed) : this.elapsed;
    this.result = {
      courseId: this.course.id,
      outcome,
      rawSeconds: Math.round(this.elapsed * 1000) / 1000,
      time,
      missed: this.missed,
      thinPassed: this.thinPassed,
      penaltySeconds: this.missed * c.missPenaltySeconds,
      bonusSeconds: this.thinPassed * c.thinBonusSeconds,
      rank: done ? raceRank(time, this.course.goldTimeSeconds) : null,
      ringTimes: [...this.ringTimes],
    };
    this.phase = 'finished';
    this.finishTimer = 0;
    this.bus.emit('race:finish', { result: this.result });
  }
}
