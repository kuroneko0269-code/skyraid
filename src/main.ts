import { WebGLRenderer } from 'three';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { ACTIONS } from './data/keybinds';
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

const input = new Input();
input.attach(window);

// URL に ?debug=input を付けると、押したアクション名をコンソールに出す（入力確認用）
const logInput = new URLSearchParams(window.location.search).get('debug') === 'input';

const loop = new GameLoop();
loop.onUpdate(() => {
  // 飛行モデル等の更新は 1-1 以降でここに登録する
  if (logInput) {
    for (const action of ACTIONS) {
      if (input.wasPressed(action)) console.info(`[input] ${action}`);
    }
  }
  input.endStep();
});
loop.onRender(() => {
  renderer.render(scene, camera);
});
loop.start();
