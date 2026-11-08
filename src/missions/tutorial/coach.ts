// チュートリアルの章（9-5c）の進行役（Three.js 非依存）: ランナーの進行中の課題（task）の条件を毎ステップ判定して進め、
// 達成できないときのヒント（時間・追い越し・射程外の射撃・見失い・速さ不足・ミサイルの命中）を知らせる。
// 課題に要る的（付いていく的・後ろに置く的）とフレアの章のミサイルもここで出す。GamePlay の固定ステップから呼ぶ
import { autoFireReady } from '../../combat/auto-fire';
import type { CombatInput } from '../../combat/combat-input';
import { EventBus } from '../../core/event-bus';
import { TUTORIAL_CONFIG, type TutorialChapter } from '../../data/tutorial';
import { TUTORIAL_TASK_CONFIG as C } from '../../data/tutorial-tasks';
import type { TargetDrone } from '../../entities/target-drone';
import { TaskObjective, type Objective } from '../objectives';
import { AimStats } from '../practice/aim-stats';
import { FlightTips, type FlightTip } from '../practice/tips';
import type { FlightSession } from '../flight-session';
import type { MissionRunner } from '../runner';
import { createAttitude, headingDiff, noseAngle, readAttitude } from './attitude';
import { launchAtPlayer, placeTutorialDrone } from './props';

/** ヒントの種類: step = 段階の時間切れ（段階ごとの文）、ほかは飛行中の一言 */
export type TutorialHint = 'step' | FlightTip | 'needSpeed' | 'missileHit' | 'replaced';

export interface TutorialEvents extends Record<string, unknown> {
  'tutorial:hint': { readonly hint: TutorialHint; readonly step: string };
}

export class TutorialCoach {
  readonly bus = new EventBus<TutorialEvents>();
  /** 進行中の段階（目標 id）と始まってからの秒数 */
  stepId: string | null = null;
  stepTime = 0;
  private hintCount = 0;
  private readonly att = createAttitude();
  private readonly nose = { angle: 0, distance: 0 };
  private readonly aim = new AimStats(16 / 9);
  private readonly tips = new FlightTips();
  private elapsed = 0;
  // 課題ごとの途中の値（段階が変わると戻す）
  private phase = 0;
  private timer = 0;
  private value = 0;
  private refHeading = 0;
  /** 最後に宙返りに入ったときの方位（段階をまたいで持つ） */
  private loopHeading = 0;
  private prevAmmo = 0;
  private prevRockets = 0;
  private prevFlares = 0;
  private prevDamage = 0;
  private prevSelected: unknown = null;
  private resupplied = false;

  constructor(
    readonly chapter: TutorialChapter,
    private readonly session: FlightSession,
    private readonly runner: MissionRunner,
  ) {
    runner.bus.on('mission:resupply', () => {
      this.resupplied = true;
    });
  }

  /** 進行中の目標（無ければ null） */
  private get active(): Objective | null {
    return this.runner.objectives.find((o) => o.status === 'active') ?? null;
  }

  /** 固定ステップ 1 回分（世界とランナーを進めた後）。input はこのステップの戦闘の操作（機銃を撃っていたか） */
  step(input: Readonly<CombatInput>, dt: number): void {
    if (!this.runner.running) return;
    const s = this.session;
    const o = this.active;
    const id = o?.def.id ?? null;
    if (id !== this.stepId) this.begin(o);
    if (!o) return;
    this.elapsed += dt;
    this.stepTime += dt;
    const st = s.aircraft.state;
    readAttitude(this.att, st.orientation);
    // 段階のヒント（時間）: hintSeconds で 1 回、その後 2 倍の間を空けてもう 1 回
    const due = TUTORIAL_CONFIG.stepHintSeconds * (this.hintCount === 0 ? 1 : 2.5);
    if (this.hintCount < 2 && this.stepTime >= due) {
      this.hintCount++;
      this.hint('step');
    }
    // 狙いの数え（練習場の一言と同じ）
    this.aim.step(s.combat, st, s.player.active, input.trigger);
    const tip = this.tips.update(this.elapsed, this.aim);
    if (tip) this.hint(tip);
    if (o instanceof TaskObjective) this.check(o, dt);
  }

