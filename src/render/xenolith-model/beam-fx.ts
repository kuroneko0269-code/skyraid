// 10-7d: UFO ゼノリスの光線の見た目（描画だけ。10-5a の fx.ts の BeamFx を作り直した）: 撃つ間は白い芯と色の外側の光の 2 層
// （芯に沿って光の脈が流れる）、予兆の線は撃つ先へ流れる点線（なぎ払いの始めと終わり・溜め撃ちのロック）。InstancedMesh 1 つで
// 4 本まで（描画 1 回）。軸は +Y の長さ 1 の筒を、口から向きへ伸ばす
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { XENOLITH_VISUAL } from '../../data/xenolith-visual';
import { f } from '../kaiju-look/glsl';

const V = XENOLITH_VISUAL;
const up = new Vector3(0, 1, 0);
const q = new Quaternion();
const m4 = new Matrix4();
const sc = new Vector3();
const col = new Color();

/** 線の種類: 0 = 芯（白く細い）・1 = 外側の光（柔らかく太い）・2 = 予兆の流れる点線 */
export type BeamLayer = 0 | 1 | 2;

export class BeamFx {
  readonly mesh: InstancedMesh;
  private readonly kind: InstancedBufferAttribute;
  private readonly u = { uTime: { value: 0 } };

  constructor() {
    const geo = new CylinderGeometry(1, 1, 1, 12, 1, true);
    geo.translate(0, 0.5, 0);
    this.kind = new InstancedBufferAttribute(new Float32Array(4), 1);
    this.kind.setUsage(DynamicDrawUsage);
    geo.setAttribute('aKind', this.kind);
    const B = V.beam;
    const mat = new ShaderMaterial({
      uniforms: this.u,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      vertexShader: /* glsl */ `
        attribute float aKind;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vC;
        varying float vKind;
        varying float vAlong;
        void main() {
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vV = -mv.xyz;
          vC = instanceColor;
          vKind = aKind;
          vAlong = position.y * length(instanceMatrix[1].xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vC;
        varying float vKind;
        varying float vAlong;
        void main() {
          float c = abs(dot(normalize(vN), normalize(vV)));
          float pulse = 0.78 + 0.22 * sin(vAlong * 0.045 - uTime * ${f(V.beam.flow * 0.045)});
          vec3 color;
          float a;
          if (vKind < 0.5) {
            // 芯: 白に寄せる
            color = mix(vC, vec3(1.0) * max(vC.r, max(vC.g, vC.b)), ${f(B.core)});
            a = pow(c, 1.2) * pulse;
          } else if (vKind < 1.5) {
            // 外側の光: 真ん中ほど濃い柔らかい光
            color = vC;
            a = pow(c, 3.0) * 0.55 * pulse;
          } else {
            // 予兆: 撃つ先へ流れる点線
            float dash = smoothstep(0.35, 0.5, fract(vAlong / 70.0 - uTime * ${f(V.beam.flow / 70 / 3)}));
            color = vC;
            a = pow(c, 1.5) * (0.45 + 0.55 * dash);
          }
          float fade = smoothstep(0.0, 6.0, vAlong);
          gl_FragColor = vec4(color, clamp(a * fade, 0.0, 1.0));
        }`,
    });
    this.mesh = new InstancedMesh(geo, mat, 4);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.setColorAt(0, col.set(0));
  }

  begin(time: number): void {
    this.mesh.count = 0;
    this.u.uTime.value = time;
  }

  /** 1 本足す（origin から dir へ length m、半径 radius、色 hex × 明るさ k、種類） */
  add(
    origin: Readonly<Vector3>,
    dir: Readonly<Vector3>,
    length: number,
    radius: number,
    hex: number,
    k: number,
    layer: BeamLayer = 0,
  ): void {
    const i = this.mesh.count;
    if (i >= 4) return;
    q.setFromUnitVectors(up, dir);
    sc.set(radius, length, radius);
    m4.compose(origin, q, sc);
    this.mesh.setMatrixAt(i, m4);
    this.mesh.setColorAt(i, col.set(hex).multiplyScalar(k));
    this.kind.setX(i, layer);
    this.mesh.count = i + 1;
  }

  end(): void {
    this.mesh.visible = this.mesh.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.kind.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
