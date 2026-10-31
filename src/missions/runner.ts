// ミッションランナー（2-4、Three.js 非依存）: 定義を読み、出現物を時間・条件で投入し、目標の進み具合を追い、
// 成功 / 失敗を決める。進み具合と結果はイベントバス（bus）で知らせる（HUD・リザルト画面が購読する）。
// 固定ステップで step() を呼ぶ。世界（自機・敵・撃墜数）は MissionWorld を毎ステップ読むだけ
import { EventBus } from '../core/event-bus';
import { MAPS, ISLAND_MAP, type MapDef } from '../data/maps';
import { MISSION_FLOW } from '../data/missions';
import { computeRank, rewardCredits } from '../data/ranking';
import { raidReward } from '../progression/raid-reward';
import { BoundaryWatch } from './boundary';
import { createObjective, RingPassObjective, type Objective } from './objectives';
import type { MissionEvents, MissionOutcome, MissionResult, ObjectiveResult } from './events';
import type { FailCondition, MissionDef, SpawnDef } from './types';
import type { MissionWorld } from './world';

export type { MissionEvents, MissionResult, MissionOutcome, ObjectiveResult } from './events';

export type MissionStatus = 'running' | 'success' | 'failed' | 'aborted';

export class MissionRunner {
  readonly bus = new EventBus<MissionEvents>();
  readonly objectives: readonly Objective[];
  readonly boundary: BoundaryWatch;
  readonly map: MapDef;
  status: MissionStatus = 'running';
  failReason: FailCondition | null = null;
  /** 開始からの経過（秒）。終わったら止まる */
  elapsed = 0;
  /** 終わってからの経過（秒）。MISSION_FLOW.resultDelaySeconds を過ぎたらリザルトへ */
  sinceEnd = 0;
  paused = false;
  /** 終わったときの結果（running の間は null） */
  result: MissionResult | null = null;
  /** objectives[i] の順番（0 から。同じ番号は同時に進む） */
  private readonly stages: readonly number[];
  private readonly spawned: boolean[];
  private readonly lastProgress: number[];
  private initialDowns = 0;
  private initialDamage = 0;
  private started = false;
  /** 前回知らせた境界の状態（変わったときだけ知らせる） */
  private lastBoundaryOutside = false;
  private lastBoundarySeconds = -1;

  constructor(
    readonly def: MissionDef,
    private readonly world: MissionWorld,
  ) {
    this.map = MAPS[def.mapId] ?? ISLAND_MAP;
    this.boundary = new BoundaryWatch(this.map, def.failConditions.includes('outOfBounds'));
    this.objectives = def.objectives.map((o) => createObjective(o));
    let stage = 0;
    this.stages = def.objectives.map((o, i) => {
      if (i > 0 && o.start === 'afterPrevious') stage++;
      return stage;
    });
    this.spawned = def.spawns.map(() => false);
    this.lastProgress = def.objectives.map(() => -1);
  }

  get running(): boolean {
    return this.status === 'running';
  }

  /** 制限時間の残り（秒）。制限時間がなければ null */
  get timeLeft(): number | null {
    const limit = this.def.timeLimitSeconds;
    return limit === undefined ? null : Math.max(0, limit - this.elapsed);
  }

  /** 結果の表示（リザルト画面）へ進んでよいか（終わってから大きな文字を出し終えた） */
  get readyForResult(): boolean {
    return (
      !this.running && this.status !== 'aborted' && this.sinceEnd >= MISSION_FLOW.resultDelaySeconds
    );
  }

  /** 進行中のリング通過の目標（描画と HUD の「次のリング」）。なければ null */
  get activeRings(): RingPassObjective | null {
    for (const o of this.objectives)
      if (o instanceof RingPassObjective && o.status === 'active') return o;
    return null;
  }

  /** 開始する（最初の固定ステップの前）。開始時の出現物と最初の目標を出す */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.initialDowns = this.world.playerDowns;
    this.initialDamage = this.world.playerDamageTaken;
    this.boundary.reset();
    this.bus.emit('mission:start', { def: this.def });
    this.runSpawns();
    this.activateStages();
    this.emitProgress();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  /** 中断（ポーズメニューの「ミッションを中断」）。報酬もリザルトもなし */
  abort(): void {
    if (!this.running) return;
    this.status = 'aborted';
    this.result = this.buildResult('aborted');
    this.bus.emit('mission:abort', { result: this.result });
  }

  /** 固定ステップ 1 回分 */
  step(dt: number): void {
    if (!this.started) this.start();
    if (this.paused) return;
    if (!this.running) {
      this.sinceEnd += dt;
      return;
    }
    this.elapsed += dt;
    const w = this.world;
    this.runSpawns();

    if (w.playerActive) this.boundary.step(w.playerPosition.x, w.playerPosition.z, dt);
    this.emitBoundary();

    for (const o of this.objectives) if (o.status === 'active') o.step(w, dt);
    this.emitProgress();
    this.handleCompletions();

    const fail = this.checkFailure();
    if (fail) this.finish('failed', fail);
    else if (this.allRequiredComplete()) this.finish('success', null);
  }

  private emitBoundary(): void {
    const b = this.boundary;
    const seconds = Math.ceil(b.secondsLeft - 1e-6);
    if (b.outside === this.lastBoundaryOutside && seconds === this.lastBoundarySeconds) return;
    this.lastBoundaryOutside = b.outside;
    this.lastBoundarySeconds = seconds;
    this.bus.emit('boundary:change', { outside: b.outside, secondsLeft: b.secondsLeft });
  }

