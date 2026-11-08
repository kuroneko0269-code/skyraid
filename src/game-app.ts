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
import { ActiveMap } from './missions/active-map';
import { DamageOverlay } from './ui/damage-overlay';
import { KaijuHud } from './ui/kaiju-hud';
import { KaijuHudLink } from './render/kaiju-hud-link';
import { createGameSettings } from './ui/settings-link';
import { createControlsLink } from './ui/controls-link';
import { TutorialLink } from './ui/tutorial-link';
import { Screens } from './ui/screens';
import { createGameAudio } from './audio/setup';
import { FxEvents } from './render/fx/fx-events';
import { FrameFx } from './render/frame-fx';
import { linkWeather } from './ui/weather-link';
import { createPvpWiring } from './ui/pvp-wiring';
import { createInputAssist } from './ui/input-assist-link';
import { linkMissionEvents } from './ui/mission-wiring';
import { createAppControls } from './ui/app-controls';
import { createDefenseLink } from './ui/defense-link';
import { createSimWorld, createSoloLinks } from './ui/solo-links';
import { FREE_FLIGHT_ENEMIES } from './data/ai';
import { DEFENSE_CONFIG } from './data/defense';
import { ReplayHub } from './replay/hub';
import { startFlightRuntime } from './ui/flight-runtime';
import { linkOnline } from './ui/online-link';
import { linkContextLoss } from './ui/context-loss';
import { createLanguageSettings } from './ui/language-settings';
import { linkTiltPause } from './ui/tilt-settings';
import { screenRoll } from './render/screen-roll';
import { linkKaiju2, linkKaijuArtDev } from './ui/kaiju2-link';
import { linkAlbion } from './ui/albion-link';
import { linkGourai } from './ui/gourai-link';
import type { AppShell } from './app';
import { CityView } from './render/city/city-view';

/** 殻（app.ts）に返す、読み込んだ後の入口 */
export interface GameApp {
  /** タイトルの「タップで開始」（初回はパイロット名の入力、それ以外はモード選択へ） */
  readonly titleStart: () => void;
  /** タイトルの歯車（設定画面） */
  readonly titleSettings: () => void;
  /** 起動の読み込みの後（タイトルか ?skipTitle の飛行へ移った後）に呼ぶ: ?room の参加 */
  readonly afterBoot: () => void;
}

/**
 * 10-1: ゲーム本体（飛行・戦闘・HUD・音・メニューの画面・各モード）を組み立てる。タイトルと背景の 3D は殻（app.ts）が先に出し、
 * これは遅延チャンク（play-*）で読む。中身と並びは 1.1.0 の startApp の続きと同じ（殻へ移したものを shell から受け取る）
 */
