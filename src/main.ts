import { WebGLRenderer } from 'three';
import { GameLoop } from './core/loop';
import { parseSkipTitle } from './core/debug-flags';
import { BOOT_TASKS, runBoot } from './core/boot';
import { GameState } from './core/game-state';
import { parseFlightOptions, parseFlightOverrides } from './core/flight-options';
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
import { HangarStage } from './render/hangar-stage';
import { PlayerView } from './render/player-view';
import { ChaseCamera } from './render/chase-camera';
import { DemoCamera } from './render/demo-camera';
import { RenderPipeline } from './render/pipeline';
import { QualityLink } from './render/quality-link';
import { createWorldScene } from './render/scene';
import { ActiveMap } from './missions/active-map';
import { DamageOverlay } from './ui/damage-overlay';
import { AssistControl } from './core/assist-control';
import { KaijuHud } from './ui/kaiju-hud';
import { KaijuHudLink } from './render/kaiju-hud-link';
import { installTouchGuards } from './ui/mobile';
import { createGameSettings } from './ui/settings-link';
import { FlightFrame } from './render/flight-frame';
import { createControlsLink } from './ui/controls-link';
import { TutorialLink } from './ui/tutorial-link';
import { openBrowserSave } from './ui/save-link';
import { Screens } from './ui/screens';
import { installAppShell } from './ui/app-shell';
import { createGameAudio } from './audio/setup';
import { FxEvents } from './render/fx/fx-events';
import { FrameFx } from './render/frame-fx';
import { createFlightStarter } from './ui/flight-start';
import { linkWeather } from './ui/weather-link';
import { linkFlightLoop } from './ui/flight-loop';
import { createPvpWiring } from './ui/pvp-wiring';
import { linkMissionEvents } from './ui/mission-wiring';
import { createAppControls } from './ui/app-controls';
import { createPhotoMode } from './ui/photo/photo-link';
import { createRaceLink } from './ui/race-link';
import { GhostView } from './render/ghost-view';

const container = document.getElementById('app');
if (!container) throw new Error('#app が見つかりません');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const { scene, camera, world } = createWorldScene(renderer, window.innerWidth / window.innerHeight);
// 今のマップ（6-4）: 地面の高さ・街。切り替えると地形・水深・木・街を作り直す
const activeMap = new ActiveMap();
const getGroundHeight = activeMap.ground;
activeMap.onChange((m) => {
  world.setMap(m);
});
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

const { input, gamepad, hud, missionHud, settingsParts, touch, debug, keys } = createAppControls({
  game,
  screens,
  save,
  storage,
  pipeline,
  world,
  photoTouch: () => photo.showsTouch,
  photoToggle: () => {
    photo.toggle();
  },
});

// 飛行: フリーフライトは島の沖合から、ミッション（2-4）は定義の開始位置から。?autolevel=off / ?invert で操作設定を変える。
// 射撃（2-1）・ロックオンとミサイル（2-2）・敵機（2-3）。判定は固定ステップ、演出は描画フレーム
const session = new FlightSession({
  groundHeight: getGroundHeight,
  buildings: () => activeMap.buildings,
  flightOptions: parseFlightOptions(window.location.search),
  start: WORLD_CONFIG.start,
});
const play = new GamePlay(session);
// 怪獣の HUD（6-2）: 体力バー・フェーズ・ロック中の部位・予兆・スタンのノイズ
const kaijuHud = new KaijuHudLink(new KaijuHud(document.body), hud, session);
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
const { pvp, coopKaiju } = createPvpWiring({
  screens,
  search,
  game,
  scene,
  camera,
  session,
  playerView,
  save,
  audio,
  groundHeight: getGroundHeight,
  activeMap,
  input,
  fxEvents,
  views,
  kaijuHud,
  quality,
});
const ringView = new RingView(scene);
const missionLink = new MissionLink(missionHud, camera, aircraftMesh, play);
linkMissionEvents({
  session,
  activeMap,
  play,
  screens,
  missionHud,
  tutorial,
  save,
  chaseCamera,
  playerView,
  groundHeight: getGroundHeight,
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

// 天候（7-5）: 飛行・メニュー・ブリーフィング・ロビーの天候、HUD のマーカーと夜の減光、環境音
linkWeather(world.weather, { game, screens, pvp, hud, hudLink, audio, save });
// リングレース（7-1）: コース一覧・HUD・リザルト・音・ゴースト（天候の配線の後: レースの天候で上書きする）
const ghost = new GhostView(scene);
const race = createRaceLink({
  game,
  screens,
  play,
  save,
  audio,
  weather: world.weather,
  ghost,
  hud,
});
const startFlight = createFlightStarter({
  activeMap,
  screens,
  session,
  play,
  playerView,
  views,
  chaseCamera,
  quality,
  pvp,
  race,
});

const loop = new GameLoop();
const { simulate } = linkFlightLoop(loop, {
  game,
  input,
  gamepad,
  keys,
  controls,
  combatInput,
  weaponInput,
  assist,
  pvp,
  play,
  session,
  activeMap,
  chaseCamera,
  screens,
  tutorial,
  coopKaiju,
  touch,
  hangarStage,
  aircraftMesh,
  startFlight,
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
// フォトモード（7-A）: ポーズメニュー・P キー。フリーフライト・キャンペーン・ソロのレイドだけ（時間は止める）
const photo = createPhotoMode({
  game,
  canvas: renderer.domElement,
  camera,
  pipeline,
  playerView,
  views,
  pause: screens.pause,
  groundHeight: getGroundHeight,
  weather: world.weather,
  audio,
  save,
  allowed: () => !pvp.flying && !screens.inTutorial,
  simulate,
  stepSeconds: loop.stepSeconds,
  refreshTouch: () => {
    touch.refresh();
  },
});
frame.photo = photo;

loop.onRender((alpha) => {
  pvp.render(alpha);
  race.render(alpha);
  frame.render(game.state, alpha, keys.menuTick);
  if (game.state === 'flight') kaijuHud.update();
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
