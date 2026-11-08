// 9-6a: ネフィルガの形（手続き生成）: 皮膚（胴・首・頭・尾・翼の骨・脚）1 つと、翼の膜（尾の先のひれも）1 つ。
// 頂点の積み方はヴォルガスの KaijuMeshBuilder（管・楕円体・角錐、骨 2 本までの混ぜ）を使う。
// aGlow: 皮膚 0 / 目 1 / 喉の袋 2。膜は 0〜1 の筋の強さ
import { Vector3 } from 'three';
import { KAIJU2_MODEL_CONFIG, type Kaiju2DetailSpec } from '../../data/kaiju2-model';
import {
  KaijuMeshBuilder,
  rgb,
  type BoneBind,
  type Rgb,
  type TubeRing,
} from '../kaiju-model/builder';
import { BONE2, WING_TIP, bone2Position, type Kaiju2BoneName } from './skeleton';

const C = KAIJU2_MODEL_CONFIG.colors;
const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
const one = (n: Kaiju2BoneName): BoneBind => ({ a: BONE2[n] });
const mix = (a: Kaiju2BoneName, b: Kaiju2BoneName, w: number): BoneBind => ({
  a: BONE2[a],
  b: BONE2[b],
  w,
});

/** 点の列を管にする（長さ方向は rings 倍に間引く / 増やす。端の点は残す） */
function tubeAlong(
  b: KaijuMeshBuilder,
  input: readonly { p: Vector3; r: number; ry?: number; bone: BoneBind; color?: Rgb }[],
  d: Kaiju2DetailSpec,
  under: Rgb = rgb(C.belly),
): void {
  const rings: TubeRing[] = [];
  const pts = input;
  const steps = Math.max(1, Math.round(2 * d.rings));
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const c = pts[i + 1];
    if (!a || !c) continue;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const r = a.r + (c.r - a.r) * t;
      const ry = (a.ry ?? a.r) + ((c.ry ?? c.r) - (a.ry ?? a.r)) * t;
      rings.push({
        center: a.p.clone().lerp(c.p, t),
        rx: r,
        ry,
        color: a.color ?? rgb(C.back),
        under,
        bone: t < 0.5 ? a.bone : c.bone,
      });
    }
  }
  const last = pts[pts.length - 1];
  if (last)
    rings.push({
      center: last.p,
      rx: last.r,
      ry: last.ry ?? last.r,
      color: last.color ?? rgb(C.back),
      under,
      bone: last.bone,
    });
  b.tube(rings, d.radial, true, true, true);
}

/** 皮膚: 胴・首・頭（くちばし・とさか・目・喉の袋）・尾・翼の骨・脚。extra は 10-7a の作り込み（高画質だけ） */
export function buildKaiju2Skin(d: Kaiju2DetailSpec, extra = false): KaijuMeshBuilder {
  const b = new KaijuMeshBuilder();
  const cols = Math.max(6, d.radial);
  const rows = Math.max(4, Math.round(d.radial * 0.6));
  // 胴（尾の付け根 → 胸）と首
  tubeAlong(
    b,
    [
      { p: v(0, -1, 26), r: 7, ry: 6, bone: one('tail0') },
      { p: v(0, 0, 10), r: 13, ry: 11, bone: mix('root', 'tail0', 0.3) },
      { p: v(0, 1, -8), r: 16, ry: 13, bone: one('root') },
      { p: v(0, 3, -26), r: 12, ry: 11, bone: mix('root', 'chest', 0.7) },
      { p: v(0, 5, -38), r: 7, bone: mix('chest', 'neck0', 0.6) },
      { p: v(0, 9, -54), r: 5.2, bone: one('neck1') },
      { p: v(0, 11, -64), r: 5, bone: mix('neck1', 'head', 0.7) },
    ],
    d,
  );
  // 頭: 楕円体 + くちばし + 後ろへ伸びるとさか + 目
  const head = one('head');
  b.ellipsoid(v(0, 12, -71), 7, 6, 11, rows, cols, rgb(C.back), head, 0, rgb(C.belly));
  b.spike(v(0, 10, -79), v(0, 7, -94), 4.2, Math.max(4, d.radial >> 1), rgb(C.dark), head);
  b.spike(v(0, 16, -67), v(0, 24, -44), 3.2, 4, rgb(C.horn), head);
  for (const s of [-1, 1])
    b.ellipsoid(v(5.4 * s, 13.5, -75), 1.6, 1.4, 2, 3, 6, rgb(C.eye), head, 1);
  // 喉の袋（雷球の予兆で光る）
  b.ellipsoid(v(0, 3, -50), 4.5, 4.5, 9, rows, cols, rgb(C.storm, 0.6), one('neck0'), 2);
  // 尾（先へ細く）
  tubeAlong(
    b,
    [
      { p: v(0, -1, 24), r: 6, bone: one('tail0') },
      { p: bone2Position('tail1'), r: 4.4, bone: one('tail1') },
      { p: bone2Position('tail2'), r: 3.2, bone: one('tail2') },
      { p: bone2Position('tail3'), r: 2.3, bone: one('tail3') },
      { p: v(0, -2, 84), r: 1.2, bone: one('tail4') },
    ],
    d,
  );
  // 翼の骨（肩 → 肘 → 手首 → 指の先）と、手首の爪
  for (const side of [-1, 1] as const) {
    const n = side < 0 ? 'L' : 'R';
    tubeAlong(
      b,
      [
        { p: v(8 * side, 5, -20), r: 6, bone: one('chest') },
        { p: bone2Position(`wing${n}0`), r: 5.5, bone: one(`wing${n}0`) },
        { p: bone2Position(`wing${n}1`), r: 4, bone: mix(`wing${n}0`, `wing${n}1`, 0.6) },
        { p: bone2Position(`wing${n}2`), r: 3, bone: mix(`wing${n}1`, `wing${n}2`, 0.6) },
        { p: v(WING_TIP.x * side, WING_TIP.y, WING_TIP.z), r: 1, bone: one(`wing${n}2`) },
      ],
      d,
      rgb(C.dark),
    );
    const w = bone2Position(`wing${n}2`);
    b.spike(w, v(w.x + 3 * side, w.y + 2, w.z - 12), 2, 4, rgb(C.horn), one(`wing${n}2`));
    // 脚（たたんで後ろへ）と爪
    const leg = one(`leg${n}`);
    const hip = bone2Position(`leg${n}`);
    tubeAlong(
      b,
      [
        { p: hip, r: 4, bone: leg },
        { p: v(hip.x, hip.y - 10, hip.z + 4), r: 2.6, bone: leg },
        { p: v(hip.x, hip.y - 18, hip.z + 6), r: 1.8, bone: leg },
      ],
      d,
    );
    b.spike(v(hip.x, hip.y - 18, hip.z + 6), v(hip.x, hip.y - 22, hip.z), 1.6, 4, rgb(C.dark), leg);
  }
  if (extra) addKaiju2Spikes(b);
  return b;
}

