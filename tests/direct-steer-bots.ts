// 「方向へ倒す」方式（9-2）のテスト・診断用: 向かいたい点を、この方式のスティックの値（右・上が正、合成の大きさ 1 まで）にする。
// 人は「機首から見て右へ何度・上へ何度」（地平線が基準）を見て倒す。端まで倒すのは DIRECT_STEER_CONFIG.fullDeg 度より外
// リングレースのボットは tests/direct-race-bots.ts（9-8 で分けた）
import { DIRECT_STEER_CONFIG } from '../src/data/steer';
import { LOCAL_FORWARD, LOCAL_UP, type FlightState } from '../src/flight/flight-model';
import { inverseRotateVec3, rotateVec3, type Vec3 } from '../src/flight/math';

const f: Vec3 = { x: 0, y: 0, z: 0 };
const u: Vec3 = { x: 0, y: 0, z: 0 };

function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/** point へ向かうスティックの値を out に書く（後ろなら近い側の端へ倒し切る） */
export function stickToward(
  out: { x: number; y: number },
  state: Readonly<FlightState>,
  point: Readonly<Vec3>,
): { x: number; y: number } {
  const p = state.position;
  rotateVec3(f, state.orientation, LOCAL_FORWARD);
  rotateVec3(u, state.orientation, LOCAL_UP);
  // 方位は DirectSteer と同じ取り方（機首の水平成分 + 機体の上下の向きの水平成分）
  const heading = Math.atan2(f.x - u.x * f.y, -(f.z - u.z * f.y));
  const dx = point.x - p.x;
  const dz = point.z - p.z;
  const ax = wrapPi(Math.atan2(dx, -dz) - heading);
  const ay =
    Math.atan2(point.y - p.y, Math.hypot(dx, dz)) - Math.asin(Math.max(-1, Math.min(1, f.y)));
  const full = (DIRECT_STEER_CONFIG.fullDeg * Math.PI) / 180;
  let x = ax / full;
  let y = ay / full;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  out.x = x;
  out.y = y;
  return out;
}

const LOOP = DIRECT_STEER_CONFIG.loop;
const body: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * 宙返り（9-3）の人の倒し方: 機首が上を向いている（60° より上）か宙返りの途中で、向かう点が機体から見て上（頭の側）に
 * 10° より上・左右のずれが小さいなら、上へ倒し続ける（「上へ倒し続ければ回る」）。宙返りの途中は、向かう点を通る輪の
 * 半径になるよう倒し具合を加減する（端 = 輪の半径 loop.radius、戻すほど大きな輪）。向かう点がはっきり下（-3°）に
 * なったら離す（頂点ならインメルマン）。宙返りの倒し方をしたら true
 */
export function loopStick(
  out: { x: number; y: number },
  state: Readonly<FlightState>,
  point: Readonly<Vec3>,
  looping: boolean,
): boolean {
  rotateVec3(f, state.orientation, LOCAL_FORWARD);
  if (!looping && f.y < Math.sin((60 * Math.PI) / 180)) return false;
  const p = state.position;
  body.x = point.x - p.x;
  body.y = point.y - p.y;
  body.z = point.z - p.z;
  inverseRotateVec3(body, state.orientation, body);
  const up = body.y;
  const ahead = -body.z;
  const pitchTo = Math.atan2(up, ahead);
  const side = Math.atan2(Math.abs(body.x), Math.hypot(up, ahead));
  // 入る前は向かう点が 10° より上、回っている間は 3° より下（はっきり外）になるまで倒し続ける（外れ気味なら大きな輪）
  const below = looping ? -3 : 10;
  if (pitchTo < (below * Math.PI) / 180 || side > (30 * Math.PI) / 180) {
    if (!looping) return false;
    out.x = 0;
    out.y = 0;
    return true;
  }
  out.x = 0;
  if (!looping) {
    out.y = 1;
    return true;
  }
  // 機首の接線で向かう点を通る円の半径 R = (上² + 前²) / (2 上)
  const r = (up * up + ahead * ahead) / (2 * Math.max(1e-3, up));
  const s = Math.min(1, Math.max(0, (LOOP.radius / r - 0.5) / 0.5));
  out.y = LOOP.holdStick + s * (1 - LOOP.holdStick);
  return true;
}
