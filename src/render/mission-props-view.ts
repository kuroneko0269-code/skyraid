// ミッションの出現物（2-5）の描画: 輸送機（4-3 の機体モデルの生成器。太い胴体・高翼・4 発）と怪獣（6-1。
// 手続き生成のモデル kaiju-model/。部位 6 + 熱線 + 岩で draw call 8）。出ていないものは描かない。
// 怪獣の表示元は差し替えられる（協力のクライアントはホストの状態の写し。6-2）。地上目標（2-6）は ground-target-view.ts
import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import type { KaijuBodyView, KaijuEffectsView } from '../entities/kaiju-display';
import type { MissionProps } from '../missions/mission-props';
import type { AircraftDetail } from '../data/aircraft-model';
import { TRANSPORT_SHAPE } from '../data/aircraft-shapes';
import { hitFlashScale } from './aircraft-model/accumulator';
import { buildAircraft } from './aircraft-model/build';
import { createPaintMaterial } from './aircraft-model/material';
import { KaijuObject } from './kaiju-model/kaiju-object';

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
  private readonly kaiju: KaijuObject;
  /** 怪獣の表示元（null はミッションの怪獣） */
  private kaijuSource: { body: KaijuBodyView; fx: KaijuEffectsView | null } | null = null;
  private detail: AircraftDetail = 'high';
  private lastMs: number | null = null;

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
    this.kaiju = new KaijuObject('high');
    scene.add(this.transports, ...this.kaiju.objects);
  }

  /** 画質（「低」は LOD）。変わったら輸送機のジオメトリを作り直す */
  setDetail(detail: AircraftDetail): void {
    if (detail === this.detail) return;
    this.detail = detail;
    this.transports.geometry.dispose();
    this.transports.geometry = createTransportGeometry(detail);
    this.kaiju.setDetail(detail);
  }

  /** 怪獣の表示元を差し替える（協力のクライアント。null でミッションの怪獣に戻す） */
  setKaijuSource(body: KaijuBodyView | null, fx: KaijuEffectsView | null = null): void {
    this.kaijuSource = body ? { body, fx } : null;
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
    const now = performance.now();
    const dt = this.lastMs === null ? 0 : Math.min(0.1, (now - this.lastMs) / 1000);
    this.lastMs = now;
    const src = this.kaijuSource;
    if (src) this.kaiju.update(src.body, src.fx, alpha, dt);
    else this.kaiju.update(this.props.kaiju, this.props.kaijuAi, alpha, dt);
  }
}

function finish(mesh: InstancedMesh, n: number): void {
  mesh.count = n;
  mesh.visible = n > 0;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
