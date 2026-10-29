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
import { parseFlightOptions } from './core/flight-options';
import { FLIGHT_CONFIG } from './data/flight';
import { ACTIONS } from './data/keybinds';
import { Aircraft, type AircraftControls } from './entities/aircraft';
import { applyInterpolatedPose, createPlaceholderAircraft } from './render/aircraft-mesh';
import { ChaseCamera } from './render/chase-camera';
import { RenderPipeline, getGpuRendererName } from './render/pipeline';
import { createWorldScene } from './render/scene';
import { WorldHelpers } from './render/world-helpers';
import { DebugOverlay } from './ui/debug-overlay';
import { createQualitySelect } from './ui/quality-select';

const container = document.getElementById('app');
if (!container) {
  throw new Error('#app が見つかりません');
}

const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const { scene, camera, ground } = createWorldScene(window.innerWidth / window.innerHeight);
const pipeline = new RenderPipeline(renderer, scene, camera);
const worldHelpers = new WorldHelpers(scene, ground);
const aircraftMesh = createPlaceholderAircraft();
scene.add(aircraftMesh);
const chaseCamera = new ChaseCamera(camera);

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

// 起動直後から巡航速度で飛んでいる。?autolevel=off / ?invert で操作設定を変える
const aircraft = new Aircraft(undefined, parseFlightOptions(window.location.search));
const controls: AircraftControls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false };
let lastCrashCount = aircraft.crashCount;

const loop = new GameLoop();
loop.onUpdate((dt) => {
  controls.pitch = input.axis('pitchDown', 'pitchUp');
  controls.roll = input.axis('rollLeft', 'rollRight');
  controls.yaw = input.axis('yawLeft', 'yawRight');
  controls.throttle = input.axis('throttleDown', 'throttleUp');
  controls.afterburner = input.isDown('afterburner');
  aircraft.step(controls, dt);
  if (input.wasPressed('debugToggle')) overlay.toggle();
  if (input.wasPressed('cameraToggle')) chaseCamera.toggleMode();
  if (debugFlags.logInput) {
    for (const action of ACTIONS) {
      if (input.wasPressed(action)) console.info(`[input] ${action}`);
    }
  }
  input.endStep();
});
loop.onRender((alpha) => {
  const now = performance.now();
  const frameSeconds = lastFrameMs === null ? 0 : (now - lastFrameMs) / 1000;
  applyInterpolatedPose(
    aircraftMesh,
    aircraft.prevPosition,
    aircraft.state.position,
    aircraft.prevOrientation,
    aircraft.state.orientation,
    alpha,
  );
  if (aircraft.crashCount !== lastCrashCount) {
    lastCrashCount = aircraft.crashCount;
    chaseCamera.snap();
    chaseCamera.addImpact();
  }
  // 地形が入る 1-3 までは地面の高さは一定
  chaseCamera.update(aircraftMesh, aircraft.state, FLIGHT_CONFIG.groundAltitude, frameSeconds);
  worldHelpers.update(aircraftMesh.position);
  pipeline.render();
  if (lastFrameMs !== null && frameStats.record(frameSeconds)) {
    const { fps, frameMs } = frameStats.latest;
    const { drawCalls, triangles } = pipeline.lastStats;
    overlay.update({ fps, frameMs, drawCalls, triangles });
  }
  lastFrameMs = now;
});
loop.start();
