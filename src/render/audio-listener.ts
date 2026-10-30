// 音のリスナー（4-4）: カメラの位置と向き（前方・上方向）を音へ渡す形にする
import { Vector3, type Camera } from 'three';
import type { ListenerPose } from '../audio/game-audio';

const forward = new Vector3();
const up = new Vector3();

export function listenerPose(camera: Camera, out: ListenerPose): ListenerPose {
  camera.getWorldDirection(forward);
  up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  out.x = camera.position.x;
  out.y = camera.position.y;
  out.z = camera.position.z;
  out.fx = forward.x;
  out.fy = forward.y;
  out.fz = forward.z;
  out.ux = up.x;
  out.uy = up.y;
  out.uz = up.z;
  return out;
}
