// 10-1: 起動の殻。タイトルまでに要るもの（空・海・島の背景の 3D・描画・画質・セーブ・タイトル・読み込み中の画面・音の土台）
// だけを起動時に読み、ゲーム本体（飛行・戦闘・HUD・音・メニューの画面・各モード。game-app.ts）は遅延チャンクにする。
// 本体はタイトルを出した直後に裏で読み始め、タイトルを押したとき（歯車も）に読み終わりを待つ（docs/perf.md の 10-1）
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { AudioEngine, browserContextFactory } from './audio/engine';
import { BOOT_TASKS, runBoot } from './core/boot';
import { parseSkipTitle } from './core/debug-flags';
import { GameState, usesDemoCamera } from './core/game-state';
import { lazyChunk } from './core/lazy-chunk';
import { GameLoop } from './core/loop';
import { watchViewport } from './core/viewport';
import { coverActive, onCoverGone, setCoverLandingTarget } from './core/viewport-cover';
import { APP_SHELL_CONFIG } from './data/app';
import { DEFAULT_WEATHER_ID } from './data/weather';
import type { SaveStore } from './progression/save-store';
import { DemoCamera } from './render/demo-camera';
import { RenderPipeline } from './render/pipeline';
import { QualityLink } from './render/quality-link';
import { createWorldScene, type World } from './render/scene';
import { installAppShell } from './ui/app-shell';
import { syncHudScreen } from './ui/hud-screen';
import { loadChunk, prefetchChunk } from './ui/lazy-load';
import { installTouchGuards } from './ui/mobile';
import { openBrowserSave } from './ui/save-link';
import { FadeCurtain, LoadingScreen, applyScreenFade, type ShellScreens } from './ui/screen';
import { TitleScreen } from './ui/title';
import type { GameApp } from './game-app';

/** 殻が作ってゲーム本体（game-app.ts の startGame）へ渡すもの */
export interface AppShell {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly world: World;
  readonly pipeline: RenderPipeline;
  readonly demoCamera: DemoCamera;
  readonly save: SaveStore;
  readonly game: GameState;
  readonly quality: QualityLink;
  readonly audioEngine: AudioEngine;
  readonly loop: GameLoop;
  readonly screens: ShellScreens;
  /** 本体の描画が始まるときに 1 回呼ぶ: 殻の描画をやめ、島の周りの時間と前のフレームの時刻を返す */
  readonly clock: () => { worldTime: number; lastFrameMs: number | null };
}

/** ゲーム本体の遅延チャンク（play-logic / play-render / play-ui。scripts/vite-chunks.ts） */
const gameChunk = lazyChunk(() => import('./game-app'));

/** 起動の読み込みの前に本体を読む URL（開発用の直行・部屋への参加・?dev= の開発中の機能。1.1.0 までと同じく起動時に全部組み立てる） */
export function needsGameAtBoot(search: string): boolean {
  const params = new URLSearchParams(search);
  return parseSkipTitle(search) || params.has('room') || params.has('dev');
}

/**
 * ゲームを起動する（8-3: main.ts が WebGL2 の描画を作れたときだけ呼ぶ。作れなければ案内画面）。
 * renderer は main.ts が作って #app に入れたもの
 */
