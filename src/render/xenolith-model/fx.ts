// 10-5a: UFO ゼノリスの効果の見た目: バリアの殻（縁が明るい青い楕円体。揺らぐと点滅し、当たると波紋が広がる）・光線（予兆の細い線と
// 撃つ太い芯。InstancedMesh 1 つで 2 本まで）・瞬間移動の予兆（移る先の白い柱と地上の輪）。どれも出ているときだけ描く
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { XENOLITH_MODEL_CONFIG } from '../../data/xenolith-model';

const M = XENOLITH_MODEL_CONFIG;

/** バリアの殻（ワールドに置く。形は縦の軸の周りに対称なので回さない） */
export function createBarrierMesh(segments: number): {
  mesh: Mesh;
  set(opacity: number, rippleDir: Readonly<Vector3>, ripple: number): void;
} {
  const geo = new SphereGeometry(1, segments, Math.max(6, Math.round(segments / 2)));
  const u = {
    uColor: { value: new Color(M.colors.barrier) },
    uOpacity: { value: 0 },
    uRipple: { value: new Vector3(0, 1, 0) },
    uRippleK: { value: 0 },
  };
  const mat = new ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vL;
      void main() {
        vL = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform vec3 uRipple;
      uniform float uRippleK;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vL;
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
        float ang = acos(clamp(dot(vL, uRipple), -1.0, 1.0));
        float front = (1.0 - uRippleK) * 1.4;
        float ring = exp(-pow((ang - front) * 7.0, 2.0)) * uRippleK;
        float a = uOpacity * (0.25 + fres * 1.6) + ring * 0.9;
        gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
      }`,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  return {
    mesh,
    set(opacity, rippleDir, ripple) {
      u.uOpacity.value = opacity;
      u.uRipple.value.copy(rippleDir);
      u.uRippleK.value = ripple;
    },
  };
}

const up = new Vector3(0, 1, 0);
const q = new Quaternion();
const m4 = new Matrix4();
const sc = new Vector3();
const col = new Color();

/** 光線の線 2 本まで（予兆の始めと終わりの線・ロックの線・撃つ芯）。軸は +Y の長さ 1 の筒を、口から向きへ伸ばす */
export class BeamFx {
  readonly mesh: InstancedMesh;

  constructor() {
    const geo = new CylinderGeometry(1, 1, 1, 10, 1, true);
    geo.translate(0, 0.5, 0);
    const mat = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
      side: DoubleSide,
    });
    this.mesh = new InstancedMesh(geo, mat, 2);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    // 色の入れ物を作っておく（最初の setColorAt で作られる）
    this.mesh.setColorAt(0, col.set(0));
  }

  begin(): void {
    this.mesh.count = 0;
  }

  /** 1 本足す（origin から dir へ length m、半径 radius、色 hex × 明るさ k） */
  add(
    origin: Readonly<Vector3>,
    dir: Readonly<Vector3>,
    length: number,
    radius: number,
    hex: number,
    k: number,
  ): void {
    const i = this.mesh.count;
    if (i >= 2) return;
    q.setFromUnitVectors(up, dir);
    sc.set(radius, length, radius);
    m4.compose(origin, q, sc);
    this.mesh.setMatrixAt(i, m4);
    this.mesh.setColorAt(i, col.set(hex).multiplyScalar(k));
    this.mesh.count = i + 1;
  }

  end(): void {
    this.mesh.visible = this.mesh.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** 瞬間移動の予兆: 移る先の白い柱（destination を真ん中に）と、その真下の床の輪 */
export function createWarpFx(): {
  pillar: Mesh;
  ring: Mesh;
  set(visible: boolean, x: number, y: number, z: number, floor: number, k: number): void;
} {
  const pg = new CylinderGeometry(1, 1, 1, 16, 1, true);
  const mat = (): MeshBasicMaterial =>
    new MeshBasicMaterial({
      color: M.colors.warp,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
      side: DoubleSide,
    });
  const pm = mat();
  const pillar = new Mesh(pg, pm);
  const rg = new RingGeometry(0.75, 1, 48);
  rg.rotateX(-Math.PI / 2);
  const rm = mat();
  const ring = new Mesh(rg, rm);
  for (const o of [pillar, ring]) {
    o.frustumCulled = false;
    o.visible = false;
  }
  const W = M.warp;
  return {
    pillar,
    ring,
    set(visible, x, y, z, floor, k) {
      pillar.visible = visible;
      ring.visible = visible;
      if (!visible) return;
      // 柱は細く始まって太く、移る直前に一番明るい（点滅）
      const r = W.pillarRadius * (0.4 + 0.6 * k);
      pillar.position.set(x, y, z);
      pillar.scale.set(r, W.pillarHeight, r);
      pm.opacity = 0.25 + 0.6 * k;
      ring.position.set(x, floor + 2, z);
      const rr = W.ringRadius * (1.6 - 0.6 * k);
      ring.scale.set(rr, 1, rr);
      rm.opacity = 0.35 + 0.5 * k;
    },
  };
}
