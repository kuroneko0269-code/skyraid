// 10-7e: ヴォルガスの見た目の入口。起動時に読むのはここだけ（小さく保つ）: 演出の遅延チャンク（vorgas-runtime.ts。登場の場面・
// 揺れ・描画への演出の入力・撮影）を、モード選択を開いたとき（怪獣のモデルの先読みと同じ）か、ヴォルガスが出たときに読む。
// 読むまでは描画が決まった値で描く（判定には関わらない）
import type { PerspectiveCamera } from 'three';
import type { GameAudio } from '../audio/game-audio';
import { lazyChunk } from '../core/lazy-chunk';
import type { GameState } from '../core/game-state';
import type { ActiveMap } from '../missions/active-map';
import type { GamePlay } from '../missions/game-play';
import type { FlightFrame } from '../render/flight-frame';
import type { VorgasLook } from '../render/kaiju-model/vorgas-view';
import type { QualityLink } from '../render/quality-link';
import type { RenderPipeline } from '../render/pipeline';

export interface VorgasLinkParts {
  readonly search: string;
  readonly play: GamePlay;
  readonly audio: GameAudio;
  readonly camera: PerspectiveCamera;
  readonly activeMap: ActiveMap;
  readonly game: GameState;
  readonly quality: QualityLink;
  readonly pvp: { readonly flying: boolean };
  readonly onRender: (fn: (alpha: number) => void) => void;
  readonly frame: FlightFrame;
  readonly pipeline: RenderPipeline;
  readonly weather: { set(id: string, instant?: boolean): void };
  readonly shake: (strength: number) => void;
  /** 描画の口（ミッションの出現物の描画へ） */
  readonly views: { setKaijuLook(look: VorgasLook): void };
}

export function linkVorgas(p: VorgasLinkParts): void {
  const chunk = lazyChunk(async (): Promise<void> => {
    const m = await import('./vorgas-runtime');
    m.startVorgas({
      play: p.play,
      search: p.search,
      audio: p.audio,
      camera: p.camera,
      frame: p.frame,
      pipeline: p.pipeline,
      weather: p.weather,
      shake: p.shake,
      game: p.game,
      state: () => p.game.state,
      ground: (x, z) => p.activeMap.ordnanceGround(x, z),
      soloRaid: () => p.play.runner?.def.id === 'raid' && !p.pvp.flying,
      onDetail: (fn) => {
        p.quality.onPreset((preset) => {
          fn(preset);
        });
      },
      onRender: p.onRender,
      setLook: (look) => {
        p.views.setKaijuLook(look);
      },
    });
  });
  let started = false;
  const load = (): void => {
    started = true;
    chunk().catch((e: unknown) => {
      started = false;
      console.error('vorgas look failed to load', e);
    });
  };
  p.game.onChange(({ to }) => {
    if (to === 'mode_select') load();
  });
  p.onRender(() => {
    if (!started && p.play.session.props.kaiju.visible) load();
  });
}
