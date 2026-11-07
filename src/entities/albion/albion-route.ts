// 10-3a: 白鯨アルビオンの周回路（Three.js 非依存）: 湾の上空の楕円（直線 2 本と右回りの半円 2 つ）。
// 周回路の上の距離 s（0〜周の長さ）から位置と進む向きを式で決めるので、何周しても位置がずれない（リプレイで同じ）。
// 向きの決まりは src/ai/raid-kit/frame.ts（方位 heading: 前 = (−sin h, 0, −cos h)、右 = (cos h, 0, −sin h)）
export interface AlbionRoute {
  /** 周回路の中心（水平） */
  readonly x: number;
  readonly z: number;
  /** 直線の向き（方位のラジアン。1 本目の直線はこの向きへ進む） */
  readonly axis: number;
  readonly halfLength: number;
  readonly turnRadius: number;
}

export interface RoutePoint {
  x: number;
  z: number;
  /** 進む向き（方位のラジアン） */
  heading: number;
  /** 半円の上か（傾く・回り返しの速さ） */
  turning: boolean;
}

/** 周の長さ */
export function routeLength(r: AlbionRoute): number {
  return 4 * r.halfLength + 2 * Math.PI * r.turnRadius;
}

/** 周回路の上の距離 s の点（s は周の長さで回す） */
export function routePoint(r: AlbionRoute, s: number, out: RoutePoint): RoutePoint {
  const len = routeLength(r);
  let d = s % len;
  if (d < 0) d += len;
  const fx = -Math.sin(r.axis);
  const fz = -Math.cos(r.axis);
  const rx = -fz;
  const rz = fx;
  const L = r.halfLength;
  const R = r.turnRadius;
  const arc = Math.PI * R;
  let px: number;
  let pz: number;
  let tx: number;
  let tz: number;
  out.turning = false;
  if (d < 2 * L) {
    // 1 本目: 左側（−右）を前へ
    const u = d - L;
    px = r.x + fx * u - rx * R;
    pz = r.z + fz * u - rz * R;
    tx = fx;
    tz = fz;
  } else if (d < 2 * L + arc) {
    // 前の端の半円（右回り）: 中心 = 中心 + 前 × L
    const th = (d - 2 * L) / R;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    px = r.x + fx * L + R * (-rx * c + fx * sn);
    pz = r.z + fz * L + R * (-rz * c + fz * sn);
    tx = rx * sn + fx * c;
    tz = rz * sn + fz * c;
    out.turning = true;
  } else if (d < 4 * L + arc) {
    // 2 本目: 右側を後ろへ
    const u = d - (2 * L + arc) - L;
    px = r.x - fx * u + rx * R;
    pz = r.z - fz * u + rz * R;
    tx = -fx;
    tz = -fz;
  } else {
    // 後ろの端の半円: 中心 = 中心 − 前 × L
    const th = (d - (4 * L + arc)) / R;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    px = r.x - fx * L + R * (rx * c - fx * sn);
    pz = r.z - fz * L + R * (rz * c - fz * sn);
    tx = -rx * sn - fx * c;
    tz = -rz * sn - fz * c;
    out.turning = true;
  }
  out.x = px;
  out.z = pz;
  out.heading = Math.atan2(-tx, -tz);
  return out;
}

/** 周回路が中心 (cx, cz) から半径 limit の内側に収まるよう中心を寄せる（体の半分の長さ margin も入れる） */
export function fitRoute(
  r: AlbionRoute,
  cx: number,
  cz: number,
  limit: number,
  margin: number,
): AlbionRoute {
  const reach = r.halfLength + r.turnRadius + margin;
  const room = Math.max(0, limit - reach);
  const dx = r.x - cx;
  const dz = r.z - cz;
  const d = Math.hypot(dx, dz);
  if (d <= room) return r;
  const k = d > 0 ? room / d : 0;
  return { ...r, x: cx + dx * k, z: cz + dz * k };
}

/** 位置 (x, z) に一番近い周回路の上の距離（出すとき。直線の上を粗く探して半円も見る） */
export function nearestOnRoute(r: AlbionRoute, x: number, z: number): number {
  const len = routeLength(r);
  const p: RoutePoint = { x: 0, z: 0, heading: 0, turning: false };
  let best = 0;
  let bestD = Infinity;
  const n = 256;
  for (let i = 0; i < n; i++) {
    const s = (i / n) * len;
    routePoint(r, s, p);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
