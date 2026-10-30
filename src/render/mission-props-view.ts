// ミッションの出現物（2-5）の描画: 輸送機（4-3 の機体モデルの生成器。太い胴体・高翼・4 発）と怪獣の仮実装（プリミティブ）。
// 種類ごとに InstancedMesh / Mesh 1 つ（追加の draw call は最大 2。出ていないものは描かない）。
// 怪獣は 6-1 で作り直す。地上目標（2-6）は ground-target-view.ts
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
import { KAIJU_PLACEHOLDER_CONFIG as KAIJU } from '../data/mission-props';
import type { MissionProps } from '../missions/mission-props';
import type { AircraftDetail } from '../data/aircraft-model';
import { TRANSPORT_SHAPE } from '../data/aircraft-shapes';
import { hitFlashScale } from './aircraft-model/accumulator';
import { buildAircraft } from './aircraft-model/build';
import { createPaintMaterial } from './aircraft-model/material';

const WHITE = new Color(0xffffff);
const FLASH = 0.75;
const TRANSPORT_FLASH = new Color().setScalar(hitFlashScale(TRANSPORT_SHAPE.bodyColor, FLASH));
const matrix = new Matrix4();
const forward = new Vector3();
const up = new Vector3(0, 1, 0);
const right = new Vector3();
const back = new Vector3();

/** 輸送機: 機体モデルの生成器（キャノピーも機体に入れる。ミサイルなし） */
function createTransportGeometry(detail: AircraftDetail): BufferGeometry {
  return buildAircraft(TRANSPORT_SHAPE, { detail, missiles: 0, mergeCanopy: true }).body;
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
  const mesh = new InstancedMesh(geometry, createPaintMaterial(), count);
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
  private readonly kaiju: Mesh;
  private readonly kaijuMaterial: MeshStandardMaterial;
  private detail: AircraftDetail = 'high';

  constructor(
    scene: Scene,
    private readonly props: MissionProps,
  ) {
    // 色は頂点の色（TRANSPORT_SHAPE）。インスタンスの色は被弾の光だけ
    this.transports = createInstanced(
      createTransportGeometry('high'),
      0xffffff,
      props.transports.length,
    );
    this.kaijuMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.kaiju = new Mesh(createKaijuGeometry(), this.kaijuMaterial);
    this.kaiju.castShadow = true;
    this.kaiju.visible = false;
    scene.add(this.transports, this.kaiju);
  }

  /** 画質（「低」は LOD）。変わったら輸送機のジオメトリを作り直す */
  setDetail(detail: AircraftDetail): void {
    if (detail === this.detail) return;
    this.detail = detail;
    this.transports.geometry.dispose();
    this.transports.geometry = createTransportGeometry(detail);
  }

  /** 描画フレームごとに呼ぶ。動くもの（輸送機・怪獣）は前ステップとの間を補間する */
  update(alpha: number): void {
    this.updateTransports(alpha);
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
      mesh.setColorAt(n, t.flashTimer > 0 ? TRANSPORT_FLASH : WHITE);
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
