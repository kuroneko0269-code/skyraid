// 9-6a: ネフィルガの止まり木（攻める隙）: 陸の高い所へ降りる → 羽を休める（動かない・攻撃しない）→ 飛び立つ。
// 場所の選び方は kaiju2-attacks.ts の choosePerch。Three.js 非依存。
// 9-6d: 降り方を作り直した（上空から一瞬で移らない）: 近づく → 旋回しながら降りる → 羽ばたいて寄せる → 着地。
// 飛び立ちも羽ばたいて真上へ上がってから前へ。経路は決まった計算（種によらない）で、位置はすべて integrate で進める
import { KAIJU2_CONFIG as C } from '../data/kaiju2';
import { choosePerch } from './kaiju2-attacks';
import { vec3, type Vec3 } from '../flight/math';
import type { SkyKaiju } from '../entities/kaiju2/sky-kaiju';

const DEG = Math.PI / 180;
const want = vec3();
const goal = vec3();

const smooth = (u: number): number => u * u * (3 - 2 * u);

/** 今の位置から goal へ、この 1 ステップで動く（向きと速さを差から決めて integrate で進める。床・天井の制約はそのまま） */
function moveTo(k: SkyKaiju, to: Readonly<Vec3>, dt: number, minClear: number): void {
  const dx = to.x - k.position.x;
  const dy = to.y - k.position.y;
  const dz = to.z - k.position.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > 1e-3) {
    k.forward.x = dx / d;
    k.forward.y = dy / d;
    k.forward.z = dz / d;
  }
  k.speed = d / dt;
  k.integrate(dt, minClear);
}

/** 止まり木へ降りる: 近づく → 旋回しながら降りる → 羽ばたいて寄せる → 着地 */
export function stepLanding(k: SkyKaiju, dt: number): void {
  const p = C.perch;
  if (k.stateTime <= 0) {
    k.landStage = 0;
    k.landTime = 0;
    k.perchPending = false;
  }
  k.landTime += dt;
  const dx = k.position.x - k.perch.x;
  const dz = k.position.z - k.perch.z;
  const hd = Math.hypot(dx, dz);
  if (k.landStage === 0) {
    // 近づく: 止まり木の周り（approachRadius）の今の側の点へ、巡航の速さで。下がる速さは approachDescent まで
    const l = hd || 1;
    const top = k.perch.y + p.approachAbove;
    want.x = k.perch.x + (dx / l) * p.approachRadius - k.position.x;
    want.z = k.perch.z + (dz / l) * p.approachRadius - k.position.z;
    const wl = Math.hypot(want.x, want.z) || 1;
    const dy = Math.max(-p.approachDescent, Math.min(20, top - k.position.y));
    want.y = (dy / Math.max(1, k.speed)) * wl;
    k.steer(want, k.turnRate * 1.4 * dt);
    k.approachSpeed(k.cruiseSpeed, 30, dt);
    k.integrate(dt);
    if (hd <= p.approachRadius + 80 || (k.landTime >= p.approachSeconds && hd <= 700))
      beginSpiral(k);
    else if (k.landTime > 60) {
      // 降りられない（届かない）: あきらめて巡航
      k.stamina = p.stamina * 0.5;
      k.setState('cruise', null);
    }
    return;
  }
  if (k.landStage === 1) {
    // 旋回しながら降りる: 角度は速さ / 半径で進め、半径と高さと速さを秒数で縮める
    const u = Math.min(1, k.landTime / k.landSeconds);
    const e = smooth(u);
    const r = k.landR0 + (p.spiralEndRadius - k.landR0) * e;
    const v = k.landV0 + (p.spiralEndSpeed - k.landV0) * u;
    k.landAngle += (k.landSign * v * dt) / Math.max(1, r);
    goal.x = k.perch.x + Math.cos(k.landAngle) * r;
    goal.z = k.perch.z + Math.sin(k.landAngle) * r;
    goal.y = k.landH0 + (k.perch.y + p.spiralEndAbove - k.landH0) * e;
    moveTo(k, goal, dt, C.bodyClearance);
    if (u >= 1) {
      k.landStage = 2;
      k.landTime = 0;
      k.landFrom.x = k.position.x;
      k.landFrom.y = k.position.y;
      k.landFrom.z = k.position.z;
    }
    return;
  }
  // 羽ばたいて寄せる: 水平は減速しながら（終わりで 0）、高さは後半で下ろす
  const u = Math.min(1, k.landTime / p.flareSeconds);
  const h = 1 - (1 - u) * (1 - u);
  goal.x = k.landFrom.x + (k.perch.x - k.landFrom.x) * h;
  goal.z = k.landFrom.z + (k.perch.z - k.landFrom.z) * h;
  goal.y = k.landFrom.y + (k.perch.y - k.landFrom.y) * smooth(u);
  const f = k.forward;
  const fx = f.x;
  const fz = f.z;
  moveTo(k, goal, dt, p.standHeight);
  // 寄せる間は体を水平に保ち、止まり木の向きに（真上に来たら前の向きのまま）
  const hx = k.perch.x - k.position.x;
  const hz = k.perch.z - k.position.z;
  const hl = Math.hypot(hx, hz);
  const tx = hl > 5 ? hx / hl : fx;
  const tz = hl > 5 ? hz / hl : fz;
  const tl = Math.hypot(tx, tz) || 1;
  f.x = tx / tl;
  f.y = 0;
  f.z = tz / tl;
  if (u >= 1) {
    k.position.x = k.perch.x;
    k.position.z = k.perch.z;
    k.position.y = k.floorAt(k.perch.x, k.perch.z) + p.standHeight;
    k.speed = 0;
    k.setState('perched', null);
  }
}

