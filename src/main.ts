import { WebGLRenderer } from 'three';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { GamepadInput, browserGamepads } from './core/gamepad';
import { parseDebugFlags, parseSkipTitle } from './core/debug-flags';
import { BOOT_TASKS, runBoot } from './core/boot';
import { GameState, isSimulating, syncLoopWithState, usesDemoCamera } from './core/game-state';
import { FrameStats } from './core/frame-stats';
import { getBrowserStorage } from './core/settings';
import { parseFlightOptions } from './core/flight-options';
import { ACTIONS } from './data/keybinds';
import { QUALITY_CONFIG } from './data/quality';
import { WORLD_CONFIG } from './data/terrain';
import { MISSIONS } from './data/missions';
import { createControls } from './entities/aircraft';
import { createCombatInput } from './combat/combat-system';
import { WeaponInput } from './core/weapon-input';
import { FlightSession } from './missions/flight-session';
import { GamePlay } from './missions/game-play';
import { FlightViews } from './render/flight-views';
import { HudLink } from './render/hud-link';
import { MissionLink } from './render/mission-link';
import { RingView } from './render/ring-view';
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
import { MissionHud } from './ui/mission-hud';
import { createFullscreenButton, createToggleButton, installTouchGuards } from './ui/mobile';
import { createTouchLink } from './ui/touch-link';
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

// 画面状態（タイトル → モード選択 →（ミッション一覧 → ブリーフィング →）飛行 ⇄ ポーズ →（リザルト））。DOM は ui/screens.ts
const game = new GameState();
const screens = new Screens(document.body, game, MISSIONS, () => {
  play.abortMission();
});

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

// タッチ操作（自動 / 強制表示 / 強制非表示）。飛行中だけ出す
const touch = createTouchLink(
  document.body,
  input,
  storage,
  settingsPanel,
  () => game.state === 'flight',
);
// HUD: H キー / ポーズメニューの設定のボタンで表示切替。ミッションの HUD（2-4）も合わせる
const hud = new Hud(document.body);
const missionHud = new MissionHud(document.body);
const toggleHud = (): boolean => {
  hud.toggle();
  missionHud.setHudVisible(hud.visible);
  return hud.visible;
};
const hudButton = createToggleButton(settingsPanel, 'HUD', hud.visible, toggleHud);
createFullscreenButton(settingsPanel);

// ?debug でデバッグ表示を初期表示、?debug=input で押したアクション名をコンソールに出す
const debugFlags = parseDebugFlags(window.location.search);
const overlay = new DebugOverlay(document.body, debugFlags.overlay);
const frameStats = new FrameStats();
let lastFrameMs: number | null = null;

// 飛行: フリーフライトは島の沖合から、ミッション（2-4）は定義の開始位置から。?autolevel=off / ?invert で操作設定を変える。
// 射撃（2-1）・ロックオンとミサイル（2-2）・敵機（2-3）。判定は固定ステップ、演出は描画フレーム
const session = new FlightSession({
  groundHeight: getGroundHeight,
  flightOptions: parseFlightOptions(window.location.search),
  start: WORLD_CONFIG.start,
});
const play = new GamePlay(session);
const { aircraft } = session;
// 敵の有無・難易度（ポーズメニューの設定。localStorage に保存）
createEnemySettings(settingsPanel, storage, (enabled, difficulty) => {
  session.configureEnemies(enabled, difficulty);
  screens.modeSelect.setEnemiesEnabled(enabled);
});
const damageOverlay = new DamageOverlay(document.body);
const controls = createControls();
const views = new FlightViews(scene, aircraftMesh, session);
const ringView = new RingView(scene);
const missionLink = new MissionLink(missionHud, camera, aircraftMesh, play);
play.onRunnerChange((runner) => {
  missionHud.attach(runner);
  screens.pause.setInMission(runner !== null);
  // 報酬の受け皿（保存・残高はフェーズ3）。今は知らせるだけ
  runner?.bus.on('mission:reward', ({ missionId, credits, rank }) => {
    console.info(`[mission] ${missionId}: rank ${rank ?? '-'} / ${credits} CR`);
  });
});
// 撃墜（地面への墜落も）されたら揺らし、リスポーンしたらカメラを寄せ直す
session.onPlayerDown(() => {
  chaseCamera.addImpact();
});
session.onRespawn(() => {
  chaseCamera.snap();
});
const combatInput = createCombatInput();
// 武器の操作（タッチ・パッドの長押しで兵装の切替・爆弾。2-6）
const weaponInput = new WeaponInput();
const hudLink = new HudLink(hud, camera, aircraftMesh, session, getGroundHeight, weaponInput);
// HUD の対象をタップ（クリック）すると選ぶ。スティック・ボタンの上は canvas に届かない
hudLink.bindTap(renderer.domElement, () => game.state === 'flight');

