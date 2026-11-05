// ソロのモードのうち、天候の配線の後に作るもの（main の app.ts が 300 行を超えたので分けた。9-5）: リングレース（7-1。ゴーストも）と
// 練習場（9-5）・日替わりチャレンジ（9-9）。どれも飛行の始めに天候を上書きする（レースはコースの天候、練習場は昼の快晴、
// 日替わりは条件の天候）
import type { ActiveMap } from '../missions/active-map';
import type { SimWorld } from '../replay/sim';
import type { StateSnapshot } from '../replay/state-walk';
import { GhostView } from '../render/ghost-view';
import { createPracticeLink, type PracticeLink, type PracticeLinkParts } from './practice-link';
import { createRaceLink, type RaceLink, type RaceLinkParts } from './race-link';
import { createDailyLink, type DailyLink } from './daily-link';
import type { Scene } from 'three';

export type SoloLinkParts = Omit<RaceLinkParts, 'ghost'> & PracticeLinkParts & { scene: Scene };

export function createSoloLinks(p: SoloLinkParts): {
  race: RaceLink;
  practice: PracticeLink;
  daily: DailyLink;
} {
  const ghost = new GhostView(p.scene);
  return {
    race: createRaceLink({ ...p, ghost }),
    practice: createPracticeLink(p),
    daily: createDailyLink(p),
  };
}

/** 記録と再生で同じ始め方をする世界（7-B。起動直後の写し pristine は配線の最後に撮る） */
export function createSimWorld(
  play: SimWorld['play'],
  activeMap: ActiveMap,
): SimWorld & { pristine: StateSnapshot | null } {
  return {
    play,
    useMap: (id) => {
      activeMap.use(id);
    },
    buildings: () => activeMap.buildings,
    pristine: null,
  };
}
