import { WebGLRenderer } from 'three';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { GamepadInput, browserGamepads } from './core/gamepad';
import { loadTouchMode, saveTouchMode, shouldShowTouchControls } from './core/touch-settings';
import { parseDebugFlags, parseSkipTitle } from './core/debug-flags';
import { BOOT_TASKS, runBoot } from './core/boot';
import { GameState, isSimulating, syncLoopWithState, usesDemoCamera } from './core/game-state';
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
import { DemoCamera } from './render/demo-camera';
import { projectFlightPath } from './render/hud-projection';
import { RenderPipeline, getGpuRendererName } from './render/pipeline';
import { createWorldScene } from './render/scene';
import { getGroundHeight } from './render/terrain-height';
import { DebugOverlay } from './ui/debug-overlay';
import { Hud, type HudFrame } from './ui/hud';
import { createQualitySelect } from './ui/quality-select';
import {
  createFullscreenButton,
  createRotateHint,
  createToggleButton,
  createTouchModeSelect,
  installTouchGuards,
} from './ui/mobile';
import { TouchControls } from './ui/touch-controls';
import { Screens } from './ui/screens';

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
const demoCamera = new DemoCamera(camera);

// 画面状態（読み込み中 → タイトル → モード選択 → 飛行 ⇄ ポーズ）。DOM は ui/screens.ts
const game = new GameState();
const screens = new Screens(document.body, game);

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
// 設定（画質・タッチ・HUD・全画面）はポーズメニューの中
const settingsPanel = screens.pause.settings;
createQualitySelect(settingsPanel, quality.level, (level) => {
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

// タッチ操作: 自動（pointer: coarse のときだけ）/ 強制表示 / 強制非表示。設定は localStorage。飛行中だけ出す
const touchControls = new TouchControls(document.body, input);
createRotateHint(document.body);
let touchMode = loadTouchMode(storage);
const coarsePointer =
  typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
const refreshTouchVisibility = (): void => {
  touchControls.setVisible(
    game.state === 'flight' && shouldShowTouchControls(touchMode, coarsePointer?.matches ?? false),
  );
};
refreshTouchVisibility();
coarsePointer?.addEventListener('change', refreshTouchVisibility);
createTouchModeSelect(settingsPanel, touchMode, (mode) => {
  touchMode = mode;
  saveTouchMode(storage, mode);
  refreshTouchVisibility();
});
// HUD: H キー / ポーズメニューの設定のボタンで表示切替
const hud = new Hud(document.body);
const hudButton = createToggleButton(settingsPanel, 'HUD', hud.visible, () => {
  hud.toggle();
  return hud.visible;
});
createFullscreenButton(settingsPanel);
window.addEventListener('blur', () => {
  touchControls.reset();
});

// ?debug でデバッグ表示を初期表示、?debug=input で押したアクション名をコンソールに出す
const debugFlags = parseDebugFlags(window.location.search);
const overlay = new DebugOverlay(document.body, debugFlags.overlay);
const frameStats = new FrameStats();
let lastFrameMs: number | null = null;

// フリーフライト開始時に島の沖合から巡航速度で島へ向かう。?autolevel=off / ?invert で操作設定を変える
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
const flightPath = { x: 0, y: 0 };
const hudFrame: HudFrame = {
  speed: 0,
  throttle: 0,
  afterburnerGauge: 0,
  afterburnerActive: false,
  afterburnerLocked: false,
  x: 0,
  y: 0,
  z: 0,
  altitudeAboveGround: 0,
  stall: 0,
  orientation: aircraft.state.orientation,
  flightPath: null,
};

const loop = new GameLoop();
// 固定ステップ更新は飛行中だけ（ポーズ・メニュー中は GameLoop ごと止める）
syncLoopWithState(game, loop);
game.onChange(({ from, to }) => {
  if (to === 'flight' && from !== 'pause') startFreeFlight();
  // 止めている間に押されたキー（再開に使った Esc など）を飛行に持ち込まない
  if (to === 'flight') input.endStep();
  aircraftMesh.visible = !usesDemoCamera(to);
  refreshTouchVisibility();
});
aircraftMesh.visible = false;
// 島の周りを回る時間。海の波もこれで動かし、ポーズ中は止める
let worldTime = 0;

loop.onUpdate((dt) => {
  gamepad.poll();
  if (input.wasPressed('pause')) {
    input.endStep();
    game.transition('pause');
    return;
  }
  controls.pitch = input.axis('pitchDown', 'pitchUp');
  controls.roll = input.axis('rollLeft', 'rollRight');
  controls.yaw = input.axis('yawLeft', 'yawRight');
  controls.throttle = input.axis('throttleDown', 'throttleUp');
  controls.afterburner = input.isDown('afterburner');
  controls.throttleTarget = input.takeThrottleTarget();
  aircraft.step(controls, dt);
  if (input.wasPressed('cameraToggle')) chaseCamera.toggleMode();
  handleCommonKeys();
});
loop.onRender((alpha) => {
  const now = performance.now();
  const frameSeconds = lastFrameMs === null ? 0 : (now - lastFrameMs) / 1000;
  const state = game.state;
  if (!isSimulating(state)) menuTick();
  if (state !== 'pause') worldTime += frameSeconds;
  if (usesDemoCamera(state)) demoCamera.update(frameSeconds);
  else if (state === 'flight') updateFlightView(alpha, frameSeconds);
  world.update(camera.position, worldTime);
  if (state === 'flight' && hud.visible) updateHud();
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

// 起動シーケンス: 読み込み（今はアセットなしで即完了）を待ってからタイトルへ。?skipTitle なら飛行へ直行
void runBoot(BOOT_TASKS, (progress) => {
  screens.loading.setProgress(progress);
}).then(() => {
  game.transition(parseSkipTitle(window.location.search) ? 'flight' : 'title');
});

/** フリーフライトを始める（モード選択から入るたび、起動位置・巡航速度から） */
function startFreeFlight(): void {
  aircraft.respawn(WORLD_CONFIG.start);
  lastCrashCount = aircraft.crashCount;
  chaseCamera.snap();
}

/** 飛行中・メニュー中どちらでも効くキー（F3 / H）と入力ログ。固定更新 1 回分の終わりに呼ぶ */
function handleCommonKeys(): void {
  if (input.wasPressed('debugToggle')) overlay.toggle();
  if (input.wasPressed('hudToggle')) {
    hud.toggle();
    hudButton.sync(hud.visible);
  }
  if (debugFlags.logInput) {
    for (const action of ACTIONS) {
      if (input.wasPressed(action)) console.info(`[input] ${action}`);
    }
  }
  input.endStep();
}

/** 固定更新が止まっている間（タイトル・モード選択・ポーズ）の入力。描画フレームごとに呼ぶ */
function menuTick(): void {
  gamepad.poll();
  if (input.wasPressed('pause')) {
    // Esc / Start: ポーズ → 再開、モード選択 → タイトル
    if (game.state === 'pause') game.transition('flight');
    else if (game.state === 'mode_select') game.transition('title');
  }
  handleCommonKeys();
}

/** 追従カメラと機体の描画位置を更新する（飛行中だけ。ポーズ中はカメラも止める） */
function updateFlightView(alpha: number, frameSeconds: number): void {
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
  touchControls.syncThrottle(aircraft.throttle);
}

/** HUD に機体の状態を渡す（DOM の書き換えは HUD 側で変化があったときだけ） */
function updateHud(): void {
  const state = aircraft.state;
  const p = state.position;
  hudFrame.speed = state.speed;
  hudFrame.throttle = aircraft.throttle;
  hudFrame.afterburnerGauge = state.afterburnerGauge;
  hudFrame.afterburnerActive = state.afterburnerActive;
  hudFrame.afterburnerLocked = state.afterburnerLocked;
  hudFrame.x = p.x;
  hudFrame.y = p.y;
  hudFrame.z = p.z;
  hudFrame.altitudeAboveGround = p.y - getGroundHeight(p.x, p.z);
  hudFrame.stall = state.stall;
  hudFrame.flightPath = projectFlightPath(
    camera,
    aircraftMesh,
    window.innerWidth,
    window.innerHeight,
    flightPath,
  )
    ? flightPath
    : null;
  hud.update(hudFrame);
}
