// 10-7d: UFO ゼノリスの急加速の光の尾（描画だけ）: 体の通った点を残し、円盤の面の向きの帯（横から見える）と縦の帯（上下から見える）を
// 十字に重ねて引く（帯 2 本で 1 回の描画）。前は水色で濃く、後ろは紫で薄い。速さが minSpeed を超えると出て、遅くなると消えていく。
// 止めている間（撮影）は速度から点を作る
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { XENOLITH_VISUAL } from '../../data/xenolith-visual';

const T = XENOLITH_VISUAL.trail;
const dir = new Vector3();
const across = new Vector3();
const worldUp = new Vector3(0, 1, 0);

export class TrailRibbon {
  readonly mesh: Mesh;
  private readonly pts: Vector3[];
  private readonly ages: Float32Array;
  private readonly pos: Float32Array;
  private readonly fade: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly fadeAttr: BufferAttribute;
  private readonly u = { uK: { value: 0 } };
  private count = 0;
  private strength = 0;
  private readonly last = new Vector3();

  /** halfWidth: 帯の横の半分（円盤の半径）・halfHeight: 縦の帯の半分（m） */
  constructor(
    private readonly halfWidth: number,
    private readonly halfHeight: number,
  ) {
    const n = T.points;
    this.pts = Array.from({ length: n }, () => new Vector3());
    this.ages = new Float32Array(n);
    // 帯 2 本 × 点ごとに 2 頂点
    this.pos = new Float32Array(n * 4 * 3);
    this.fade = new Float32Array(n * 4);
    const g = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    this.fadeAttr = new BufferAttribute(this.fade, 1).setUsage(DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aT', this.fadeAttr);
    const index: number[] = [];
    for (let r = 0; r < 2; r++)
      for (let i = 0; i < n - 1; i++) {
        const a = r * n * 2 + i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    g.setIndex(index);
    const head = new Color(XENOLITH_VISUAL.colors.trailHead);
    const tail = new Color(XENOLITH_VISUAL.colors.trailTail);
    this.mesh = new Mesh(
      g,
      new ShaderMaterial({
        uniforms: { ...this.u, uHead: { value: head }, uTail: { value: tail } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        vertexShader: /* glsl */ `
          attribute float aT;
          varying float vT;
          void main() {
            vT = aT;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uK;
          uniform vec3 uHead;
          uniform vec3 uTail;
          varying float vT;
          void main() {
            float t = clamp(vT, 0.0, 1.0);
            gl_FragColor = vec4(mix(uHead, uTail, t), clamp((1.0 - t) * (1.0 - t) * uK, 0.0, 1.0));
          }`,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** 履歴を消す（瞬間移動・場面の切り替え） */
  reset(): void {
    this.count = 0;
    this.strength = 0;
    this.mesh.visible = false;
  }

  /** 体の中心 center・速度 vel（m/秒）・進めた秒数 dt */
  update(center: Readonly<Vector3>, vel: Readonly<Vector3>, dt: number): void {
    const speed = vel.length();
    const want = speed > T.minSpeed ? Math.min(1, (speed - T.minSpeed) / 80) : 0;
    this.strength += (want - this.strength) * Math.min(1, dt * (want > this.strength ? 8 : 2.5));
    const n = this.pts.length;
    if (dt > 0) {
      const moved = center.distanceTo(this.last);
      const paused = moved < speed * dt * 0.2;
      this.last.copy(center);
      if (paused) {
        // 止まっている（撮影）: 速度から後ろへ点を並べる
        for (let i = 0; i < n; i++) {
          const age = (i / (n - 1)) * T.seconds;
          this.pts[i]?.copy(center).addScaledVector(vel, -age);
          this.ages[i] = age;
        }
        this.count = n;
      } else {
        for (let i = 0; i < this.count; i++) this.ages[i] = (this.ages[i] ?? 0) + dt;
        // 新しい点を前へ（古い点は後ろへずらす）
        for (let i = Math.min(this.count, n - 1); i > 0; i--) {
          this.pts[i]?.copy(this.pts[i - 1] ?? center);
          this.ages[i] = this.ages[i - 1] ?? 0;
        }
        this.pts[0]?.copy(center);
        this.ages[0] = 0;
        this.count = Math.min(n, this.count + 1);
        while (this.count > 1 && (this.ages[this.count - 1] ?? 0) > T.seconds) this.count--;
      }
    }
    this.mesh.visible = this.strength > 0.02 && this.count > 2;
    if (!this.mesh.visible) return;
    this.u.uK.value = this.strength * T.alpha;
    for (let i = 0; i < n; i++) {
      const j = Math.min(i, this.count - 1);
      const p = this.pts[j] ?? center;
      const q = this.pts[Math.min(j + 1, this.count - 1)] ?? p;
      dir.subVectors(p, q);
      if (dir.lengthSq() < 1e-6) dir.copy(vel);
      dir.normalize();
      across.crossVectors(worldUp, dir).normalize();
      const t = Math.min(1, (this.ages[j] ?? 0) / T.seconds);
      // 後ろほど細く
      const w = this.halfWidth * (1 - t * 0.55);
      const h = this.halfHeight * (1 - t * 0.6);
      const o = i * 6;
      this.pos[o] = p.x + across.x * w;
      this.pos[o + 1] = p.y;
      this.pos[o + 2] = p.z + across.z * w;
      this.pos[o + 3] = p.x - across.x * w;
      this.pos[o + 4] = p.y;
      this.pos[o + 5] = p.z - across.z * w;
      const v = (n + i) * 6;
      this.pos[v] = p.x;
      this.pos[v + 1] = p.y + h;
      this.pos[v + 2] = p.z;
      this.pos[v + 3] = p.x;
      this.pos[v + 4] = p.y - h;
      this.pos[v + 5] = p.z;
      const ft = i < this.count ? t : 1;
      this.fade[i * 2] = this.fade[i * 2 + 1] = ft;
      this.fade[(n + i) * 2] = this.fade[(n + i) * 2 + 1] = ft;
    }
    this.posAttr.needsUpdate = true;
    this.fadeAttr.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const m = this.mesh.material;
    if (m instanceof ShaderMaterial) m.dispose();
  }
}
