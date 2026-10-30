// 機体モデルの生成器（4-3）: 形のパラメータ（src/data/aircraft-shapes.ts）からパーツを組み立て、
// 1 つのジオメトリ（不透明の部分）と、別にキャノピー（半透明。merged なら機体に入れて不透明の暗い色）を作る
import type { BufferGeometry } from 'three';
import type { AircraftShape } from '../../data/aircraft-shapes';
import { AIRCRAFT_MODEL_CONFIG, type AircraftDetail } from '../../data/aircraft-model';
import { MeshAccumulator, rgb, type UvFn } from './accumulator';
import {
  addCanopy,
  addFuselage,
  addIntakes,
  addNacelles,
  addNozzles,
  nozzleSpots,
  type NozzleSpot,
} from './fuselage';
import { PART, SURFACE_COUNT, finSection, wingRootX, wingSection, type Point3 } from './planform';
import { addNacellePylons, addStores } from './stores';
import { addWingPanel, type PanelSpec, type WingBuildOptions } from './wing';

/** 操舵面の回転軸（部品番号 − 1 の順） */
export interface Hinge {
  readonly position: Point3;
  readonly axis: Point3;
}

export interface BuiltAircraft {
  /** 機体（不透明。頂点の色・UV・部品番号つき） */
  readonly body: BufferGeometry;
  /** キャノピー（半透明で別に描く）。merged のときは null（機体に入っている） */
  readonly canopy: BufferGeometry | null;
  readonly hinges: readonly Hinge[];
  readonly nozzles: readonly NozzleSpot[];
  /** 左右の翼端（飛行機雲を出す位置）。[左, 右] */
  readonly wingTips: readonly [Point3, Point3];
  /** パイロン（ミサイル）の数 */
  readonly pylons: number;
  /** 三角形の数（機体 + キャノピー） */
  readonly triangles: number;
}

export interface BuildOptions {
  readonly detail: AircraftDetail;
  /** パイロンとミサイルの数 */
  readonly missiles: number;
  /** キャノピーを機体に入れる（InstancedMesh 1 つで描く敵機・輸送機） */
  readonly mergeCanopy: boolean;
}

const cleanUv: UvFn = () => [0.75, 0.875];

