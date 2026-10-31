// 怪獣の部位のジオメトリ（6-1）: 胴・頭・腕・脚・尾・結晶。どれも静止姿勢（足元が原点・前方 -Z）で作り、
// 骨（skeleton.ts）に貼り付ける。前傾姿勢で頭が低く、目は 4 つ（左右 2 つずつ）、長い尾。
// 6-1b: 背中の一列の棘をやめ、結晶は肩・首の付け根・前腕の外側の不規則な塊（crystal-shape.ts）。
// 胴と脚の断面に筋肉の起伏（Bulge）、目を大きく、前腕を長く
import { Vector3 } from 'three';
import { KAIJU_MODEL_CONFIG, type KaijuDetailSpec } from '../../data/kaiju-model';
import { createRandom } from '../../core/random';
import {
  KaijuMeshBuilder,
  rgb,
  type BoneBind,
  type Bulge,
  type Rgb,
  type TubeRing,
} from './builder';
import { addCrystal } from './crystal-shape';
import { BONE, bonePosition } from './skeleton';

const C = KAIJU_MODEL_CONFIG.colors;
const BACK = rgb(C.back);
const BELLY = rgb(C.belly);
const CLAW = rgb(C.claw);
const EYE = rgb(C.eye);
const CRYSTAL = rgb(C.crystal);

const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
const MUSCLE = KAIJU_MODEL_CONFIG.muscle;

/** 筋肉の起伏（6-1b）: 位置 t で山の数・位相を少しずつ変え、隣どうしの起伏がつながって筋に見えるように */
function muscles(t: number, seed: number, scale = 1): Bulge[] {
  const a = MUSCLE * scale;
  return [
    { k: 3, amp: a * (0.7 + 0.3 * Math.sin(t * 9 + seed)), phase: seed + t * 1.3 },
    { k: 5, amp: a * 0.55 * (0.6 + 0.4 * Math.sin(t * 13 + seed * 2)), phase: seed * 1.7 - t * 2 },
    { k: 8, amp: a * 0.25, phase: seed * 0.3 + t * 4 },
  ];
}

/** 長さ方向の分割数（最低 3） */
function count(base: number, d: KaijuDetailSpec): number {
  return Math.max(3, Math.round(base * d.rings));
}

/** 2 本の骨の間を t（0〜1）で混ぜる */
function blend(a: number, b: number, t: number): BoneBind {
  return { a, b, w: Math.min(1, Math.max(0, t)) };
}

/** 中心の曲線（制御点を折れ線で）を n 等分した点 */
function along(points: readonly Vector3[], t: number): Vector3 {
  const seg = points.length - 1;
  const x = Math.min(seg - 1e-6, Math.max(0, t * seg));
  const i = Math.floor(x);
  const f = x - i;
  const a = points[i] ?? points[0] ?? v(0, 0, 0);
  const b = points[i + 1] ?? a;
  return a.clone().lerp(b, f);
}

/** 胴: 尾の付け根 → 骨盤 → 胸 → 首。前傾した太い胴（腹は少し明るい） */
export function buildTorso(d: KaijuDetailSpec): KaijuMeshBuilder {
  const m = new KaijuMeshBuilder();
  const path = [v(0, 52, 30), v(0, 60, 10), v(0, 78, -14), v(0, 90, -32), v(0, 95, -46)];
  // 骨盤 → 胸 → 首の骨の割り当て（t で混ぜる）
  const n = count(22, d);
  const rings: TubeRing[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = along(path, t);
    // 太さ: 骨盤で最大、首へ細く
    const girth = Math.sin(Math.PI * Math.min(1, 0.25 + t * 0.9));
    const rx = 12 + 16 * girth - 9 * Math.max(0, t - 0.75) * 4;
    const ry = 13 + 15 * girth - 8 * Math.max(0, t - 0.75) * 4;
    const bone =
      t < 0.45
        ? blend(BONE.pelvis, BONE.chest, (t - 0.25) / 0.2)
        : blend(BONE.chest, BONE.neck, (t - 0.75) / 0.25);
    rings.push({
      center: c,
      rx: Math.max(7, rx),
      ry: Math.max(7, ry),
      color: BACK,
      under: BELLY,
      bone,
      bulge: muscles(t, 0.4, 1 - (0.6 * Math.max(0, t - 0.7)) / 0.3),
    });
  }
  m.tube(rings, d.radial, true, false);
  return m;
}

