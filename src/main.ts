import { WebGLRenderer } from 'three';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { parseDebugFlags } from './core/debug-flags';
import { FrameStats } from './core/frame-stats';
import {
  QualitySettings,
  getBrowserStorage,
  isTouchDevice,
  resolveInitialQuality,
} from './core/settings';
import { ACTIONS } from './data/keybinds';
import { RenderPipeline, getGpuRendererName } from './render/pipeline';
import { createWorldScene } from './render/scene';
import { DebugOverlay } from './ui/debug-overlay';
import { createQualitySelect } from './ui/quality-select';

const container = document.getElementById('app');
if (!container) {
  throw new Error('#app が見つかりません');
}

const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const { scene, camera } = createWorldScene(window.innerWidth / window.innerHeight);
const pipeline = new RenderPipeline(renderer, scene, camera);

// 品質設定: 保存された手動設定 > 自動判定（タッチ端末・低性能 GPU は low）
const storage = getBrowserStorage();
const quality = new QualitySettings(
  storage,
  resolveInitialQuality(storage, {
    touch: isTouchDevice(),
    gpuRenderer: getGpuRendererName(renderer),
  }),
);
pipeline.applyQuality(quality.preset);
quality.onChange((_level, preset) => {
  pipeline.applyQuality(preset);
});
createQualitySelect(document.body, quality.level, (level) => {
  quality.set(level);
});

window.addEventListener('resize', () => {
  pipeline.resize(window.innerWidth, window.innerHeight);
});

const input = new Input();
input.attach(window);

// ?debug でデバッグ表示を初期表示、?debug=input で押したアクション名をコンソールに出す
const debugFlags = parseDebugFlags(window.location.search);
const overlay = new DebugOverlay(document.body, debugFlags.overlay);
const frameStats = new FrameStats();
let lastFrameMs: number | null = null;

const loop = new GameLoop();
loop.onUpdate(() => {
  // 飛行モデル等の更新は 1-1 以降でここに登録する
  if (input.wasPressed('debugToggle')) overlay.toggle();
  if (debugFlags.logInput) {
    for (const action of ACTIONS) {
      if (input.wasPressed(action)) console.info(`[input] ${action}`);
    }
  }
  input.endStep();
});
loop.onRender(() => {
  pipeline.render();
  const now = performance.now();
  if (lastFrameMs !== null && frameStats.record((now - lastFrameMs) / 1000)) {
    const { fps, frameMs } = frameStats.latest;
    const { drawCalls, triangles } = pipeline.lastStats;
    overlay.update({ fps, frameMs, drawCalls, triangles });
  }
  lastFrameMs = now;
});
loop.start();
