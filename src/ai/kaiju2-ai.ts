// 9-6a: ネフィルガの動き（Three.js 非依存）: 巡航（プレイヤーの近くを周回）→ 攻撃を選ぶ → 予兆 → 攻撃 → 硬直 → 巡航。
// スタミナが尽きたら止まり木（陸の高い所）に降りて羽を休める（攻める隙）。急降下の後の引き起こしも隙。
// 決まった計算だけで進め、乱数は本体の SeededRandom（種から）だけを使う（リプレイで同じ結果）
import type { Flare } from '../combat/flare';
import type { Pool } from '../combat/pool';
import { KAIJU2_CONFIG as C, type Kaiju2Attack } from '../data/kaiju2';
import { vec3, type Vec3 } from '../flight/math';
import type { SkyKaiju } from '../entities/kaiju2/sky-kaiju';
import {
  attackCandidates,
  attackUsable,
  choosePerch,
  geometryTo,
  gustHits,
  launchOrbs,
  pickAttack,
  stepOrbs,
  tailTip,
} from './kaiju2-attacks';
import { stepDive } from './kaiju2-dive';
import { stepLanding, stepPerched, stepTakeoff } from './kaiju2-perch';
import { updateKaiju2Pose } from '../entities/kaiju2/kaiju2-pose';

const A = C.attacks;

/** 怪獣が見る世界（プレイヤー 1 機・フレア・当たったときの知らせ先） */
export interface Kaiju2Target {
  readonly position: Readonly<Vec3>;
  /** 速度（m/s。急降下の予測） */
  readonly velocity: Readonly<Vec3>;
  readonly active: boolean;
}

export interface Kaiju2Hooks {
  /** プレイヤーに当たった（数値は仮。stun は操作できない秒数） */
  hit(attack: Kaiju2Attack, damage: number, stun: number): void;
}

const want = vec3();
const tip = vec3();

/** 攻撃の秒数（予兆 / 攻撃 / 硬直）。windupScale は難易度の予兆の倍率（9-6b。高難度で短い） */
export function attackTimes(
  a: Kaiju2Attack,
  windupScale = 1,
): { windup: number; active: number; recover: number } {
  const s = A[a];
  return { windup: s.windup * windupScale, active: s.active, recover: s.recover };
}

export class Kaiju2Ai {
  constructor(
    readonly body: SkyKaiju,
    private readonly hooks: Kaiju2Hooks,
  ) {}

  /** 出す: 位置・向き・種。周回の向きは種から */
  spawn(x: number, y: number, z: number, headingRad: number, seed: number): void {
    const k = this.body;
    k.random.reseed(seed);
    k.position.x = x;
    k.position.z = z;
    k.position.y = Math.max(y, k.floorAt(x, z) + C.avoid.clearance);
    k.forward.x = Math.sin(headingRad);
    k.forward.y = 0;
    k.forward.z = -Math.cos(headingRad);
    k.speed = k.cruiseSpeed;
    k.bank = 0;
    k.anchor.x = x;
    k.anchor.z = z;
    k.orbitSign = k.random.next() < 0.5 ? 1 : -1;
    k.stamina = C.perch.stamina;
    k.attackCooldown = C.firstAttackDelay;
    k.history.length = 0;
    k.attackHit = false;
    k.diveWait = A.dive.dueSeconds;
    for (const o of k.orbs) o.active = false;
    for (const key of Object.keys(k.hits) as Kaiju2Attack[]) k.hits[key] = 0;
    k.setState('cruise', null);
    k.time = 0;
    k.beginStep();
  }

  /** 固定ステップ 1 回分 */
  step(dt: number, target: Kaiju2Target, flares: Pool<Flare> | null): void {
    const k = this.body;
    k.beginStep();
    // 9-6c: 急降下の出番の時計（段階 2 から）
    if (k.phase >= A.dive.fromPhase && k.attack !== 'dive') k.diveWait += dt;
    switch (k.state) {
      case 'cruise':
        this.cruise(dt, target);
        break;
      case 'windup':
      case 'attack':
      case 'recover':
        this.stepAttack(dt, target);
        break;
      case 'landing':
        stepLanding(k, dt);
        break;
      case 'perched':
        stepPerched(k, dt);
        break;
      case 'takeoff':
        stepTakeoff(k, dt);
        break;
    }
    const orbHits = stepOrbs(k, target.active ? target.position : null, flares, dt);
    for (let i = 0; i < orbHits; i++) this.hit('orbs', A.orbs.damage, 0);
    updateKaiju2Pose(k, dt);
  }

  private hit(a: Kaiju2Attack, damage: number, stun: number): void {
    this.body.hits[a]++;
    this.hooks.hit(a, damage * this.body.damageScale, stun);
  }

  /** 9-6b: 部位が壊れて今の攻撃が使えなくなったら取り消す（予兆・急降下の間。雷球は撃った後は続ける）。取り消したら true */
  cancelBlocked(): boolean {
    const k = this.body;
    const a = k.attack;
    if (a === null || attackUsable(a, k.broken)) return false;
    if (k.state !== 'windup' && !(k.state === 'attack' && a !== 'orbs')) return false;
    if (a === 'dive' && k.state === 'attack') k.setState('recover');
    else this.endAttack();
    return true;
  }