export function startApp(
  renderer: WebGLRenderer,
  /** 本体の組み立てで例外が出たとき（main.ts が案内画面を出す。1.1.0 までは startApp の中の例外と同じ扱い） */
  onStartFailed: (e: unknown) => void,
): void {
  const { scene, camera, world } = createWorldScene(
    renderer,
    window.innerWidth / window.innerHeight,
  );
  const pipeline = new RenderPipeline(renderer, scene, camera);
  const demoCamera = new DemoCamera(camera);
  // セーブ（3-1）: 進み具合・クレジット・パイロット名・設定。壊れていたら初期値にしてお知らせ
  const save = openBrowserSave(document.body);
  // 画面状態（タイトル →（初回: パイロット名 →）モード選択 → …）。画面の切り替えは本体の Screens（読むまでは下の showShell）
  const game = new GameState();
  applyScreenFade(document.documentElement);
  // 初回起動（パイロット名がまだない）はタイトルの後に名前の入力（3-1）。本体を読んでから
  let app: GameApp | null = null;
  const withGame = (fn: (g: GameApp) => void): void => {
    if (app) {
      fn(app);
      return;
    }
    void loadChunk(loadGame).then((g) => {
      // 失敗したらタイトルのまま（お知らせは loadChunk）。読む間にタイトルを離れていたら何もしない
      if (g && game.state === 'title') fn(g);
    });
  };
  const title = new TitleScreen(
    document.body,
    () => {
      withGame((g) => {
        g.titleStart();
      });
    },
    () => {
      withGame((g) => {
        g.titleSettings();
      });
    },
  );
  title.setPilotName(save.pilotName);
  // 10-1b: 測り直しの幕のロゴは、外すときにタイトルの文字へ移って重なる（src/core/viewport-cover.ts）
  setCoverLandingTarget(() => title.landingBox());
  const loading = new LoadingScreen(document.body);
  const curtain = new FadeCurtain(document.body);

  // 品質設定（初期判定・切り替え・自動ダウングレード）と露出
  const quality = new QualityLink(renderer, pipeline, world, save.settingsStorage);
  installTouchGuards(document);
  installAppShell(document.body);
  // 描画の大きさ（8-6）: canvas の実際の大きさに合わせる（iOS の起動直後・向きの変更の後の古い window の値を使わない）
  watchViewport(renderer.domElement, (w, h) => {
    pipeline.resize(w, h);
  });
  // 音（4-4）: AudioContext は最初のユーザー操作で作る（タイトルのタップ。ゲームの音は本体を読んでから）
  const audioEngine = new AudioEngine(browserContextFactory);
  audioEngine.attach(window, document);

  // 本体を読むまでの画面の切り替え（読み込み中 → タイトル）。本体の Screens と同じ印を付ける
  const showShell = ({ to }: { to: GameState['state'] }): void => {
    document.documentElement.dataset.screen = to;
    syncHudScreen(document.documentElement, to);
    loading.setShown(to === 'boot');
    title.setShown(to === 'title');
    // メニューの背景は昼・快晴（ui/weather-link.ts と同じ）
    if (to === 'title') {
      world.weather.set(DEFAULT_WEATHER_ID);
      world.weather.setTimeFlow(false);
    }
  };
  const offShell = game.onChange(showShell);
  showShell({ to: game.state });

  // タイトルの背景（デモカメラで島の周り）。本体を読んだら本体の描画（render/flight-frame.ts）が続きから描く
  const loop = new GameLoop();
  loop.setPaused(true);
  let worldTime = 0;
  let lastFrameMs: number | null = null;
  const offRender = loop.onRender(() => {
    const now = performance.now();
    const frameSeconds = lastFrameMs === null ? 0 : (now - lastFrameMs) / 1000;
    worldTime += frameSeconds;
    if (usesDemoCamera(game.state)) demoCamera.update(frameSeconds);
    world.weather.update(camera, worldTime);
    world.update(camera.position, worldTime, camera.position);
    camera.updateMatrixWorld();
    pipeline.render();
    lastFrameMs = now;
  });
  const clock = (): { worldTime: number; lastFrameMs: number | null } => {
    offRender();
    return { worldTime, lastFrameMs };
  };

  const shell: AppShell = {
    renderer,
    scene,
    camera,
    world,
    pipeline,
    demoCamera,
    save,
    game,
    quality,
    audioEngine,
    loop,
    screens: { title, loading, curtain },
    clock,
  };
  let starting: Promise<GameApp> | null = null;
  function loadGame(): Promise<GameApp> {
    starting ??= gameChunk().then(
      (m) => {
        offShell();
        try {
          app = m.startGame(shell);
          // 計測（scripts/perf.js）: 本体を読んで組み立て終えた時刻
          performance.mark('skyraid:game');
        } catch (e) {
          onStartFailed(e);
          throw e;
        }
        return app;
      },
      (e: unknown) => {
        // 読めなかったら覚えない（次に押したときに読み直す。lazyChunk と同じ）
        starting = null;
        throw e;
      },
    );
    return starting;
  }
  loop.start();

  // 起動シーケンス: 読み込み（今はアセットなしで即完了）を待ってからタイトルへ。?skipTitle なら飛行へ直行
  const search = window.location.search;
  const early = needsGameAtBoot(search);
  void runBoot(BOOT_TASKS, (progress) => {
    loading.setProgress(progress);
  })
    .then(() => (early ? loadGame().catch(() => null) : null))
    .then(() => {
      game.transition(parseSkipTitle(search) ? 'flight' : 'title');
      app?.afterBoot();
      // タイトルの展開アニメ（0.6 秒）が済んでから本体を裏で読む（読んで組み立てる間は主スレッドがふさがるので、アニメを
      // かくつかせない。表示も遅らせない）。その前に押したときは withGame が待つ
      // 10-1b: 測り直しの幕（iOS のホーム画面から横向きの起動）が出ていれば、その間に本体のファイルを読んでおき、
      // 組み立ては幕が明けて展開アニメが済んでから（測り直しの試みの時刻・幕のロゴの動きを遅らせない）
      if (!app) {
        if (coverActive()) prefetchChunk(gameChunk);
        buildLater();
      }
    });
  function buildLater(): void {
    window.setTimeout(() => {
      if (coverActive()) onCoverGone(buildLater);
      else prefetchChunk(loadGame);
    }, APP_SHELL_CONFIG.titleDeploySeconds * 1000);
  }
}
