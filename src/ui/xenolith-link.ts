// 10-5b: UFO ゼノリスの入口。起動時に読むのはここだけ（小さく保つ）: レイドの別の怪獣として登録し（怪獣選び・リプレイ・
// 記録カードの題）、判定・形・HUD・文言・協力の遅延チャンク（xenolith-runtime.ts）を、ゼノリスのレイドを始める前・リプレイを
// 再生する前・協力の飛行の前（ホストは開始の前、クライアントはロビーで先読み）に読む（読み込み中・失敗の表示付き）。
// 怪獣選びで選んだときは先読みする。?dev=xenolith（10-5a の確かめる場）のときは起動時に読み、フリーフライトにも出す
import type { PerspectiveCamera, Scene } from 'three';
import { lazyChunk } from '../core/lazy-chunk';
import { parseDevFlags } from '../core/debug-flags';
import type { GameState } from '../core/game-state';
import type { ActiveMap } from '../missions/active-map';
import type { GamePlay } from '../missions/game-play';
import { registerRaidKaijuHooks } from '../missions/raid-kaiju-hooks';
import { registerRaidVariant } from '../missions/raid-variants';
import { XENOLITH_VARIANT } from '../missions/xenolith-mission';
import type { QualityLink } from '../render/quality-link';
import type { FlightFrame } from '../render/flight-frame';
import type { RenderPipeline } from '../render/pipeline';
import { loadChunk, prefetchChunk } from './lazy-load';
import { registerRaidKaijuChunk } from './raid-kaiju-link';
import type { XenolithRuntime } from './xenolith-runtime';

export interface XenolithLinkParts {
  readonly search: string;
  readonly play: GamePlay;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly activeMap: ActiveMap;
  readonly game: GameState;
  readonly quality: QualityLink;
  readonly pvp: { readonly flying: boolean };
  readonly onRender: (fn: (alpha: number) => void) => void;
  /** レイドの HUD を出しているか（H キー） */
  readonly hud: { readonly visible: boolean };
  /** 10-7d: 天候（雨の強さ）・演出のカメラの口（登場の場面）・撮影（?dev=kshot）・画面の揺れ */
  readonly weather: {
    set(id: string, instant?: boolean): void;
    readonly params: Readonly<{ rain: number }>;
  };
  readonly frame: FlightFrame;
  readonly pipeline: RenderPipeline;
  readonly shake: (strength: number) => void;
}

let parts: XenolithLinkParts | null = null;
let runtime: XenolithRuntime | null = null;

const chunk = lazyChunk(async (): Promise<XenolithRuntime> => {
  const p = parts;
  if (!p) throw new Error('xenolith: not linked');
  const m = await import('./xenolith-runtime');
  runtime ??= m.startXenolith({
    play: p.play,
    scene: p.scene,
    camera: p.camera,
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
    devFree: parseDevFlags(p.search).has('xenolith'),
    weather: p.weather,
    frame: p.frame,
    pipeline: p.pipeline,
    shake: p.shake,
    game: p.game,
  });
  return runtime;
});

/** 起動時: 登録して部品をつなぐ（?dev=xenolith ならすぐ読む） */
export function linkXenolith(p: XenolithLinkParts): void {
  parts = p;
  registerRaidVariant(XENOLITH_VARIANT);
  registerRaidKaijuChunk(XENOLITH_VARIANT.id, {
    load: () => loadChunk(chunk).then((rt) => rt !== null),
    prefetch: () => {
      prefetchChunk(chunk);
    },
  });
  // 画像を撮るときの基準点（体の中心と水平の向き）
  registerRaidKaijuHooks(XENOLITH_VARIANT.id, {
    artAnchor: () => {
      const b = runtime?.dev.kaiju.body;
      if (!b?.visible) return null;
      return { ...b.position, fx: -Math.sin(b.heading), fz: -Math.cos(b.heading) };
    },
  });
  if (parseDevFlags(p.search).has('xenolith'))
    chunk().catch((e: unknown) => {
      console.error('xenolith failed to load', e);
    });
}