  /** 達成した目標を知らせ、次の順番の目標を始める */
  private handleCompletions(): void {
    let any = false;
    for (let index = 0; index < this.objectives.length; index++) {
      const o = this.objectives[index];
      if (o?.status !== 'complete' || this.lastProgress[index] === Infinity) continue;
      this.lastProgress[index] = Infinity;
      any = true;
      this.bus.emit('objective:complete', { index, id: o.def.id });
    }
    if (!any) return;
    this.runSpawns();
    this.activateStages();
    this.emitProgress();
  }

  /** それより前の順番の必須目標がすべて達成済みなら、その順番の目標を始める */
  private activateStages(): void {
    // 目標が始まったときの出現物（objectiveActive）を出す
    let activated = false;
    for (let index = 0; index < this.objectives.length; index++) {
      const o = this.objectives[index];
      if (o?.status !== 'pending' || !this.stageOpen(this.stages[index] ?? 0)) continue;
      o.activate(this.world);
      activated = true;
      this.bus.emit('objective:activate', { index, id: o.def.id });
    }
    if (activated) this.runSpawns();
  }

  private stageOpen(stage: number): boolean {
    return this.objectives.every(
      (o, i) => (this.stages[i] ?? 0) >= stage || !o.def.required || o.status === 'complete',
    );
  }

  private emitProgress(): void {
    this.objectives.forEach((o, index) => {
      if (o.status === 'pending' || o.current === this.lastProgress[index]) return;
      if (this.lastProgress[index] === Infinity) return;
      this.lastProgress[index] = o.current;
      this.bus.emit('objective:progress', {
        index,
        id: o.def.id,
        current: o.current,
        target: o.target,
      });
    });
  }

  private runSpawns(): void {
    this.def.spawns.forEach((s, i) => {
      if (this.spawned[i] || !this.triggered(s)) return;
      this.spawned[i] = true;
      this.world.spawn(s);
    });
  }

  private triggered(s: SpawnDef): boolean {
    const t = s.trigger;
    switch (t.type) {
      case 'start':
        return true;
      case 'time':
        return this.elapsed + 1e-9 >= t.seconds;
      case 'objectiveActive':
      case 'objectiveComplete': {
        const o = this.objectives.find((x) => x.def.id === t.objective);
        if (!o) return false;
        return t.type === 'objectiveActive' ? o.status !== 'pending' : o.status === 'complete';
      }
    }
  }

  private checkFailure(): FailCondition | null {
    const w = this.world;
    for (const c of this.def.failConditions) {
      if (c === 'playerDown' && w.playerDowns > this.initialDowns) return c;
      if (c === 'escortLost' && w.escortLost) return c;
      if (c === 'kaijuReachedCity' && w.kaijuReachedCity) return c;
      if (c === 'outOfBounds' && this.boundary.expired) return c;
      if (c === 'timeUp' && this.timeLeft !== null && this.timeLeft <= 1e-9) return c;
    }
    return null;
  }

  private allRequiredComplete(): boolean {
    return this.objectives.every((o) => !o.def.required || o.status === 'complete');
  }

  private finish(outcome: 'success' | 'failed', reason: FailCondition | null): void {
    this.status = outcome;
    this.failReason = reason;
    this.sinceEnd = 0;
    if (outcome === 'failed')
      for (const o of this.objectives) if (o.status !== 'complete') o.status = 'failed';
    const result = this.buildResult(outcome);
    this.result = result;
    this.bus.emit('mission:end', { result });
    if (result.credits > 0)
      this.bus.emit('mission:reward', {
        missionId: this.def.id,
        credits: result.credits,
        rank: result.rank,
      });
  }

  private buildResult(outcome: MissionOutcome): MissionResult {
    const w = this.world;
    const damageTaken = Math.max(0, w.playerDamageTaken - this.initialDamage);
    const objectives: ObjectiveResult[] = this.objectives.map((o) => ({
      id: o.def.id,
      def: o.def,
      status: o.status,
      current: o.current,
      target: o.target,
    }));
    const success = outcome === 'success';
    // 任意目標の達成は加点（3-2）
    const optional = this.objectives.filter((o) => !o.def.required);
    const tally = {
      completed: optional.filter((o) => o.status === 'complete').length,
      total: optional.length,
    };
    const rank = success
      ? computeRank(this.elapsed, this.def.parTimeSeconds, damageTaken, w.playerMaxHp, tally)
      : null;
    const raid = this.def.reward.raid;
    // 6-6: レイドは基礎額 × 時間ボーナス（× 高難度）、失敗でも 300
    const credits = raid
      ? raidReward({ coop: false, cleared: success, seconds: this.elapsed, ...raid })
      : rank
        ? rewardCredits(this.def.reward.baseCredits, rank, this.def.reward.rankMultipliers)
        : 0;
    return {
      missionId: this.def.id,
      outcome,
      failReason: this.failReason,
      elapsedSeconds: this.elapsed,
      damageTaken,
      maxHp: w.playerMaxHp,
      objectives,
      rank,
      credits,
      ...(w.protectedBuildings != null ? { protectedBuildings: w.protectedBuildings } : {}),
    };
  }
}
