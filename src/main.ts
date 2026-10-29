import { WebGLRenderer } from 'three';
import { SCENE_CONFIG } from './data/scene';
import { createWorldScene } from './render/scene';

const container = document.getElementById('app');
if (!container) {
  throw new Error('#app が見つかりません');
}

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, SCENE_CONFIG.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const { scene, camera } = createWorldScene(window.innerWidth / window.innerHeight);

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// 固定タイムステップのループは 0-2 で core/loop.ts に実装する。ここでは描画のみ
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
