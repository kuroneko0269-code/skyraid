// リプレイ（7-B）の部品を組み立てる（main.ts が 300 行を超えないよう分けた）: 再生のカメラ（自由カメラはフォトモードの
// 操作を流用）・再生中の操作・一覧と保存の配線
import type { PerspectiveCamera } from 'three';
import type { GameAudio } from '../audio/game-audio';
import type { CommonKeys } from '../core/common-keys';
import type { GameState } from '../core/game-state';
import type { GamepadInput } from '../core/gamepad';
import type { Input } from '../core/input';
import type { GameLoop } from '../core/loop';
import type { AircraftControls } from '../entities/aircraft';
import type { SaveStore } from '../progression/save-store';
import type { ChaseCamera } from '../render/chase-camera';
import type { FlightFrame } from '../render/flight-frame';
import type { FlightViews } from '../render/flight-views';
import type { PlayerView } from '../render/player-view';
import { ReplayCameras } from '../render/replay-camera';
import type { WeatherView } from '../render/weather/weather-view';
import type { ReplayHub } from '../replay/hub';
import type { SimWorld } from '../replay/sim';
import { attachPhotoGestures } from './photo/photo-gestures';
import { createReplayLink, type ReplayLink } from './replay-link';
import { ReplayPlayback } from './replay-playback';

export interface ReplayWiringParts {
  readonly game: GameState;
  readonly hub: ReplayHub;
  readonly world: SimWorld;
  readonly loop: GameLoop;
  readonly frame: FlightFrame;
  readonly camera: PerspectiveCamera;
  readonly canvas: HTMLElement;
  readonly controls: AircraftControls;
  readonly input: Input;
  readonly gamepad: GamepadInput;
  readonly keys: CommonKeys;
  readonly views: FlightViews;
  readonly playerView: PlayerView;
  readonly chaseCamera: ChaseCamera;
  readonly weather: WeatherView;
  readonly audio: GameAudio;
  readonly save: SaveStore;
  readonly groundHeight: (x: number, z: number) => number;
  readonly photo: () => void;
  readonly resultExtras: readonly HTMLElement[];
}

export function createReplayWiring(p: ReplayWiringParts): {
  link: ReplayLink;
  playback: ReplayPlayback;
} {
  const session = p.world.play.session;
  const cameras = new ReplayCameras(p.camera, p.playerView.mesh, session, p.groundHeight);
  const playback = new ReplayPlayback({ ...p, cameras });
  // 自由カメラ: フォトモードと同じ操作（ドラッグで回転・2 本指 / 右ドラッグで平行移動・ピンチ / ホイールで寄る）
  attachPhotoGestures(
    p.canvas,
    () => playback.active && p.game.state === 'flight' && cameras.mode === 'free',
    {
      rotate: (dx, dy) => {
        cameras.rotate(dx, dy);
      },
      pan: (dx, dy) => {
        cameras.pan(dx, dy, window.innerHeight);
      },
      zoom: (f) => {
        cameras.zoom(f);
      },
      wheel: (d) => {
        cameras.wheel(d);
      },
      doubleTap: () => undefined,
    },
  );
  const link = createReplayLink({
    game: p.game,
    hub: p.hub,
    play: p.world.play,
    world: p.world,
    save: p.save,
    playback,
    resultExtras: p.resultExtras,
  });
  return { link, playback };
}
