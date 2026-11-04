// 画面の傾き（9-4。ドラッグ操作）: 描画のカメラが地平線に対して右へ傾いている角度（rad。右へバンクすると正）。
// カメラは機体と一緒に傾くので、画面の上で押さえた点を地平線の基準に戻すのに使う
import { Vector3, type Camera } from 'three';

const right = new Vector3();
const up = new Vector3();
const back = new Vector3();

export function screenRoll(camera: Camera): number {
  camera.matrixWorld.extractBasis(right, up, back);
  return Math.atan2(-right.y, up.y);
}
