// ミッションと自機のイベントの配線（main.ts から分けた。7-A の事前修正。挙動は変えていない）:
// 爆弾・ロケットと建物、ミッションの開始（HUD・ポーズの「中断」・チュートリアル・報酬）、撃墜とリスポーンのカメラ
import type { ActiveMap } from '../missions/active-map';
import type { FlightSession } from '../missions/flight-session';
import type { GamePlay } from '../missions/game-play';
import { bindMissionRewards } from '../progression/mission-rewards';
import { raidRecord, recordOutbox } from '../online/outbox';
import { recordRaidTime } from '../progression/save-records';
import type { SaveStore } from '../progression/save-store';
import type { ChaseCamera } from '../render/chase-camera';
import type { PlayerView } from '../render/player-view';
import type { MissionHud } from './mission-hud';
import type { Screens } from './screens';
import type { TutorialLink } from './tutorial-link';
import { t } from '../core/i18n';
import { showToast } from './toast';

/** ミサイルの補充のお知らせを出す秒数（8-6b） */
const RESUPPLY_TOAST_SECONDS = 3;

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
  /** 7-B: リプレイの再生中か（報酬・記録をセーブに入れない） */
  readonly replaying: () => boolean;
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
    const replaying = p.replaying();
    screens.pause.setInMission(
      runner !== null,
      inTutorial ? screens.tutorialText.abortMenu : undefined,
    );
    p.tutorial.attach(runner, inTutorial);
    // 8-6b: M1 のミサイルの補充を上のお知らせに
    runner?.bus.on('mission:resupply', () => {
      showToast(t('hud.missileResupply'), { seconds: RESUPPLY_TOAST_SECONDS });
    });
    // 成功の記録と報酬をセーブへ（3-2）。チュートリアルの報酬は初回だけ（TutorialLink）
    // 7-B: 再生中は記録・報酬を入れない
    if (runner && !inTutorial && !replaying) {
      bindMissionRewards(runner.bus, p.save, screens.progress);
      // 7-4: ソロのレイドのクリアをオンライン連携の記録に（連携していなければ何もしない）
      const raid = runner.def.reward.raid;
      if (raid) {
        runner.bus.on('mission:end', ({ result }) => {
          if (result.outcome !== 'success') return;
          const aircraftId = screens.hangar.selectedId;
          // 7-D: モード選択のカードに出す自己ベスト（ローカル）
          p.save.transact((data) =>
            recordRaidTime(data.records, raid.difficulty, result.elapsedSeconds * 1000),
          );
          recordOutbox.submit(
            raidRecord(raid.difficulty, result.elapsedSeconds, aircraftId, result.rank),
          );
        });
      }
    }
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