const loop = new GameLoop();
// 固定ステップ更新は飛行中だけ（ポーズ・メニュー中は GameLoop ごと止める）
syncLoopWithState(game, loop);
game.onChange(({ from, to }) => {
  if (to === 'flight' && from !== 'pause') startFlight(from === 'briefing' || from === 'result');
  if (to === 'pause') play.runner?.pause();
  else if (to === 'flight') play.runner?.resume();
  // 止めている間に押されたキー（再開に使った Esc など）を飛行に持ち込まない
  if (to === 'flight') {
    input.endStep();
    weaponInput.reset();
  }
  // 撃墜されたまま（ミッション失敗）のリザルトでは機体を隠す
  aircraftMesh.visible = !usesDemoCamera(to) && session.player.active;
  touch.refresh();
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
  weaponInput.read(input, combatInput, dt);
  play.step(controls, combatInput, dt);
  if (input.wasPressed('cameraToggle')) chaseCamera.toggleMode();
  handleCommonKeys();
  // ミッションが終わり、大きな文字を出し終えたらリザルトへ（固定更新もここで止まる）
  const runner = play.runner;
  if (runner?.readyForResult && runner.result) {
    screens.showResult(runner.result);
    game.transition('result');
  }
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
  ringView.update(play.runner?.running ? play.runner.activeRings : null);
  const p = session.player;
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
  if (state === 'flight') missionLink.update(window.innerWidth, window.innerHeight);
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

/**
 * 飛行を始める（モード選択・ブリーフィング・リザルトの「もう一度」から入るたび）。
 * フリーフライトは起動位置から、ミッションは選んだミッションの開始位置から
 */
function startFlight(mission: boolean): void {
  const def = mission ? screens.selectedMission : null;
  if (def) play.startMission(def);
  else play.startFree();
  views.reset();
  chaseCamera.snap();
  quality.startWatch();
}

/** 飛行中・メニュー中どちらでも効くキー（F3 / H）と入力ログ。固定更新 1 回分の終わりに呼ぶ */
function handleCommonKeys(): void {
  if (input.wasPressed('debugToggle')) overlay.toggle();
  if (input.wasPressed('hudToggle')) hudButton.sync(toggleHud());
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
    else if (game.state === 'mission_select') game.transition('mode_select');
    else if (game.state === 'briefing') game.transition('mission_select');
  }
  handleCommonKeys();
}

/** 追従カメラと機体の描画位置を更新する（飛行中だけ。ポーズ中はカメラも止める） */
function updateFlightView(alpha: number, frameSeconds: number): void {
  // 撃墜されている間は機体を隠す（破片は combat の撃墜の演出）
  aircraftMesh.visible = session.player.active;
  applyInterpolatedPose(
    aircraftMesh,
    aircraft.prevPosition,
    aircraft.state.position,
    aircraft.prevOrientation,
    aircraft.state.orientation,
    alpha,
  );
  // カメラが地面にめり込まないよう、前フレームのカメラ位置の地表の高さを渡す
  const groundUnderCamera = getGroundHeight(camera.position.x, camera.position.z);
  chaseCamera.update(aircraftMesh, aircraft.state, groundUnderCamera, frameSeconds);
  touch.controls.syncThrottle(aircraft.throttle);
  touch.controls.syncSecondary(weaponInput.secondary);
}
