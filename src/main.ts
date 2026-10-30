import { WebGLRenderer } from 'three';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { GamepadInput, browserGamepads } from './core/gamepad';
import { loadTouchMode, saveTouchMode, shouldShowTouchControls } from './core/touch-settings';
import { parseDebugFlags, parseSkipTitle } from './core/debug-flags';
import { BOOT_TASKS, runBoot } from './core/boot';
import { GameState, isSimulating, syncLoopWithState, usesDemoCamera } from './core/game-state';
import { FrameStats } from './core/frame-stats';
import { getBrowserStorage } from './core/settings';
import { parseFlightOptions } from './core/flight-options';
import { ACTIONS } from './data/keybinds';
import { QUALITY_CONFIG } from './data/quality';
import { WORLD_CONFIG } from './data/terrain';
import { createControls } from './entities/aircraft';
import { createCombatInput } from './combat/combat-system';
import { FreeFlight } from './missions/free-flight';
import { FlightViews } from './render/flight-views';
import { HudLink } from './render/hud-link';
import { applyInterpolatedPose, createPlaceholderAircraft } from './render/aircraft-mesh';
import { ChaseCamera } from './render/chase-camera';
import { DemoCamera } from './render/demo-camera';
import { RenderPipeline } from './render/pipeline';
import { QualityLink } from './render/quality-link';
import { createWorldScene } from './render/scene';
import { setShadowFlags } from './render/lighting';
import { getGroundHeight } from './render/terrain-height';
import { DamageOverlay } from './ui/damage-overlay';
import { DebugOverlay } from './ui/debug-overlay';
import { createEnemySettings } from './ui/enemy-settings';
import { Hud } from './ui/hud';
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
// 自機は影を落とし、自分の影（翼の影など）も受ける
setShadowFlags(aircraftMesh, true, true);
scene.add(aircraftMesh);
const chaseCamera = new ChaseCamera(camera);
const demoCamera = new DemoCamera(camera);

// 画面状態（読み込み中 → タイトル → モード選択 → 飛行 ⇄ ポーズ）。DOM は ui/screens.ts
const game = new GameState();
const screens = new Screens(document.body, game);

// 品質設定（初期判定・切り替え・自動ダウングレード）と露出
const storage = getBrowserStorage();
const quality = new QualityLink(renderer, pipeline, world, storage);
installTouchGuards(document);
// 設定（画質・タッチ・HUD・全画面）はポーズメニューの中
const settingsPanel = screens.pause.settings;
quality.createSelect(settingsPanel);

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

// フリーフライト: 島の沖合から巡航速度で島へ向かう。?autolevel=off / ?invert で操作設定を変える。
// 射撃（2-1）・ロックオンとミサイル（2-2）・敵機（2-3）。判定は固定ステップ、演出は描画フレーム
const freeFlight = new FreeFlight({
  groundHeight: getGroundHeight,
  flightOptions: parseFlightOptions(window.location.search),
  start: WORLD_CONFIG.start,
});
const { aircraft, combat } = freeFlight;
// 敵の有無・難易度（ポーズメニューの設定。localStorage に保存）
createEnemySettings(settingsPanel, storage, (enabled, difficulty) => {
  freeFlight.configureEnemies(enabled, difficulty);
  screens.modeSelect.setEnemiesEnabled(enabled);
});
const damageOverlay = new DamageOverlay(document.body);
const controls = createControls();
let lastCrashCount = aircraft.crashCount;
const views = new FlightViews(scene, aircraftMesh, freeFlight);
// 撃墜されたら揺らし、リスポーンしたらカメラを寄せ直す
freeFlight.onPlayerDown(() => {
  chaseCamera.addImpact();
});
freeFlight.onRespawn(() => {
  chaseCamera.snap();
});
const combatInput = createCombatInput();
const hudLink = new HudLink(hud, camera, aircraftMesh, freeFlight, getGroundHeight);
// HUD の対象をタップ（クリック）すると選ぶ。スティック・ボタンの上は canvas に届かない
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (game.state !== 'flight') return;
  const target = hudLink.pick(e.clientX, e.clientY);
  if (target) combat.targeting.select(target);
});

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
  combatInput.trigger = input.isDown('fire');
  combatInput.missile = input.wasPressed('missile');
  combatInput.flare = input.wasPressed('flare');
  combatInput.targetNext = input.wasPressed('targetNext');
  freeFlight.step(controls, combatInput, dt);
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
  views.update(alpha, state === 'flight' ? frameSeconds : 0, camera.position);
  const p = freeFlight.player;
  damageOverlay.update(
    p.flashTimer,
    p.isDestroyed,
    p.respawnTimer,
    isSimulating(state) || state === 'pause',
  );
  // 影は機体のまわり（タイトル・モード選択ではカメラのまわり）
  world.update(
    camera.position,
    worldTime,
    aircraftMesh.visible ? aircraftMesh.position : camera.position,
  );
  if (state === 'flight' && hud.visible)
    hudLink.update(alpha, window.innerWidth, window.innerHeight);
  pipeline.render();
  if (state === 'flight' && lastFrameMs !== null && quality.recordFlightFrame(frameSeconds)) {
    const { notice, noticeSeconds } = QUALITY_CONFIG.autoDowngrade;
    hud.showNotice(notice, noticeSeconds);
  }
  if (lastFrameMs !== null && frameStats.record(frameSeconds)) {
    const { triangleCount: terrainTriangles, visibleChunks: terrainChunks } = world.terrain;
    overlay.update({
      ...frameStats.latest,
      ...pipeline.lastStats,
      terrainTriangles,
      terrainChunks,
    });
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
  freeFlight.reset();
  lastCrashCount = aircraft.crashCount;
  views.reset();
  chaseCamera.snap();
  quality.startWatch();
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
  // 撃墜されている間は機体を隠す（破片は combat の撃墜の演出）
  aircraftMesh.visible = freeFlight.player.active;
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
