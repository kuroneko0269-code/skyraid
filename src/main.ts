import { WebGLRenderer } from 'three';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { GamepadInput, browserGamepads } from './core/gamepad';
import { parseDebugFlags, parseSkipTitle } from './core/debug-flags';
import { BOOT_TASKS, runBoot } from './core/boot';
import { GameState, isSimulating, syncLoopWithState, usesDemoCamera } from './core/game-state';
import { parseFlightOptions } from './core/flight-options';
import { ACTIONS } from './data/keybinds';
import { QUALITY_CONFIG } from './data/quality';
import { WORLD_CONFIG } from './data/terrain';
import { MISSIONS } from './data/missions';
import { createControls } from './entities/aircraft';
import { createCombatInput } from './combat/combat-system';
import { WeaponInput } from './core/weapon-input';
import { readFlightControls } from './core/flight-input';
import { FlightSession } from './missions/flight-session';
import { GamePlay } from './missions/game-play';
import { bindMissionRewards } from './progression/mission-rewards';
import { FlightViews } from './render/flight-views';
import { HudLink } from './render/hud-link';
import { MissionLink } from './render/mission-link';
import { RingView } from './render/ring-view';
import { HangarStage } from './render/hangar-stage';
import { DebugLink } from './render/debug-link';
import { PlayerView } from './render/player-view';
import { ChaseCamera } from './render/chase-camera';
import { DemoCamera } from './render/demo-camera';
import { RenderPipeline } from './render/pipeline';
import { QualityLink } from './render/quality-link';
import { createWorldScene } from './render/scene';
import { getGroundHeight } from './render/terrain-height';
import { DamageOverlay } from './ui/damage-overlay';
import { createEnemySettings } from './ui/enemy-settings';
import { Hud } from './ui/hud';
import { createHudToggle } from './ui/hud-toggle';
import { MissionHud } from './ui/mission-hud';
import { createFullscreenButton, installTouchGuards } from './ui/mobile';
import { createSaveSettings } from './ui/save-settings';
import { openBrowserSave } from './ui/save-link';
import { createTouchLink } from './ui/touch-link';
import { Screens } from './ui/screens';
import { installAppShell } from './ui/app-shell';

const container = document.getElementById('app');
if (!container) throw new Error('#app が見つかりません');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const { scene, camera, world } = createWorldScene(renderer, window.innerWidth / window.innerHeight);
const pipeline = new RenderPipeline(renderer, scene, camera);
const playerView = new PlayerView(scene);
const aircraftMesh = playerView.mesh;
const chaseCamera = new ChaseCamera(camera);
// ハンガー（3-3）の機体の展示。表示中はカメラを展示の前に置く
const hangarStage = new HangarStage(scene, camera);
const demoCamera = new DemoCamera(camera);

// セーブ（3-1）: 進み具合・クレジット・パイロット名・設定。壊れていたら初期値にしてお知らせ
const save = openBrowserSave(document.body);
// 設定の部品は今までどおり StorageLike で読み書きし、セーブの設定に振り分ける
const storage = save.settingsStorage;

// 画面状態（タイトル →（初回: パイロット名 →）モード選択 →（ミッション一覧 → ブリーフィング →）飛行 ⇄ ポーズ →（リザルト））。
// ハンガー（3-3）はモード選択・ブリーフィングから
const game = new GameState();
const screens = new Screens(document.body, game, MISSIONS, save, () => {
  play.abortMission();
});
screens.onAircraftView((model) => {
  hangarStage.setModel(model, screens.hangar.loadout(model.id).missiles);
});

// 品質設定（初期判定・切り替え・自動ダウングレード）と露出
const quality = new QualityLink(renderer, pipeline, world, storage);
installTouchGuards(document);
installAppShell(document.body);
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
// HUD: H キー / ポーズメニューの設定のボタンで表示切替（3-1 から保存）。ミッションの HUD（2-4）も合わせる
const hud = new Hud(document.body);
const missionHud = new MissionHud(document.body);
const hudToggle = createHudToggle(settingsPanel, hud, missionHud, save);
createFullscreenButton(settingsPanel);

