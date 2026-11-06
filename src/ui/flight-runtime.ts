// 飛行の実行の組み立て（main.ts から分けた。7-B で main.ts が 300 行を超えたため。並びと挙動は変えていない）:
// 飛行の始め方・固定ステップ（記録・再生も）・描画フレーム・フォトモード（7-A）・リプレイ（7-B）をつないでゲームループを回す
import type { GameAudio } from '../audio/game-audio';
import type { GameLoop } from '../core/loop';
import type { SaveStore } from '../progression/save-store';
import { FlightFrame, type FlightFrameParts } from '../render/flight-frame';
import { setCardSceneCapture } from './card/card-entry';
import type { ReplayHub } from '../replay/hub';
import { simSkip, type SimWorld } from '../replay/sim';
import { StateSnapshot } from '../replay/state-walk';
import type { DefenseLink } from './defense-link';
import { linkFlightLoop, type FlightLoopParts } from './flight-loop';
import { createFlightStarter, type FlightStartParts } from './flight-start';
import type { KaijuHudLink } from '../render/kaiju-hud-link';
import { createPhotoMode, type PhotoEntry } from './photo/photo-entry';
import type { RaceLink } from './race-link';
import type { PracticeLink } from './practice-link';
import type { DailyLink } from './daily-link';
import type { BadgeLink } from './badge-link';
import { createReplayWiring } from './replay-wiring';
import { viewport } from '../core/viewport';

export type FlightRuntimeParts = Omit<
  FlightStartParts,
  'world' | 'replay' | 'race' | 'defense' | 'practice' | 'daily'
> &
  Omit<FlightLoopParts, 'startFlight' | 'replay' | 'afterStep' | 'holdSim'> &
  Omit<FlightFrameParts, 'touch'> & {
    /** 描画のタッチ操作（スロットルの表示）。FlightLoopParts の touch は TouchLink */
    readonly touchControls: FlightFrameParts['touch'];
    readonly race: RaceLink;
    readonly defense: DefenseLink;
    readonly practice: PracticeLink;
    readonly daily: DailyLink;
    /** 勲章（9-10）: 記録する飛行の始めと固定ステップの後 */
    readonly badges: BadgeLink;
    readonly canvas: HTMLElement;
    readonly audio: GameAudio;
    readonly save: SaveStore;
    readonly kaijuHud: KaijuHudLink;
    readonly replayHub: ReplayHub;
    /** 記録と再生で同じ始め方をする世界（起動直後の写しはここで撮る） */
    readonly simWorld: SimWorld & { pristine: StateSnapshot | null };
    /** 10-1: 起動の殻（app.ts）が回しているゲームループ（タイトルの背景を描いている） */
    readonly loop: GameLoop;
    /** 10-1: 殻が描いてきた島の周りの時間と前のフレームの時刻（続きから描く。渡したら殻は描くのをやめる） */
    readonly clock: () => { worldTime: number; lastFrameMs: number | null };
  };

export function startFlightRuntime(p: FlightRuntimeParts): {
  photo: PhotoEntry;
  /** 描画フレームごとに呼ぶ関数を足す（9-6a: ネフィルガ） */
  onRender: (fn: (alpha: number) => void) => void;
  /** 描画の 1 フレーム（9-10d: 怪獣の画像を描く ?dev=kaiju-art がカメラを置く） */
  frame: FlightFrame;
} {
  const { game, screens, race, defense, practice, replayHub, simWorld, pvp, touch } = p;
  const startFlight = createFlightStarter({
    ...p,
    world: simWorld,
    replay: {
      takePending: () => replay.link.hooks.takePending(),
      liveStarted: (s) => {
        replay.link.hooks.liveStarted(s);
        p.badges.begin(s);
      },
      unrecordedStarted: () => {
        replay.link.hooks.unrecordedStarted();
      },
      replayStarted: () => {
        replay.link.hooks.replayStarted();
      },
    },
  });

  const loop = p.loop;
  const { simulate } = linkFlightLoop(loop, {
    ...p,
    startFlight,
    replay: {
      hub: replayHub,
      update: () => {
        replay.playback.update();
      },
      stepOnce: () => {
        replay.playback.stepOnce();
      },
    },
    afterStep: () => {
      race.afterStep();
      p.badges.step(loop.stepSeconds);
    },
    holdSim: () => race.guide.holdSim(),
  });
  p.aircraftMesh.visible = false;
  const frame = new FlightFrame({ ...p, touch: p.touchControls });
  // 9-8: リングレースの道案内（下見のカメラ・番号の札）と、通り損ねたら次のリングの印を赤く
  frame.raceGuide = race.guide;
  p.missionLink.raceAlert = () => race.guide.missed();
  // フォトモード（7-A）: ポーズメニュー・P キー。フリーフライト・キャンペーン・ソロのレイド（7-B: リプレイも）だけ（時間は止める）
  const photo = createPhotoMode(
    {
      game,
      canvas: p.canvas,
      camera: p.camera,
      pipeline: p.pipeline,
      playerView: p.playerView,
      views: p.views,
      pause: screens.pause,
      groundHeight: p.groundHeight,
      weather: p.world.weather,
      audio: p.audio,
      save: p.save,
      allowed: () => !pvp.flying && !screens.inTutorial,
      simulate,
      stepSeconds: loop.stepSeconds,
      refreshTouch: () => {
        touch.refresh();
      },
    },
    frame,
  );
  // 8-5: 記録カードの背景（結果の時点の場面を 1 枚。フォトモードの撮影と同じく描画バッファを一時的にその大きさにして描く）
  setCardSceneCapture((w, h) => p.pipeline.capture(w, h));
  // 8-2: モード選択を開いたら、遅延読み込みのフォトモードと怪獣のモデルを先に読んでおく（タイトルの表示を遅らせない）
  game.onChange(({ to }) => {
    if (to !== 'mode_select') return;
    photo.prefetch();
    p.views.prefetchKaiju();
  });
  // リプレイ（7-B）: 一覧・再生・保存
  const replay = createReplayWiring({
    ...p,
    hub: replayHub,
    world: simWorld,
    loop,
    frame,
    weather: p.world.weather,
    photo: () => {
      photo.toggle();
    },
    resultExtras: [
      screens.result.extras,
      race.resultExtras,
      defense.resultExtras,
      practice.resultExtras,
      p.daily.resultExtras,
    ],
  });
  // 起動直後の世界の写し（飛行の始めに前の飛行の名残を消す）は配線の最後に撮る
  simWorld.pristine = StateSnapshot.take([p.play], simSkip(p.play));

  frame.continueFrom(p.clock());
  loop.onRender((alpha) => {
    replay.playback.render();
    pvp.render(alpha);
    race.render(alpha);
    defense.render(viewport.width, viewport.height);
    practice.render();
    p.daily.render();
    frame.render(game.state, alpha, p.keys.menuTick);
    if (game.state === 'flight') p.kaijuHud.update();
    p.tutorial.update(game.state === 'flight');
  });
  return {
    photo,
    onRender: (fn) => {
      loop.onRender(fn);
    },
    frame,
  };
}
