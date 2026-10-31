// フォトモード（7-A）の配線: ポーズメニューの「フォトモード」・P キーで入り、Esc / 閉じる / P で飛行へ戻る。
// 入っている間は固定ステップを止めたまま（コマ送りで 1 回だけ進める）、カメラ・画面の調整・天候・表示を一時的に上書きし、
// 出るときに戻す。フリーフライト・キャンペーン・ソロのレイドだけ（PvP・協力・チュートリアルは無効）
import type { Object3D, PerspectiveCamera } from 'three';
import type { GameAudio } from '../../audio/game-audio';
import type { GameState } from '../../core/game-state';
import { availableResolutions, resolveResolution } from '../../core/photo-capture';
import { GradeOverride } from '../../core/photo-grade';
import {
  applyPreset,
  clampOrbit,
  createOrbit,
  findPreset,
  panOrbit,
  rotateOrbit,
  wheelZoomFactor,
  zoomOrbit,
} from '../../core/photo-orbit';
import { WeatherOverride } from '../../core/photo-weather';
import { isTouchDevice } from '../../core/settings';
import { PHOTO_FOCUS, type PhotoResolution } from '../../data/photo';
import type { SaveStore } from '../../progression/save-store';
import type { PhotoFrameHook } from '../../render/flight-frame';
import type { FocusSettings } from '../../render/focus-pass';
import type { FlightViews } from '../../render/flight-views';
import { PhotoCamera } from '../../render/photo/photo-camera';
import type { PlayerView } from '../../render/player-view';
import type { PauseMenu } from '../pause';
import type { RenderPipeline } from '../../render/pipeline';
import type { WeatherView } from '../../render/weather/weather-view';
import { attachPhotoGestures } from './photo-gestures';
import { PhotoShutter } from './photo-shutter';
import { PhotoToolbar, type PhotoShowKind } from './photo-toolbar';

export interface PhotoLinkParts {
  readonly game: GameState;
  readonly canvas: HTMLElement;
  readonly camera: PerspectiveCamera;
  readonly pipeline: RenderPipeline;
  readonly playerView: PlayerView;
  readonly views: FlightViews;
  readonly pause: PauseMenu;
  readonly groundHeight: (x: number, z: number) => number;
  readonly weather: WeatherView;
  readonly audio: GameAudio;
  readonly save: SaveStore;
  /** フォトモードに入れる遊び方か（フリーフライト・キャンペーン・ソロのレイド） */
  readonly allowed: () => boolean;
  /** 固定ステップを 1 回だけ進める（ゲームの判定そのもの。入力は読まない） */
  readonly simulate: (dt: number) => void;
  readonly stepSeconds: number;
  /** タッチ操作の表示をやり直す（表示の切替の後） */
  readonly refreshTouch: () => void;
}

/** フォトモードを作り、ポーズメニューの「フォトモード」をつなぐ（P キーは common-keys の toggle） */
export function createPhotoMode(p: PhotoLinkParts): PhotoLink {
  const photo = new PhotoLink(p);
  p.pause.onPhoto = () => {
    if (photo.canEnter) p.game.transition('photo');
  };
  p.game.onChange(({ to }) => {
    if (to === 'pause') p.pause.setPhotoAvailable(p.allowed());
  });
  return photo;
}

export class PhotoLink implements PhotoFrameHook {
  private readonly aircraft: Object3D;
  private readonly toolbar: PhotoToolbar;
  private readonly cam: PhotoCamera;
  private readonly orbit = createOrbit();
  private readonly grade: GradeOverride;
  private readonly weather: WeatherOverride;
  private readonly focus: FocusSettings = { distance: 30, blur: PHOTO_FOCUS.defaultBlur };
  private focusAuto = true;
  private pendingStep = 0;
  private resolution: PhotoResolution = 'screen';
  private readonly mobile = isTouchDevice();
  /** タッチ操作を出すか（表示の切替。既定は隠す） */
  private touchShown = false;
  private uiHidden = false;
  private readonly shutter: PhotoShutter;

  constructor(private readonly p: PhotoLinkParts) {
    this.aircraft = p.playerView.mesh;
    const g = p.views.photoGroups;
    this.cam = new PhotoCamera(p.camera, {
      aircraft: [this.aircraft],
      enemies: g.enemies,
      effects: [...g.effects, p.playerView.trailMesh],
    });
    this.grade = new GradeOverride(p.pipeline);
    this.weather = new WeatherOverride(p.weather.director);
    this.toolbar = new PhotoToolbar(
      document.body,
      this.handlers(),
      availableResolutions(this.mobile),
    );
    this.shutter = new PhotoShutter(p.pipeline, p.audio);
    attachPhotoGestures(p.canvas, () => p.game.state === 'photo', {
      rotate: (dx, dy) => rotateOrbit(this.orbit, dx, dy),
      pan: (dx, dy) =>
        panOrbit(this.orbit, dx, dy, window.innerHeight, this.cam.headingOf(this.aircraft)),
      zoom: (f) => zoomOrbit(this.orbit, f),
      wheel: (d) => zoomOrbit(this.orbit, wheelZoomFactor(d)),
      doubleTap: () => {
        if (this.uiHidden) this.setUiHidden(false);
      },
    });
    p.game.onChange(({ from, to }) => {
      if (to === 'photo') this.enter();
      else if (from === 'photo') this.exit();
    });
  }