// ?debug でデバッグ表示を初期表示、?debug=input で押したアクション名をコンソールに出す
const debugFlags = parseDebugFlags(window.location.search);
const debug = new DebugLink(document.body, debugFlags.overlay, pipeline, world);
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
// 設定の最下部: セーブデータのコピー / 復元 / 削除。復元・削除の後は読み込み直して新しいセーブで始める
createSaveSettings(settingsPanel, save);
const damageOverlay = new DamageOverlay(document.body);
const controls = createControls();
const views = new FlightViews(scene, aircraftMesh, session);
// 機体モデルの細かさ（4-3。画質「低」は LOD）
quality.onPreset((preset) => {
  playerView.setDetail(preset.aircraftDetail);
  views.setAircraftDetail(preset.aircraftDetail);
});
const ringView = new RingView(scene);
const missionLink = new MissionLink(missionHud, camera, aircraftMesh, play);
play.onRunnerChange((runner) => {
  missionHud.attach(runner);
  screens.pause.setInMission(runner !== null);
  // 成功の記録と報酬をセーブへ（3-2）
  if (runner) bindMissionRewards(runner.bus, save, screens.progress);
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
  // 撃墜されたまま（ミッション失敗）のリザルトでは機体を隠す。ハンガーでは展示の機体だけ
  aircraftMesh.visible = !usesDemoCamera(to) && to !== 'hangar' && session.player.active;
  hangarStage.setShown(to === 'hangar');
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
  readFlightControls(input, controls);
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
  else if (state === 'hangar') hangarStage.update(frameSeconds);
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
    state === 'hangar'
      ? hangarStage.mesh.position
      : aircraftMesh.visible
        ? aircraftMesh.position
        : camera.position,
  );
  if (state === 'flight' && hud.visible)
    hudLink.update(alpha, window.innerWidth, window.innerHeight);
  if (state === 'flight') missionLink.update(window.innerWidth, window.innerHeight);
  pipeline.render();
  if (state === 'flight' && lastFrameMs !== null && quality.recordFlightFrame(frameSeconds)) {
    const { notice, noticeSeconds } = QUALITY_CONFIG.autoDowngrade;
    hud.showNotice(notice, noticeSeconds);
  }
  if (lastFrameMs !== null) debug.record(frameSeconds);
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
  applyPlayerLoadout();
  if (def) play.startMission(def);
  else play.startFree();
  views.reset();
  playerView.reset();
  chaseCamera.snap();
  quality.startWatch();
}

/** ハンガーで選んだ機体と強化を自機に入れる（3-3）。飛行を始めるたびに呼ぶ。見た目も機体の形に */
function applyPlayerLoadout(): void {
  const loadout = screens.hangar.loadout();
  session.applyLoadout(loadout);
  playerView.setModel(screens.hangar.selectedModel, loadout.missiles);
}

/** 飛行中・メニュー中どちらでも効くキー（F3 / H）と入力ログ。固定更新 1 回分の終わりに呼ぶ */
function handleCommonKeys(): void {
  if (input.wasPressed('debugToggle')) debug.toggle();
  if (input.wasPressed('hudToggle')) hudToggle.toggle();
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
  // Esc / Start: ポーズ → 再開、モード選択 → タイトルなど 1 つ前の画面へ
  if (input.wasPressed('pause')) screens.navigateBack(game);
  handleCommonKeys();
}

/** 追従カメラと機体の描画位置を更新する（飛行中だけ。ポーズ中はカメラも止める） */
function updateFlightView(alpha: number, frameSeconds: number): void {
  // 撃墜されている間は機体を隠す（破片は combat の撃墜の演出）
  aircraftMesh.visible = session.player.active;
  playerView.update(aircraft, controls, session.combat.missileAmmo.count, alpha, frameSeconds);
  // カメラが地面にめり込まないよう、前フレームのカメラ位置の地表の高さを渡す
  const groundUnderCamera = getGroundHeight(camera.position.x, camera.position.z);
  chaseCamera.update(aircraftMesh, aircraft.state, groundUnderCamera, frameSeconds);
  touch.controls.syncThrottle(aircraft.throttle);
  touch.controls.syncSecondary(weaponInput.secondary);
}
