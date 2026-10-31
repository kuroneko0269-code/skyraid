// 飛行の始め方（main.ts から分けた。5-1）: ハンガーの装備を自機に入れ、フリーフライト・ミッション・PvP の世界にして、
// 演出・カメラ・画質の監視をやり直す。
// 7-B: シングルプレイ（チュートリアル以外）は「初期状態」（src/replay/types.ts の ReplayStart）を作ってから、記録・再生と同じ
// startFromHeader で始める（起動直後の状態に戻す → 敵の設定 → 装備 → マップ → シード → モード）。再生も同じ道を通る
import { findAircraftModel } from '../data/aircraft';
import type { DefenseDifficulty } from '../data/defense';
import { findMap, ISLAND_MAP } from '../data/maps';
import { WORLD_CONFIG } from '../data/terrain';
import { weatherForFlight } from '../data/weather';
import { freshSeed } from '../core/random';
import type { ActiveMap } from '../missions/active-map';
import type { FlightSession } from '../missions/flight-session';
import type { GamePlay } from '../missions/game-play';
import type { CourseDef } from '../missions/race/types';
import type { MissionDef } from '../missions/types';
import type { ChaseCamera } from '../render/chase-camera';
import type { FlightViews } from '../render/flight-views';
import type { PlayerView } from '../render/player-view';
import type { QualityLink } from '../render/quality-link';
import { loadoutFor, missionFor, startFromHeader, type SimWorld } from '../replay/sim';
import type { ReplayData, ReplayStart } from '../replay/types';
import type { PvpEntry } from './pvp-entry';
import type { Screens } from './screens';

/** 記録・再生（ui/replay-link.ts）とのつなぎ */
export interface FlightReplayHooks {
  /** 再生を始めるなら、その記録（取り出したら消える） */
  takePending(): ReplayData | null;
  /** 記録する飛行を始めた（start の世界ができた直後） */
  liveStarted(start: ReplayStart): void;
  /** 記録しない飛行を始めた（チュートリアル・PvP） */
  unrecordedStarted(): void;
  /** 再生を始めた */
  replayStarted(): void;
}

export interface FlightStartParts {
  readonly activeMap: ActiveMap;
  readonly screens: Screens;
  readonly session: FlightSession;
  readonly play: GamePlay;
  readonly playerView: PlayerView;
  readonly views: FlightViews;
  readonly chaseCamera: ChaseCamera;
  readonly quality: QualityLink;
  readonly pvp: PvpEntry;
  /** 起動直後の世界（前の飛行の名残を消す。7-B） */
  readonly world: SimWorld;
  readonly replay: FlightReplayHooks;
  /** リングレース（7-1。ui/race-link.ts）: 飛ぶコース（null はレースでない）・ベストの各リングのタイム・始めた後の処理 */
  readonly race: {
    readonly course: CourseDef | null;
    reference(): readonly number[] | null;
    afterStart(replaying: boolean): void;
  };
  /** 防衛戦（7-2。ui/defense-link.ts）: 選んだマップと難易度（null は防衛戦でない）・始めた後の処理 */
  readonly defense: {
    readonly selection: { readonly mapId: string; readonly difficulty: DefenseDifficulty } | null;
    afterStart(): void;
  };
}

/** 今の画面の選択から、記録する飛行の初期状態を作る（チュートリアル・定義にないミッションは null = 記録しない） */
export function liveStart(p: FlightStartParts, def: MissionDef | null): ReplayStart | null {
  const screens = p.screens;
  if (screens.inTutorial) return null;
  const hangar = screens.hangar;
  const aircraftId = hangar.selectedId;
  const base = {
    aircraftId,
    upgrades: { ...hangar.levels(aircraftId) },
    enemies: p.session.freeEnemies,
    seed: freshSeed(),
  };
  const freeWeather = screens.modeSelect.freeWeatherId;
  const course = p.race.course;
  if (course)
    return {
      ...base,
      mode: 'race',
      mapId: course.mapId,
      courseId: course.id,
      raceReference: p.race.reference(),
      weatherId: course.weatherId,
    };
  const weatherId = weatherForFlight(false, def?.id ?? null, freeWeather, freeWeather);
  const defense = p.defense.selection;
  if (defense)
    return {
      ...base,
      mode: 'defense',
      mapId: defense.mapId,
      defenseDifficulty: defense.difficulty,
      weatherId,
    };
  if (def) {
    const raid = def.reward.raid;
    const start: ReplayStart = raid
      ? { ...base, mode: 'raid', mapId: def.mapId, raidDifficulty: raid.difficulty, weatherId }
      : { ...base, mode: 'mission', mapId: def.mapId, missionId: def.id, weatherId };
    return missionFor(start) ? start : null;
  }
  return { ...base, mode: 'free', mapId: screens.modeSelect.freeMapId, weatherId };
}

/**
 * 飛行を始める関数を作る（モード選択・ブリーフィング・リザルトの「もう一度」・PvP のロビー・リプレイの一覧から入るたびに呼ぶ）。
 * フリーフライトは起動位置から、ミッション（チュートリアルも）は定義の開始位置から、リングレース（7-1）はコースのスタート地点から。
 * PvP（net）は敵・ミッションなしの世界にして、自機の位置と色は PvP 側で決める
 */
export function createFlightStarter(
  p: FlightStartParts,
): (def: MissionDef | null, net: boolean) => void {
  return (def, net) => {
    const pending = net ? null : p.replay.takePending();
    const start = pending ? pending.header : net ? null : liveStart(p, def);
    if (start) {
      startFromHeader(p.world, start);
      const model = findAircraftModel(start.aircraftId) ?? p.screens.hangar.selectedModel;
      p.playerView.setModel(model, loadoutFor(start).missiles);
      if (start.mode === 'race') p.race.afterStart(pending !== null);
      if (start.mode === 'defense' && !pending) p.defense.afterStart();
      if (pending) p.replay.replayStarted();
      else p.replay.liveStarted(start);
    } else {
      startUnrecorded(p, def, net);
      p.replay.unrecordedStarted();
    }
    p.views.reset();
    p.playerView.reset();
    p.chaseCamera.snap();
    p.quality.startWatch();
  };
}

/** PvP・チュートリアル（記録しない）: 今までどおり */
function startUnrecorded(p: FlightStartParts, def: MissionDef | null, net: boolean): void {
  // PvP は強化の無効（ホストの設定）とロビーで選んだ機体（5-4）
  const loadout = (net ? p.pvp.loadout() : null) ?? p.screens.hangar.loadout();
  // 前の飛行の名残を消す（7-B。チュートリアルだけ。PvP はロビーの間に世界へ入れたものがあるので今までどおり）
  if (!net) {
    const enemies = p.session.freeEnemies;
    p.world.pristine?.restore();
    p.session.setFreeEnemies(enemies);
  }
  p.session.applyLoadout(loadout);
  p.playerView.setModel(p.screens.hangar.selectedModel, loadout.missiles);
  // 6-4: マップ（PvP はロビーのホスト設定、ミッションは定義）
  const mapId = net ? p.pvp.mapId : def ? def.mapId : p.screens.modeSelect.freeMapId;
  p.activeMap.use(mapId);
  const map = findMap(mapId);
  p.session.setFreeStart(map.id === ISLAND_MAP.id ? WORLD_CONFIG.start : map.start);
  if (net) {
    p.play.startEmpty({ ...WORLD_CONFIG.start, headingDeg: 0 });
    p.pvp.beginFlight();
  } else if (def) p.play.startMission(def);
  else p.play.startFree();
}
