// 10-6: ボットだけの「近づきすぎない」避け方（ネフィルガ。ヴォルガスのボットは部位の 60m 上を飛ぶのでほぼぶつからない）。ぶつかると最大 HP の約 8 割なので、人は体から離れて撃つ
// （10-4c のアルビオンのボットと同じ考え）。体から見た自機の進み（自機の速度 − 体の速度）を ahead 秒先まで、余裕 pad m を足した
// 体の形で調べ、入りそうなら体から離れる点を返す
import type { Kaiju2Hull, Kaiju2HullBody } from '../src/ai/kaiju-hull/kaiju2-hull';
import type { Vec3 } from '../src/flight/math';

/** 体から離れる点（体の中心から自機への向きへ 800m・進む向きへ 300m。高さは floor より上） */
function away(
  me: Readonly<Vec3>,
  v: Readonly<Vec3>,
  center: Readonly<Vec3>,
  floor: number,
  out: Vec3,
): void {
  let dx = me.x - center.x;
  let dy = me.y - center.y;
  let dz = me.z - center.z;
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l;
  dy /= l;
  dz /= l;
  const sp = Math.hypot(v.x, v.y, v.z) || 1;
  out.x = me.x + dx * 800 + (v.x / sp) * 300;
  out.y = Math.max(floor, me.y + dy * 800 + (v.y / sp) * 300);
  out.z = me.z + dz * 800 + (v.z / sp) * 300;
}

/** ネフィルガ: 入りそうなら out に離れる点を入れて true */
export function kaiju2HullAvoid(
  hull: Kaiju2Hull,
  k: Kaiju2HullBody,
  kv: Readonly<Vec3>,
  me: Readonly<Vec3>,
  v: Readonly<Vec3>,
  ahead: number,
  pad: number,
  floor: number,
  out: Vec3,
): boolean {
  const now: Kaiju2HullBody = {
    position: k.position,
    prevPosition: k.position,
    forward: k.forward,
    prevForward: k.forward,
    bank: k.bank,
    prevBank: k.bank,
    pose: k.pose,
    broken: k.broken,
  };
  const to = {
    x: me.x + (v.x - kv.x) * ahead,
    y: me.y + (v.y - kv.y) * ahead,
    z: me.z + (v.z - kv.z) * ahead,
  };
  if (!hull.contact(now, me, to, pad, 8)) return false;
  away(me, v, k.position, floor, out);
  return true;
}
