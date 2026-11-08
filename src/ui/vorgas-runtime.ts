// 10-7e: ヴォルガスの見た目の遅延チャンク（読むのは src/ui/vorgas-link.ts）: 描画（render/kaiju-model/）へ演出の入力
// （カメラ・頭が追う相手・足元の床・倒してからの秒数・登場の場面の進み・演出の秒数）を渡し、登場の場面（海から上陸。ソロのレイドだけ・
// タップで飛ばす）・段階と撃破の揺れ・足音 / 膝をつく / 倒れたときの揺れ・撮影（?dev=kshot）を受け持つ。判定は読むだけ
import type { PerspectiveCamera } from 'three';
import type { GameAudio } from '../audio/game-audio';
import { CombatSounds } from '../audio/sfx/combat-sounds';
import { KaijuSounds } from '../audio/sfx/kaiju-sounds';
import { SfxKit } from '../audio/sfx/kit';
import { parseDevFlags } from '../core/debug-flags';
import type { ScreenState } from '../core/game-state';
import type { AircraftDetail } from '../data/aircraft-model';
import { kaijuTier, type KaijuTier } from '../data/kaiju-look';
import { VORGAS_VISUAL } from '../data/vorgas-visual';
import type { KaijuBodyView } from '../entities/kaiju-display';
import type { GamePlay } from '../missions/game-play';
import type { FlightFrame } from '../render/flight-frame';
import type { VorgasLook, VorgasViewInput } from '../render/kaiju-model/vorgas-view';
import type { RenderPipeline } from '../render/pipeline';
import { createVorgasCinema } from './vorgas-cinema';

export interface VorgasRuntimeParts {
  readonly play: GamePlay;
  readonly search: string;
  readonly audio: GameAudio;
  readonly camera: PerspectiveCamera;
  readonly frame: FlightFrame;
  readonly pipeline: RenderPipeline;
  readonly weather: { set(id: string, instant?: boolean): void };
  readonly shake: (strength: number) => void;
  readonly game: { transition(to: 'pause' | 'flight'): boolean };
  readonly state: () => ScreenState;
  /** 地形の高さ（海は 0 で切る） */
  readonly ground: (x: number, z: number) => number;
  /** ソロのレイドを飛んでいる（協力・PvP でない） */
  readonly soloRaid: () => boolean;
  readonly onDetail: (fn: (d: { aircraftDetail: AircraftDetail; bloom: boolean }) => void) => void;
  readonly onRender: (fn: (alpha: number) => void) => void;
  readonly setLook: (look: VorgasLook) => void;
}

/** 演出のカメラ（登場の場面）を出してよい画面 */
const CINEMA_SHOWN: readonly ScreenState[] = ['flight', 'pause'];

export function startVorgas(p: VorgasRuntimeParts): void {
  let tier: KaijuTier = 'high';
  p.onDetail((d) => {
    tier = kaijuTier(d);
  });
  const kit = new SfxKit(p.audio.engine, p.camera.position);
  const sounds = new KaijuSounds(kit, new CombatSounds(kit));
  const { cinema, subject } = createVorgasCinema({
    frame: p.frame,
    camera: p.camera,
    shake: p.shake,
    roar: () => {
      sounds.roar(1);
    },
  });
  // 撮影（?dev=kshot）: 止めている間も演出を進める秒数・怪獣を描くか・形を動かす時間・倒してからの秒数と登場の進みの固定
  let shotDt: number | null = null;
  let shotDead: number | null = null;
  let shotEntrance = -1;
  let shown = true;
  let resetFx = false;
  let apply: (shown: boolean) => void = () => undefined;
  const updateTimes: number[] = [];
  let deadTime = -1;
  let last = performance.now();
  const input = {
    camera: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    floor: 0,
    deadTime: -1,
    entrance: -1,
    fxDt: 0,
  };
  const look: VorgasLook = {
    get tier() {
      return tier;
    },
    get shown() {
      return shown;
    },
    get clock() {
      return shotDt;
    },
    input(body: KaijuBodyView, dt: number): VorgasViewInput {
      const fxDt = shotDt ?? (p.state() === 'flight' ? dt : 0);
      deadTime = body.hp <= 0 ? Math.max(0, deadTime) + fxDt : -1;
      const c = p.camera.position;
      input.camera.x = input.target.x = c.x;
      input.camera.y = input.target.y = c.y;
      input.camera.z = input.target.z = c.z;
      input.floor = Math.max(0, p.ground(body.feet.x, body.feet.z));
      input.deadTime = shotDead ?? deadTime;
      input.entrance = cinema.active ? cinema.progress : shotEntrance;
      input.fxDt = fxDt;
      return input;
    },
    takeReset() {
      const r = resetFx;
      resetFx = false;
      return r;
    },
    bind(fn) {
      apply = fn;
    },
    measured(ms) {
      updateTimes.push(ms);
      if (updateTimes.length > 120) updateTimes.shift();
    },
    impact(strength, at) {
      if (shotDt !== null || p.state() !== 'flight') return;
      const c = p.camera.position;
      const d = Math.hypot(at.x - c.x, at.y - c.y, at.z - c.z);
      const k = Math.max(0, 1 - d / VORGAS_VISUAL.shake.stepRange);
      if (k > 0.02) p.shake(strength * k);
    },
  };
  p.setLook(look);
  if (parseDevFlags(p.search).has('kshot'))
    void import('./vorgas-shot').then((m) => {
      m.linkVorgasShot({
        kaiju: () => p.play.session.props.kaiju,
        ai: () => p.play.session.props.kaijuAi,
        camera: p.camera,
        pipeline: p.pipeline,
        weather: p.weather,
        game: p.game,
        setFxClock: (d) => {
          shotDt = d;
        },
        setKaijuShown: (v) => {
          shown = v;
          apply(v);
        },
        updateMs: () => {
          const t = [...updateTimes].sort((a, b) => a - b);
          return t[t.length >> 1] ?? 0;
        },
        cue: (scene) => {
          resetFx = true;
          deadTime = -1;
          shotDead = scene === 'defeat' ? VORGAS_VISUAL.collapse.fall + 1.2 : null;
          shotEntrance = scene === 'entrance' ? 0.6 : -1;
        },
      });
    });
  p.onRender(() => {
    const now = performance.now();
    const dt = shotDt ?? Math.min(0.1, (now - last) / 1000);
    last = now;
    const k = p.play.session.props.kaiju;
    subject.kaiju = k;
    const state = p.state();
    const solo = p.soloRaid() && k.visible && CINEMA_SHOWN.includes(state) && shotDt === null;
    cinema.update(solo ? subject : null, state === 'flight', dt);
  });
}
