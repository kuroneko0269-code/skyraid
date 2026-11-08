// 10-3b: 白鯨アルビオンの入口。起動時に読むのはここだけ（小さく保つ）: レイドの別の怪獣として登録し（怪獣選び・リプレイ・
// 記録カードの題）、判定・形・HUD・文言・協力の遅延チャンク（albion-runtime.ts）を、アルビオンのレイドを始める前・リプレイを
// 再生する前・協力の飛行の前（ホストは開始の前、クライアントはロビーで先読み）に読む（読み込み中・失敗の表示付き）。
// 怪獣選びで選んだときは先読みする。?dev=albion（10-3a の確かめる場）のときは起動時に読み、フリーフライトにも出す
import type { PerspectiveCamera, Scene } from 'three';
import { lazyChunk } from '../core/lazy-chunk';
import { parseDevFlags } from '../core/debug-flags';
import type { GameState } from '../core/game-state';
import type { ActiveMap } from '../missions/active-map';
import { ALBION_VARIANT } from '../missions/albion-mission';
import type { GamePlay } from '../missions/game-play';
import { registerRaidVariant } from '../missions/raid-variants';
import type { QualityLink } from '../render/quality-link';
import type { FlightFrame } from '../render/flight-frame';
import type { RenderPipeline } from '../render/pipeline';
import type { AlbionRuntime } from './albion-runtime';
import { loadChunk, prefetchChunk } from './lazy-load';
import { registerRaidKaijuChunk } from './raid-kaiju-link';

export interface AlbionLinkParts {
  readonly search: string;
  readonly play: GamePlay;
  readonly scene: Scene;
  readonly activeMap: ActiveMap;
  readonly game: GameState;
  readonly quality: QualityLink;
  readonly pvp: { readonly flying: boolean };
  readonly onRender: (fn: (alpha: number) => void) => void;
  /** レイドの HUD を出しているか（H キー） */
  readonly hud: { readonly visible: boolean };
  /** 10-7b: 天候（雨の強さ）・カメラ・演出のカメラの口（登場の場面）・撮影（?dev=kshot）・画面の揺れ */
  readonly camera: PerspectiveCamera;
  readonly weather: {
    set(id: string, instant?: boolean): void;
    readonly params: Readonly<{ rain: number }>;
  };
  readonly frame: FlightFrame;
  readonly pipeline: RenderPipeline;
  readonly shake: (strength: number) => void;
}

let parts: AlbionLinkParts | null = null;
let runtime: AlbionRuntime | null = null;

const chunk = lazyChunk(async (): Promise<AlbionRuntime> => {
  const p = parts;
  if (!p) throw new Error('albion: not linked');
  const m = await import('./albion-runtime');
  runtime ??= m.startAlbion({
    play: p.play,
    scene: p.scene,
    search: p.search,
    ground: p.activeMap.ordnanceGround,
    map: () => p.activeMap.def,
    state: () => p.game.state,
    inFreeFlight: () =>
      p.play.runner === null &&
      p.play.race === null &&
      p.play.defense === null &&
      p.play.practice === null &&
      !p.pvp.flying,
    onDetail: (fn) => {
      p.quality.onPreset((preset) => {
        fn(preset);
      });
    },
    onRender: p.onRender,
    hudVisible: () => p.hud.visible,
    devFree: parseDevFlags(p.search).has('albion'),
    weather: p.weather,
    camera: p.camera,
    frame: p.frame,
    pipeline: p.pipeline,
    shake: p.shake,
    game: p.game,
  });
  return runtime;
});

/** 起動時: 登録して部品をつなぐ（?dev=albion ならすぐ読む） */
export function linkAlbion(p: AlbionLinkParts): void {
  parts = p;
  registerRaidVariant(ALBION_VARIANT);
  registerRaidKaijuChunk(ALBION_VARIANT.id, {
    load: () => loadChunk(chunk).then((rt) => rt !== null),
    prefetch: () => {
      prefetchChunk(chunk);
    },
  });
  if (parseDevFlags(p.search).has('albion'))
    chunk().catch((e: unknown) => {
      console.error('albion failed to load', e);
    });
}
