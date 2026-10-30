// 機体の描画位置の補間（自機・ハンガー以外でも使う）。機体の形は src/render/aircraft-model/（4-3）
import { Quaternion, Vector3, type Object3D } from 'three';
import type { Quat, Vec3 } from '../flight/math';

const prevPos = new Vector3();
const currPos = new Vector3();
const prevQuat = new Quaternion();
const currQuat = new Quaternion();

/** 前ステップと現ステップの間を alpha で補間して object に反映する */
export function applyInterpolatedPose(
  object: Object3D,
  prevPosition: Readonly<Vec3>,
  position: Readonly<Vec3>,
  prevOrientation: Readonly<Quat>,
  orientation: Readonly<Quat>,
  alpha: number,
): void {
  prevPos.set(prevPosition.x, prevPosition.y, prevPosition.z);
  currPos.set(position.x, position.y, position.z);
  object.position.lerpVectors(prevPos, currPos, alpha);
  prevQuat.set(prevOrientation.x, prevOrientation.y, prevOrientation.z, prevOrientation.w);
  currQuat.set(orientation.x, orientation.y, orientation.z, orientation.w);
  object.quaternion.slerpQuaternions(prevQuat, currQuat, alpha);
}
