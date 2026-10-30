// ミッションの出現物（2-5）の描画: 輸送機・怪獣の仮実装・地上目標の仮置き。どれもプリミティブのプレースホルダーで、
// 種類ごとに InstancedMesh / Mesh 1 つ（追加の draw call は最大 3。出ていないものは描かない）。
// 怪獣は 6-1、地上目標は 2-6 で作り直す
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  GROUND_TARGET_PLACEHOLDER_CONFIG as GROUND,
  KAIJU_PLACEHOLDER_CONFIG as KAIJU,
  TRANSPORT_CONFIG as TRANSPORT,
} from '../data/mission-props';
import type { MissionProps } from '../missions/mission-props';

const WHITE = new Color(0xffffff);
const FLASH = 0.75;
const color = new Color();
const matrix = new Matrix4();
const forward = new Vector3();
const up = new Vector3(0, 1, 0);
const right = new Vector3();
const back = new Vector3();

/** 輸送機: 胴体・主翼・水平尾翼・垂直尾翼（前方 -Z、翼幅 30m・長さ 26m） */
function createTransportGeometry(): BufferGeometry {
  const parts = [
    new BoxGeometry(4.2, 4.2, 26),
    new BoxGeometry(30, 0.6, 5).translate(0, 1.2, -1),
    new BoxGeometry(11, 0.4, 3).translate(0, 1.8, 11),
    new BoxGeometry(0.5, 6, 4).translate(0, 4.5, 11),
  ];
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

/** 怪獣: 胴（箱）+ 頭（円錐）。足元が原点、前方 -Z。頭だけ色を変える（頂点カラー） */
function createKaijuGeometry(): BufferGeometry {
  const b = KAIJU.body;
  const headHeight = KAIJU.height - b.height;
  const body = new BoxGeometry(b.width, b.height, b.depth).translate(0, b.height / 2, 0);
  const head = new ConeGeometry(KAIJU.headRadius, headHeight, 12).translate(
    0,
    b.height + headHeight / 2,
    0,
  );
  const paint = (g: BufferGeometry, hex: number): BufferGeometry => {
    const c = new Color(hex);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
    g.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return g.index ? g.toNonIndexed() : g;
  };
  const parts = [paint(body, KAIJU.color), paint(head, KAIJU.headColor)];
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

function createInstanced(geometry: BufferGeometry, hex: number, count: number): InstancedMesh {
  const mesh = new InstancedMesh(
    geometry,
    new MeshStandardMaterial({ roughness: 0.6, metalness: 0.2 }),
    count,
  );
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  const base = new Color(hex);
  for (let i = 0; i < count; i++) mesh.setColorAt(i, base);
  mesh.count = 0;
  mesh.visible = false;
  return mesh;
}

export class MissionPropsView {
  private readonly transports: InstancedMesh;
  private readonly groundTargets: InstancedMesh;
  private readonly kaiju: Mesh;
  private readonly kaijuMaterial: MeshStandardMaterial;
  private readonly transportColor = new Color(TRANSPORT.color);
  private readonly groundColor = new Color(GROUND.color);

  constructor(
    scene: Scene,
    private readonly props: MissionProps,
  ) {
    this.transports = createInstanced(
      createTransportGeometry(),
      TRANSPORT.color,
      props.transports.length,
    );
    const s = GROUND.size;
    this.groundTargets = createInstanced(
      new BoxGeometry(s.width, s.height, s.depth),
      GROUND.color,
      props.groundTargets.length,
    );
    this.groundTargets.receiveShadow = true;
    this.kaijuMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.kaiju = new Mesh(createKaijuGeometry(), this.kaijuMaterial);
    this.kaiju.castShadow = true;
    this.kaiju.visible = false;
    scene.add(this.transports, this.groundTargets, this.kaiju);
  }

  /** 描画フレームごとに呼ぶ。動くもの（輸送機・怪獣）は前ステップとの間を補間する */
  update(alpha: number): void {
    this.updateTransports(alpha);
    this.updateGroundTargets();
    this.updateKaiju(alpha);
  }

  private updateTransports(alpha: number): void {
    const mesh = this.transports;
    let n = 0;
    for (const t of this.props.transports) {
      if (!t.active) continue;
      const p = t.position;
      const q = t.prevPosition;
      // 水平に飛ぶので、向きは進む向きの水平成分（上は +Y）
      const d = t.direction;
      forward.set(d.x, 0, d.z).normalize();
      right.crossVectors(forward, up).normalize();
      back.copy(forward).negate();
      matrix
        .makeBasis(right, up, back)
        .setPosition(
          q.x + (p.x - q.x) * alpha,
          q.y + (p.y - q.y) * alpha,
          q.z + (p.z - q.z) * alpha,
        );
      mesh.setMatrixAt(n, matrix);
      const flash = t.flashTimer > 0 ? FLASH : 0;
      mesh.setColorAt(n, color.copy(this.transportColor).lerp(WHITE, flash));
      n++;
    }
    finish(mesh, n);
  }

  private updateGroundTargets(): void {
    const mesh = this.groundTargets;
    let n = 0;
    for (const g of this.props.groundTargets) {
      if (!g.active) continue;
      matrix.makeTranslation(g.position.x, g.position.y, g.position.z);
      mesh.setMatrixAt(n, matrix);
      const flash = g.flashTimer > 0 ? FLASH : 0;
      mesh.setColorAt(n, color.copy(this.groundColor).lerp(WHITE, flash));
      n++;
    }
    finish(mesh, n);
  }

  private updateKaiju(alpha: number): void {
    const k = this.props.kaiju;
    this.kaiju.visible = k.visible;
    if (!k.visible) return;
    const p = k.feet;
    const q = k.prevFeet;
    this.kaiju.position.set(
      q.x + (p.x - q.x) * alpha,
      q.y + (p.y - q.y) * alpha,
      q.z + (p.z - q.z) * alpha,
    );
    // 前方（-Z）を向いている方位へ
    this.kaiju.rotation.set(0, Math.atan2(-k.facing.x, -k.facing.z), 0);
    this.kaijuMaterial.emissive.setScalar(k.flashTimer > 0 ? 0.5 : 0);
  }
}

function finish(mesh: InstancedMesh, n: number): void {
  mesh.count = n;
  mesh.visible = n > 0;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