/**
 * 10-7a: 輪郭のとがり（高画質だけ）: 頭の両脇から後ろへ反る角 2 本、首と背の筋のとげ、尾のとげ、翼の肘と指の先の爪。
 * 1 本 4〜5 面の角錐（三角形は 1 本 4〜5）
 */
function addKaiju2Spikes(b: KaijuMeshBuilder): void {
  const head = one('head');
  const horn = rgb(C.horn);
  for (const s of [-1, 1]) {
    b.spike(v(4.5 * s, 16, -70), v(11 * s, 22, -52), 2.2, 5, horn, head);
    b.spike(v(5.5 * s, 13, -66), v(9 * s, 15, -56), 1.3, 4, horn, head);
  }
  // 首の筋（後ろへ寝る）
  const neck: readonly [number, number, number, Kaiju2BoneName][] = [
    [6.5, -58, 2.2, 'neck1'],
    [5.6, -50, 2.4, 'neck1'],
    [4.4, -42, 2.6, 'neck0'],
  ];
  for (const [y, z, r, bone] of neck)
    b.spike(v(0, y + 3, z), v(0, y + 9, z + 7), r, 4, horn, one(bone));
  // 背の筋（胸 → 尾の付け根）
  for (let i = 0; i < 6; i++) {
    const z = -30 + i * 9;
    const y = 13 - Math.abs(z + 6) * 0.08;
    const bone = z < -14 ? mix('root', 'chest', 0.7) : z < 16 ? one('root') : one('tail0');
    b.spike(v(0, y - 1, z), v(0, y + 6 - i * 0.4, z + 6), 2.8 - i * 0.2, 4, horn, bone);
  }
  // 尾のとげ（先へ小さく）
  const tails: readonly Kaiju2BoneName[] = ['tail1', 'tail2', 'tail3'];
  tails.forEach((t, i) => {
    const p = bone2Position(t);
    b.spike(
      v(0, p.y + 3.2 - i, p.z - 2),
      v(0, p.y + 7 - i * 1.4, p.z + 5),
      1.8 - i * 0.4,
      4,
      horn,
      one(t),
    );
  });
  // 翼の肘の爪と指の先の爪
  for (const side of [-1, 1] as const) {
    const n = side < 0 ? 'L' : 'R';
    const e = bone2Position(`wing${n}1`);
    b.spike(
      v(e.x, e.y + 2, e.z),
      v(e.x + 2 * side, e.y + 5, e.z - 9),
      2,
      4,
      horn,
      one(`wing${n}1`),
    );
    const tip = v(WING_TIP.x * side, WING_TIP.y, WING_TIP.z);
    b.spike(tip, v(tip.x + 7 * side, tip.y + 1, tip.z + 6), 1.2, 4, horn, one(`wing${n}2`));
  }
}

/**
 * 翼の膜（両翼）と尾の先のひれ。前縁は翼の骨（肩 → 肘 → 手首 → 指の先）、後縁は胴の脇から指の先へ、
 * 指の間でえぐれた曲線（シルエットの「ぎざぎざの後縁」）。筋（aGlow）は付け根から先へ放射状に
 */