  /** 巡航: 周回の中心をプレイヤーへ寄せ、その周りを回る。時間で攻撃・スタミナで止まり木 */
  private cruise(dt: number, target: Kaiju2Target): void {
    const k = this.body;
    this.fly(dt, target);
    k.stamina -= dt * (k.wingsBroken > 0 ? C.perch.wingBrokenDrain : 1);
    if (k.stamina <= 0) {
      if (choosePerch(k, k.random.next, k.perch)) {
        k.setState('landing', null);
        return;
      }
      k.stamina = C.perch.stamina * 0.5;
    }
    k.attackCooldown -= dt;
    if (k.attackCooldown > 0 || !target.active) return;
    const due = k.diveWait >= A.dive.dueSeconds;
    const cands = attackCandidates(
      geometryTo(k, target.position),
      k.phase,
      k.broken,
      k.history,
      due,
    );
    const a = pickAttack(cands, k.random.next, due);
    if (a === null) {
      k.attackCooldown = 1;
      return;
    }
    k.history.push(a);
    if (k.history.length > 4) k.history.shift();
    if (a === 'dive') k.diveWait = 0;
    k.attackHit = false;
    k.setState('windup', a);
  }

  /** 周回の飛び方（巡航・硬直・攻撃の間の尾など） */
  private fly(dt: number, target: Kaiju2Target, speedScale = 1): void {
    const k = this.body;
    const c = C.cruise;
    if (target.active) {
      // 周回の中心をプレイヤーへ寄せる（周回が戦域の soft の内側に収まる範囲で）
      const ax = target.position.x - k.anchor.x;
      const az = target.position.z - k.anchor.z;
      const al = Math.hypot(ax, az);
      const step = Math.min(al, c.anchorDrift * dt);
      if (al > 1) {
        k.anchor.x += (ax / al) * step;
        k.anchor.z += (az / al) * step;
      }
      const lim = C.arena.soft - c.orbitRadius;
      const ar = Math.hypot(k.anchor.x - k.center.x, k.anchor.z - k.center.z);
      if (ar > lim) {
        k.anchor.x = k.center.x + ((k.anchor.x - k.center.x) / ar) * lim;
        k.anchor.z = k.center.z + ((k.anchor.z - k.center.z) / ar) * lim;
      }
    }
    // 周回: 中心から見た今の角度の少し先（接線の向き）を狙う
    const dx = k.position.x - k.anchor.x;
    const dz = k.position.z - k.anchor.z;
    const ang = Math.atan2(dz, dx) + k.orbitSign * 0.6;
    const tx = k.anchor.x + Math.cos(ang) * c.orbitRadius;
    const tz = k.anchor.z + Math.sin(ang) * c.orbitRadius;
    const floor = Math.max(k.floorAt(tx, tz), k.floorAt(k.position.x, k.position.z));
    const ty = Math.min(k.ceiling, floor + c.altitude + Math.sin(ang * 1) * c.altitudeWave);
    want.x = tx - k.position.x;
    want.y = (ty - k.position.y) * 0.8;
    want.z = tz - k.position.z;
    k.steer(want, k.turnRate * dt);
    k.approachSpeed(k.cruiseSpeed * speedScale, c.accel, dt);
    k.integrate(dt);
  }

  /** 正面をプレイヤーへ向けて、ゆっくり飛ぶ（雷球・突風の予兆） */
  private face(dt: number, target: Kaiju2Target, speed: number): void {
    const k = this.body;
    const d = k.directionTo(target.position);
    want.x = d.x;
    want.y = Math.max(-0.3, Math.min(0.3, d.y));
    want.z = d.z;
    k.steer(want, k.turnRate * 1.3 * dt);
    k.approachSpeed(speed, 60, dt);
    k.integrate(dt);
  }

  private stepAttack(dt: number, target: Kaiju2Target): void {
    const k = this.body;
    const a = k.attack;
    if (a === null) {
      k.setState('cruise', null);
      return;
    }
    const t = attackTimes(a, k.windupScale);
    switch (a) {
      case 'orbs':
        // 攻撃に入った最初のステップで撃つ（attackHit を「撃った」の印に使う）
        if (k.state === 'attack' && !k.attackHit) {
          k.attackHit = true;
          k.orbVolleyHits = 0;
          launchOrbs(k, target.position, k.random.next);
        }
        if (k.state === 'recover') this.fly(dt, target);
        else this.face(dt, target, 45);
        break;
      case 'gust':
        if (k.state === 'recover') this.fly(dt, target);
        else this.face(dt, target, 50);
        if (k.state === 'attack' && !k.attackHit && target.active && gustHits(k, target.position)) {
          k.attackHit = true;
          this.hit('gust', A.gust.damage, A.gust.stun);
        }
        break;
      case 'tail':
        this.fly(dt, target);
        if (k.state === 'attack' && !k.attackHit && target.active) {
          const p = target.position;
          const tp = tailTip(k, tip);
          if (Math.hypot(p.x - tp.x, p.y - tp.y, p.z - tp.z) <= A.tail.hitRadius) {
            k.attackHit = true;
            this.hit('tail', A.tail.damage, 0);
          }
        }
        break;
      case 'dive':
        stepDive(
          k,
          dt,
          target,
          (a, dmg, stun) => {
            this.hit(a, dmg, stun);
          },
          () => {
            this.endAttack();
          },
        );
        return;
    }
    this.advance(t);
  }

  /** 予兆 → 攻撃 → 硬直 → 巡航（時間で） */
  private advance(t: { windup: number; active: number; recover: number }): void {
    const k = this.body;
    const limit = k.state === 'windup' ? t.windup : k.state === 'attack' ? t.active : t.recover;
    if (k.stateTime < limit) return;
    if (k.state === 'windup') k.setState('attack');
    else if (k.state === 'attack') k.setState('recover');
    else this.endAttack();
  }

  private endAttack(): void {
    const k = this.body;
    k.setState('cruise', null);
    k.attackCooldown = (C.attackInterval[k.phase - 1] ?? 7) * k.intervalScale;
  }
}
