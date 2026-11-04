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
  diveHits,
  geometryTo,
  gustHits,
  launchOrbs,
  pickAttack,
  stepOrbs,
  tailTip,
} from './kaiju2-attacks';
import { stepLanding, stepPerched, stepTakeoff } from './kaiju2-perch';
import { updateKaiju2Pose } from '../entities/kaiju2/kaiju2-pose';

const A = C.attacks;
const DEG = Math.PI / 180;

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
    const cands = attackCandidates(geometryTo(k, target.position), k.phase, k.broken, k.history);
    const a = pickAttack(cands, k.random.next);
    if (a === null) {
      k.attackCooldown = 1;
      return;
    }
    k.history.push(a);
    if (k.history.length > 4) k.history.shift();
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
        this.dive(dt, target);
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

  /** 急降下: 上昇（予兆）→ 狙った点へ降下（攻撃）→ 引き起こし（硬直 = 攻める隙） */
  private dive(dt: number, target: Kaiju2Target): void {
    const k = this.body;
    const d = A.dive;
    if (k.state === 'windup') {
      // 上昇: プレイヤーの手前・上の点へ（終わったときにプレイヤーが前の下に来る）
      const tp = target.position;
      const hx = tp.x - k.position.x;
      const hz = tp.z - k.position.z;
      const hl = Math.hypot(hx, hz) || 1;
      want.x = tp.x - (hx / hl) * d.setback - k.position.x;
      want.z = tp.z - (hz / hl) * d.setback - k.position.z;
      const wl = Math.hypot(want.x, want.z) || 1;
      const wantY = Math.min(k.ceiling, tp.y + d.above) - k.position.y;
      want.y = Math.max(-0.2, Math.min(Math.tan(d.climbDeg * DEG), wantY / wl)) * wl;
      k.steer(want, k.turnRate * 1.5 * dt);
      k.approachSpeed(d.climbSpeed, 40, dt);
      k.integrate(dt);
      if (k.stateTime >= d.windup * k.windupScale) {
        const p = target.position;
        const v = target.velocity;
        k.diveTarget.x = p.x + v.x * d.lead;
        k.diveTarget.y = p.y + v.y * d.lead;
        k.diveTarget.z = p.z + v.z * d.lead;
        k.setState('attack');
      }
      return;
    }
    if (k.state === 'attack') {
      const dir = k.directionTo(k.diveTarget);
      // 狙った点を追う（ゆっくり）。予兆の終わりの向きが大きく違っても、始めの 0.6 秒は速く向ける
      const turn = (k.stateTime < d.aimSeconds ? d.aimDegPerSec : d.turnDegPerSec) * DEG * dt;
      want.x = dir.x;
      want.y = dir.y;
      want.z = dir.z;
      k.steer(want, turn, false);
      k.approachSpeed(d.speed, 140, dt);
      k.integrate(dt);
      if (!k.attackHit && target.active && diveHits(k, target.position)) {
        k.attackHit = true;
        this.hit('dive', d.damage, 0);
      }
      const tx = k.diveTarget.x - k.position.x;
      const ty = k.diveTarget.y - k.position.y;
      const tz = k.diveTarget.z - k.position.z;
      const passed =
        k.stateTime > d.aimSeconds && tx * k.forward.x + ty * k.forward.y + tz * k.forward.z < 0;
      const low = k.position.y - k.floorAt(k.position.x, k.position.z) < d.pullUpClearance;
      if (passed || low || k.stateTime >= d.active) k.setState('recover');
      return;
    }
    // 引き起こし: 水平より少し上へ、ゆっくり（腹を見せる）
    const f = k.forward;
    const h = Math.hypot(f.x, f.z) || 1;
    want.x = f.x / h;
    want.y = 0.3;
    want.z = f.z / h;
    k.steer(want, 30 * DEG * dt);
    k.approachSpeed(d.recoverSpeed, 50, dt);
    k.integrate(dt);
    if (k.stateTime < d.recover) return;
    this.endAttack();
    // 9-6b: 隙をつなげる: 急降下で疲れていれば（スタミナが perchAfterDive 未満）そのまま止まり木へ
    if (
      k.stamina < C.perch.stamina * C.perch.perchAfterDive &&
      choosePerch(k, k.random.next, k.perch)
    )
      k.setState('landing', null);
  }
}
