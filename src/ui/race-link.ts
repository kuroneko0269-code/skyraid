// リングレース（7-1）と画面・音・天候・ゴースト・セーブの配線: モード選択の「リングレース」→ コース一覧（機体の選択）→
// レース（カウントダウン・HUD・音・ゴースト）→ ゴールで記録・報酬 → リザルト（もう一度 / コース一覧へ）。
// 7-B: ゴーストはベストの走行の入力の記録を別の世界で再生する（GhostSim）。リプレイの再生中は記録・報酬・リザルト・ゴーストなし
import { t } from '../core/i18n';
import type { GameAudio } from '../audio/game-audio';
import { isResume, usesDemoCamera, type GameState } from '../core/game-state';
import { COURSES } from '../data/courses';
import { findAircraftModel } from '../data/aircraft';
import type { GamePlay } from '../missions/game-play';
import { decodeGhost, GhostSim } from '../missions/race/ghost';
import type { ActiveMap } from '../missions/active-map';
import type { ReplayHub } from '../replay/hub';
import type { RaceResult, RaceRunner } from '../missions/race/runner';
import type { CourseDef } from '../missions/race/types';
import {
  markPreviewed,
  raceRecord,
  recordRace,
  type RaceRecordOutcome,
} from '../progression/race-records';
import { raceRecord as onlineRaceRecord, recordOutbox } from '../online/outbox';
import type { SaveStore } from '../progression/save-store';
import type { GhostView } from '../render/ghost-view';
import type { WeatherView } from '../render/weather/weather-view';
import type { PerspectiveCamera, Scene } from 'three';
import { RaceGuideLink } from '../render/race-guide-link';
import { RaceGuideView } from '../render/race-guide-view';
import { RaceGuideHud } from './race-guide-hud';
import { RaceHud } from './race-hud';
import { RacePreviewScreen } from './race-preview';
import { cardPaint } from './card/card-entry';
import { RaceResultScreen } from './race-result';
import { RaceSelectScreen } from './race-select';
import type { Screens } from './screens';

export interface RaceLinkParts {
  readonly game: GameState;
  readonly screens: Screens;
  readonly play: GamePlay;
  readonly save: SaveStore;
  readonly audio: GameAudio;
  readonly weather: WeatherView;
  readonly ghost: GhostView;
  /** レース中は武器関連の HUD を隠す（7-2 の事前修正） */
  readonly hud: { setNoWeapons(on: boolean): void };
  /** ゴーストの世界の地表・建物（7-B） */
  readonly activeMap: ActiveMap;
  readonly replay: ReplayHub;
  /** 9-8 道案内: 点線を置くシーン・番号の札を投影するカメラ（追従カメラが動かすカメラ）・下見の後に追従カメラを寄せる */
  readonly scene: Scene;
  readonly chaseCamera: { readonly camera: PerspectiveCamera; snap(): void };
}

export interface RaceLink {
  /** 飛ぶ（飛んだばかりの）コース。メニューへ戻ると null（フリーフライト・ミッションと区別する） */
  readonly course: CourseDef | null;
  /** ベストの各リングのタイム（ゴーストとの差・スプリット。なければ null） */
  reference(): readonly number[] | null;
  /** レースを始めた直後（ui/flight-start.ts）: ベストのゴーストを読む（再生中は出さない） */
  afterStart(replaying: boolean): void;
  /** 本番の固定ステップ 1 回ごと（ゴーストを同じだけ進める） */
  afterStep(): void;
  /** 描画フレームごと（alpha は固定ステップの補間） */
  render(alpha: number): void;
  /** リザルトの追加の欄（7-B: リプレイを保存） */
  readonly resultExtras: HTMLElement;
  /** 9-8 道案内と下見（flight-frame・flight-loop が呼ぶ） */
  readonly guide: RaceGuideHooks;
}

