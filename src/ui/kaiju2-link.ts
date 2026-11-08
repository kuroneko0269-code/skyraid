// 9-6c: ネフィルガ（2 体目の怪獣）の入口。起動時に読むのはここだけ（小さく保つ）: レイドの別の怪獣として登録し（モード選択の
// レイドの選択・リプレイ・記録カードの題）、判定・形・HUD・音・文言の遅延チャンク（kaiju2-runtime.ts）を、ネフィルガのレイドを
// 始める前・ネフィルガのリプレイを再生する前・協力のネフィルガの飛行の前に読む（読み込み中・失敗の表示付き）。
// モード選択でネフィルガを選んだときは先読みする。?dev=kaiju2（9-6a の確かめる場）のときは起動時に読む
import type { PerspectiveCamera, Scene } from 'three';
import { lazyChunk } from '../core/lazy-chunk';
import { parseDevFlags } from '../core/debug-flags';
import type { GameState } from '../core/game-state';
import type { ActiveMap } from '../missions/active-map';
import type { GamePlay } from '../missions/game-play';
import { NEPHIRGA_VARIANT } from '../missions/kaiju2-mission';
import { registerRaidVariant } from '../missions/raid-variants';
import type { MissionDef } from '../missions/types';
import type { QualityLink } from '../render/quality-link';
import type { FlightFrame } from '../render/flight-frame';
import type { RenderPipeline } from '../render/pipeline';
import type { GameAudio } from '../audio/game-audio';
import { loadChunk, prefetchChunk } from './lazy-load';
import { registerRaidKaijuChunk } from './raid-kaiju-link';
import type { Kaiju2Runtime } from './kaiju2-runtime';

export interface Kaiju2LinkParts {
  readonly search: string;
  readonly play: GamePlay;
  readonly scene: Scene;
  readonly activeMap: ActiveMap;
  readonly game: GameState;
  readonly quality: QualityLink;
  readonly pvp: { readonly flying: boolean };
  readonly onRender: (fn: (alpha: number) => void) => void;
  /** レイドの HUD（H キーの表示の切り替え）・音（エンジンとリスナーの位置） */
  readonly hud: { readonly visible: boolean };
  readonly audio: GameAudio;
  readonly camera: PerspectiveCamera;
  /** 9-7: 天候（M8 の決戦の演出で移す）。10-7a: 雨の強さ（体の周りの雨・稲光の多さ） */
  readonly weather: {
    set(id: string, instant?: boolean): void;
    readonly params: Readonly<{ rain: number }>;
  };
  /** 10-7a: 演出のカメラ（登場の場面）・撮影（?dev=kshot）・画面の揺れ（咆哮） */
  readonly frame: FlightFrame;
  readonly pipeline: RenderPipeline;
  readonly shake: (strength: number) => void;
}

let parts: Kaiju2LinkParts | null = null;
let runtime: Kaiju2Runtime | null = null;

const chunk = lazyChunk(async (): Promise<Kaiju2Runtime> => {
  const p = parts;
  if (!p) throw new Error('kaiju2: not linked');
  const m = await import('./kaiju2-runtime');
  runtime ??= startRuntime(m, p);
  return runtime;
});

function startRuntime(m: typeof import('./kaiju2-runtime'), p: Kaiju2LinkParts): Kaiju2Runtime {
  const { play, activeMap, game } = p;
  return m.startKaiju2({
    play,
    scene: p.scene,
    search: p.search,
    // 地表と建物の屋根（港湾都市のタワーにも潜らない）
    ground: activeMap.ordnanceGround,
    map: () => activeMap.def,
    state: () => game.state,
    inFreeFlight: () =>
      play.runner === null &&
      play.race === null &&
      play.defense === null &&
      play.practice === null &&
      !p.pvp.flying,
    onDetail: (fn) => {
      p.quality.onPreset((preset) => {
        fn(preset);
      });
    },
    onRender: p.onRender,
    hudVisible: () => p.hud.visible,
    audio: p.audio,
    listener: p.camera.position,
    devFree: parseDevFlags(p.search).has('kaiju2'),
    setWeather: (id) => {
      p.weather.set(id);
    },
    weather: p.weather,
    camera: p.camera,
    frame: p.frame,
    pipeline: p.pipeline,
    shake: p.shake,
    game,
  });
}

/** 起動時: 登録して部品をつなぐ（?dev=kaiju2 ならすぐ読む） */
export function linkKaiju2(p: Kaiju2LinkParts): void {
  parts = p;
  registerRaidVariant(NEPHIRGA_VARIANT);
  // 10-2: 怪獣ごとの遅延チャンクの口（raid-kaiju-link.ts）に読み方を登録する
  registerRaidKaijuChunk(NEPHIRGA_VARIANT.id, {
    load: () => loadKaiju2().then((rt) => rt !== null),
    prefetch: prefetchKaiju2,
  });
  if (parseDevFlags(p.search).has('kaiju2'))
    chunk().catch((e: unknown) => {
      console.error('kaiju2 failed to load', e);
    });
}

/** 読む（読み込み中・失敗の表示付き）。失敗したら null（呼ぶ側は始めない） */
export function loadKaiju2(): Promise<Kaiju2Runtime | null> {
  return loadChunk(chunk);
}

/** 読み込み済みなら（同期で使う側） */
export function loadedKaiju2(): Kaiju2Runtime | null {
  return runtime;
}

/** 先読み（モード選択でネフィルガを選んだとき。表示なし） */
export function prefetchKaiju2(): void {
  if (parts) prefetchChunk(chunk);
}

/** ネフィルガの怪獣の id か（読む必要があるか） */
export function needsKaiju2(kaiju: string | undefined): boolean {
  return kaiju === NEPHIRGA_VARIANT.id;
}

/** 9-7: キャンペーンのミッションがネフィルガ（M8 の決戦）を出すか（出撃・再生の前に読む） */
export function missionNeedsKaiju2(def: Pick<MissionDef, 'skyKaiju'> | null | undefined): boolean {
  return needsKaiju2(def?.skyKaiju);
}

/**
 * 9-7: キャンペーンのミッションを始める（ブリーフィングの「出撃」から）。ネフィルガを出すミッションは遅延チャンクを読んでから
 * （読めない・読む間にブリーフィングを離れたら渡さない）。ほかのミッションはすぐ
 */
export function withCampaignMission(def: MissionDef | null, go: () => void): void {
  if (!missionNeedsKaiju2(def)) {
    go();
    return;
  }
  void loadKaiju2().then((rt) => {
    if (rt && parts?.game.state === 'briefing') go();
  });
}
