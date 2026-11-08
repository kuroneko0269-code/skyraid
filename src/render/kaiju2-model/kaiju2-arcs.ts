// 10-7a: ネフィルガの電気の弧と稲妻（描画だけ。kaiju2-fx.ts から分けた）: 端から端をぎざぎざの帯でつなぐ（帯 1 つ = 1 draw call）。
// 乱数は Math.random（見た目だけ）
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { KAIJU2_VISUAL } from '../../data/kaiju2-visual';

const axis = new Vector3();
const side = new Vector3();
const nrm = new Vector3();
const toCam = new Vector3();
const tmp = new Vector3();

interface Arc {
  readonly a: Vector3;
  readonly b: Vector3;
  age: number;
  life: number;
  width: number;
  amp: number;
  intensity: number;
}

const SEG = 8;
const arcColor = new Color(KAIJU2_VISUAL.colors.lightning);

/** 電気の弧と稲妻: 端から端をぎざぎざの帯でつなぐ（毎フレーム形を変えて瞬く）。1 本 8 区間 = 48 頂点 */
export class Kaiju2Arcs {
  readonly mesh: Mesh;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly arcs: Arc[] = [];
  private next = 0;
  private readonly pts: Vector3[] = Array.from({ length: SEG + 1 }, () => new Vector3());

  constructor(readonly capacity: number) {
    const verts = Math.max(1, capacity) * SEG * 6;
    this.pos = new Float32Array(verts * 3);
    this.col = new Float32Array(verts * 3);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    g.setAttribute('color', new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage));
    this.mesh = new Mesh(
      g,
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    for (let i = 0; i < capacity; i++)
      this.arcs.push({
        a: new Vector3(),
        b: new Vector3(),
        age: 1,
        life: 0,
        width: 1,
        amp: 1,
        intensity: 1,
      });
  }

  /** a から b へ（life 秒・幅 m・ぎざぎざの振れ幅の割合・明るさ） */
  spark(
    a: Readonly<Vector3>,
    b: Readonly<Vector3>,
    life: number,
    width: number,
    amp = 0.18,
    intensity = 4,
  ): void {
    if (this.arcs.length === 0) return;
    const s = this.arcs[this.next];
    this.next = (this.next + 1) % this.arcs.length;
    if (!s) return;
    s.a.copy(a);
    s.b.copy(b);
    s.age = 0;
    s.life = life;
    s.width = width;
    s.amp = amp;
    s.intensity = intensity;
  }

  update(camera: Readonly<Vector3>, dt: number): void {
    let v = 0;
    for (const s of this.arcs) {
      if (s.age >= s.life) continue;
      s.age += dt;
      const fade = Math.max(0, 1 - s.age / s.life) * (0.6 + 0.4 * Math.random());
      const len = s.a.distanceTo(s.b);
      axis.subVectors(s.b, s.a).normalize();
      toCam.subVectors(camera, s.a);
      side.crossVectors(axis, toCam).normalize();
      nrm.crossVectors(axis, side).normalize();
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        const env = Math.sin(t * Math.PI) * len * s.amp;
        const p = this.pts[i];
        if (!p) continue;
        p.lerpVectors(s.a, s.b, t)
          .addScaledVector(side, (Math.random() - 0.5) * env)
          .addScaledVector(nrm, (Math.random() - 0.5) * env);
      }
      const c = s.intensity * fade;
      for (let i = 0; i < SEG; i++) {
        const p0 = this.pts[i];
        const p1 = this.pts[i + 1];
        if (!p0 || !p1) continue;
        toCam.subVectors(camera, p0);
        tmp.subVectors(p1, p0);
        side
          .crossVectors(tmp, toCam)
          .normalize()
          .multiplyScalar(s.width * Math.max(1, toCam.length() / 600));
        const quad = [
          [p0, -1],
          [p1, -1],
          [p1, 1],
          [p0, -1],
          [p1, 1],
          [p0, 1],
        ] as const;
        for (const [p, sg] of quad) {
          this.pos[v * 3] = p.x + side.x * sg;
          this.pos[v * 3 + 1] = p.y + side.y * sg;
          this.pos[v * 3 + 2] = p.z + side.z * sg;
          this.col[v * 3] = arcColor.r * c;
          this.col[v * 3 + 1] = arcColor.g * c;
          this.col[v * 3 + 2] = arcColor.b * c;
          v++;
        }
      }
    }
    const g = this.mesh.geometry;
    g.setDrawRange(0, v);
    this.mesh.visible = v > 0;
    if (v > 0) {
      const pa = g.getAttribute('position');
      const ca = g.getAttribute('color');
      pa.needsUpdate = true;
      ca.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