/** 近づき終わった（または打ち切り）: 今の位置から旋回しながら降りる。回る向きは今の向きに近い方 */
function beginSpiral(k: SkyKaiju): void {
  const p = C.perch;
  const dx = k.position.x - k.perch.x;
  const dz = k.position.z - k.perch.z;
  const r0 = Math.max(1, Math.hypot(dx, dz));
  k.landStage = 1;
  k.landTime = 0;
  k.landAngle = Math.atan2(dz, dx);
  // 接線（角度が増える向き）は (−sin, cos)。今の向きとの内積で回る向きを決める
  const tx = -dz / r0;
  const tz = dx / r0;
  k.landSign = k.forward.x * tx + k.forward.z * tz >= 0 ? 1 : -1;
  k.landR0 = r0;
  k.landH0 = k.position.y;
  k.landV0 = Math.max(p.spiralEndSpeed, k.speed);
  const drop = Math.max(0, k.landH0 - (k.perch.y + p.spiralEndAbove));
  const [lo = 5, hi = 11] = p.spiralSeconds;
  // 半径を縮める速さも 45 m/s までにする（遠くから始めても速くなりすぎない）
  k.landSeconds = Math.max(lo, Math.min(hi, drop / p.spiralDescent), (r0 - p.spiralEndRadius) / 45);
}

/** 羽を休める（動かない。攻撃しない）。終わったら飛び立つ */
export function stepPerched(k: SkyKaiju, dt: number): void {
  k.speed = 0;
  k.integrate(dt, C.perch.standHeight);
  if (k.stateTime >= (C.perch.restSeconds[k.phase - 1] ?? 8)) k.setState('takeoff', null);
}

/**
 * 飛び立つ: 始めの liftSeconds は羽ばたいてほぼ真上へ、その後は前へ 30° で上がる。終わったら巡航（スタミナは満タン）
 */
export function stepTakeoff(k: SkyKaiju, dt: number): void {
  const p = C.perch;
  const f = k.forward;
  const h = Math.hypot(f.x, f.z) || 1;
  if (k.stateTime < p.liftSeconds) {
    // 真上へ: 向きは水平のまま、上がる速さを liftSpeed へ（前へは少しだけ）
    const u = k.stateTime / p.liftSeconds;
    const up = p.liftSpeed * Math.min(1, u * 1.5);
    const ahead = 4 + 10 * u;
    f.x /= h;
    f.y = 0;
    f.z /= h;
    k.position.y += up * dt;
    k.speed = ahead;
    k.integrate(dt, C.perch.standHeight);
    return;
  }
  want.x = f.x / h;
  want.y = 0.6;
  want.z = f.z / h;
  k.steer(want, 40 * DEG * dt, false);
  k.approachSpeed(k.cruiseSpeed, 35, dt);
  k.integrate(dt, C.perch.standHeight);
  const agl = k.position.y - k.floorAt(k.position.x, k.position.z);
  // 巡航の高さの下限（bodyClearance）を越えてから巡航へ（越えられなければ 3 倍の時間で）
  if (
    k.stateTime >= p.takeoffSeconds &&
    (agl >= C.bodyClearance || k.stateTime >= p.takeoffSeconds * 3)
  ) {
    k.position.y = Math.max(k.position.y, k.floorAt(k.position.x, k.position.z) + C.bodyClearance);
    k.stamina = p.stamina;
    k.attackCooldown = (C.attackInterval[k.phase - 1] ?? 7) * k.intervalScale;
    k.setState('cruise', null);
  }
}

/**
 * 9-6d: スタミナが尽きたら止まり木を選び（遠い間は巡航のまま周回の中心を寄せる: kaiju2-ai.ts の fly）、pendingRange まで
 * 近づいたら降り始める。降り始めたら true
 */
export function stepPerchPending(k: SkyKaiju): boolean {
  const p = C.perch;
  if (k.stamina <= 0 && !k.perchPending) {
    if (choosePerch(k, k.random.next, k.perch)) k.perchPending = true;
    else k.stamina = p.stamina * 0.5;
  }
  if (
    k.perchPending &&
    Math.hypot(k.perch.x - k.position.x, k.perch.z - k.position.z) <= p.pendingRange
  ) {
    k.perchPending = false;
    k.setState('landing', null);
    return true;
  }
  return false;
}

/** 9-6b: すぐ止まり木へ（両方の翼が壊れて落ちる）。降りられる場所が無ければ false */
export function forcePerch(k: SkyKaiju): boolean {
  if (k.state === 'landing' || k.state === 'perched') return true;
  if (!choosePerch(k, k.random.next, k.perch)) return false;
  for (const o of k.orbs) o.active = false;
  k.setState('landing', null);
  return true;
}
