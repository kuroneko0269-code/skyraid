// リング（2-4）の描画: 次に通るリングは発光する Mesh、その先の数個は半透明の InstancedMesh（draw call 2）。
// 通過済みのリングと、リングの目標・レースが進行中でないときは描かない。
// 7-1 のリングレースは種類（通常 / ブースト / 細い / チェックポイント）で色を変え、見た目の半径はリングごと
import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
  type Scene,
} from 'three';
import { RACE_CONFIG } from '../data/race';
import { RING_CONFIG } from '../data/rings';
import type { Ring } from '../missions/objectives/ring';
import type { RingKind } from '../missions/race/types';
import { createEmissiveMaterial } from './materials';

/** 描くリングの列（ミッションのリングの目標・レース）。current は次に通るリングの番号 */
export interface RingTrack {
  readonly rings: readonly (Ring & { readonly radius?: number; readonly kind?: RingKind })[];
  readonly current: number;
  readonly next: Ring | null;
}

const Z_AXIS = new Vector3(0, 0, 1);
const pos = new Vector3();
const normal = new Vector3();
const quat = new Quaternion();
const scale = new Vector3();
const matrix = new Matrix4();
const color = new Color();

export class RingView {
  private readonly next: Mesh;
  private readonly nextMaterial: MeshStandardMaterial;
  private readonly others: InstancedMesh;

  constructor(scene: Scene) {
    const c = RING_CONFIG;
    // 輪の太さは半径 1 の輪に対する比で作り、大きさは scale で決める
    const geometry = new TorusGeometry(1, c.tube / c.radius, 10, 48);
    this.nextMaterial = createEmissiveMaterial(c.nextColor, c.nextIntensity);
    this.next = new Mesh(geometry, this.nextMaterial);
    this.next.visible = false;
    const material = new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.4,
      metalness: 0.1,
      transparent: true,
      opacity: 0.75,
    });
    this.others = new InstancedMesh(geometry, material, c.visibleAhead);
    this.others.instanceMatrix.setUsage(DynamicDrawUsage);
    this.others.frustumCulled = false;
    this.others.count = 0;
    this.others.visible = false;
    for (let i = 0; i < c.visibleAhead; i++) this.others.setColorAt(i, color.set(c.otherColor));
    scene.add(this.next, this.others);
  }

  /** 描画フレームごとに呼ぶ。track は進行中のリングの目標・レース（なければ null） */
  update(track: RingTrack | null): void {
    const next = track?.next ?? null;
    this.next.visible = next !== null;
    if (track && next) {
      const r = track.rings[track.current] ?? { ...next, kind: undefined };
      ringMatrix(r, matrix).decompose(this.next.position, this.next.quaternion, this.next.scale);
      this.nextMaterial.emissive.set(r.kind ? RACE_CONFIG.colors[r.kind] : RING_CONFIG.nextColor);
    }
    let n = 0;
    if (track) {
      const from = track.current + 1;
      const to = Math.min(track.rings.length, from + RING_CONFIG.visibleAhead);
      for (let i = from; i < to; i++) {
        const r = track.rings[i];
        if (!r) continue;
        this.others.setColorAt(
          n,
          color.set(r.kind ? RACE_CONFIG.colors[r.kind] : RING_CONFIG.otherColor),
        );
        this.others.setMatrixAt(n++, ringMatrix(r, matrix));
      }
    }
    this.others.count = n;
    this.others.visible = n > 0;
    this.others.instanceMatrix.needsUpdate = true;
    if (this.others.instanceColor) this.others.instanceColor.needsUpdate = true;
  }
}

/** リングの位置・向き（輪の面の法線を +Z から回す）・大きさ */
function ringMatrix(r: RingTrack['rings'][number], out: Matrix4): Matrix4 {
  pos.set(r.position.x, r.position.y, r.position.z);
  normal.set(r.normal.x, r.normal.y, r.normal.z);
  quat.setFromUnitVectors(Z_AXIS, normal);
  scale.setScalar(r.radius ?? RING_CONFIG.radius);
  return out.compose(pos, quat, scale);
}
