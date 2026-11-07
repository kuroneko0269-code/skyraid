// 10-3a: 白鯨アルビオンの入口（作っている間）。?dev=albion のときだけ、判定・形・値の表示の遅延チャンク（albion-runtime.ts）を
// 起動時に読む。付けないときは何も読まず、何も変えない（遊ぶ人には見えない）。10-3b でレイドの登録と読み方をここに足す
import type { Scene } from 'three';
import { parseDevFlags } from '../core/debug-flags';
import type { GameState } from '../core/game-state';
import type { ActiveMap } from '../missions/active-map';
import type { GamePlay } from '../missions/game-play';
import type { QualityLink } from '../render/quality-link';

export interface AlbionLinkParts {
  readonly search: string;
  readonly play: GamePlay;
  readonly scene: Scene;
  readonly activeMap: ActiveMap;
  readonly game: GameState;
  readonly quality: QualityLink;
  readonly pvp: { readonly flying: boolean };
  readonly onRender: (fn: (alpha: number) => void) => void;
}

/** 起動時: ?dev=albion なら遅延チャンクを読んでつなぐ */
export function linkAlbionDev(p: AlbionLinkParts): void {
  if (!parseDevFlags(p.search).has('albion')) return;
  void import('./albion-runtime')
    .then((m) => {
      const { play, activeMap, game } = p;
      m.startAlbion({
        play,
        scene: p.scene,
        search: p.search,
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
            fn(preset.aircraftDetail);
          });
        },
        onRender: p.onRender,
      });
    })
    .catch((e: unknown) => {
      console.error('albion failed to load', e);
    });
}
