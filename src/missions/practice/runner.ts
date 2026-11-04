// 練習場（9-5）の進行（Three.js 非依存）: 数え（3 秒。開始位置に止める）→ 課題（60〜90 秒）→ 時間切れで結果。
// 課題ごとに的（風船。撃墜から 10 秒で別の地点へ）・動く的（ドローン 3 機に直進・蛇行・上下の経路）・模擬の敵（撃ち返さない rookie。
// 落とすと 3 秒後に前方へ出直す）を出す。自機は撃墜されない・墜落は上空へ戻す（チュートリアルと同じ練習扱い）・戦域外でも終わらない。
// 撃墜・命中・狙いの指標（aim-stats.ts）はこの中で数えるので、リプレイでも同じ結果になる。自機を止める・機銃だけにするのは GamePlay
import { createCombatInput, type CombatInput } from '../../combat/combat-input';
import { EventBus } from '../../core/event-bus';
import type { AircraftControls } from '../../entities/aircraft';
import { PRACTICE_CONFIG, type PracticeDrill } from '../../data/practice';
import { headingDegOf } from '../../entities/enemy-aircraft';
import type { FlightSession } from '../flight-session';
import { configureDrones } from '../session-spawn';
import type { Pose } from '../types';
import { AimStats } from './aim-stats';
import { buildPracticeResult, practiceScore, type PracticeResult } from './score';

export type PracticePhase = 'countdown' | 'running' | 'finished';

export interface PracticeEvents extends Record<string, unknown> {
  /** 数えの 1 秒ごと（3, 2, 1） */
  'practice:countdown': { readonly count: number };
  'practice:start': Record<string, never>;
  'practice:kill': { readonly kills: number };
  'practice:end': { readonly result: PracticeResult };
}

export class PracticeRunner {
  readonly bus = new EventBus<PracticeEvents>();
  readonly duration: number;
  readonly start: Pose;
  readonly aim: AimStats;
  phase: PracticePhase = 'countdown';
  countdownLeft: number = PRACTICE_CONFIG.countdownSeconds;
  /** 課題の経過（秒。数えの間は 0） */
  elapsed = 0;
  /** 終わってからの経過（秒） */
  sinceEnd = 0;
  kills = 0;
  result: PracticeResult | null = null;
  /** 撃墜までの時間（秒）の並び */
  readonly killTimes: number[] = [];
  /** 撃墜までの時間を数えはじめた時刻（始め・前の撃墜・模擬の敵の出現） */
  private markAt = 0;
  private kills0 = 0;
  private shots0 = 0;
  private hits0 = 0;
  /** 模擬の敵（enemies の添字。出ていなければ -1）と、出し直すまでの秒数 */
  private bandit = -1;
  private banditTimer = 0;
  /** 模擬の敵を出した回数（左右・向きの順番） */
  private banditCount = 0;
  private lastCount = 0;
  private started = false;
  private readonly input = createCombatInput();

  constructor(
    readonly drill: PracticeDrill,
    private readonly session: FlightSession,
    aspect: number,
  ) {
    this.duration = PRACTICE_CONFIG.durations[drill];
    this.start = PRACTICE_CONFIG.starts[drill];
    const r = PRACTICE_CONFIG.aspectRange;
    this.aim = new AimStats(
      Number.isFinite(aspect) ? Math.min(r.max, Math.max(r.min, aspect)) : r.fallback,
    );
  }

  /** 残り時間（秒） */
  get timeLeft(): number {
    return Math.max(0, this.duration - this.elapsed);
  }

  get running(): boolean {
    return this.phase === 'running';
  }

  /** 今のスコア（HUD。終わったら結果のスコア） */
  get liveScore(): number {
    if (this.result) return this.result.score;
    if (this.phase === 'countdown') return 0;
    const g = this.session.combat.gun;
    const shots = g.shotCount - this.shots0;
    return practiceScore(this.kills, shots > 0 ? (g.hitCount - this.hits0) / shots : null);
  }

  /** 結果の画面へ進んでよいか（時間切れの大きな文字を出し終えた） */
  get readyForResult(): boolean {
    return this.phase === 'finished' && this.sinceEnd >= PRACTICE_CONFIG.resultDelaySeconds;
  }

  /** 課題の出現物を出す（GamePlay.startPractice が世界を空にした直後） */
  begin(): void {
    if (this.started) return;
    this.started = true;
    const s = this.session;
    if (this.drill === 'static') s.combat.targets.configure(s.combat.targets.balloons.length, true);
    if (this.drill === 'moving') {
      const paths = PRACTICE_CONFIG.dronePaths;
      configureDrones(s.combat.drones, paths.length, true);
      s.combat.drones.forEach((d, i) => {
        const path = paths[i];
        if (path) d.setPath(path);
      });
    }
    if (this.drill === 'bandit') this.spawnBandit();
    this.lastCount = Math.ceil(this.countdownLeft);
    this.bus.emit('practice:countdown', { count: this.lastCount });
  }

