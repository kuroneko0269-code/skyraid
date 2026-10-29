import { WebGLRenderer } from 'three';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { GamepadInput, browserGamepads } from './core/gamepad';
import { loadTouchMode, saveTouchMode, shouldShowTouchControls } from './core/touch-settings';
import { parseDebugFlags } from './core/debug-flags';
import { FrameStats } from './core/frame-stats';
import {
  QualitySettings,
  getBrowserStorage,
  isTouchDevice,
  resolveInitialQuality,
} from './core/settings';
import { parseFlightOptions } from './core/flight-options';
import { ACTIONS } from './data/keybinds';
import { WORLD_CONFIG } from './data/terrain';
import { Aircraft, type AircraftControls } from './entities/aircraft';
import { applyInterpolatedPose, createPlaceholderAircraft } from './render/aircraft-mesh';
import { ChaseCamera } from './render/chase-camera';
import { RenderPipeline, getGpuRendererName } from './render/pipeline';
import { createWorldScene } from './render/scene';
import { getGroundHeight } from './render/terrain-height';
import { DebugOverlay } from './ui/debug-overlay';
import { createQualitySelect } from './ui/quality-select';
import {
  createFullscreenButton,
  createRotateHint,
  createSettingsBar,
  createTouchModeSelect,
  installTouchGuards,
} from './ui/mobile';
import { TouchControls } from './ui/touch-controls';

const container = document.getElementById('app');
if (!container) {
  throw new Error('#app が見つかりません');
}

const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const { scene, camera, world } = createWorldScene(window.innerWidth / window.innerHeight);
const pipeline = new RenderPipeline(renderer, scene, camera);
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
world.applyQuality(quality.preset);
quality.onChange((_level, preset) => {
  pipeline.applyQuality(preset);
  world.applyQuality(preset);
});
installTouchGuards(document);
const settingsBar = createSettingsBar(document.body);
createQualitySelect(settingsBar, quality.level, (level) => {
  quality.set(level);
});

window.addEventListener('resize', () => {
  pipeline.resize(window.innerWidth, window.innerHeight);
});

const input = new Input();
input.attach(window);

// ゲームパッド: 接続されたら自動で読む
const gamepad = new GamepadInput(input, browserGamepads);
gamepad.attach(window);

// タッチ操作: 自動（pointer: coarse のときだけ）/ 強制表示 / 強制非表示。設定は localStorage
const touchControls = new TouchControls(document.body, input);
createRotateHint(document.body);
let touchMode = loadTouchMode(storage);
const coarsePointer =
  typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
const refreshTouchVisibility = (): void => {
  touchControls.setVisible(shouldShowTouchControls(touchMode, coarsePointer?.matches ?? false));
};
refreshTouchVisibility();
coarsePointer?.addEventListener('change', refreshTouchVisibility);
createTouchModeSelect(settingsBar, touchMode, (mode) => {
  touchMode = mode;
  saveTouchMode(storage, mode);
  refreshTouchVisibility();
});
createFullscreenButton(settingsBar);
window.addEventListener('blur', () => {
  touchControls.reset();
});

// ?debug でデバッグ表示を初期表示、?debug=input で押したアクション名をコンソールに出す
const debugFlags = parseDebugFlags(window.location.search);
const overlay = new DebugOverlay(document.body, debugFlags.overlay);
const frameStats = new FrameStats();
let lastFrameMs: number | null = null;

// 起動直後から島の沖合を巡航速度で島へ向かって飛んでいる。?autolevel=off / ?invert で操作設定を変える
const aircraft = new Aircraft(
  undefined,
  parseFlightOptions(window.location.search),
  undefined,
  getGroundHeight,
);
aircraft.respawn(WORLD_CONFIG.start);
const controls: AircraftControls = {
  pitch: 0,
  roll: 0,
  yaw: 0,
  throttle: 0,
  afterburner: false,
  throttleTarget: null,
};
let lastCrashCount = aircraft.crashCount;

const loop = new GameLoop();
loop.onUpdate((dt) => {
  gamepad.poll();
  controls.pitch = input.axis('pitchDown', 'pitchUp');
  controls.roll = input.axis('rollLeft', 'rollRight');
  controls.yaw = input.axis('yawLeft', 'yawRight');
  controls.throttle = input.axis('throttleDown', 'throttleUp');
  controls.afterburner = input.isDown('afterburner');
  controls.throttleTarget = input.takeThrottleTarget();
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
  // カメラが地面にめり込まないよう、前フレームのカメラ位置の地表の高さを渡す
  const groundUnderCamera = getGroundHeight(camera.position.x, camera.position.z);
  chaseCamera.update(aircraftMesh, aircraft.state, groundUnderCamera, frameSeconds);
  world.update(camera.position, now / 1000);
  touchControls.syncThrottle(aircraft.throttle);
  pipeline.render();
  if (lastFrameMs !== null && frameStats.record(frameSeconds)) {
    const { fps, frameMs } = frameStats.latest;
    const { drawCalls, triangles } = pipeline.lastStats;
    const { triangleCount: terrainTriangles, visibleChunks: terrainChunks } = world.terrain;
    overlay.update({ fps, frameMs, drawCalls, triangles, terrainTriangles, terrainChunks });
  }
  lastFrameMs = now;
});
loop.start();
