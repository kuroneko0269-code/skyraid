// 10-7b: 怪獣の大きさを比べる鳥の群れ（描画だけ）: 体の横を一緒に飛ぶ小さな鳥（くの字の三角形 2 つ）を InstancedMesh 1 つで。
// 群れの中心は体の横・少し下をゆっくり回り、鳥ごとにずれて羽ばたく。乱数は Math.random（見た目だけ）
import {
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';

interface Bird {
  /** 群れの中心からのずれ（体の右・上・前 m）と、ずれがゆれる位相・羽ばたきの位相 */
  readonly off: Vector3;
  phase: number;
  flap: number;
}

const m4 = new Matrix4();
const q = new Quaternion();
const p = new Vector3();
const s3 = new Vector3();
const right = new Vector3();
const yAxis = new Vector3(0, 1, 0);

/** 鳥 1 羽（前 −Z・翼の端から端 1）: くの字の翼 2 枚 */
function birdGeometry(): BufferGeometry {
  const pos = [
    // 左の翼
    0, 0, -0.12, -0.5, 0.06, 0.1, 0, 0, 0.12,
    // 右の翼
    0, 0, -0.12, 0, 0, 0.12, 0.5, 0.06, 0.1,
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

export class KaijuBirds {
  readonly mesh: InstancedMesh;
  private readonly birds: Bird[] = [];
  private time = 0;

  /** count 羽・翼の端から端 span m・群れの広がり spread m・色 */
  constructor(
    count: number,
    private readonly span: number,
    private readonly spread: number,
    color: number,
  ) {
    this.mesh = new InstancedMesh(
      birdGeometry(),
      new MeshBasicMaterial({ color, side: DoubleSide }),
      Math.max(1, count),
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    for (let i = 0; i < count; i++)
      this.birds.push({
        off: new Vector3(
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread * 0.35,
          (Math.random() - 0.5) * spread * 1.6,
        ),
        phase: Math.random() * Math.PI * 2,
        flap: Math.random(),
      });
  }

  /**
   * center は群れの中心（ワールド）、heading は体の向き（ラジアン。前 −Z を Y 軸回りに）、speed は体の速さ（羽ばたきの速さ）。
   * show が false なら隠す
   */
  update(center: Readonly<Vector3>, heading: number, dt: number, show: boolean): void {
    this.time += dt;
    if (!show || this.birds.length === 0) {
      this.mesh.visible = false;
      return;
    }
    const t = this.time;
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    right.set(c, 0, -s);
    let n = 0;
    for (const b of this.birds) {
      // 群れの中でゆっくり入れ替わる（円を描く）
      const w = t * 0.35 + b.phase;
      const ox = b.off.x + Math.sin(w) * this.spread * 0.12;
      const oy = b.off.y + Math.sin(w * 1.7) * this.spread * 0.05;
      const oz = b.off.z + Math.cos(w) * this.spread * 0.12;
      p.set(center.x + right.x * ox - s * oz, center.y + oy, center.z + right.z * ox - c * oz);
      // 進む向き（体と同じ）に、少し傾けてゆらす
      q.setFromAxisAngle(yAxis, heading + Math.sin(w) * 0.25);
      b.flap += dt * (2.2 + (b.phase % 1));
      const flap = 0.35 + 0.65 * Math.abs(Math.sin(b.flap * Math.PI * 2));
      s3.set(this.span * flap, this.span * (1.6 - flap), this.span);
      m4.compose(p, q, s3);
      this.mesh.setMatrixAt(n++, m4);
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
