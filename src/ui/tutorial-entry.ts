// チュートリアルの入口（9-5c。screens.ts が 300 行を超えているので分けた）: 章の一覧のダイアログ・章を始める・結果の「次の章へ」・
// 今の利用者への一度だけの「チュートリアルが新しくなりました」。9-5d: 一度だけの「補助の組を選んでください」（タッチの端末だけ。
// 初めての人は名前の後・チュートリアルの案内の前 = 最初の飛行の前、今の利用者はモード選択で「今の設定のまま」も付けて）
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
import { AssistPresetPrompt } from './assist-preset';
import { applyAssistPreset } from '../core/assist-preset';
import { isTouchDevice } from '../core/settings';
import type { AssistPreset } from '../data/assist';

/** 使う Screens の部品（nextMission は次に飛ぶミッション） */
export interface TutorialEntryParts {
  nextMission: MissionDef | null;
  readonly save: SaveStore;
  readonly modeSelect: ModeSelectScreen;
  readonly settingsNav: SettingsNav;
}

export class TutorialEntry {
  private readonly list: TutorialList;
  private readonly presetPrompt: AssistPresetPrompt;
  /** 起動したときに名前がまだだった（この起動の間は今の利用者向けの「補助の組」を出さない） */
  private readonly newPilot: boolean;
  /** 9-5d: 補助の組を選んだ後（設定画面・練習場の欄の表示を合わせ直す。app.ts が入れる） */
  onPresetPick: () => void = () => undefined;

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
      controls: () => p.save.settings.controls,
      onPreset: (preset) => {
        this.pickPreset(preset);
      },
    });
    ms.addOverlay(() => this.list.close());
    this.presetPrompt = new AssistPresetPrompt(
      ms.root,
      () => p.save.settings.controls,
      (preset) => {
        this.pickPreset(preset);
      },
    );
    ms.addOverlay(() => this.presetPrompt.close());
    this.newPilot = p.save.needsPilotName;
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
      if (p.save.needsPilotName) return;
      if (!p.save.flag('tutorialNotice')) {
        p.save.setFlag('tutorialNotice');
        this.list.showNotice();
        return;
      }
      // 9-5d: 今の利用者に一度だけ（「今の設定のまま」も）。初めての人は名前の後（offerPreset）
      if (!this.newPilot && this.presetDue()) {
        p.save.setFlag('assistPreset');
        this.presetPrompt.show(true, () => {
          ms.reveal();
        });
      }
    });
  }

  /** まだ補助の組を選んでいないタッチの端末 */
  private presetDue(): boolean {
    return !this.p.save.flag('assistPreset') && isTouchDevice();
  }

  /** 初めての人（名前を決めた直後）: 9-5d の補助の組 → 「チュートリアルを始めますか？」 */
  offerFirstRun(): void {
    this.offerPreset(() => {
      this.p.modeSelect.showTutorialPrompt();
    });
  }

  /** 9-5d: 出すときは選んだ後に next、出さないならすぐ next */
  private offerPreset(next: () => void): void {
    if (!this.presetDue()) {
      next();
      return;
    }
    this.p.save.setFlag('assistPreset');
    this.presetPrompt.show(false, next);
  }

  private pickPreset(preset: AssistPreset): void {
    this.p.save.updateControls((c) => {
      applyAssistPreset(c, preset);
    });
    this.onPresetPick();
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