  /**
   * GamePlay の固定ステップ 1 回分: 数えの間は hold（開始位置に止める。レースと同じ）、課題の間は機銃だけ
   * （ミサイル・ロケット・爆弾は撃たない）、終わったら撃たないで世界を進め、そのあと step
   */
  stepWorld(
    controls: Readonly<AircraftControls>,
    input: Readonly<CombatInput>,
    dt: number,
    hold: (pose: Readonly<Pose>) => void,
  ): void {
    const firing = this.running && input.trigger;
    if (this.phase === 'countdown') hold(this.start);
    else {
      const gun = this.input;
      Object.assign(gun, input);
      gun.trigger = firing;
      gun.missile = gun.rocket = gun.bomb = gun.bombHeld = false;
      this.session.step(controls, gun, dt);
    }
    this.step(dt, firing);
  }

  /** 固定ステップ 1 回分（世界を進めた後）。firing はこのステップで機銃を撃っていたか */
  step(dt: number, firing: boolean): void {
    if (!this.started) this.begin();
    if (this.phase === 'countdown') {
      this.countdownLeft -= dt;
      const n = Math.ceil(this.countdownLeft - 1e-9);
      if (n !== this.lastCount && n > 0) {
        this.lastCount = n;
        this.bus.emit('practice:countdown', { count: n });
      }
      if (this.countdownLeft <= 1e-9) this.go();
      return;
    }
    if (this.phase === 'finished') {
      this.sinceEnd += dt;
      return;
    }
    this.elapsed += dt;
    const s = this.session;
    this.aim.step(s.combat, s.aircraft.state, s.player.active, firing);
    const kills = s.combat.kills - this.kills0;
    if (kills > this.kills) {
      for (let i = this.kills; i < kills; i++) this.killTimes.push(this.elapsed - this.markAt);
      this.kills = kills;
      this.markAt = this.elapsed;
      this.bus.emit('practice:kill', { kills });
    }
    if (this.drill === 'bandit') this.stepBandit(dt);
    if (this.elapsed >= this.duration - 1e-9) this.finish();
  }

  private go(): void {
    this.phase = 'running';
    this.countdownLeft = 0;
    const c = this.session.combat;
    this.kills0 = c.kills;
    this.shots0 = c.gun.shotCount;
    this.hits0 = c.gun.hitCount;
    this.markAt = 0;
    this.bus.emit('practice:start', {});
  }

  private finish(): void {
    this.phase = 'finished';
    this.sinceEnd = 0;
    const c = this.session.combat;
    const result = buildPracticeResult(
      this.drill,
      this.duration,
      {
        kills: this.kills,
        shots: c.gun.shotCount - this.shots0,
        hits: c.gun.hitCount - this.hits0,
        killTimes: this.killTimes,
      },
      this.aim,
    );
    this.result = result;
    this.bus.emit('practice:end', { result });
  }

  /** 模擬の敵: 落ちた（地面への衝突も）ら数えて、respawnSeconds 後に出し直す */
  private stepBandit(dt: number): void {
    const e = this.bandit >= 0 ? this.session.enemies[this.bandit] : undefined;
    if (e?.active) return;
    if (this.bandit >= 0) {
      this.bandit = -1;
      this.banditTimer = PRACTICE_CONFIG.bandit.respawnSeconds;
    }
    this.banditTimer -= dt;
    if (this.banditTimer > 1e-9) return;
    this.spawnBandit();
    // 撃墜までの時間は出たときから数える
    this.markAt = this.elapsed;
  }

  /** 自機の前方に模擬の敵を 1 機出す（左右・向きは順番に変える） */
  private spawnBandit(): void {
    const b = PRACTICE_CONFIG.bandit;
    const st = this.session.aircraft.state;
    const k = this.banditCount++;
    const heading = headingDegOf(st.orientation);
    const h = (heading * Math.PI) / 180;
    const side = b.sides[k % b.sides.length] ?? 0;
    const turn = b.headings[k % b.headings.length] ?? 0;
    const p = st.position;
    const at = {
      x: p.x + Math.sin(h) * b.ahead + Math.cos(h) * side,
      y: Math.min(b.maxAltitude, Math.max(b.minAltitude, p.y)),
      z: p.z - Math.cos(h) * b.ahead + Math.sin(h) * side,
      headingDeg: heading + turn,
    };
    this.bandit = this.session.squadron.deploy(at, b.patrol, b.difficulty, false, b.hpScale, true);
  }
}