  /** フォトモードに入れるか（飛行中・ポーズ中で、許された遊び方） */
  get canEnter(): boolean {
    const s = this.p.game.state;
    return (s === 'flight' || s === 'pause') && this.p.allowed();
  }

  /** P キー: 入る / 出る */
  toggle(): void {
    const game = this.p.game;
    if (game.state === 'photo') game.transition('flight');
    else if (this.canEnter) game.transition('photo');
  }

  /** タッチ操作をフォトモードで出すか */
  get showsTouch(): boolean {
    return this.p.game.state === 'photo' && this.touchShown;
  }

  takeStepSeconds(): number {
    const s = this.pendingStep;
    this.pendingStep = 0;
    return s;
  }

  update(): void {
    const distance = this.cam.update(this.orbit, this.aircraft, this.p.groundHeight);
    if (this.focusAuto && Math.abs(this.focus.distance - distance) > 0.05) {
      this.focus.distance = distance;
      this.p.pipeline.setFocus(this.focus);
      if (this.p.pipeline.focusAvailable) this.toolbar.camera.showFocusDistance(distance);
    }
  }

  private enter(): void {
    const p = this.p;
    this.cam.enter();
    this.grade.begin();
    this.weather.begin();
    this.focusAuto = true;
    p.pipeline.setFocus(this.focus);
    for (const k of ['aircraft', 'enemies', 'effects'] as const) this.cam.setVisible(k, true);
    this.touchShown = false;
    delete document.documentElement.dataset.photoHud;
    this.resolution = resolveResolution(this.resolution, this.mobile);
    const t = this.toolbar;
    t.camera.syncCamera(this.orbit.fov, this.orbit.roll);
    t.camera.syncFocus(true, this.focus.distance, this.focus.blur, p.pipeline.focusAvailable);
    t.grade.sync(this.grade.settings, p.pipeline.gradeAvailable);
    for (const k of ['hud', 'touch'] as const) t.syncShow(k, false);
    for (const k of ['aircraft', 'enemies', 'effects'] as const) t.syncShow(k, true);
    t.syncWeather(null, this.weather.hour);
    t.syncShot(this.resolution, p.save.settings.photoWatermark);
    this.setUiHidden(false);
    this.toolbar.setShown(true);
  }

  private exit(): void {
    const p = this.p;
    this.cam.exit();
    this.grade.end();
    this.weather.end();
    p.pipeline.setFocus(null);
    this.touchShown = false;
    delete document.documentElement.dataset.photoHud;
    this.toolbar.setShown(false);
    this.shutter.hideToast();
    p.refreshTouch();
  }

  private setUiHidden(hidden: boolean): void {
    this.uiHidden = hidden;
    this.toolbar.setShown(!hidden && this.p.game.state === 'photo');
  }

  private show(kind: PhotoShowKind, on: boolean): void {
    if (kind === 'hud') {
      if (on) document.documentElement.dataset.photoHud = '';
      else delete document.documentElement.dataset.photoHud;
    } else if (kind === 'touch') {
      this.touchShown = on;
      this.p.refreshTouch();
    } else this.cam.setVisible(kind, on);
  }

  /** コマ送り: 固定ステップを 1 回（1/60 秒）だけ進め、次の描画で演出も同じだけ進める */
  private step(): void {
    const dt = this.p.stepSeconds;
    this.p.simulate(dt);
    this.pendingStep += dt;
  }

  private handlers(): ConstructorParameters<typeof PhotoToolbar>[1] {
    const o = this.orbit;
    const p = this.p;
    return {
      preset: (id) => {
        const preset = findPreset(id);
        if (preset) applyPreset(o, preset);
        this.toolbar.camera.syncCamera(o.fov, o.roll);
      },
      cameraReset: () => {
        Object.assign(o, createOrbit());
        this.toolbar.camera.syncCamera(o.fov, o.roll);
      },
      fov: (v) => {
        o.fov = v;
        clampOrbit(o);
      },
      roll: (v) => {
        o.roll = v;
        clampOrbit(o);
      },
      focusAuto: (on) => {
        this.focusAuto = on;
      },
      focusDistance: (m) => {
        this.focus.distance = m;
        p.pipeline.setFocus(this.focus);
      },
      blur: (v) => {
        this.focus.blur = v;
        p.pipeline.setFocus(this.focus);
      },
      grade: (key, v) => {
        this.grade.set(key, v);
      },
      filter: (f) => {
        this.grade.setFilter(f);
      },
      gradeReset: () => {
        this.grade.reset();
        this.toolbar.grade.sync(this.grade.settings, p.pipeline.gradeAvailable);
      },
      show: (kind, on) => {
        this.show(kind, on);
      },
      step: () => {
        this.step();
      },
      weather: (id) => {
        this.weather.setPreset(id);
        this.toolbar.syncWeather(this.weather.preset, this.weather.hour);
      },
      weatherRestore: () => {
        this.weather.revert();
        this.toolbar.syncWeather(null, this.weather.hour);
      },
      hour: (h) => {
        this.weather.setHour(h);
      },
      resolution: (r) => {
        this.resolution = resolveResolution(r, this.mobile);
      },
      watermark: (on) => {
        p.save.setSetting('photoWatermark', on);
      },
      shoot: () => {
        void this.shutter.shoot(this.resolution, this.mobile, p.save.settings.photoWatermark);
      },
      hideUi: () => {
        this.setUiHidden(true);
      },
      close: () => {
        if (p.game.state === 'photo') p.game.transition('flight');
      },
    };
  }
}
