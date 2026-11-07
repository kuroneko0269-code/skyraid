// 10-4a: メカ怪獣ゴウライの入口（作っている間）。?dev=gourai のときだけ、判定・形・値の表示の遅延チャンク（gourai-runtime.ts）を
// 起動時に読む。付けないときは何も読まず、何も変えない（遊ぶ人には見えない）。10-4b でレイドの登録と読み方をここに足す
import type { Scene } from 'three';
import { parseDevFlags } from '../core/debug-flags';
import type { GameState } from '../core/game-state';
import type { ActiveMap } from '../missions/active-map';
import type { GamePlay } from '../missions/game-play';
import type { QualityLink } from '../render/quality-link';

export interface GouraiLinkParts {
  readonly search: string;
  readonly play: GamePlay;
  readonly scene: Scene;
  readonly activeMap: ActiveMap;
  readonly game: GameState;
  readonly quality: QualityLink;
  readonly pvp: { readonly flying: boolean };
  readonly onRender: (fn: (alpha: number) => void) => void;
}

/** 起動時: ?dev=gourai なら遅延チャンクを読んでつなぐ */
export function linkGouraiDev(p: GouraiLinkParts): void {
  if (!parseDevFlags(p.search).has('gourai')) return;
  void import('./gourai-runtime')
    .then((m) => {
      const { play, activeMap, game } = p;
      m.startGourai({
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
      console.error('gourai failed to load', e);
    });
}
