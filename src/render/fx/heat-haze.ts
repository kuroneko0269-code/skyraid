// 陽炎（4-4）: 巡航中のノズルの後ろの揺らぎ。画質「高」は画面を歪める屈折（ポストエフェクトの仕上げのパスで、
// ノズルから後ろへ伸びる画面上の帯の中の像をずらす。draw call は増えない）。それ以外は薄い半透明の揺らぎ（1 draw call）。
// アフターバーナー中は炎があるので消す
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector3,
  type Camera,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HEAT_HAZE_CONFIG as H } from '../../data/fx';
import type { NozzleSpot } from '../aircraft-model/fuselage';

/** 画面上の陽炎の帯（uv 0〜1）。strength 0 なら無し */
export interface HazeSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** 帯の太さ（画面の高さに対する割合） */
  width: number;
  strength: number;
}

/** 屈折なし（飛行中以外） */
export const NO_HAZE: Readonly<HazeSegment> = { ax: 0, ay: 0, bx: 0, by: 0, width: 0, strength: 0 };

/** スロットル（0〜1）とアフターバーナーの炎の強さ（0〜1）から陽炎の強さ（0〜1）。テストあり */
export function hazeLevel(throttle: number, flame: number): number {
  const t = Math.min(1, Math.max(0, throttle));
  return (H.minLevel + (1 - H.minLevel) * t) * (1 - Math.min(1, Math.max(0, flame)));
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// uv.y は根元（z = 0）0 → 先（z = 1）1
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float along = vUv.y;
    float a = vUv.x * 6.2832;
    float wave = sin(a * 5.0 + along * 9.0 - uTime * 1.7) * sin(a * 3.0 - along * 13.0 + uTime * 2.3);
    float shimmer = 0.5 + 0.5 * wave;
    float fade = pow(1.0 - along, 1.3) * smoothstep(0.0, 0.12, along);
    gl_FragColor = vec4(uColor, uOpacity * fade * shimmer);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const a = new Vector3();
const b = new Vector3();
const edge = new Vector3();
const back = new Vector3();
const up = new Vector3();

export class HeatHaze {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly uOpacity = { value: 0 };
  private readonly uTime = { value: 0 };
  private readonly root = new Vector3();
  private radius = 0.5;
  private level = 0;
  private time = 0;
  /** 画質「高」: 半透明の揺らぎの代わりに屈折 */
  refraction = false;

  constructor() {
    this.material = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(H.color) },
        uOpacity: this.uOpacity,
        uTime: this.uTime,
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(new BufferGeometry(), this.material);
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
  }

  /** ノズルの位置に合わせて作り直す（機体を作り直したとき） */
  setNozzles(nozzles: readonly NozzleSpot[]): void {
    const parts = nozzles.map((n) =>
      new CylinderGeometry(n.radius * H.tipRadius, n.radius * H.rootRadius, 1, 12, 1, true)
        // +Y 向きの筒を +Z（後ろ）へ倒し、根元（下端）を z = 0・先（上端）を z = 1 に
        .rotateX(Math.PI / 2)
        .translate(n.x, n.y, 0.5),
    );
    this.mesh.geometry.dispose();
    this.mesh.geometry = parts.length > 0 ? mergeGeometries(parts) : new BufferGeometry();
    for (const p of parts) p.dispose();
    const z = nozzles[0]?.z ?? 0;
    this.mesh.position.set(0, 0, z);
    this.mesh.scale.set(1, 1, H.length);
    let x = 0;
    let y = 0;
    for (const n of nozzles) {
      x += n.x / nozzles.length;
      y += n.y / nozzles.length;
    }
    this.root.set(x, y, z);
    this.radius = nozzles[0]?.radius ?? 0.5;
  }

  /** dt は演出の時間（ポーズ中 0）。level は hazeLevel の値（撃墜中は 0） */
  update(level: number, dt: number): void {
    this.time += dt * H.flowSpeed;
    this.level = level;
    this.uTime.value = this.time;
    this.uOpacity.value = H.opacity * level;
    this.mesh.visible = !this.refraction && level > 0.01;
  }

  /**
   * 屈折の帯（画面の uv）を out に入れる。aircraft は機体（ワールド行列が最新）。
   * 屈折しない・ノズルがカメラの後ろなら strength 0
   */
  segment(aircraft: Object3D, camera: Camera, aspect: number, out: HazeSegment): HazeSegment {
    out.strength = 0;
    if (!this.refraction || this.level <= 0.01) return out;
    a.copy(this.root).applyMatrix4(aircraft.matrixWorld);
    back.set(0, 0, 1).transformDirection(aircraft.matrixWorld);
    up.set(0, 1, 0).transformDirection(aircraft.matrixWorld);
    b.copy(a).addScaledVector(back, H.length);
    edge.copy(a).addScaledVector(up, this.radius * H.refractWidth);
    a.project(camera);
    b.project(camera);
    edge.project(camera);
    // カメラの後ろ（または遠すぎる）なら出さない
    if (a.z > 1 || b.z > 1 || a.z < -1) return out;
    out.ax = a.x * 0.5 + 0.5;
    out.ay = a.y * 0.5 + 0.5;
    out.bx = b.x * 0.5 + 0.5;
    out.by = b.y * 0.5 + 0.5;
    // 太さは画面の高さに対する割合（横は aspect を掛けて測る）
    out.width = Math.hypot(((edge.x - a.x) * aspect) / 2, (edge.y - a.y) / 2);
    out.strength = H.refractStrength * this.level;
    return out;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