export function buildKaiju2Membrane(d: Kaiju2DetailSpec): {
  builder: KaijuMeshBuilder;
  uv: number[];
} {
  const b = new KaijuMeshBuilder();
  // 10-7a: 膜の絵の座標（横 = 付け根 → 先、縦 = 前縁 → 後縁）。頂点を足した順に並べる
  const uv: number[] = [];
  const nu = d.membraneSpan;
  const nv = d.membraneChord;
  for (const side of [-1, 1] as const) {
    const n = side < 0 ? 'L' : 'R';
    const lead = [
      v(10 * side, 5, -20),
      bone2Position(`wing${n}0`),
      bone2Position(`wing${n}1`),
      bone2Position(`wing${n}2`),
      v(WING_TIP.x * side, WING_TIP.y, WING_TIP.z),
    ];
    const grid: number[][] = [];
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const L = alongPolyline(lead, u);
      // 後縁: 胴の脇（腰）→ 指の先。3 か所でえぐる（指の間）
      const T = v(8 * side, -1, 22).lerp(v(WING_TIP.x * side, WING_TIP.y - 1, WING_TIP.z + 2), u);
      const scallop = Math.abs(Math.sin(u * Math.PI * 3)) * 16 * (1 - u * 0.4);
      T.z -= scallop;
      const bone = membraneBone(n, u);
      const row: number[] = [];
      for (let j = 0; j <= nv; j++) {
        const t = j / nv;
        const p = L.clone().lerp(T, t);
        // 膜は少したるむ（下へ）
        p.y -= Math.sin(t * Math.PI) * 3 * (1 - u * 0.5);
        const vein = Math.max(0, Math.cos(u * Math.PI * 9)) ** 6 * (0.4 + 0.6 * t);
        const color = rgb(t > 0.85 ? C.membraneEdge : C.membrane);
        // 後縁側は胴の骨へ少し寄せる（付け根の膜が胴について来る）
        const bb: BoneBind = u < 0.15 && t > 0.5 ? mix('root', `wing${n}0`, u / 0.15) : bone;
        row.push(b.vertex(p, UP, color, bb, vein));
        uv.push(u, t);
      }
      grid.push(row);
    }
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < nv; j++) {
        const a = grid[i]?.[j];
        const c = grid[i + 1]?.[j];
        const e = grid[i]?.[j + 1];
        const f = grid[i + 1]?.[j + 1];
        if (a === undefined || c === undefined || e === undefined || f === undefined) continue;
        // 上を向く面にそろえる（左右で巻きを逆に）
        if (side > 0) {
          b.triangle(a, e, c);
          b.triangle(c, e, f);
        } else {
          b.triangle(a, c, e);
          b.triangle(c, f, e);
        }
      }
  }
  // 尾の先のひれ（菱形。縦の舵）
  const fin = one('tail4');
  const p0 = b.vertex(v(0, -2, 74), SIDE, rgb(C.membrane), fin, 0.3);
  const p1 = b.vertex(v(0, 6, 82), SIDE, rgb(C.membrane), fin, 0.6);
  const p2 = b.vertex(v(0, -2, 92), SIDE, rgb(C.membraneEdge), fin, 0.3);
  const p3 = b.vertex(v(0, -10, 82), SIDE, rgb(C.membrane), fin, 0.6);
  uv.push(0.2, 0.1, 0.5, 0.5, 0.2, 0.9, 0.05, 0.5);
  b.triangle(p0, p1, p2);
  b.triangle(p0, p2, p3);
  return { builder: b, uv };
}

const UP = v(0, 1, 0);
const SIDE = v(1, 0, 0);

/** 折れ線の上の割合 u（0〜1。区間の長さで配分）の点 */
function alongPolyline(pts: readonly Vector3[], u: number): Vector3 {
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const c = pts[i + 1];
    const l = a && c ? a.distanceTo(c) : 0;
    lens.push(l);
    total += l;
  }
  let s = u * total;
  for (let i = 0; i < lens.length; i++) {
    const l = lens[i] ?? 0;
    const a = pts[i];
    const c = pts[i + 1];
    if (!a || !c) continue;
    if (s <= l || i === lens.length - 1) return a.clone().lerp(c, l > 0 ? Math.min(1, s / l) : 0);
    s -= l;
  }
  return pts[pts.length - 1]?.clone() ?? v(0, 0, 0);
}

/** 膜の付け根からの割合 u で、どの骨について行くか（2 本の混ぜ） */
function membraneBone(n: 'L' | 'R', u: number): BoneBind {
  if (u < 0.12) return mix('chest', `wing${n}0`, u / 0.12);
  if (u < 0.42) return mix(`wing${n}0`, `wing${n}1`, Math.max(0, (u - 0.3) / 0.12));
  if (u < 0.62) return mix(`wing${n}1`, `wing${n}2`, Math.max(0, (u - 0.5) / 0.12));
  return one(`wing${n}2`);
}