export function startGame(shell: AppShell): GameApp {
  const { renderer, scene, camera, world, pipeline, demoCamera, save, game, quality } = shell;
  // 街（6-4。港湾都市）の描画は本体のチャンクに（10-1）
  world.createCity = (buildings, count) => new CityView(buildings, count);
  // 今のマップ（6-4）: 地面の高さ・街。切り替えると地形・水深・木・街を作り直す
  const activeMap = new ActiveMap();
  const getGroundHeight = activeMap.ground;
  activeMap.onChange((m) => {
    world.setMap(m);
  });
  const playerView = new PlayerView(scene);
  const aircraftMesh = playerView.mesh;
  const chaseCamera = new ChaseCamera(camera);
  // ハンガー（3-3）の機体の展示。表示中はカメラを展示の前に置く
  const hangarStage = new HangarStage(scene, camera);

  // 設定の部品は今までどおり StorageLike で読み書きし、セーブの設定に振り分ける
  const storage = save.settingsStorage;

  // 画面状態（タイトル →（初回: パイロット名 →）モード選択 →（ミッション一覧 → ブリーフィング →）飛行 ⇄ ポーズ →（リザルト））。
  // ハンガー（3-3）はモード選択・ブリーフィングから
  const screens = new Screens(document.body, game, MISSIONS, save, shell.screens, () => {
    play.abortMission();
  });
  screens.onAircraftView((model) => {
    hangarStage.setModel(model, screens.hangar.loadout(model.id).missiles);
  });
  // 7-3: ハンガーの塗装（試し塗りもすぐ反映）と、塗装タブの上からのカメラ
  screens.paintHooks = hangarStage.paintHooks;

  // 設定（7-D: 設定画面のタブごとの slot。画質・HUD・音量・操作補助はポーズメニューにも貸す）
  const settingsUi = screens.settings;
  quality.createSelect(settingsUi.slot('quality'));
  // 8-4: 言語の切り替え（選ぶとセーブして読み込み直す。飛行中は切り替えない）
  createLanguageSettings(settingsUi.slot('language'), {
    setLanguage: (locale) => {
      save.setSetting('language', locale);
    },
    inFlight: () => screens.settingsNav.route.origin === 'pause',
  });

  const { input, gamepad, hud, missionHud, settingsParts, touch, debug, keys } = createAppControls({
    game,
    screens,
    save,
    storage,
    pipeline,
    world,
    photoTouch: () => runtime.photo.showsTouch,
    photoToggle: () => {
      runtime.photo.toggle();
    },
  });

  // 飛行: フリーフライトは島の沖合から、ミッション（2-4）は定義の開始位置から。?autolevel=off / ?invert で操作設定を変える。
  // 射撃（2-1）・ロックオンとミサイル（2-2）・敵機（2-3）。判定は固定ステップ、演出は描画フレーム
  const session = new FlightSession({
    groundHeight: getGroundHeight,
    buildings: () => activeMap.buildings,
    flightOptions: parseFlightOptions(window.location.search),
    start: WORLD_CONFIG.start,
    // 7-2: 防衛戦の戦闘機の入れ物（協力のホストの世界と同じ数。ソロで同時に出すのは soloFighterPool まで。
    // フリーフライトの敵の数の設定は今のまま）
    enemies: { ...FREE_FLIGHT_ENEMIES, maxCount: DEFENSE_CONFIG.hostFighterPool },
  });
  const play = new GamePlay(session);
  // リプレイ（7-B）: 本番の飛行の記録・再生中かどうか・外部の操作の通り道。world は記録と再生で同じ始め方をする世界
  const replayHub = new ReplayHub(play);
  const simWorld = createSimWorld(play, activeMap);
  // 怪獣の HUD（6-2）: 体力バー・フェーズ・ロック中の部位・予兆・スタンのノイズ
  const kaijuHud = new KaijuHudLink(new KaijuHud(document.body), hud, session);
  const assistFlags = createGameSettings(settingsParts, session, (enabled, difficulty) => {
    // 記録中の敵の設定の変更はリプレイに残す（7-B）
    if (replayHub.recording)
      replayHub.dispatch({
        kind: 'enemies',
        enabled,
        difficulty,
        count: session.freeEnemies.count,
      });
    else session.configureEnemies(enabled, difficulty);
  });
  const damageOverlay = new DamageOverlay(document.body);
  const controls = createControls();
  // エフェクトと音のきっかけ（4-4）。被弾・近くの爆発でカメラを揺らす
  const fxEvents = new FxEvents(session, getGroundHeight);
  const views = new FlightViews(scene, aircraftMesh, session, fxEvents, camera.position, (k) => {
    chaseCamera.addImpact(k);
  });
  const audio = createGameAudio(
    shell.audioEngine,
    session,
    fxEvents,
    getGroundHeight,
    settingsUi.slot('volume'),
    save,
  );
  // 操作設定（4-11）: 感度・デッドゾーン・反転・オートレベル（URL の ?invert / ?autolevel が優先）・左右入替・振動・大きさ・キー割当
  const controlsLink = createControlsLink(settingsUi, save, input, touch, {
    session,
    fxEvents,
    urlOverrides: parseFlightOverrides(window.location.search),
  });
  // 9-4: ポーズの「傾きを合わせ直す」（傾き操作のときだけ）
  linkTiltPause(game, screens.pause, touch);
  // チュートリアル（4-11）の指示と、タッチ操作のヒント。指示の「中断」はモード選択へ
  const tutorial = new TutorialLink(document.body, save, input, touch, hud, () => {
    screens.abortTutorial(game);
  });
  const frameFx = new FrameFx(pipeline, playerView, camera, audio);
  // 防衛戦（7-2）: モード選択の選択・HUD・リザルト・音・報酬
  const defense = createDefenseLink({
    game,
    screens,
    play,
    save,
    audio,
    camera,
    aircraft: aircraftMesh,
    replay: replayHub,
  });
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
    defenseHud: defense.hud,
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
    replaying: () => replayHub.playing,
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
  // 9-4: ドラッグ操作の面は canvas の上を覆うので、そこで押さえても同じように選ぶ（押さえた所へ機首も向ける）
  for (const surface of [renderer.domElement, touch.controls.drag.root])
    hudLink.bindTap(
      surface,
      () => game.state === 'flight' && !replayHub.playing,
      (t) => {
        replayHub.select(t);
      },
    );

  // 天候（7-5）: 飛行・メニュー・ブリーフィング・ロビーの天候、HUD のマーカーと夜の減光、環境音
  // エイムアシスト・自動射撃（9-3）・速度合わせ（9-5b）と「方向へ倒す」方式（9-2）。部屋の補正と HUD の宙返りの速度不足も
  const inputAssist = createInputAssist(play, assistFlags, input, save, activeMap, hudLink, pvp);
  // 10-4b: HUD の残弾の列の下にロケット・爆弾の撃ち方（タッチは MSL の長押しの切り替え）
  hudLink.ordnanceHint = () => tutorial.weaponHint();
  // 9-4: ドラッグ操作は画面の傾きで地平線の基準に戻す（宙返りの間は読み直さない）
  Object.assign(touch.controls.drag, {
    screenRoll: () => screenRoll(camera),
    looping: () => inputAssist.steer.looping,
  });
  linkWeather(world.weather, { game, screens, pvp, hud, hudLink, audio, save });
  // リングレース（7-1）: コース一覧・HUD・リザルト・音・ゴースト、練習場（9-5）: 課題の一覧・HUD・結果・設定の欄・記録、
  // 日替わり（9-9）（天候の配線の後: レースの天候・練習場の昼の快晴・日替わりの条件の天候で上書きする）、勲章（9-10）
  const solo = createSoloLinks({
    game,
    screens,
    play,
    save,
    audio,
    scene,
    chaseCamera,
    hud,
    activeMap,
    input,
    weather: world.weather,
    tilt: touch.tilt,
    controls: controlsLink,
    replay: replayHub,
  });
  // 飛行の始め・固定ステップ・描画・フォトモード（7-A）・リプレイ（7-B）を組み立ててゲームループを回す
  const runtime = startFlightRuntime({
    activeMap,
    screens,
    session,
    play,
    playerView,
    views,
    chaseCamera,
    quality,
    pvp,
    ...solo,
    defense,
    game,
    input,
    gamepad,
    keys,
    controls,
    combatInput,
    weaponInput,
    ...inputAssist,
    coopKaiju,
    touch,
    touchControls: touch.controls,
    hangarStage,
    aircraftMesh,
    tutorial,
    pipeline,
    world,
    camera,
    demoCamera,
    loop: shell.loop,
    clock: shell.clock,
    ringView,
    damageOverlay,
    hud,
    hudLink,
    missionLink,
    frameFx,
    debug,
    assistFlags,
    groundHeight: getGroundHeight,
    canvas: renderer.domElement,
    audio,
    save,
    kaijuHud,
    replayHub,
    simWorld,
  });

  // 9-6c: ネフィルガ（登録だけ。判定・形・HUD は遅延チャンクで、使う前に読む。?dev=kaiju2 は起動時に読む）
  const kaiju2 = { search, play, scene, activeMap, game, quality, pvp, hud, audio, camera };
  linkKaiju2({ ...kaiju2, ...runtime, weather: world.weather });
  // 10-3b: 白鯨アルビオン（登録だけ。判定・形・HUD は遅延チャンクで、使う前に読む。?dev=albion は起動時に読む）
  linkAlbion({ ...kaiju2, ...runtime });
  // 10-4b: メカ怪獣ゴウライ（登録だけ。判定・形・HUD は遅延チャンクで、使う前に読む。?dev=gourai は起動時に読む）
  linkGourai({ ...kaiju2, ...runtime });

  // 9-10d: ?dev=kaiju-art（レイドの怪獣選びの画像を描く。遊ぶ人は読まない）
  linkKaijuArtDev(search, { ...runtime, camera, pipeline, play, weather: world.weather, game });

  // 8-3: WebGL のコンテキストを失ったら、ソロの飛行中はポーズ（リプレイの再生・PvP・協力は止めない）
  linkContextLoss(renderer.domElement, {
    shouldPause: () => game.state === 'flight' && !pvp.flying && !replayHub.playing,
    pause: () => {
      game.transition('pause');
    },
  });

  // オンライン連携（7-4）: 環境変数があるときだけ読み込む（クラウドセーブ・記録の送信・ランキング）
  linkOnline({ game, screens, save });

  return {
    titleStart: () => {
      screens.titleStart();
    },
    titleSettings: () => {
      screens.settingsNav.open();
    },
    afterBoot: () => {
      pvp.joinFromUrl();
    },
  };
}
