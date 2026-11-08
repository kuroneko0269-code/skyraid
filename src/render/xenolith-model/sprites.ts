// 10-7d: UFO ゼノリスの光る星（描画だけ）: カメラへ向けた板に、十字に光が伸びる星と柔らかい芯を描く（足し合わせて光る）。
// きらめく粒（寿命のある粒。体の表面・縁・光線の口・瞬間移動でほどける / 組み上がる光）・光の弾のきらめき・遠くの目印を
// InstancedMesh 1 つにまとめる（描画 1 回。出ていなければ 0）。乱数は Math.random（見た目だけ）
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';

const m4 = new Matrix4();
const toCam = new Vector3();
const side = new Vector3();
const upV = new Vector3();
const worldUp = new Vector3(0, 1, 0);
const col = new Color();

interface Glint {
  readonly p: Vector3;
  readonly v: Vector3;
  readonly color: Color;
  age: number;
  life: number;
  size: number;
  /** 寿命の間に大きさが変わる倍率（組み上がる光は縮む） */
  grow: number;
  drag: number;
}

export class StarSprites {
  readonly mesh: InstancedMesh;
  private readonly alpha: InstancedBufferAttribute;
  private readonly spin: InstancedBufferAttribute;
  private readonly glints: Glint[];
  private readonly material: ShaderMaterial;
  private next = 0;
  private n = 0;

  /** glints: 寿命のある粒の数、extra: 毎フレーム置く星（光の弾・目印）の数 */
  constructor(
    glints: number,
    private readonly extra: number,
  ) {
    const cap = Math.max(1, glints + extra);
    const geo = new PlaneGeometry(1, 1);
    this.alpha = new InstancedBufferAttribute(new Float32Array(cap), 1);
    this.alpha.setUsage(DynamicDrawUsage);
    this.spin = new InstancedBufferAttribute(new Float32Array(cap), 1);
    this.spin.setUsage(DynamicDrawUsage);
    geo.setAttribute('aAlpha', this.alpha);
    geo.setAttribute('aSpin', this.spin);
    const mat = (this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aSpin;
        varying vec2 vUv;
        varying float vA;
        varying vec3 vC;
        void main() {
          float c = cos(aSpin);
          float s = sin(aSpin);
          vUv = mat2(c, -s, s, c) * (uv - 0.5);
          vA = aAlpha;
          vC = instanceColor;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vA;
        varying vec3 vC;
        void main() {
          vec2 p = abs(vUv) * 2.0;
          float r = length(p);
          float core = exp(-r * r * 18.0);
          float glow = exp(-r * r * 4.0) * 0.35;
          float rays = exp(-p.x * 40.0) * (1.0 - p.y) + exp(-p.y * 40.0) * (1.0 - p.x);
          float a = (core + glow + max(rays, 0.0) * 0.8) * vA;
          gl_FragColor = vec4(vC * (1.0 + core), clamp(a, 0.0, 1.0));
        }`,
    }));
    this.mesh = new InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.setColorAt(0, col.set(0));
    this.glints = Array.from({ length: glints }, () => ({
      p: new Vector3(),
      v: new Vector3(),
      color: new Color(),
      age: 1,
      life: 0,
      size: 1,
      grow: 1,
      drag: 1,
    }));
  }

  /** 粒を 1 つ（at から vel の速さで。life 秒・大きさ m・色） */
  emit(
    at: Readonly<Vector3>,
    vel: Readonly<Vector3>,
    life: number,
    size: number,
    color: number,
    grow = 1,
    drag = 1.5,
  ): void {
    if (this.glints.length === 0) return;
    const g = this.glints[this.next];
    this.next = (this.next + 1) % this.glints.length;
    if (!g) return;
    g.p.copy(at);
    g.v.copy(vel);
    g.color.set(color);
    g.age = 0;
    g.life = life;
    g.size = size;
    g.grow = grow;
    g.drag = drag;
  }

  /** 出ている粒の数 */
  get active(): number {
    let n = 0;
    for (const g of this.glints) if (g.age < g.life) n++;
    return n;
  }

  /** フレームの始め: 粒を進めて並べる */
  begin(camera: Readonly<Vector3>, dt: number): void {
    this.n = 0;
    for (const g of this.glints) {
      if (g.age >= g.life) continue;
      g.age += dt;
      g.v.multiplyScalar(1 - Math.min(1, dt * g.drag));
      g.p.addScaledVector(g.v, dt);
      const t = Math.min(1, g.age / g.life);
      // 瞬いて消える（出てすぐ明るく）
      const a = Math.sin(Math.PI * Math.min(1, t * 1.6 + 0.05)) * (1 - t * 0.4);
      this.put(camera, g.p, g.size * (1 + (g.grow - 1) * t), g.color, a, t * 2);
    }
  }

  /** 星を 1 つ置く（このフレームだけ。光の弾・目印） */
  star(
    camera: Readonly<Vector3>,
    at: Readonly<Vector3>,
    size: number,
    color: Readonly<Color>,
    alpha: number,
    spin = 0,
  ): void {
    if (this.n >= this.glints.length + this.extra) return;
    this.put(camera, at, size, color, alpha, spin);
  }

  private put(
    camera: Readonly<Vector3>,
    at: Readonly<Vector3>,
    size: number,
    color: Readonly<Color>,
    alpha: number,
    spin: number,
  ): void {
    toCam.subVectors(camera, at).normalize();
    side.crossVectors(worldUp, toCam);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    upV.crossVectors(toCam, side);
    m4.makeBasis(side.multiplyScalar(size), upV.multiplyScalar(size), toCam);
    m4.setPosition(at);
    const i = this.n++;
    this.mesh.setMatrixAt(i, m4);
    this.mesh.setColorAt(i, color);
    this.alpha.setX(i, Math.max(0, alpha));
    this.spin.setX(i, spin);
  }

  /** フレームの終わり */
  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
    this.spin.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    for (const g of this.glints) g.age = g.life;
    this.n = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