/** 頭: 低く前へ突き出した爬虫類の頭骨、下あご、4 つの目、眉の角、牙 */
export function buildHead(d: KaijuDetailSpec): KaijuMeshBuilder {
  const m = new KaijuMeshBuilder();
  const head = { a: BONE.head };
  const jaw = { a: BONE.jaw };
  const rows = Math.max(6, Math.round(d.radial * 0.55));
  const cols = d.radial;
  // 頭骨（後頭部）と鼻先
  m.ellipsoid(v(0, 99, -56), 12, 9, 13, rows, cols, BACK, head, 0, BELLY);
  m.ellipsoid(v(0, 97, -70), 8, 6, 11, rows, cols, BACK, head);
  // 下あご
  m.ellipsoid(v(0, 91, -64), 8.5, 3.5, 14, Math.max(4, rows - 2), cols, BELLY, jaw);
  // 目は左右 2 つずつ（上下に並ぶ）。発光。6-1b: 頭骨の表面から出るよう外へ寄せて大きく（半径 1.6 → 2.7m）
  const eyeRows = Math.max(3, Math.round(rows / 2));
  for (const sx of [-1, 1]) {
    // 目の上の張り出し（影で目が光って見える）
    m.ellipsoid(v(sx * 9.6, 104.2, -61), 4.2, 1.6, 5.2, eyeRows, eyeRows * 2, BACK, head);
    m.ellipsoid(v(sx * 10.4, 101.4, -63), 2.7, 1.9, 3.1, eyeRows, eyeRows * 2, EYE, head, 1);
    m.ellipsoid(v(sx * 11.0, 97.6, -60.5), 2.2, 1.5, 2.6, eyeRows, eyeRows * 2, EYE, head, 1);
    // 眉の角（後ろ上へ）
    m.spike(v(sx * 7, 104, -58), v(sx * 11, 110, -44), 2.4, 4, CLAW, head);
    m.spike(v(sx * 5, 106, -52), v(sx * 7, 113, -38), 2.0, 4, CLAW, head);
    // 牙
    for (let i = 0; i < 3; i++) {
      m.spike(
        v(sx * (5.5 - i * 0.6), 93.5, -74 + i * 4),
        v(sx * (5.2 - i * 0.6), 90.5, -74 + i * 4),
        0.8,
        3,
        CLAW,
        head,
      );
    }
  }
  return m;
}

/** 腕（左右）: 上腕・前腕と 3 本の爪。歩くための腕ではないので短め（6-1b で前腕を約 1.4 倍） */
export function buildArms(d: KaijuDetailSpec): KaijuMeshBuilder {
  const m = new KaijuMeshBuilder();
  const radial = Math.max(8, Math.round(d.radial * 0.6));
  for (const [sx, up, fore] of [
    [-1, BONE.armLUpper, BONE.armLFore],
    [1, BONE.armRUpper, BONE.armRFore],
  ] as const) {
    const sh = bonePosition(sx < 0 ? 'armLUpper' : 'armRUpper');
    const el = bonePosition(sx < 0 ? 'armLFore' : 'armRFore');
    const hand = el.clone().add(v(sx * 3, -20, -17));
    const n = count(8, d);
    const rings: TubeRing[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const c = t < 0.5 ? sh.clone().lerp(el, t * 2) : el.clone().lerp(hand, (t - 0.5) * 2);
      const r = 6 - 2.4 * t;
      const bone = blend(up, fore, (t - 0.42) / 0.16);
      rings.push({
        center: c,
        rx: r,
        ry: r * 1.1,
        color: BACK,
        under: BELLY,
        bone,
        bulge: muscles(t, sx, 0.8),
      });
    }
    m.tube(rings, radial);
    // 爪 3 本（太い 2 節。手の甲から前下へ曲がる）
    for (let k = -1; k <= 1; k++) {
      const root = hand.clone().add(v(k * 2.6, -1, -1));
      const mid = root.clone().add(v(k * 1.6, -4.5, -4));
      m.spike(root, mid, 1.9, 5, CLAW, { a: fore });
      m.spike(mid.clone().add(v(0, 0.6, 0.6)), mid.clone().add(v(k * 0.6, -6, -2)), 1.3, 5, CLAW, {
        a: fore,
      });
    }
  }
  return m;
}

