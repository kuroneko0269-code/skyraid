// 飛行の始め方（main.ts から分けた。5-1）: ハンガーの装備を自機に入れ、フリーフライト・ミッション・PvP の世界にして、
// 演出・カメラ・画質の監視をやり直す
import { findMap, ISLAND_MAP } from '../data/maps';
import { WORLD_CONFIG } from '../data/terrain';
import type { ActiveMap } from '../missions/active-map';
import type { FlightSession } from '../missions/flight-session';
import type { GamePlay } from '../missions/game-play';
import type { CourseDef } from '../missions/race/types';
import type { MissionDef } from '../missions/types';
import type { ChaseCamera } from '../render/chase-camera';
import type { FlightViews } from '../render/flight-views';
import type { PlayerView } from '../render/player-view';
import type { QualityLink } from '../render/quality-link';
import type { PvpEntry } from './pvp-entry';
import type { Screens } from './screens';

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
  /** リングレース（7-1。ui/race-link.ts）: 飛ぶコース（null はレースでない）と、レースを始める処理 */
  readonly race: { readonly course: CourseDef | null; begin(): void };
}

/**
 * 飛行を始める関数を作る（モード選択・ブリーフィング・リザルトの「もう一度」・PvP のロビーから入るたびに呼ぶ）。
 * フリーフライトは起動位置から、ミッション（チュートリアルも）は定義の開始位置から、リングレース（7-1）はコースのスタート地点から。
 * PvP（net）は敵・ミッションなしの世界にして、自機の位置と色は PvP 側で決める
 */
export function createFlightStarter(
  p: FlightStartParts,
): (def: MissionDef | null, net: boolean) => void {
  return (def, net) => {
    // ハンガーで選んだ機体と強化を自機に入れる（3-3）。見た目も機体の形に
    // PvP は強化の無効（ホストの設定）とロビーで選んだ機体（5-4）
    const loadout = (net ? p.pvp.loadout() : null) ?? p.screens.hangar.loadout();
    p.session.applyLoadout(loadout);
    p.playerView.setModel(p.screens.hangar.selectedModel, loadout.missiles);
    // 6-4: マップ（PvP はロビーのホスト設定、ミッションは定義、フリーフライトはモード選択で選んだもの）。
    // 違うマップなら地形・街を捨てて作り直す。同じなら建物を建て直すだけ
    const course = net ? null : p.race.course;
    const mapId = net
      ? p.pvp.mapId
      : course
        ? course.mapId
        : def
          ? def.mapId
          : p.screens.modeSelect.freeMapId;
    p.activeMap.use(mapId);
    const map = findMap(mapId);
    p.session.setFreeStart(map.id === ISLAND_MAP.id ? WORLD_CONFIG.start : map.start);
    if (net) {
      p.play.startEmpty({ ...WORLD_CONFIG.start, headingDeg: 0 });
      p.pvp.beginFlight();
    } else if (course) p.race.begin();
    else if (def) p.play.startMission(def);
    else p.play.startFree();
    p.views.reset();
    p.playerView.reset();
    p.chaseCamera.snap();
    p.quality.startWatch();
  };
}
