// リングレース（7-1）と画面・音・天候・ゴースト・セーブの配線: モード選択の「リングレース」→ コース一覧（機体の選択）→
// レース（カウントダウン・HUD・音・ゴースト）→ ゴールで記録・報酬 → リザルト（もう一度 / コース一覧へ）
import type { GameAudio } from '../audio/game-audio';
import { isResume, usesDemoCamera, type GameState } from '../core/game-state';
import { COURSES } from '../data/courses';
import { findAircraftModel } from '../data/aircraft';
import { LOOP_CONFIG } from '../data/loop';
import type { GamePlay } from '../missions/game-play';
import { GhostTrack } from '../missions/race/ghost';
import type { RaceResult, RaceRunner } from '../missions/race/runner';
import type { CourseDef } from '../missions/race/types';
import { raceRecord, recordRace, type RaceRecordOutcome } from '../progression/race-records';
import type { SaveStore } from '../progression/save-store';
import type { GhostView } from '../render/ghost-view';
import type { WeatherView } from '../render/weather/weather-view';
import { RaceHud } from './race-hud';
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
}

export interface RaceLink {
  /** 飛ぶ（飛んだばかりの）コース。メニューへ戻ると null（フリーフライト・ミッションと区別する） */
  readonly course: CourseDef | null;
  /** 飛行の始めに呼ぶ（ui/flight-start.ts）: ベストのゴーストを読み、レースを始める */
  begin(): void;
  /** 描画フレームごと（alpha は固定ステップの補間） */
  render(alpha: number): void;
}

/** コース一覧・HUD・リザルトを作り、画面の遷移・レースのイベントにつなぐ */
export function createRaceLink(p: RaceLinkParts): RaceLink {
  const { game, screens, play, save, audio } = p;
  const hangar = screens.hangar;
  let course: CourseDef | null = null;
  let pending: { result: RaceResult; out: RaceRecordOutcome } | null = null;
  const select = new RaceSelectScreen(
    document.body,
    COURSES,
    (id) => raceRecord(save, id),
    hangar,
    {
      onStart: (c) => {
        course = c;
        game.transition('flight');
      },
      onBack: () => game.transition('mode_select'),
    },
  );
  const result = new RaceResultScreen(document.body, {
    onRetry: () => game.transition('flight'),
    onList: () => game.transition('race_select'),
  });
  const hud = new RaceHud(document.body);
  screens.inRace = () => course !== null;

  game.onChange(({ from, to }) => {
    select.setShown(to === 'race_select');
    result.setShown(to === 'result' && course !== null);
    // メニューへ戻ったらレースの選択を外す（次の飛行はフリーフライト・ミッション）
    if (usesDemoCamera(to) || to === 'hangar') course = null;
    if (to === 'flight' && !isResume(from) && course) {
      // レースの天候は固定（7-5 の天候の配線の後に呼ばれて上書きする）
      p.weather.set(course.weatherId);
      p.weather.setTimeFlow(false);
    }
  });

  play.onRaceChange((race) => {
    hud.attach(race);
    p.hud.setNoWeapons(race !== null);
    if (race) bindRace(race);
    else p.ghost.setGhost(null, null);
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
      const id = hangar.selectedId;
      const machine = {
        aircraftId: id,
        aircraftName: hangar.selectedModel.name,
        levels: hangar.levels(id),
      };
      pending = { result: r, out: recordRace(save, r, machine, race.recorder.encode()) };
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
    pending = null;
    game.transition('result');
  };

  return {
    get course() {
      return course;
    },
    begin() {
      const c = course;
      if (!c) return;
      const ghost = raceRecord(save, c.id).ghost;
      play.startRace(c, ghost ? { ringTimes: ghost.ringTimes } : null);
      const track = ghost ? GhostTrack.decode(ghost.data, ghost.hz) : null;
      p.ghost.setGhost(track, ghost ? findAircraftModel(ghost.aircraftId) : null);
      screens.pause.setInMission(true, 'レースを中断');
    },
    render(alpha) {
      const race = play.race;
      const state = game.state;
      const flying = state === 'flight' || state === 'pause' || state === 'photo';
      if (state === 'flight') hud.update();
      const racing = race !== null && flying && race.phase === 'racing';
      p.ghost.update(
        racing ? Math.max(0, race.elapsed - (1 - alpha) / LOOP_CONFIG.updateHz) : null,
      );
      if (state === 'flight' && race?.readyForResult) showResult();
    },
  };
}