/** 脚（左右）: 太い太腿・すね・足と前向きの爪 3 本 */
export function buildLegs(d: KaijuDetailSpec): KaijuMeshBuilder {
  const m = new KaijuMeshBuilder();
  for (const left of [true, false]) {
    const sx = left ? -1 : 1;
    const hip = bonePosition(left ? 'thighL' : 'thighR');
    const knee = bonePosition(left ? 'shinL' : 'shinR');
    const ankle = bonePosition(left ? 'footL' : 'footR');
    const thigh = left ? BONE.thighL : BONE.thighR;
    const shin = left ? BONE.shinL : BONE.shinR;
    const foot = left ? BONE.footL : BONE.footR;
    const n = count(14, d);
    const rings: TubeRing[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // 膝が少し前に出た逆くの字（太腿は太く、すねは細く）
      const c = t < 0.5 ? hip.clone().lerp(knee, t * 2) : knee.clone().lerp(ankle, (t - 0.5) * 2);
      c.x += sx * 3 * Math.sin(Math.PI * t);
      const r = t < 0.5 ? 15 - 6 * t : 11.5 - 5 * (t - 0.5);
      const bone =
        t < 0.5 ? blend(thigh, shin, (t - 0.42) / 0.16) : blend(shin, foot, (t - 0.9) / 0.1);
      rings.push({
        center: c,
        rx: r,
        ry: r,
        color: BACK,
        under: BELLY,
        bone,
        bulge: muscles(t, left ? 1.1 : 2.3, t < 0.5 ? 1.2 : 0.8),
      });
    }
    m.tube(rings, d.radial, true, false);
    // 足: 平たい楕円体と爪
    m.ellipsoid(
      ankle.clone().add(v(0, -2, -6)),
      10,
      5,
      15,
      Math.max(4, Math.round(d.radial / 3)),
      d.radial,
      BACK,
      { a: foot },
      0,
      BELLY,
    );
    for (let k = -1; k <= 1; k++) {
      const base = ankle.clone().add(v(k * 5.5, -3, -18));
      m.spike(base, base.clone().add(v(k * 1.5, -2.5, -8)), 2.2, 4, CLAW, { a: foot });
    }
  }
  return m;
}

/** 尾: 骨盤の後ろから長く伸び、先は地面近くまで垂れる */
export function buildTail(d: KaijuDetailSpec): KaijuMeshBuilder {
  const m = new KaijuMeshBuilder();
  const bones = [BONE.tail0, BONE.tail1, BONE.tail2, BONE.tail3, BONE.tail4];
  const pts = (['tail0', 'tail1', 'tail2', 'tail3', 'tail4'] as const).map((n) => bonePosition(n));
  pts.push(v(0, 8, 162));
  const n = count(30, d);
  const rings: TubeRing[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = along(pts, t);
    const r = 17 * (1 - t) ** 1.1 + 1.2;
    const x = t * 5;
    const k = Math.min(4, Math.floor(x));
    const bone = k >= 4 ? { a: bones[4] ?? 0 } : blend(bones[k] ?? 0, bones[k + 1] ?? 0, x - k);
    rings.push({ center: c, rx: r, ry: r * 1.15, color: BACK, under: BELLY, bone });
  }
  m.tube(rings, d.radial, false, true);
  return m;
}

