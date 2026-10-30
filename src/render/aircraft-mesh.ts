import {
  BoxGeometry,
  BufferAttribute,
  ConeGeometry,
  Group,
  Mesh,
  type Material,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AircraftShape } from '../data/aircraft';
import type { Quat, Vec3 } from '../flight/math';
import { PLACEHOLDER_AIRCRAFT_CONFIG } from '../data/scene';

/**
 * Cone + Box の胴体、板の主翼・尾翼でできたプレースホルダー機体。前方は -Z。
 * shape（3-4）で胴体の長さ・主翼の形・色を機体ごとに変える。省略すると src/data/scene.ts の形
 */
export function createPlaceholderAircraft(shape?: Readonly<AircraftShape>): Group {
  const group = new Group();
  buildPlaceholderParts(group, shape);
  return group;
}

/** group の中身を shape の形に作り直す（ハンガーで機体を変えたとき。group は使い回すので参照はそのまま） */
export function rebuildPlaceholderAircraft(group: Group, shape: Readonly<AircraftShape>): void {
  const materials = new Set<Material>();
  for (const child of [...group.children]) {
    if (child instanceof Mesh) {
      const mesh = child as Mesh<BufferGeometry, Material>;
      mesh.geometry.dispose();
      materials.add(mesh.material);
    }
    group.remove(child);
  }
  for (const m of materials) m.dispose();
  buildPlaceholderParts(group, shape);
}

function buildPlaceholderParts(group: Group, shape?: Readonly<AircraftShape>): void {
  const cfg = PLACEHOLDER_AIRCRAFT_CONFIG;
  const body = new MeshStandardMaterial({
    color: shape?.bodyColor ?? cfg.bodyColor,
    roughness: 0.6,
    metalness: 0.3,
  });
  const accent = new MeshStandardMaterial({
    color: shape?.accentColor ?? cfg.accentColor,
    roughness: 0.6,
  });

  const f = cfg.fuselage;
  const length = shape?.fuselageLength ?? f.length;
  // 尾翼は胴体の長さに比例して前後する
  const tailScale = length / f.length;
  const fuselage = new Mesh(new BoxGeometry(f.width, f.height, length), body);
  group.add(fuselage);

  // ConeGeometry は +Y 向きなので、-Z を向くよう倒す
  const n = cfg.nose;
  const nose = new Mesh(new ConeGeometry(n.radius, n.length, 12), accent);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -(length + n.length) / 2;
  group.add(nose);

  const w = cfg.wing;
  const span = shape?.wingSpan ?? w.span;
  const chord = shape?.wingChord ?? w.chord;
  const sweep = ((shape?.wingSweepDeg ?? 0) * Math.PI) / 180;
  if (sweep === 0) {
    const wing = new Mesh(new BoxGeometry(span, w.thickness, chord), body);
    wing.position.z = w.z;
    group.add(wing);
  } else {
    // 後退翼: 左右の半分を付け根を中心に後ろへ回す（付け根は胴体の中心線）
    const half = span / 2 / Math.cos(sweep);
    for (const side of [-1, 1]) {
      const wing = new Mesh(new BoxGeometry(half, w.thickness, chord), body);
      wing.rotation.y = -side * sweep;
      wing.position.set((side * span) / 4, 0, w.z + (Math.tan(sweep) * span) / 4);
      group.add(wing);
    }
  }

  const t = cfg.tailplane;
  const tail = new Mesh(new BoxGeometry(t.span, t.thickness, t.chord), body);
  tail.position.z = t.z * tailScale;
  group.add(tail);

  const v = cfg.fin;
  const fin = new Mesh(new BoxGeometry(v.thickness, v.height, v.chord), accent);
  fin.position.set(0, (f.height + v.height) / 2, v.z * tailScale);
  group.add(fin);
}

/**
 * 同じ形を 1 つのジオメトリにまとめたもの（敵機の InstancedMesh 用）。色は頂点カラーで、
 * 胴体・翼は bodyShade、機首・垂直尾翼は accentShade の明るさ（インスタンスの色を掛ける）
 */
export function createPlaceholderAircraftGeometry(
  bodyShade = 1,
  accentShade = 0.45,
): BufferGeometry {
  const cfg = PLACEHOLDER_AIRCRAFT_CONFIG;
  const f = cfg.fuselage;
  const n = cfg.nose;
  const w = cfg.wing;
  const t = cfg.tailplane;
  const v = cfg.fin;
  const parts: [BufferGeometry, number][] = [
    [new BoxGeometry(f.width, f.height, f.length), bodyShade],
    [
      new ConeGeometry(n.radius, n.length, 12)
        .rotateX(-Math.PI / 2)
        .translate(0, 0, -(f.length + n.length) / 2),
      accentShade,
    ],
    [new BoxGeometry(w.span, w.thickness, w.chord).translate(0, 0, w.z), bodyShade],
    [new BoxGeometry(t.span, t.thickness, t.chord).translate(0, 0, t.z), bodyShade],
    [
      new BoxGeometry(v.thickness, v.height, v.chord).translate(0, (f.height + v.height) / 2, v.z),
      accentShade,
    ],
  ];
  for (const [g, shade] of parts) {
    const count = g.getAttribute('position').count;
    g.setAttribute('color', new BufferAttribute(new Float32Array(count * 3).fill(shade), 3));
  }
  // Cone は index 付き・Box も index 付きなのでそのまま結合できる
  const merged = mergeGeometries(parts.map(([g]) => g));
  for (const [g] of parts) g.dispose();
  return merged;
}

const prevPos = new Vector3();
const currPos = new Vector3();
const prevQuat = new Quaternion();
const currQuat = new Quaternion();

/** 前ステップと現ステップの間を alpha で補間して object に反映する */
export function applyInterpolatedPose(
  object: Group,
  prevPosition: Readonly<Vec3>,
  position: Readonly<Vec3>,
  prevOrientation: Readonly<Quat>,
  orientation: Readonly<Quat>,
  alpha: number,
): void {
  prevPos.set(prevPosition.x, prevPosition.y, prevPosition.z);
  currPos.set(position.x, position.y, position.z);
  object.position.lerpVectors(prevPos, currPos, alpha);
  prevQuat.set(prevOrientation.x, prevOrientation.y, prevOrientation.z, prevOrientation.w);
  currQuat.set(orientation.x, orientation.y, orientation.z, orientation.w);
  object.quaternion.slerpQuaternions(prevQuat, currQuat, alpha);
}
