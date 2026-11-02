// リプレイの再生中の操作（7-B）: 記録の入力で固定ステップを進める（GameLoop の時間の倍率で速さ・一時停止）、
// 10 秒スキップ・シーク（キーフレームから計算し直す。先は描画フレームごとに少しずつ）、カメラ、操作バー、UI を隠す、撮影、一覧へ
import type { GameAudio } from '../audio/game-audio';
import type { CommonKeys } from '../core/common-keys';
import type { GameState } from '../core/game-state';
import type { GamepadInput } from '../core/gamepad';
import { t } from '../core/i18n';
import type { Input } from '../core/input';
import type { GameLoop } from '../core/loop';
import { REPLAY_CONFIG } from '../data/replay';
import type { AircraftControls } from '../entities/aircraft';
import type { FlightOptions } from '../flight/flight-model';
import type { ChaseCamera } from '../render/chase-camera';
import type { FlightFrame } from '../render/flight-frame';
import type { FlightViews } from '../render/flight-views';
import type { PlayerView } from '../render/player-view';
import { REPLAY_CAMERAS, type ReplayCameras, type ReplayCameraMode } from '../render/replay-camera';
import type { WeatherView } from '../render/weather/weather-view';
import type { ReplayHub } from '../replay/hub';
import { ReplayPlayer } from '../replay/player';
import type { SimWorld } from '../replay/sim';
import type { ReplayData } from '../replay/types';
import { ReplayBar } from './replay-bar';
import { syncHudScreen } from './hud-screen';

export interface ReplayPlaybackParts {
  readonly game: GameState;
  readonly hub: ReplayHub;
  readonly world: SimWorld;
  readonly loop: GameLoop;
  readonly frame: FlightFrame;
  readonly cameras: ReplayCameras;
  readonly controls: AircraftControls;
  readonly input: Input;
  readonly gamepad: GamepadInput;
  readonly keys: CommonKeys;
  readonly views: FlightViews;
  readonly playerView: PlayerView;
  readonly chaseCamera: ChaseCamera;
  readonly weather: WeatherView;
  readonly audio: GameAudio;
  /** フォトモードへ（P・「撮影」） */
  readonly photo: () => void;
}

const SPEEDS = REPLAY_CONFIG.speeds;
const NORMAL_SPEED = SPEEDS.indexOf(1);

export class ReplayPlayback {
  private player: ReplayPlayer | null = null;
  private paused = false;
  private speedIndex = NORMAL_SPEED;
  private uiHidden = false;
  private readonly bar: ReplayBar;
  /** 再生の前の操作設定（再生は記録の値で上書きするので、終わったら戻す） */
  private savedOptions: FlightOptions | null = null;
  private status = '';

