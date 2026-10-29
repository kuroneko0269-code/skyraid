import {
  BoxGeometry,
  BufferAttribute,
  ConeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Quat, Vec3 } from '../flight/math';
import { PLACEHOLDER_AIRCRAFT_CONFIG } from '../data/scene';

/** Cone + Box の胴体、板の主翼・尾翼でできたプレースホルダー機体。前方は -Z */
export function createPlaceholderAircraft(): Group {
  const cfg = PLACEHOLDER_AIRCRAFT_CONFIG;
  const body = new MeshStandardMaterial({ color: cfg.bodyColor, roughness: 0.6, metalness: 0.3 });
  const accent = new MeshStandardMaterial({ color: cfg.accentColor, roughness: 0.6 });
  const group = new Group();

  const f = cfg.fuselage;
  const fuselage = new Mesh(new BoxGeometry(f.width, f.height, f.length), body);
  group.add(fuselage);

  // ConeGeometry は +Y 向きなので、-Z を向くよう倒す
  const n = cfg.nose;
  const nose = new Mesh(new ConeGeometry(n.radius, n.length, 12), accent);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -(f.length + n.length) / 2;
  group.add(nose);

  const w = cfg.wing;
  const wing = new Mesh(new BoxGeometry(w.span, w.thickness, w.chord), body);
  wing.position.z = w.z;
  group.add(wing);

  const t = cfg.tailplane;
  const tail = new Mesh(new BoxGeometry(t.span, t.thickness, t.chord), body);
  tail.position.z = t.z;
  group.add(tail);

  const v = cfg.fin;
  const fin = new Mesh(new BoxGeometry(v.thickness, v.height, v.chord), accent);
  fin.position.set(0, (f.height + v.height) / 2, v.z);
  group.add(fin);

  return group;
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
