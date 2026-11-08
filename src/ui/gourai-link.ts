// 10-4b: メカ怪獣ゴウライの入口。起動時に読むのはここだけ（小さく保つ）: レイドの別の怪獣として登録し（怪獣選び・リプレイ・
// 記録カードの題）、判定・形・HUD・文言・協力の遅延チャンク（gourai-runtime.ts）を、ゴウライのレイドを始める前・リプレイを
// 再生する前・協力の飛行の前（ホストは開始の前、クライアントはロビーで先読み）に読む（読み込み中・失敗の表示付き）。
// 怪獣選びで選んだときは先読みする。?dev=gourai（10-4a の確かめる場）のときは起動時に読み、フリーフライトにも出す
import type { PerspectiveCamera, Scene } from 'three';
import { lazyChunk } from '../core/lazy-chunk';
import { parseDevFlags } from '../core/debug-flags';
import type { GameState } from '../core/game-state';
import type { ActiveMap } from '../missions/active-map';
import type { GamePlay } from '../missions/game-play';
import { GOURAI_VARIANT } from '../missions/gourai-mission';
import { registerRaidVariant } from '../missions/raid-variants';
import type { QualityLink } from '../render/quality-link';
import type { FlightFrame } from '../render/flight-frame';
import type { RenderPipeline } from '../render/pipeline';
import type { GouraiRuntime } from './gourai-runtime';
import { loadChunk, prefetchChunk } from './lazy-load';
import { registerRaidKaijuChunk } from './raid-kaiju-link';

export interface GouraiLinkParts {
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
  /** 10-7c: 天候（雨の強さ）・カメラ・演出のカメラの口（登場の場面）・撮影（?dev=kshot）・画面の揺れ */
  readonly camera: PerspectiveCamera;
  readonly weather: {
    set(id: string, instant?: boolean): void;
    readonly params: Readonly<{ rain: number }>;
  };
  readonly frame: FlightFrame;
  readonly pipeline: RenderPipeline;
  readonly shake: (strength: number) => void;
}

let parts: GouraiLinkParts | null = null;
let runtime: GouraiRuntime | null = null;

const chunk = lazyChunk(async (): Promise<GouraiRuntime> => {
  const p = parts;
  if (!p) throw new Error('gourai: not linked');
  const m = await import('./gourai-runtime');
  runtime ??= m.startGourai({
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
    devFree: parseDevFlags(p.search).has('gourai'),
    weather: p.weather,
    camera: p.camera,
    frame: p.frame,
    pipeline: p.pipeline,
    shake: p.shake,
    game: p.game,
  });
  return runtime;
});

/** 起動時: 登録して部品をつなぐ（?dev=gourai ならすぐ読む） */
export function linkGourai(p: GouraiLinkParts): void {
  parts = p;
  registerRaidVariant(GOURAI_VARIANT);
  registerRaidKaijuChunk(GOURAI_VARIANT.id, {
    load: () => loadChunk(chunk).then((rt) => rt !== null),
    prefetch: () => {
      prefetchChunk(chunk);
    },
  });
  if (parseDevFlags(p.search).has('gourai'))
    chunk().catch((e: unknown) => {
      console.error('gourai failed to load', e);
    });
}
