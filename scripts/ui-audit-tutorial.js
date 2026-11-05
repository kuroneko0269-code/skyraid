/* global document, localStorage */
// UI の点検（9-5c）: チュートリアルの章の一覧 → 補助の章の頁、今の利用者への「新しくなりました」、飛行中の指示と図（第 3 章）、
// 章の結果（見本）。scripts/ui-audit-screens.js から 3 サイズのそれぞれで呼ぶ

/** チュートリアルの章の結果（9-5c。「第 3 章 完了」・次の章へ）を見本で出す */
async function openTutorialResultSample(page) {
  await page.evaluate(async () => {
    const { ResultScreen } = await import('/src/ui/result.ts');
    const { t } = await import('/src/core/i18n.ts');
    const screen = new ResultScreen(document.body, {
      onRetry: () => undefined,
      onList: () => undefined,
      onPractice: () => undefined,
      onNext: () => undefined,
    });
    const def = {
      id: 'aim',
      type: 'task',
      task: 'aim',
      count: 1,
      required: true,
      start: 'withPrevious',
    };
    const kill = {
      id: 'targets',
      type: 'kill',
      target: 'target',
      count: 2,
      required: true,
      start: 'afterPrevious',
    };
    screen.show(
      {
        missionId: 'tutorial-gun',
        outcome: 'success',
        failReason: null,
        elapsedSeconds: 74,
        damageTaken: 0,
        maxHp: 200,
        objectives: [
          { id: 'aim', def, status: 'complete', current: 1, target: 1 },
          { id: 'targets', def: kill, status: 'complete', current: 2, target: 2 },
        ],
        rank: null,
        credits: 0,
      },
      {
        balance: 1200,
        pilotName: 'ACE',
        newGear: false,
        tutorial: {
          title: t('tutorial.result.title', { n: '3' }),
          back: t('tutorial.result.list'),
          next: true,
        },
        practiceHint: 'tutorial',
      },
    );
    screen.setShown(true);
  });
}

/** チュートリアルの画面を撮る（shot・toModeSelect・dialog は ui-audit-screens.js のもの） */
export async function auditTutorialScreens(page, shot, toModeSelect, dialog) {
  await toModeSelect();
  await page.click('.mode-card[data-mode="tutorial"]');
  await page.locator('.tutorial-chapter[data-chapter="assist"]').click();
  await shot('dialog-tutorial-assist', '.tutorial-page');
  // 9-5d: 今の利用者への一度だけの「補助の組を選んでください」（タッチの端末だけ・「今の設定のまま」付き）
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('skyraid.save'));
    s.flags.assistPreset = false;
    localStorage.setItem('skyraid.save', JSON.stringify(s));
  });
  await toModeSelect();
  if (await page.locator('.assist-preset-prompt:not([hidden])').count()) {
    await shot('dialog-assist-preset', '.assist-preset-prompt');
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('skyraid.save'));
    s.flags.tutorialNotice = false;
    localStorage.setItem('skyraid.save', JSON.stringify(s));
  });
  await toModeSelect();
  await shot('dialog-tutorial-notice', dialog);
  await page.locator(`${dialog} .campaign-go`).click();
  await page.locator('.tutorial-chapter[data-chapter="gun"]').click();
  await page.locator(':root[data-screen="flight"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  await shot('tutorial-flight', '.tutorial-hud');
  await toModeSelect();
  await openTutorialResultSample(page);
  await shot('result-tutorial', '.result-screen.is-shown');
}
