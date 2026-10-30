// 描画フレームごとの更新（main.ts の loop.onRender から分けた。4-11 の事前修正。挙動は変えていない）:
// 画面の状態に合わせたカメラ（デモ / ハンガー / 追従）・機体と演出・HUD・ミッションの印・影・画質の監視・描画
import type { Object3D, PerspectiveCamera } from 'three';
import type { AircraftControls } from '../entities/aircraft';
import { isSimulating, usesDemoCamera, type ScreenState } from '../core/game-state';
import type { WeaponInput } from '../core/weapon-input';
import type { AssistFlags } from '../core/assist-settings';
import { QUALITY_CONFIG } from '../data/quality';
import type { FlightSession } from '../missions/flight-session';
import type { GamePlay } from '../missions/game-play';
import type { DamageOverlay } from '../ui/damage-overlay';
import type { Hud } from '../ui/hud';
import type { TouchControls } from '../ui/touch-controls';
import type { ChaseCamera } from './chase-camera';
import type { DebugLink } from './debug-link';
import type { DemoCamera } from './demo-camera';
import type { FlightViews } from './flight-views';
import type { FrameFx } from './frame-fx';
import type { HangarStage } from './hangar-stage';
import type { HudLink } from './hud-link';
import type { MissionLink } from './mission-link';
import type { RenderPipeline } from './pipeline';
import type { PlayerView } from './player-view';
import type { QualityLink } from './quality-link';
import type { RingView } from './ring-view';
import type { World } from './scene';

export interface FlightFrameParts {
  readonly pipeline: RenderPipeline;
  readonly world: World;
  readonly camera: PerspectiveCamera;
  readonly playerView: PlayerView;
  readonly chaseCamera: ChaseCamera;
  readonly demoCamera: DemoCamera;
  readonly hangarStage: HangarStage;
  readonly views: FlightViews;
  readonly ringView: RingView;
  readonly damageOverlay: DamageOverlay;
  readonly hud: Hud;
  readonly hudLink: HudLink;
  readonly missionLink: MissionLink;
  readonly frameFx: FrameFx;
  readonly quality: QualityLink;
  readonly debug: DebugLink;
  readonly session: FlightSession;
  readonly play: GamePlay;
  readonly controls: Readonly<AircraftControls>;
  readonly touch: TouchControls;
  readonly weaponInput: WeaponInput;
  readonly assistFlags: Readonly<AssistFlags>;
  readonly groundHeight: (x: number, z: number) => number;
}

export class FlightFrame {
  /** 島の周りを回る時間。海の波もこれで動かし、ポーズ中は止める */
  private worldTime = 0;
  private lastFrameMs: number | null = null;
  private readonly aircraftMesh: Object3D;

  constructor(private readonly p: FlightFrameParts) {
    this.aircraftMesh = p.playerView.mesh;
  }

  /** 描画フレーム 1 回分。menuTick は固定更新が止まっている間（タイトル・メニュー・ポーズ）の入力 */
  render(state: ScreenState, alpha: number, menuTick: () => void): void {
    const p = this.p;
    const now = performance.now();
    const frameSeconds = this.lastFrameMs === null ? 0 : (now - this.lastFrameMs) / 1000;
    if (!isSimulating(state)) menuTick();
    if (state !== 'pause') this.worldTime += frameSeconds;
    if (usesDemoCamera(state)) p.demoCamera.update(frameSeconds);
    else if (state === 'hangar') p.hangarStage.update(frameSeconds);
    else if (state === 'flight') this.updateFlightView(alpha, frameSeconds);
    p.views.update(alpha, state === 'flight' ? frameSeconds : 0, p.camera.position);
    p.ringView.update(p.play.runner?.running ? p.play.runner.activeRings : null);
    const v = p.session.player;
    p.damageOverlay.update(
      v.flashTimer,
      v.isDestroyed,
      v.respawnTimer,
      isSimulating(state) || state === 'pause',
    );
    // 影は機体のまわり（タイトル・モード選択ではカメラのまわり）
    p.world.update(
      p.camera.position,
      this.worldTime,
      state === 'hangar'
        ? p.hangarStage.mesh.position
        : this.aircraftMesh.visible
          ? this.aircraftMesh.position
          : p.camera.position,
    );
    if (state === 'flight' && p.hud.visible)
      p.hudLink.update(alpha, window.innerWidth, window.innerHeight);
    if (state === 'flight') p.missionLink.update(window.innerWidth, window.innerHeight);
    p.frameFx.update(state, this.worldTime);
    p.pipeline.render();
    if (
      state === 'flight' &&
      this.lastFrameMs !== null &&
      p.quality.recordFlightFrame(frameSeconds)
    ) {
      const { notice, noticeSeconds } = QUALITY_CONFIG.autoDowngrade;
      p.hud.showNotice(notice, noticeSeconds);
    }
    if (this.lastFrameMs !== null) p.debug.record(frameSeconds);
    this.lastFrameMs = now;
  }

  /** 追従カメラと機体の描画位置を更新する（飛行中だけ。ポーズ中はカメラも止める） */
  private updateFlightView(alpha: number, frameSeconds: number): void {
    const p = this.p;
    const { session, camera } = p;
    const aircraft = session.aircraft;
    // 撃墜されている間は機体を隠す（破片は combat の撃墜の演出）
    this.aircraftMesh.visible = session.player.active;
    p.playerView.update(
      aircraft,
      p.controls,
      session.combat.missileAmmo.count,
      alpha,
      frameSeconds,
    );
    // カメラが地面にめり込まないよう、前フレームのカメラ位置の地表の高さを渡す
    const groundUnderCamera = p.groundHeight(camera.position.x, camera.position.z);
    const focus = p.assistFlags.camera
      ? (session.combat.targeting.selected?.position ?? null)
      : null;
    p.chaseCamera.update(this.aircraftMesh, aircraft.state, groundUnderCamera, frameSeconds, focus);
    p.touch.syncThrottle(aircraft.throttle);
    p.touch.syncSecondary(p.weaponInput.secondary);
  }
}