export function buildAircraft(
  shape: Readonly<AircraftShape>,
  o: Readonly<BuildOptions>,
): BuiltAircraft {
  const cfg = AIRCRAFT_MODEL_CONFIG;
  const d = cfg.detail[o.detail];
  const body = rgb(shape.bodyColor);
  const accent = rgb(shape.accentColor);
  const acc = new MeshAccumulator();

  addFuselage(acc, shape, d.fuselageStations, d.fuselageRadial, body);
  if (shape.intakes) addIntakes(acc, shape, d.ductRadial, body);
  addNozzles(acc, shape, d.ductRadial);
  addNacelles(acc, shape, d.ductRadial, body);
  addNacellePylons(acc, shape, body);

  const wo: WingBuildOptions = {
    airfoilPoints: d.airfoilPoints,
    bevelSegments: d.bevelSegments,
    bevel: cfg.bevel,
  };
  const s = cfg.surfaces;
  const panel = (p: PanelSpec): void => {
    addWingPanel(acc, shape, p, wo);
  };
  const gap = 0.006;
  for (const side of [-1, 1] as const) {
    const aileron = side < 0 ? PART.aileronLeft : PART.aileronRight;
    // 主翼: 付け根（胴体の中）〜エルロンの手前・エルロンの前・エルロン・翼端（アクセントの色）
    const u0 = wingRootX(shape) / (shape.wing.span / 2);
    const [a0, a1] = s.aileronSpan;
    const k = s.aileronChord;
    const w = { kind: 'wing', side, color: body, part: PART.none } as const;
    panel({ ...w, u0, u1: a0, x0: 0, x1: 1 });
    panel({ ...w, u0: a0, u1: a1, x0: 0, x1: k - gap });
    panel({ ...w, u0: a0 + gap, u1: a1 - gap, x0: k + gap, x1: 1, part: aileron });
    panel({ ...w, u0: a1, u1: 1, x0: 0, x1: 1, color: accent });
    // 水平尾翼（全遊動式）
    panel({
      kind: 'stabilizer',
      side,
      u0: wingRootX(shape) / (shape.stabilizer.span / 2),
      u1: 1,
      x0: 0,
      x1: 1,
      color: body,
      part: side < 0 ? PART.stabilizerLeft : PART.stabilizerRight,
    });
  }
  // 垂直尾翼: 付け根・ラダーの前・ラダー（アクセント）・上端（アクセント）。双垂直尾翼は左右に
  const finSides = shape.tail === 'twin' ? ([-1, 1] as const) : ([1] as const);
  for (const side of finSides) {
    const rudder = side < 0 || shape.tail === 'single' ? PART.rudderLeft : PART.rudderRight;
    const [r0, r1] = s.rudderSpan;
    const k = s.rudderChord;
    const f = { kind: 'fin', side, color: body, part: PART.none } as const;
    panel({ ...f, u0: 0, u1: r0, x0: 0, x1: 1 });
    panel({ ...f, u0: r0, u1: r1, x0: 0, x1: k - gap });
    panel({ ...f, u0: r0 + gap, u1: r1 - gap, x0: k + gap, x1: 1, color: accent, part: rudder });
    panel({ ...f, u0: r1, u1: 1, x0: 0, x1: 1, color: accent });
  }

  const m = cfg.missile;
  const pylons = addStores(
    acc,
    shape,
    o.missiles,
    d.missileRadial,
    d.missileFins,
    body,
    rgb(m.color),
    rgb(m.seekerColor),
  );

  let canopy: BufferGeometry | null = null;
  let canopyTriangles = 0;
  if (o.mergeCanopy) {
    addCanopy(acc, shape, d.canopySegments, rgb(cfg.colors.canopyOpaque), cleanUv);
  } else {
    const c = new MeshAccumulator();
    addCanopy(c, shape, d.canopySegments, [1, 1, 1], cleanUv);
    canopyTriangles = c.triangleCount;
    canopy = c.toGeometry();
  }
  const triangles = acc.triangleCount + canopyTriangles;
  const tip = wingSection(shape, shape.wing, 1);
  const tipZ = tip.z + tip.chord * 0.6;
  return {
    body: acc.toGeometry(),
    canopy,
    hinges: hinges(shape),
    nozzles: nozzleSpots(shape),
    wingTips: [
      { x: -tip.x, y: tip.y, z: tipZ },
      { x: tip.x, y: tip.y, z: tipZ },
    ],
    pylons,
    triangles,
  };
}

/** 操舵面の回転軸。水平の面は外側（+X 寄り）向き、ラダーは上向きの軸（正の角度で後縁が下・右へ） */
function hinges(shape: Readonly<AircraftShape>): Hinge[] {
  const s = AIRCRAFT_MODEL_CONFIG.surfaces;
  const out: Hinge[] = [];
  const line = (p0: Point3, p1: Point3): Hinge => {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dz = p1.z - p0.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    return { position: p0, axis: { x: dx / l, y: dy / l, z: dz / l } };
  };
  const at = (
    sec: { x: number; y: number; z: number; chord: number },
    k: number,
    side: number,
  ) => ({
    x: sec.x * side,
    y: sec.y,
    z: sec.z + sec.chord * k,
  });
  const [a0, a1] = s.aileronSpan;
  const w0 = wingSection(shape, shape.wing, a0);
  const w1 = wingSection(shape, shape.wing, a1);
  // 左: 外 → 内（+X 向き）、右: 内 → 外
  out.push(line(at(w1, s.aileronChord, -1), at(w0, s.aileronChord, -1)));
  out.push(line(at(w0, s.aileronChord, 1), at(w1, s.aileronChord, 1)));
  const st = wingSection(shape, shape.stabilizer, 0);
  const stab: Hinge = {
    position: { x: 0, y: st.y, z: st.z + st.chord * s.stabilizerHinge },
    axis: { x: 1, y: 0, z: 0 },
  };
  out.push(stab, stab);
  const [r0, r1] = s.rudderSpan;
  const f0 = finSection(shape, r0);
  const f1 = finSection(shape, r1);
  for (const side of [-1, 1])
    out.push(line(at(f0, s.rudderChord, side), at(f1, s.rudderChord, side)));
  if (out.length !== SURFACE_COUNT) throw new Error('操舵面の数が合いません');
  return out;
}