  private hint(hint: TutorialHint): void {
    this.bus.emit('tutorial:hint', { hint, step: this.stepId ?? '' });
  }

  /** 段階が変わった: 途中の値を戻し、課題に要る物を出す */
  private begin(o: Objective | null): void {
    this.stepId = o?.def.id ?? null;
    this.stepTime = 0;
    this.hintCount = 0;
    this.phase = this.timer = this.value = 0;
    this.tips.reset();
    const s = this.session;
    const st = s.aircraft.state;
    readAttitude(this.att, st.orientation);
    this.refHeading = this.att.headingDeg;
    this.prevAmmo = s.combat.missileAmmo.count;
    this.prevRockets = s.combat.rockets.count;
    this.prevFlares = s.combat.flares.magazine.count;
    this.prevDamage = s.player.damageTaken;
    this.prevSelected = s.combat.targeting.selected;
    this.resupplied = false;
    if (!(o instanceof TaskObjective)) return;
    if (o.def.task === 'climb') this.value = st.position.y;
    // 宙返りの頂点で前の段階（loopTop）を終えた: その宙返りのまま戻せば反転
    if (o.def.task === 'reverse' && this.att.upY < 0) {
      this.phase = 2;
      this.refHeading = this.loopHeading;
    }
    if (o.def.task === 'follow')
      placeTutorialDrone(s, C.follow.ahead, C.follow.speed, C.follow.length);
    if (o.def.task === 'behind') this.placeBehind();
    if (o.def.task === 'loopTop' && this.runner.elapsed < 0.1) {
      st.speed = C.loop.startSpeed;
      s.aircraft.throttle = C.loop.startThrottle;
    }
    if (o.def.task === 'flare') this.timer = C.flare.intervalSeconds - C.flare.firstSeconds;
  }

  private check(o: TaskObjective, dt: number): void {
    const s = this.session;
    const st = s.aircraft.state;
    const a = this.att;
    const c = s.combat;
    switch (o.def.task) {
      case 'level': {
        const L = C.level;
        if (Math.abs(a.bankDeg) >= L.bankDeg) this.phase = 1;
        const level = Math.abs(a.bankDeg) < L.levelDeg && Math.abs(a.pitchDeg) < L.levelDeg;
        this.timer = this.phase === 1 && level ? this.timer + dt : 0;
        if (this.timer >= L.holdSeconds) o.report(1);
        break;
      }
      case 'climb': {
        const y = st.position.y;
        if (this.phase === 0 && y >= this.value + C.climb.meters) {
          this.phase = 1;
          o.report(1);
        }
        if (this.phase === 1) {
          this.value = Math.max(this.value, y);
          if (y <= this.value - C.climb.meters) o.report(2);
        } else this.value = Math.min(this.value, y);
        break;
      }
      case 'slow':
        if (st.speed <= C.slow.speed) o.report(1);
        break;
      case 'follow': {
        const d = c.drones[0];
        if (!d?.active) break;
        noseAngle(this.nose, st.position, st.orientation, d.position);
        const f = C.follow;
        const n = this.nose;
        if (n.distance >= f.minDistance && n.distance <= f.maxDistance && n.angle <= f.coneDeg) {
          this.value += dt;
          o.report(this.value);
        }
        // 後ろへ回ったまま 10 秒: 前に出し直す
        this.timer = n.angle > 90 ? this.timer + dt : 0;
        if (this.timer >= 10) {
          this.timer = 0;
          placeTutorialDrone(s, f.ahead, f.speed, f.length);
          this.hint('replaced');
        }
        break;
      }
      case 'aim': {
        const ready = autoFireReady(
          c.targeting.selected,
          c.lead,
          c.leadValid,
          st.position,
          st.orientation,
          c.gun.hitRadiusScale,
        );
        this.timer = ready ? this.timer + dt : this.timer;
        if (this.timer >= C.aim.holdSeconds) o.report(1);
        break;
      }
      case 'lock':
        if (c.targeting.locked) o.report(1);
        break;
      case 'launch': {
        const ammo = c.missileAmmo.count;
        if (ammo < this.prevAmmo && c.targeting.selected) o.report(1);
        this.prevAmmo = ammo;
        break;
      }
      case 'resupply':
        if (this.resupplied) o.report(1);
        break;
      case 'rocket': {
        // 10-4b: ロケットを撃った（残弾が減った）
        const n = c.rockets.count;
        if (n < this.prevRockets) o.report(1);
        this.prevRockets = n;
        break;
      }
      case 'flare':
        this.stepFlare(o, dt);
        break;
      case 'loopTop':
      case 'reverse':
        this.stepLoop(o);
        break;
      case 'select': {
        const sel = c.targeting.selected;
        const prev = this.prevSelected as TargetDrone | null;
        if (sel && prev && sel !== prev && prev.active) {
          noseAngle(this.nose, st.position, st.orientation, prev.position);
          if (this.nose.angle <= C.select.keepDeg) o.report(o.current + 1);
        }
        this.prevSelected = sel;
        break;
      }
      case 'behind': {
        const d = c.drones[0];
        if (!d?.active) break;
        if (c.targeting.selected !== d) c.targeting.select(d);
        noseAngle(this.nose, st.position, st.orientation, d.position);
        if (this.nose.angle <= C.behind.foundDeg) {
          o.report(o.current + 1);
          if (o.status === 'active') this.placeBehind();
        }
        break;
      }
    }
  }