/** 9-8: 描画（番号の札・下見のカメラ）と固定ステップ（下見の間は止める）から呼ぶ */
export interface RaceGuideHooks {
  /** 下見のカメラを置く（置いたら true。追従カメラの代わり） */
  previewCamera(frameSeconds: number): boolean;
  /** カメラを置いた後の描画フレームごと（hudShown は H キー / 設定の HUD） */
  update(width: number, height: number, hudShown: boolean): void;
  /** 次のリングを通り損ねている（ミッションの HUD の印を赤く） */
  missed(): boolean;
  /** 固定ステップを止める（下見の間と、飛ばした直後の 1 回。true の間は入力も捨てる） */
  holdSim(): boolean;
}

/** コース一覧・HUD・リザルトを作り、画面の遷移・レースのイベントにつなぐ */
export function createRaceLink(p: RaceLinkParts): RaceLink {
  const { game, screens, play, save, audio, replay } = p;
  const hangar = screens.hangar;
  const ghostSim = new GhostSim(p.activeMap.ground, () => p.activeMap.buildings);
  let course: CourseDef | null = null;
  /** 9-8: 次の飛行でスタート前に下見するか（コース一覧の切り替え。「もう一度」は見たコースなら飛ばす） */
  let previewNext = false;
  let pending: { result: RaceResult; out: RaceRecordOutcome } | null = null;
  const select = new RaceSelectScreen(
    document.body,
    COURSES,
    (id) => raceRecord(save, id),
    hangar,
    {
      onStart: (c, preview) => {
        course = c;
        previewNext = preview;
        game.transition('flight');
      },
      onBack: () => game.transition('mode_select'),
    },
  );
  const result = new RaceResultScreen(document.body, {
    onRetry: () => {
      previewNext = course !== null && raceRecord(save, course.id).previewed !== true;
      game.transition('flight');
    },
    onList: () => game.transition('race_select'),
  });
  const hud = new RaceHud(document.body);
  screens.inRace = () => course !== null;
  // 9-8 道案内（番号の札・印・通り損ね・点線）と下見
  const guide = new RaceGuideLink({
    camera: p.chaseCamera.camera,
    hud: new RaceGuideHud(hud.root, hud.band),
    view: new RaceGuideView(p.scene),
    player: () => ({
      position: play.session.aircraft.state.position,
      velocity: play.session.player.velocity,
    }),
    groundHeight: p.activeMap.ground,
  });
  const previewScreen = new RacePreviewScreen(document.body);
  /** 下見を終えた直後の固定ステップを 1 回止める（飛ばしたキーで動かない・ポーズしない） */
  let releaseStep = false;
  const endPreview = (): void => {
    if (!guide.previewing) return;
    guide.endPreview();
    previewScreen.hide();
    releaseStep = true;
    p.chaseCamera.snap();
    const c = play.race?.course;
    if (c && !replay.playing) markPreviewed(save, c.id);
  };

  game.onChange(({ from, to, restart }) => {
    select.setShown(to === 'race_select');
    result.setShown(to === 'result' && course !== null);
    // メニューへ戻ったらレースの選択を外す（次の飛行はフリーフライト・ミッション）
    if (usesDemoCamera(to) || to === 'hangar') course = null;
    if (to === 'flight' && !isResume(from, restart) && course) {
      // レースの天候は固定（7-5 の天候の配線の後に呼ばれて上書きする）
      p.weather.set(course.weatherId);
      p.weather.setTimeFlow(false);
    }
  });

  play.onRaceChange((race) => {
    hud.attach(race);
    guide.attach(race);
    previewScreen.hide();
    p.hud.setNoWeapons(race !== null);
    if (race) bindRace(race);
    else {
      p.ghost.setGhost(null, null);
      ghostSim.start(null);
    }
  });

  /** レースのイベント: 音と、ゴール（時間切れ）の記録 */
  const bindRace = (race: RaceRunner): void => {
    const bus = race.bus;
    const last = race.rings.length - 1;
    bus.on('race:countdown', () => {
      audio.playUi('countdown');
    });
    bus.on('race:start', () => {
      audio.playUi('go');
    });
    bus.on('race:ring', ({ ring }) => {
      audio.playRace(ring.index === last ? 'goal' : ring.required ? 'checkpoint' : ring.kind);
    });
    bus.on('race:miss', () => {
      audio.playRace('miss');
    });
    bus.on('race:finish', ({ result: r }) => {
      // 7-B: 再生中は記録・報酬なし（リザルトも出さない）。9-9: 日替わりの周回（コースの選択が無い）も記録・報酬・送信なし
      if (replay.playing || course === null) return;
      const id = hangar.selectedId;
      const machine = {
        aircraftId: id,
        aircraftName: hangar.selectedModel.name,
        levels: hangar.levels(id),
      };
      pending = { result: r, out: recordRace(save, r, machine, replay.ghostData()) };
      // 7-4: オンライン連携の記録（完走だけ。連携していなければ何もしない）
      const rec = onlineRaceRecord(r, id);
      if (rec) recordOutbox.submit(rec);
    });
  };

  const showResult = (): void => {
    const c = course;
    if (!pending || !c) return;
    result.show(pending.result, pending.out, {
      courseName: c.name,
      balance: save.credits,
      pilotName: save.pilotName,
      gold: c.goldTimeSeconds,
    });
    // 8-5: 記録カード
    const aircraftId = hangar.selectedId;
    result.card.set({
      mode: 'race',
      courseId: c.id,
      finished: pending.result.outcome === 'finished',
      rank: pending.result.rank,
      time: pending.result.time,
      newBest: pending.out.newBest,
      aircraftId,
      paint: cardPaint(save, aircraftId),
      pilotName: save.pilotName,
      date: Date.now(),
    });
    pending = null;
    game.transition('result');
  };

  return {
    resultExtras: result.extras,
    get course() {
      return course;
    },
    reference() {
      const c = course;
      return c ? (raceRecord(save, c.id).ghost?.ringTimes ?? null) : null;
    },
    afterStart(replaying) {
      const c = play.race?.course;
      if (!c) return;
      const ghost = replaying ? null : raceRecord(save, c.id).ghost;
      const data = ghost ? decodeGhost(ghost.data, c.id) : null;
      ghostSim.start(data);
      p.ghost.setGhost(data ? ghostSim : null, ghost ? findAircraftModel(ghost.aircraftId) : null);
      if (!replaying) screens.pause.setInMission(true, t('race.abort'));
      // 9-8: スタート前の下見（固定ステップを止めてカメラだけ動かす。記録・ゴーストは下見の後から）
      if (!replaying && previewNext) {
        guide.startPreview();
        previewScreen.show(c, endPreview);
      }
      previewNext = false;
    },
    guide: {
      previewCamera(frameSeconds) {
        if (!guide.previewing) return false;
        if (game.state === 'flight') {
          guide.updatePreviewCamera(frameSeconds);
          previewScreen.setProgress(guide.previewProgress ?? 1);
          if (guide.previewDone) endPreview();
        } else guide.updatePreviewCamera(0);
        return true;
      },
      update(width, height, hudShown) {
        guide.update(width, height, hudShown, save.settings.raceGuideLine);
      },
      missed: () => guide.missed,
      holdSim() {
        if (guide.previewing) return true;
        if (!releaseStep) return false;
        releaseStep = false;
        return true;
      },
    },
    afterStep() {
      if (play.race && ghostSim.active) ghostSim.step();
    },
    render(alpha) {
      const race = play.race;
      const state = game.state;
      const flying = state === 'flight' || state === 'pause' || state === 'photo';
      if (state === 'flight') hud.update();
      const racing = race !== null && flying && race.phase === 'racing';
      p.ghost.update(racing ? alpha : null);
      if (state === 'flight' && race?.readyForResult && !replay.playing) showResult();
    },
  };
}