  constructor(private readonly p: ReplayPlaybackParts) {
    this.bar = new ReplayBar(document.body, {
      togglePause: () => {
        this.togglePause();
      },
      skip: (s) => {
        this.skip(s);
      },
      setSpeed: (i) => {
        this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, i));
      },
      seek: (f) => {
        const pl = this.player;
        if (pl) this.seek(f * pl.steps);
      },
      setCamera: (m) => {
        this.setCamera(m);
      },
      nextTarget: () => {
        this.bar.setTargetLabel(p.cameras.nextTarget());
      },
      photo: p.photo,
      hideUi: () => {
        this.setUiHidden(true);
      },
      exit: () => {
        this.exit();
      },
    });
    window.addEventListener('keydown', (e) => {
      this.onKey(e);
    });
    // UI を隠している間は画面をタップ（クリック）すると戻す
    window.addEventListener('pointerdown', () => {
      if (this.uiHidden && this.active) this.setUiHidden(false);
    });
  }

  /** 再生中か（飛行の画面で） */
  get active(): boolean {
    return this.player !== null;
  }

  /** 飛行の始め（世界は startFromHeader で作ってある） */
  start(data: ReplayData): void {
    const p = this.p;
    const options = p.world.play.session.aircraft.flight.options;
    this.savedOptions ??= { ...options };
    const player = new ReplayPlayer(p.world, data, p.controls);
    player.begin(true);
    this.player = player;
    this.paused = false;
    this.speedIndex = NORMAL_SPEED;
    this.status = player.startMatches ? '' : t('replay.status.startMismatch');
    p.weather.set(data.header.weatherId, true);
    p.weather.setTimeFlow(false);
    p.cameras.setMode('follow');
    p.frame.cameraOverride = p.cameras;
    document.documentElement.dataset.replay = '';
    this.setUiHidden(false);
  }

  /** 再生を終える（一覧へ戻るとき・別の飛行を始めるとき） */
  stop(): void {
    const p = this.p;
    if (!this.player) return;
    this.player = null;
    p.hub.playing = false;
    p.loop.timeScale = 1;
    p.frame.timeScale = 1;
    p.frame.cameraOverride = null;
    p.cameras.reset();
    p.audio.muteEffects(false);
    this.bar.setShown(false);
    delete document.documentElement.dataset.replay;
    const saved = this.savedOptions;
    if (saved) Object.assign(p.world.play.session.aircraft.flight.options, saved);
    this.savedOptions = null;
  }

  /** 固定ステップ 1 回分（flight-loop の update の代わり。キーは止まっていても読めるよう render で読む） */
  update(): void {
    const pl = this.player;
    if (pl && !this.paused && !pl.seeking && !pl.step()) this.paused = true;
  }

  /** キー（止まっている間も描画フレームごとに読む）: Esc 一覧へ、H は「UI を隠す」（HUD の設定は変えない）、P・F3 は今までどおり */
  private readKeys(): void {
    const p = this.p;
    p.gamepad.poll();
    if (p.input.wasPressed('pause')) {
      p.input.endStep();
      this.exit();
      return;
    }
    if (p.input.wasPressed('hudToggle')) {
      this.setUiHidden(!this.uiHidden);
      p.input.endStep();
    } else p.keys.handle();
  }

  /** 1 ステップだけ（フォトモードのコマ送り） */
  stepOnce(): void {
    this.player?.step();
  }

  /** 描画フレームごと（描画の前）: 先へのシークの続き・時間の倍率・操作バー */
  render(): void {
    const p = this.p;
    const pl = this.player;
    if (!pl) return;
    if (p.game.state === 'flight') this.readKeys();
    if (!this.player) return;
    if (pl.seeking) {
      p.audio.muteEffects(true);
      if (pl.advanceSeek()) this.afterJump();
    }
    const flying = p.game.state === 'flight';
    const scale = this.paused || pl.seeking || pl.ended ? 0 : (SPEEDS[this.speedIndex] ?? 1);
    p.loop.timeScale = scale;
    p.frame.timeScale = flying ? scale : 1;
    this.bar.setShown(flying && !this.uiHidden);
    this.bar.update({
      seconds: pl.seconds,
      duration: pl.durationSeconds,
      paused: this.paused || pl.ended,
      speedIndex: this.speedIndex,
      camera: p.cameras.mode,
      status: pl.seeking
        ? t('replay.status.seeking')
        : pl.ended
          ? t('replay.status.ended')
          : this.status,
    });
  }

  private togglePause(): void {
    const pl = this.player;
    if (!pl) return;
    // 終わりで押したら最初から
    if (pl.ended) {
      this.seek(0);
      this.paused = false;
      return;
    }
    this.paused = !this.paused;
  }

  private skip(seconds: number): void {
    const pl = this.player;
    if (pl) this.seek(pl.tick + seconds * 60);
  }

  private seek(tick: number): void {
    const pl = this.player;
    if (!pl) return;
    this.p.audio.muteEffects(true);
    if (pl.seek(tick)) this.afterJump();
  }

  /** シークの後: 演出・機体の描画・カメラを今の位置へすぐ移す（前の位置の煙・飛行機雲を残さない） */
  private afterJump(): void {
    const p = this.p;
    p.audio.muteEffects(false);
    p.views.reset();
    p.playerView.reset();
    p.playerView.respawn(p.world.play.session.aircraft);
    p.chaseCamera.snap();
  }

  private setCamera(mode: ReplayCameraMode): void {
    this.p.cameras.setMode(mode);
    if (mode === 'enemy') this.bar.setTargetLabel(this.p.cameras.nextTarget());
  }

  private setUiHidden(on: boolean): void {
    this.uiHidden = on;
    const root = document.documentElement;
    if (on) delete root.dataset.hud;
    else syncHudScreen(root, this.p.game.state);
  }

  private exit(): void {
    this.p.game.transition('replay_select');
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.active || this.p.game.state !== 'flight') return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement) return;
    switch (e.code) {
      case 'Space':
        this.togglePause();
        break;
      case 'ArrowLeft':
        this.skip(-REPLAY_CONFIG.skipSeconds);
        break;
      case 'ArrowRight':
        this.skip(REPLAY_CONFIG.skipSeconds);
        break;
      case 'ArrowUp':
        this.speedIndex = Math.min(SPEEDS.length - 1, this.speedIndex + 1);
        break;
      case 'ArrowDown':
        this.speedIndex = Math.max(0, this.speedIndex - 1);
        break;
      case 'KeyC': {
        const i = REPLAY_CAMERAS.indexOf(this.p.cameras.mode);
        this.setCamera(REPLAY_CAMERAS[(i + 1) % REPLAY_CAMERAS.length] ?? 'follow');
        break;
      }
      case 'KeyN':
        if (this.p.cameras.mode === 'enemy') this.bar.setTargetLabel(this.p.cameras.nextTarget());
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