  /** フレア: 警告が出ている間にフレアを撒いた回数。ミサイルは間を空けて後ろから撃たせる */
  private stepFlare(o: TaskObjective, dt: number): void {
    const s = this.session;
    const c = s.combat;
    const incoming = c.incomingMissiles(s.player) > 0;
    const flares = c.flares.magazine.count;
    if (incoming && flares < this.prevFlares) o.report(o.current + 1);
    if (flares === 0) c.flares.magazine.refill();
    this.prevFlares = c.flares.magazine.count;
    // 当たった（撒かなかった）: ヒント
    if (s.player.damageTaken > this.prevDamage + 1e-6) this.hint('missileHit');
    this.prevDamage = s.player.damageTaken;
    if (incoming || !s.player.active) return;
    this.timer += dt;
    if (this.timer < C.flare.intervalSeconds) return;
    this.timer = 0;
    launchAtPlayer(s);
  }

  /** 宙返り: 機首が上がった → 頂点（背中が下・機首が水平）→（reverse は）水平に戻って反対向き */
  private stepLoop(o: TaskObjective): void {
    const a = this.att;
    const L = C.loop;
    const st = this.session.aircraft.state;
    if (a.pitchDeg >= L.needSpeedDeg && st.speed < L.needSpeed && this.phase === 0)
      this.hintOnce('needSpeed');
    // 入る前の方位（真上の近くの方位は定まらないので、機首が 45° より下の間の値）
    if (this.phase === 0 && a.pitchDeg < 45 && a.upY > 0) this.loopHeading = a.headingDeg;
    if (this.phase === 0 && a.pitchDeg >= L.entryDeg) {
      this.phase = 1;
      this.refHeading = this.loopHeading;
    }
    const top = a.upY < L.topUpY && Math.abs(a.pitchDeg) < L.topPitchDeg;
    if (this.phase === 1 && top) {
      if (o.def.task === 'loopTop') {
        o.report(1);
        return;
      }
      this.phase = 2;
    }
    if (this.phase !== 2) return;
    const level =
      Math.abs(a.bankDeg) < L.levelDeg && Math.abs(a.pitchDeg) < L.levelDeg && a.upY > 0;
    if (!level) return;
    if (headingDiff(a.headingDeg, this.refHeading) >= L.reverseDeg) o.report(1);
    // 反転せずに 1 回転して戻った: もう一度
    else this.phase = 0;
  }

  private hintOnce(hint: TutorialHint): void {
    if (this.timer > 0) return;
    this.timer = 1;
    this.hint(hint);
  }

  /** 後ろの的: 機首から 180° ± sideDeg（交互）の距離 distance に、横切る向きで */
  private placeBehind(): void {
    const b = C.behind;
    const side = (this.runner.objectives.find((x) => x.def.id === this.stepId)?.current ?? 0) % 2;
    placeTutorialDrone(
      this.session,
      b.distance,
      b.speed,
      b.length,
      180 + (side === 0 ? b.sideDeg : -b.sideDeg),
    );
  }
}
