import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
} from 'three';
import { SCENE_CONFIG } from '../data/scene';

export interface WorldScene {
  scene: Scene;
  camera: PerspectiveCamera;
}

/** 空の色と地面の板だけの最小シーンを作る */
export function createWorldScene(aspect: number): WorldScene {
  const cfg = SCENE_CONFIG;
  const scene = new Scene();
  scene.background = new Color(cfg.skyColor);
  scene.fog = new Fog(cfg.skyColor, cfg.fogNear, cfg.fogFar);

  const hemi = new HemisphereLight(
    cfg.hemiLight.skyColor,
    cfg.hemiLight.groundColor,
    cfg.hemiLight.intensity,
  );
  scene.add(hemi);

  const sun = new DirectionalLight(cfg.sunLight.color, cfg.sunLight.intensity);
  sun.position.set(cfg.sunLight.position.x, cfg.sunLight.position.y, cfg.sunLight.position.z);
  scene.add(sun);

  const ground = new Mesh(
    new PlaneGeometry(cfg.groundSize, cfg.groundSize),
    new MeshStandardMaterial({ color: cfg.groundColor, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const camera = new PerspectiveCamera(cfg.camera.fov, aspect, cfg.camera.near, cfg.camera.far);
  camera.position.set(cfg.camera.position.x, cfg.camera.position.y, cfg.camera.position.z);
  camera.lookAt(cfg.camera.lookAt.x, cfg.camera.lookAt.y, cfg.camera.lookAt.z);

  return { scene, camera };
}
