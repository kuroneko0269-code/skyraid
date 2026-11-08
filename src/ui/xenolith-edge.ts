// 10-5a / 10-5b: UFO ゼノリスを見失ったときの手がかり（ゼノリスの遅延チャンク）: 画面の外のゼノリス（水色）と、画面の外の
// 瞬間移動の移る先（白く点滅。動作を減らす設定では点滅しない: xenolith-dev.css）の向きを画面の端に出す。画面の中なら隠す
import { Vector3, type Camera } from 'three';

const ndc = new Vector3();
const view = new Vector3();

/** 画面の端の印（画面の外の点の向き）。画面の中なら隠す */
export function placeEdge(el: HTMLElement, camera: Camera, x: number, y: number, z: number): void {
  camera.updateMatrixWorld();
  view.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
  ndc.set(x, y, z).project(camera);
  const behind = view.z > 0;
  let nx = ndc.x;
  let ny = ndc.y;
  if (behind) {
    nx = -nx;
    ny = -ny;
  }
  const inside = !behind && Math.abs(nx) <= 1 && Math.abs(ny) <= 1;
  el.hidden = inside;
  if (inside) return;
  if (behind && Math.abs(nx) < 1e-3 && Math.abs(ny) < 1e-3) ny = -1;
  const m = Math.max(Math.abs(nx), Math.abs(ny)) || 1;
  const k = 0.9 / m;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const px = (nx * k * 0.5 + 0.5) * w;
  const py = (-ny * k * 0.5 + 0.5) * h;
  const angle = Math.atan2(-ny, nx);
  el.style.transform = `translate(${px.toFixed(1)}px, ${(py - 11).toFixed(1)}px) rotate(${angle.toFixed(3)}rad)`;
}

/** 本体と瞬間移動の移る先の 2 つの印 */
export class XenolithEdges {
  private readonly body: HTMLDivElement;
  private readonly warp: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.body = document.createElement('div');
    this.body.className = 'xenolith-edge';
    this.body.hidden = true;
    this.warp = document.createElement('div');
    this.warp.className = 'xenolith-edge is-warp';
    this.warp.hidden = true;
    parent.append(this.body, this.warp);
  }

  /** body は本体の描く位置、warp は予兆の間の移る先（無ければ null） */
  update(
    camera: Camera,
    body: { readonly x: number; readonly y: number; readonly z: number },
    warp: { readonly x: number; readonly y: number; readonly z: number } | null,
  ): void {
    placeEdge(this.body, camera, body.x, body.y, body.z);
    if (warp) placeEdge(this.warp, camera, warp.x, warp.y, warp.z);
    else this.warp.hidden = true;
  }

  hide(): void {
    this.body.hidden = true;
    this.warp.hidden = true;
  }
}
