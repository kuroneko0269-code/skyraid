import { WebGLRenderer } from 'three';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { GamepadInput, browserGamepads } from './core/gamepad';
import { parseDebugFlags, parseSkipTitle } from './core/debug-flags';
import { BOOT_TASKS, runBoot } from './core/boot';
import { GameState, syncLoopWithState, usesDemoCamera } from './core/game-state';
import { parseFlightOptions, parseFlightOverrides } from './core/flight-options';
import { CommonKeys } from './core/common-keys';
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
import { AssistControl } from './core/assist-control';
import { Hud } from './ui/hud';
import { MissionHud } from './ui/mission-hud';
import { installTouchGuards } from './ui/mobile';
import { createDisplaySettings, createGameSettings } from './ui/settings-link';
import { FlightFrame } from './render/flight-frame';
import { createControlsLink } from './ui/controls-link';
import { TutorialLink } from './ui/tutorial-link';
import { openBrowserSave } from './ui/save-link';
import { Screens } from './ui/screens';
import { installAppShell } from './ui/app-shell';
import { createGameAudio } from './audio/setup';
import { FxEvents } from './render/fx/fx-events';
import { FrameFx } from './render/frame-fx';
import { PvpEntry } from './ui/pvp-entry';
import { createFlightStarter } from './ui/flight-start';

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

const hud = new Hud(document.body);
const missionHud = new MissionHud(document.body);
// ポーズメニューの設定: タッチ・HUD・全画面（ここ）→ 敵・操作補助・セーブデータ（セッションの後）
const settingsParts = {
  panel: settingsPanel,
  input,
  storage,
  save,
  hud,
  missionHud,
  modeSelect: screens.modeSelect,
  inFlight: () => game.state === 'flight',
};
const { touch, hudToggle } = createDisplaySettings(settingsParts);

// ?debug でデバッグ表示を初期表示、?debug=input で押したアクション名をコンソールに出す
const debugFlags = parseDebugFlags(window.location.search);
const debug = new DebugLink(document.body, debugFlags.overlay, pipeline, world);
const back = screens.navigateBack.bind(screens, game);
const keys = new CommonKeys(input, gamepad, { debug, hud: hudToggle }, back, debugFlags.logInput);

// 飛行: フリーフライトは島の沖合から、ミッション（2-4）は定義の開始位置から。?autolevel=off / ?invert で操作設定を変える。
// 射撃（2-1）・ロックオンとミサイル（2-2）・敵機（2-3）。判定は固定ステップ、演出は描画フレーム
const session = new FlightSession({
  groundHeight: getGroundHeight,
  flightOptions: parseFlightOptions(window.location.search),
  start: WORLD_CONFIG.start,
});
const play = new GamePlay(session);
const { aircraft } = session;
const assistFlags = createGameSettings(settingsParts, session);
const assist = new AssistControl(session, assistFlags, () => input.lastDevice);
const damageOverlay = new DamageOverlay(document.body);
const controls = createControls();
// エフェクトと音のきっかけ（4-4）。被弾・近くの爆発でカメラを揺らす
const fxEvents = new FxEvents(session, getGroundHeight);
const views = new FlightViews(scene, aircraftMesh, session, fxEvents, camera.position, (k) => {
  chaseCamera.addImpact(k);
});
const audio = createGameAudio(session, fxEvents, getGroundHeight, settingsPanel, save);
// 操作設定（4-11）: 感度・デッドゾーン・反転・オートレベル（URL の ?invert / ?autolevel が優先）・左右入替・振動・大きさ・キー割当
const overrides = parseFlightOverrides(window.location.search);
createControlsLink(settingsPanel, save, input, touch.controls, session, fxEvents, overrides);
// チュートリアル（4-11）の指示と、タッチ操作のヒント。指示の「中断」はモード選択へ
const tutorial = new TutorialLink(document.body, save, input, touch, hud, () => {
  screens.abortTutorial(game);
});
const frameFx = new FrameFx(pipeline, playerView, camera, audio);
// PvP（5-1）: 選んだとき・?room のときだけ通信の部分を読み込む
const search = window.location.search;
const pvp = new PvpEntry(screens, search, {
  game,
  scene,
  camera,
  session,
  playerView,
  pilotName: () => save.pilotName,
  groundHeight: getGroundHeight,
  // 5-3: スコアボードは Tab（ターゲット切替のキー）の長押し、他プレイヤーの機銃は敵機と同じ位置付きの音
  scoreKeyDown: () => input.isDown('targetNext'),
  otherGun: (x, y, z) => {
    fxEvents.otherGun(x, y, z);
  },
});
// 機体モデルの細かさ（4-3。画質「低」は LOD）と陽炎の屈折（4-4。「高」だけ）
quality.onPreset((preset) => {
  playerView.setDetail(preset.aircraftDetail);
  views.setAircraftDetail(preset.aircraftDetail);
  playerView.setHazeRefraction(preset.heatHazeRefraction);
  pvp.setAircraftDetail(preset.aircraftDetail);
});
const ringView = new RingView(scene);
const missionLink = new MissionLink(missionHud, camera, aircraftMesh, play);
play.onRunnerChange((runner) => {
  const inTutorial = screens.inTutorial;
  missionHud.attach(runner);
  screens.pause.setInMission(
    runner !== null,
    inTutorial ? screens.tutorialText.abortMenu : undefined,
  );
  tutorial.attach(runner, inTutorial);
  // 成功の記録と報酬をセーブへ（3-2）。チュートリアルの報酬は初回だけ（TutorialLink）
  if (runner && !inTutorial) bindMissionRewards(runner.bus, save, screens.progress);
});
// 撃墜（地面への墜落も）されたら揺らし、リスポーンしたら機体とカメラを新しい位置へすぐ移す（4-12b。
// 次の描画を待つと、揺れ・地面の高さ・飛行機雲が撃墜された場所のまま 1 フレーム残る）
session.onPlayerDown(() => {
  chaseCamera.addImpact();
});
session.onRespawn(() => {
  playerView.respawn(aircraft);
  chaseCamera.snapTo(aircraftMesh, aircraft.state, getGroundHeight);
});
const combatInput = createCombatInput();
// 武器の操作（タッチ・パッドの長押しで兵装の切替・爆弾。2-6）
const weaponInput = new WeaponInput();
const hudLink = new HudLink(
  hud,
  camera,
  aircraftMesh,
  session,
  getGroundHeight,
  weaponInput,
  () => assistFlags.hud,
);
// HUD の対象をタップ（クリック）すると選ぶ。スティック・ボタンの上は canvas に届かない
hudLink.bindTap(renderer.domElement, () => game.state === 'flight');

