import { Vector3, type Object3D, type PerspectiveCamera } from 'three';

// 機首方向のこの距離先の点を投影する（遠いほどカメラ位置のずれの影響が小さい）
const PROJECT_DISTANCE = 1000;
const tmp = new Vector3();

/**
 * 進行方向マーカーの画面座標（px、左上原点）を out に書く。横滑りなしのモデルなので
 * 進行方向 = 機首方向。カメラの後ろにあるときは false を返す
 */
export function projectFlightPath(
  camera: PerspectiveCamera,
  aircraft: Object3D,
  width: number,
  height: number,
  out: { x: number; y: number },
): boolean {
  // 機体ローカルの前方は -Z
  tmp.set(0, 0, -PROJECT_DISTANCE).applyQuaternion(aircraft.quaternion).add(aircraft.position);
  tmp.project(camera);
  if (tmp.z > 1) return false;
  out.x = (tmp.x * 0.5 + 0.5) * width;
  out.y = (-tmp.y * 0.5 + 0.5) * height;
  return true;
}
