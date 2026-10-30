// 描画フレームごとの陽炎の屈折と音（4-4）: 飛行中（ポーズを含む）は自機のノズルの陽炎の帯をポストエフェクトへ渡し、
// それ以外では消す。音にはカメラの位置と向き（リスナー）と画面の状態を渡す
import type { PerspectiveCamera } from 'three';
import type { ScreenState } from '../core/game-state';
import type { GameAudio, ListenerPose } from '../audio/game-audio';
import { listenerPose } from './audio-listener';
import { NO_HAZE, type HazeSegment } from './fx/heat-haze';
import type { RenderPipeline } from './pipeline';
import type { PlayerView } from './player-view';

export class FrameFx {
  private readonly pose: ListenerPose = {
    x: 0,
    y: 0,
    z: 0,
    fx: 0,
    fy: 0,
    fz: -1,
    ux: 0,
    uy: 1,
    uz: 0,
  };
  private readonly haze: HazeSegment = { ...NO_HAZE };

  constructor(
    private readonly pipeline: RenderPipeline,
    private readonly player: PlayerView,
    private readonly camera: PerspectiveCamera,
    private readonly audio: GameAudio,
  ) {}

  /** カメラを動かした後・描画の前に呼ぶ。time は陽炎の揺らぎの時間（ポーズ中は止める） */
  update(state: ScreenState, time: number): void {
    const camera = this.camera;
    camera.updateMatrixWorld();
    if (state === 'flight' || state === 'pause') {
      this.pipeline.setHaze(this.player.hazeSegment(camera, camera.aspect, this.haze), time);
    } else {
      this.pipeline.setHaze(NO_HAZE, 0);
    }
    this.audio.frame(state, listenerPose(camera, this.pose));
  }
}
