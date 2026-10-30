// 機体の環境マップ（4-10 事前修正）: 4-1 の大気散乱のスカイドームを PMREM にして、影側を空の色で持ち上げる
import {
  Mesh,
  PMREMGenerator,
  Scene,
  Vector3,
  Vector4,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { SKY_CONFIG } from '../data/sky';
import type { Atmosphere } from './atmosphere';

/**
 * 空のドームを起動時に 1 回だけ低解像度のキューブに描き、PMREM（粗さごとのぼかし）にする。
 * 太陽の円盤とまぶしさは消して描く（太陽の光と鏡面の照り返しは平行光源の担当）。
 * 地平線より下はドームが描く遠くの海の色になるので、機体の腹は海の色で少し照らされる
 */
export function createSkyEnvironment(renderer: WebGLRenderer, atmosphere: Atmosphere): Texture {
  const cfg = SKY_CONFIG.environment;
  const material = atmosphere.mesh.material;
  const u = material.uniforms;
  const disc = u.uDiscRadiance?.value as number;
  const glow = (u.uGlow?.value as Vector4).clone();
  if (u.uDiscRadiance) u.uDiscRadiance.value = 0;
  (u.uGlow?.value as Vector4).set(0, 1, 0, 1);

  const position = new Vector3(0, cfg.height, 0);
  const scene = new Scene();
  const sky = new Mesh(atmosphere.mesh.geometry, material);
  sky.position.copy(position);
  scene.add(sky);
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0, 1, SKY_CONFIG.radius * 2, { size: cfg.size, position });
  pmrem.dispose();

  if (u.uDiscRadiance) u.uDiscRadiance.value = disc;
  (u.uGlow?.value as Vector4).copy(glow);
  return target.texture;
}
