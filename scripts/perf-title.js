/* global performance, document, window, MutationObserver, URL */
// 10-1: 起動の計測（scripts/perf.js）のタイトルまわり: タイトルが出た時刻・タイトルまでに読み始めたもの・裏で読む本体の組み立て
/**
 * 10-1: タイトル（.title-screen.is-shown）が出た時刻を window.__titleShownAt に記録する（どの版でも同じ測り方）。
 * 9-x までは表示を確かめた後の performance.now() だったが、10-1 からはタイトルの後に本体を組み立てて主スレッドがふさがり、
 * その待ちまで数えてしまうため
 */
export const initTitleWatch = () => {
  new MutationObserver((_list, observer) => {
    if (document.querySelector('.title-screen.is-shown')) {
      window.__titleShownAt = performance.now();
      observer.disconnect();
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
};

/** タイトルの印（src/ui/title.ts の performance.mark）より前に読み始めたファイルと、本体を組み立て終えるまでの時間 */
export async function titleDetail(page, loaded) {
  // 10-1: タイトルの表示の印（src/ui/title.ts）より前に読み始めたものだけを数える（タイトルの直後に裏で先読みする本体は除く）。
  // 印の無い版（1.1.0 まで）は今までどおりタイトルが見えるまでに読んだもの全部
  const before = await page.evaluate(() => {
    const mark = performance.getEntriesByName('skyraid:title')[0];
    if (!mark) return null;
    return performance
      .getEntriesByType('resource')
      .filter((e) => e.startTime <= mark.startTime)
      .map((e) => new URL(e.name).pathname.slice(1));
  });
  const titled = before ? loaded.filter((f) => before.includes(f)) : loaded;
  // 10-1: タイトルの後に裏で読む本体を組み立て終えるまで（タイトルの表示から。印の無い版は 0）
  const gameMs = await page
    .waitForFunction(
      () => {
        const t = performance.getEntriesByName('skyraid:title')[0];
        const g = performance.getEntriesByName('skyraid:game')[0];
        // 0 は偽なので、値は配列に包んで返す
        if (!t) return [0];
        return g ? [g.startTime - t.startTime] : false;
      },
      null,
      { timeout: 30000 },
    )
    .then(async (h) => (await h.jsonValue())[0]);
  return { titled, gameMs };
}
