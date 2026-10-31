// 怪獣の部位のジオメトリ（6-1）: 胴・頭・腕・脚・尾・背中の結晶の棘。どれも静止姿勢（足元が原点・前方 -Z）で作り、
// 骨（skeleton.ts）に貼り付ける。前傾姿勢で頭が低く、目は 4 つ（左右 2 つずつ）、背中に結晶の棘、長い尾
import { Vector3 } from 'three';
import { KAIJU_MODEL_CONFIG, type KaijuDetailSpec } from '../../data/kaiju-model';
import { KaijuMeshBuilder, rgb, type BoneBind, type Rgb, type TubeRing } from './builder';
import { BONE, bonePosition } from './skeleton';

const C = KAIJU_MODEL_CONFIG.colors;
const BACK = rgb(C.back);
const BELLY = rgb(C.belly);
const CLAW = rgb(C.claw);
const EYE = rgb(C.eye);
const CRYSTAL = rgb(C.crystal);

const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

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
  // 目は左右 2 つずつ（上下に並ぶ）。発光
  const eyeRows = Math.max(3, Math.round(rows / 2));
  for (const sx of [-1, 1]) {
    m.ellipsoid(v(sx * 8.6, 101.5, -63), 1.6, 1.1, 2.0, eyeRows, eyeRows * 2, EYE, head, 1);
    m.ellipsoid(v(sx * 9.4, 98.6, -61), 1.3, 0.9, 1.6, eyeRows, eyeRows * 2, EYE, head, 1);
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

/** 腕（左右）: 上腕・前腕と 3 本の爪。歩くための腕ではないので短め */
export function buildArms(d: KaijuDetailSpec): KaijuMeshBuilder {
  const m = new KaijuMeshBuilder();
  const radial = Math.max(8, Math.round(d.radial * 0.6));
  for (const [sx, up, fore] of [
    [-1, BONE.armLUpper, BONE.armLFore],
    [1, BONE.armRUpper, BONE.armRFore],
  ] as const) {
    const sh = bonePosition(sx < 0 ? 'armLUpper' : 'armRUpper');
    const el = bonePosition(sx < 0 ? 'armLFore' : 'armRFore');
    const hand = el.clone().add(v(sx * 2, -14, -12));
    const n = count(8, d);
    const rings: TubeRing[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const c = t < 0.5 ? sh.clone().lerp(el, t * 2) : el.clone().lerp(hand, (t - 0.5) * 2);
      const r = 5.5 - 2.5 * t;
      const bone = blend(up, fore, (t - 0.42) / 0.16);
      rings.push({ center: c, rx: r, ry: r * 1.1, color: BACK, under: BELLY, bone });
    }
    m.tube(rings, radial);
    for (let k = -1; k <= 1; k++) {
      m.spike(
        hand.clone().add(v(k * 2.5, 0, 0)),
        hand.clone().add(v(k * 3.5, -7, -5)),
        1.4,
        4,
        CLAW,
        { a: fore },
      );
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
      rings.push({ center: c, rx: r, ry: r, color: BACK, under: BELLY, bone });
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

/** 背中の結晶の棘: 首の付け根から尾の中ほどまで、背骨に沿って 2 列（中央が最も高い） */
export function buildCrystals(d: KaijuDetailSpec): KaijuMeshBuilder {
  const m = new KaijuMeshBuilder();
  const spine = [
    v(0, 104, -38),
    v(0, 112, -20),
    v(0, 104, 4),
    v(0, 82, 26),
    v(0, 66, 56),
    v(0, 54, 84),
  ];
  const n = d.spikes;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const base = along(spine, t);
    // 高さ: 胸の上で最大（先が全高 150m に届く）、前後へ小さく
    const h = 8 + 44 * Math.sin(Math.PI * Math.min(1, t * 1.6)) ** 1.5 * (1 - t * 0.55);
    const row = i % 2 === 0 ? -1 : 1;
    // 先は少し外側・後ろへ傾ける
    const b = base.clone().add(v(row * 4.5, -2, 0));
    const tip = b.clone().add(v(row * h * 0.18, h, h * (0.15 + 0.3 * t)));
    const bone = boneAlongSpine(t);
    m.spike(b, tip, 2.4 + h * 0.11, d.spikeSides, tintCrystal(t), bone, 0);
  }
  return m;
}

/** 背骨に沿った位置 t の骨 */
function boneAlongSpine(t: number): BoneBind {
  if (t < 0.25) return blend(BONE.chest, BONE.neck, 0.2);
  if (t < 0.5) return blend(BONE.pelvis, BONE.chest, 1 - (t - 0.25) * 4);
  if (t < 0.75) return blend(BONE.tail0, BONE.pelvis, 1 - (t - 0.5) * 4);
  return blend(BONE.tail1, BONE.tail0, 1 - (t - 0.75) * 4);
}

/** 棘の色: 根元ほどわずかに濃い */
function tintCrystal(t: number): Rgb {
  const k = 0.85 + 0.15 * (1 - t);
  return [CRYSTAL[0] * k, CRYSTAL[1] * k, CRYSTAL[2] * k];
}
