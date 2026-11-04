// チュートリアルの入口（9-5c。screens.ts が 300 行を超えているので分けた）: 章の一覧のダイアログ・章を始める・結果の「次の章へ」・
// 今の利用者への一度だけの「チュートリアルが新しくなりました」
import type { GameState } from '../core/game-state';
import {
  TUTORIAL_CHAPTER_DEFS,
  TUTORIAL_CHAPTERS,
  nextTutorialChapter,
  tutorialChapterOf,
  type TutorialChapter,
} from '../data/tutorial';
import type { MissionDef } from '../missions/types';
import type { SaveStore } from '../progression/save-store';
import type { SettingsNav } from './settings-nav';
import { completeTutorialChapter, tutorialChaptersDone } from '../progression/tutorial-reward';
import type { ModeSelectScreen } from './mode-select';
import { TutorialList } from './tutorial-list';

/** 使う Screens の部品（nextMission は次に飛ぶミッション） */
export interface TutorialEntryParts {
  nextMission: MissionDef | null;
  readonly save: SaveStore;
  readonly modeSelect: ModeSelectScreen;
  readonly settingsNav: SettingsNav;
}

export class TutorialEntry {
  private readonly list: TutorialList;

  constructor(
    private readonly game: GameState,
    private readonly p: TutorialEntryParts,
  ) {
    const ms = p.modeSelect;
    this.list = new TutorialList(ms.root, () => tutorialChaptersDone(p.save), {
      onStart: (c) => {
        this.start(c);
      },
      onSettings: () => {
        p.settingsNav.open();
      },
      onPractice: () => {
        game.transition('practice_select');
      },
      onRead: () => {
        completeTutorialChapter(p.save, 'assist');
      },
      onClose: () => {
        ms.reveal();
      },
    });
    ms.addOverlay(() => this.list.close());
    ms.onTutorialStart = () => {
      this.start();
    };
    ms.onTutorialList = () => {
      this.list.show();
    };
    // 初回起動の人（名前がまだ）は「チュートリアルを始めますか？」を出すので「新しくなりました」は出さない
    if (p.save.needsPilotName) p.save.setFlag('tutorialNotice');
    // 今の利用者（名前を登録済み）に一度だけ。初回起動の人は名前の入力で印を付ける（markNewPilot）
    game.onChange(({ from, to }) => {
      if (to !== 'mode_select') return;
      // 章の中断・結果の「章の一覧へ」: 章の一覧を重ねる（別の章を選び直せる）
      if ((from === 'flight' || from === 'pause' || from === 'result') && this.chapter) {
        this.list.show();
        return;
      }
      if (p.save.needsPilotName || p.save.flag('tutorialNotice')) return;
      p.save.setFlag('tutorialNotice');
      this.list.showNotice();
    });
  }

  /** 章を始める（飛ばない章は一覧の頁を出す） */
  start(c: TutorialChapter = TUTORIAL_CHAPTERS[0]): void {
    const def = TUTORIAL_CHAPTER_DEFS[c].mission;
    if (!def) {
      this.game.transition('mode_select');
      this.list.show(true);
      return;
    }
    this.p.nextMission = def;
    this.game.transition('flight');
  }

  /** 今の（終えたばかりの）章 */
  get chapter(): TutorialChapter | null {
    return tutorialChapterOf(this.p.nextMission?.id);
  }

  /** 結果の「次の章へ」 */
  next(): void {
    const c = this.chapter;
    const n = c ? nextTutorialChapter(c) : null;
    if (n) this.start(n);
    else this.game.transition('mode_select');
  }
}
