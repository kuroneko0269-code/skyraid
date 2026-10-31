// ミッションと自機のイベントの配線（main.ts から分けた。7-A の事前修正。挙動は変えていない）:
// 爆弾・ロケットと建物、ミッションの開始（HUD・ポーズの「中断」・チュートリアル・報酬）、撃墜とリスポーンのカメラ
import type { ActiveMap } from '../missions/active-map';
import type { FlightSession } from '../missions/flight-session';
import type { GamePlay } from '../missions/game-play';
import { bindMissionRewards } from '../progression/mission-rewards';
import type { SaveStore } from '../progression/save-store';
import type { ChaseCamera } from '../render/chase-camera';
import type { PlayerView } from '../render/player-view';
import type { MissionHud } from './mission-hud';
import type { Screens } from './screens';
import type { TutorialLink } from './tutorial-link';

export interface MissionWiringParts {
  readonly session: FlightSession;
  readonly activeMap: ActiveMap;
  readonly play: GamePlay;
  readonly screens: Screens;
  readonly missionHud: MissionHud;
  readonly tutorial: TutorialLink;
  readonly save: SaveStore;
  readonly chaseCamera: ChaseCamera;
  readonly playerView: PlayerView;
  readonly groundHeight: (x: number, z: number) => number;
}

export function linkMissionEvents(p: MissionWiringParts): void {
  const { session, activeMap, screens, chaseCamera, playerView } = p;
  // 6-4: 爆弾・ロケットは建物の屋根・壁でも起爆し、当たった建物を壊す（HP 1 回分）
  session.combat.ordnanceGround = activeMap.ordnanceGround;
  session.combat.onOrdnance((x, y, z, radius) => {
    activeMap.buildings?.hitSphere(x, y, z, radius, 'player');
  });
  p.play.onRunnerChange((runner) => {
    const inTutorial = screens.inTutorial;
    p.missionHud.attach(runner);
    screens.pause.setInMission(
      runner !== null,
      inTutorial ? screens.tutorialText.abortMenu : undefined,
    );
    p.tutorial.attach(runner, inTutorial);
    // 成功の記録と報酬をセーブへ（3-2）。チュートリアルの報酬は初回だけ（TutorialLink）
    if (runner && !inTutorial) bindMissionRewards(runner.bus, p.save, screens.progress);
  });
  // 撃墜（地面への墜落も）されたら揺らし、リスポーンしたら機体とカメラを新しい位置へすぐ移す（4-12b。
  // 次の描画を待つと、揺れ・地面の高さ・飛行機雲が撃墜された場所のまま 1 フレーム残る）
  session.onPlayerDown(() => {
    chaseCamera.addImpact();
  });
  session.onRespawn(() => {
    const aircraft = session.aircraft;
    playerView.respawn(aircraft);
    chaseCamera.snapTo(playerView.mesh, aircraft.state, p.groundHeight);
  });
}