/** 結晶の塊 1 つ: 中心・伸びる向き・大きさ・本数（「高」）・骨 */
interface CrystalCluster {
  readonly at: readonly [number, number, number];
  readonly dir: readonly [number, number, number];
  readonly size: number;
  readonly count: number;
  readonly bone: BoneBind;
}

/**
 * 結晶の塊の配置（6-1b）。左右で数・大きさ・向きを変えて不規則にする。背骨に沿った列は作らない。
 * 首の付け根の塊の先が全高（約 145m）
 */
const CLUSTERS: readonly CrystalCluster[] = [
  {
    at: [-21, 90, -30],
    dir: [-0.55, 0.8, 0.2],
    size: 1,
    count: 9,
    bone: blend(BONE.chest, BONE.armLUpper, 0.35),
  },
  {
    at: [22, 88, -27],
    dir: [0.62, 0.72, 0.28],
    size: 0.82,
    count: 7,
    bone: blend(BONE.chest, BONE.armRUpper, 0.35),
  },
  {
    at: [-4, 101, -35],
    dir: [-0.18, 0.95, 0.28],
    size: 1.15,
    count: 8,
    bone: blend(BONE.chest, BONE.neck, 0.3),
  },
  {
    at: [8, 99, -28],
    dir: [0.4, 0.88, 0.3],
    size: 0.66,
    count: 5,
    bone: blend(BONE.chest, BONE.neck, 0.15),
  },
  { at: [-29, 53, -44], dir: [-0.92, 0.22, 0.3], size: 0.52, count: 5, bone: { a: BONE.armLFore } },
  { at: [-30, 45, -50], dir: [-0.85, 0.1, 0.5], size: 0.36, count: 3, bone: { a: BONE.armLFore } },
  { at: [30, 50, -46], dir: [0.9, 0.32, 0.22], size: 0.6, count: 6, bone: { a: BONE.armRFore } },
];

/** 結晶: 肩・首の付け根・前腕の外側の塊（6-1b） */
export function buildCrystals(d: KaijuDetailSpec): KaijuMeshBuilder {
  const m = new KaijuMeshBuilder();
  const axis = new Vector3();
  const s1 = new Vector3();
  const s2 = new Vector3();
  CLUSTERS.forEach((c, ci) => {
    const rnd = createRandom(9100 + ci * 77);
    axis.set(c.dir[0], c.dir[1], c.dir[2]).normalize();
    // 向きに垂直な 2 軸（根元を散らす）
    s1.set(0, 1, 0);
    if (Math.abs(axis.y) > 0.9) s1.set(1, 0, 0);
    s1.cross(axis).normalize();
    s2.crossVectors(axis, s1).normalize();
    const n = Math.max(2, Math.round(c.count * d.crystals));
    for (let i = 0; i < n; i++) {
      // 1 本目が最も大きく、残りは 0.35〜0.8 倍
      const k = i === 0 ? 1 : 0.35 + 0.45 * rnd();
      const len = c.size * 36 * k;
      const ang = rnd() * Math.PI * 2;
      const spread = i === 0 ? 0 : c.size * (2 + 5 * rnd());
      const base = v(c.at[0], c.at[1], c.at[2])
        .addScaledVector(s1, Math.cos(ang) * spread)
        .addScaledVector(s2, Math.sin(ang) * spread)
        .addScaledVector(axis, -2.5 * c.size);
      // 先は塊の向きから外へ開く（根元が中心から遠いほど大きく傾く）
      const tilt = 0.25 + 0.35 * rnd();
      const dirv = axis
        .clone()
        .addScaledVector(s1, Math.cos(ang) * tilt)
        .addScaledVector(s2, Math.sin(ang) * tilt)
        .normalize();
      const tip = base.clone().addScaledVector(dirv, len);
      const tint = 0.8 + 0.3 * rnd();
      const color: Rgb = [CRYSTAL[0] * tint, CRYSTAL[1] * tint, CRYSTAL[2] * tint];
      addCrystal(
        m,
        base,
        tip,
        len * (0.15 + 0.05 * rnd()),
        d.crystalSides,
        color,
        c.bone,
        1,
        rnd(),
      );
    }
  });
  return m;
}
