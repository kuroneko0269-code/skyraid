// 9-6a: ネフィルガの止まり木（攻める隙）: 陸の高い所へ降りる → 羽を休める（動かない・攻撃しない）→ 飛び立つ。
// 場所の選び方は kaiju2-attacks.ts の choosePerch。Three.js 非依存
import { KAIJU2_CONFIG as C } from '../data/kaiju2';
import { choosePerch } from './kaiju2-attacks';
import { vec3 } from '../flight/math';
import type { SkyKaiju } from '../entities/kaiju2/sky-kaiju';

const DEG = Math.PI / 180;
const want = vec3();

/** 止まり木へ降りる: 真上の高さを保って近づき、近くなったら下りる */
export function stepLanding(k: SkyKaiju, dt: number): void {
  const p = C.perch;
  const dx = k.perch.x - k.position.x;
  const dz = k.perch.z - k.position.z;
  const hd = Math.hypot(dx, dz);
  const near = hd < 350;
  const ty = near ? k.perch.y : Math.max(k.position.y, k.perch.y + 200);
  want.x = dx;
  want.y = (ty - k.position.y) * (near ? 1.2 : 0.5);
  want.z = dz;
  k.steer(want, k.turnRate * 1.6 * dt, !near);
  k.approachSpeed(near ? p.landingSpeed * 0.6 : p.landingSpeed * 1.6, 30, dt);
  k.integrate(dt, near ? p.standHeight : C.bodyClearance);
  const dist = Math.hypot(dx, k.perch.y - k.position.y, dz);
  if (dist < 25 || (near && k.stateTime > 25)) {
    k.position.x = k.perch.x;
    k.position.z = k.perch.z;
    k.position.y = k.floorAt(k.perch.x, k.perch.z) + p.standHeight;
    k.speed = 0;
    const h = Math.hypot(k.forward.x, k.forward.z) || 1;
    k.forward.x /= h;
    k.forward.y = 0;
    k.forward.z /= h;
    k.setState('perched', null);
  } else if (k.stateTime > 60) {
    // 降りられない（届かない）: あきらめて巡航
    k.stamina = p.stamina * 0.5;
    k.setState('cruise', null);
  }
}

/** 羽を休める（動かない。攻撃しない）。終わったら飛び立つ */
export function stepPerched(k: SkyKaiju, dt: number): void {
  k.speed = 0;
  k.integrate(dt, C.perch.standHeight);
  if (k.stateTime >= (C.perch.restSeconds[k.phase - 1] ?? 8)) k.setState('takeoff', null);
}

/** 飛び立つ: 前へ 30° で上がる。終わったら巡航（スタミナは満タン） */
export function stepTakeoff(k: SkyKaiju, dt: number): void {
  const f = k.forward;
  const h = Math.hypot(f.x, f.z) || 1;
  want.x = f.x / h;
  want.y = 0.6;
  want.z = f.z / h;
  k.steer(want, 40 * DEG * dt, false);
  k.approachSpeed(k.cruiseSpeed, 35, dt);
  k.integrate(dt, C.perch.standHeight);
  const agl = k.position.y - k.floorAt(k.position.x, k.position.z);
  // 巡航の高さの下限（bodyClearance）を越えてから巡航へ（越えられなければ 3 倍の時間で）
  if (
    k.stateTime >= C.perch.takeoffSeconds &&
    (agl >= C.bodyClearance || k.stateTime >= C.perch.takeoffSeconds * 3)
  ) {
    k.position.y = Math.max(k.position.y, k.floorAt(k.position.x, k.position.z) + C.bodyClearance);
    k.stamina = C.perch.stamina;
    k.attackCooldown = C.attackInterval[k.phase - 1] ?? 7;
    k.setState('cruise', null);
  }
}

/** 9-6b: すぐ止まり木へ（両方の翼が壊れて落ちる）。降りられる場所が無ければ false */
export function forcePerch(k: SkyKaiju): boolean {
  if (k.state === 'landing' || k.state === 'perched') return true;
  if (!choosePerch(k, k.random.next, k.perch)) return false;
  for (const o of k.orbs) o.active = false;
  k.setState('landing', null);
  return true;
}
