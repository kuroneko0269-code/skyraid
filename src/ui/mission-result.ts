// ミッション（キャンペーン・チュートリアル・ソロのレイド）のリザルトを出す（screens.ts が 300 行を超えたので分けた。9-5）。
// クリアの記録と報酬はミッションの終わりのイベントでセーブに入っている（progression/mission-rewards.ts）ので、ここは残高を読むだけ
import type { MissionResult } from '../missions/runner';
import { missionCardSource } from './card/card-entry';
import { practiceHintFor } from './practice-text';
import { nextTutorialChapter, TUTORIAL_CHAPTERS, tutorialChapterOf } from '../data/tutorial';
import type { Screens } from './screens';

export function showMissionResult(screens: Screens, result: MissionResult, tutorialPaid = 0): void {
  const save = screens.save;
  const balance = save.credits;
  // チュートリアル（4-11）: 報酬は初回だけ（払った額を出す）。ランクは出さない
  const tutorial = screens.inTutorial;
  const r = tutorial ? { ...result, credits: tutorialPaid, rank: null } : result;
  // 報酬で新しく機体・強化が買える残高になったら 1 行出す（3-3）
  const newGear = screens.hangar.newlyAffordable(balance - r.credits, balance);
  const t = screens.tutorialText;
  // 9-5c: 章の結果（「第 N 章 完了」・次の章・章の一覧へ）
  const chapter = tutorialChapterOf(result.missionId);
  const title = chapter
    ? t.result.title.replace('{n}', String(TUTORIAL_CHAPTERS.indexOf(chapter) + 1))
    : t.complete;
  screens.result.show(r, {
    balance,
    pilotName: save.pilotName,
    newGear,
    tutorial: tutorial
      ? {
          title,
          back: t.result.list,
          next: chapter !== null && nextTutorialChapter(chapter) !== null,
        }
      : undefined,
    // 9-5: チュートリアル（9-5c: 狙いの章）の完了・M1 / M2 の失敗に練習場への案内
    practiceHint: practiceHintFor(tutorial, result),
  });
  // 8-5: 記録カード（キャンペーン・ソロのレイド。チュートリアルは作らない）
  const raidDef = screens.inRaid ? screens.nextMission?.reward.raid : undefined;
  const raid = screens.inRaid ? (raidDef?.difficulty ?? 'normal') : null;
  screens.result.card.set(
    tutorial ? null : missionCardSource(result, raid, screens.hangar, save, raidDef?.kaiju),
  );
}