const startFlight = createFlightStarter({
  screens,
  session,
  play,
  playerView,
  views,
  chaseCamera,
  quality,
  pvp,
});

const loop = new GameLoop();
// 固定ステップ更新は飛行中だけ（ポーズ・メニュー中は GameLoop ごと止める）
syncLoopWithState(game, loop);
game.onChange(({ from, to }) => {
  if (to === 'flight' && from !== 'pause') startFlight(screens.nextMission, from === 'lobby');
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
  if (to === 'flight' && from !== 'pause')
    tutorial.onFlightStart(screens.inTutorial ? 'tutorial' : play.runner ? 'mission' : 'free');
});
aircraftMesh.visible = false;
const frame = new FlightFrame({
  pipeline,
  world,
  camera,
  playerView,
  chaseCamera,
  demoCamera,
  hangarStage,
  views,
  ringView,
  damageOverlay,
  hud,
  hudLink,
  missionLink,
  frameFx,
  quality,
  debug,
  session,
  play,
  controls,
  touch: touch.controls,
  weaponInput,
  assistFlags,
  groundHeight: getGroundHeight,
});

loop.onUpdate((dt) => {
  gamepad.poll();
  // PvP の飛行中はゲームを止めず、Esc で PvP のメニュー
  if (input.wasPressed('pause') && !pvp.togglePause()) {
    input.endStep();
    game.transition('pause');
    return;
  }
  readFlightControls(input, controls);
  assist.apply(controls);
  weaponInput.read(input, combatInput, dt);
  if (pvp.flying) pvp.step(controls, combatInput, dt);
  else play.step(controls, combatInput, dt);
  if (input.wasPressed('cameraToggle')) chaseCamera.toggleMode();
  keys.handle();
  // ミッションが終わり、大きな文字を出し終えたらリザルトへ（固定更新もここで止まる）
  const runner = play.runner;
  if (runner?.readyForResult && runner.result) {
    screens.showResult(runner.result, tutorial.paid);
    game.transition('result');
  }
});
loop.onRender((alpha) => {
  pvp.render(alpha);
  frame.render(game.state, alpha, keys.menuTick);
  tutorial.update(game.state === 'flight');
});
loop.start();

// 起動シーケンス: 読み込み（今はアセットなしで即完了）を待ってからタイトルへ。?skipTitle なら飛行へ直行
void runBoot(BOOT_TASKS, (progress) => {
  screens.loading.setProgress(progress);
}).then(() => {
  game.transition(parseSkipTitle(search) ? 'flight' : 'title');
  pvp.joinFromUrl();
});
