// 9-6a: ?dev=<名前> の開発中の機能（遊ぶ人には見えない。CLAUDE.md「更新履歴」）の入口。付いている名前の遅延チャンクだけを読む。
// 今は kaiju2（空の怪獣の確かめる場。src/ui/kaiju2-dev.ts）
import type { Scene } from 'three';
import { parseDevFlags } from '../core/debug-flags';
import type { GameState } from '../core/game-state';
import type { ActiveMap } from '../missions/active-map';
import type { GamePlay } from '../missions/game-play';
import type { QualityLink } from '../render/quality-link';

export interface DevLinkParts {
  readonly search: string;
  readonly play: GamePlay;
  readonly scene: Scene;
  readonly activeMap: ActiveMap;
  readonly game: GameState;
  readonly quality: QualityLink;
  readonly pvp: { readonly flying: boolean };
  readonly onRender: (fn: (alpha: number) => void) => void;
}

export function linkDevFeatures(p: DevLinkParts): void {
  const flags = parseDevFlags(p.search);
  if (!flags.has('kaiju2')) return;
  const { play, activeMap, game } = p;
  void import('./kaiju2-dev').then(
    (m) =>
      m.startKaiju2Dev({
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
            fn(preset.aircraftDetail);
          });
        },
        onRender: p.onRender,
      }),
    (e: unknown) => {
      console.error('dev=kaiju2 failed to load', e);
    },
  );
}
