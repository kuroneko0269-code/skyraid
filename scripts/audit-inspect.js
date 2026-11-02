/* global document, getComputedStyle, innerWidth, Node, SVGElement */
// UI の点検の、ページの中で動かす部分（7-D の scripts/ui-audit.js から分けた。8-6d で全体の横スクロールとフォントを足した）。
// page.evaluate(inspect, rootSelector) で呼ぶ（関数をそのまま送るので、外の変数は使わない）。
//
// root の中のボタン（.ui-button・button.ui-toggle・.ui-seg-item）: wrap / clip / ellipsis / small / overlap / offscreen
// root（無ければ文書）の横スクロール: hscroll（documentElement か root が画面の幅を超える）
// 8-6d: 画面に出ているすべての要素（root の外のダイアログ・お知らせも）:
//   hscrollEl 横にスクロールできる要素（overflow-x が auto / scroll で scrollWidth > clientWidth。overflow-y だけ auto にしても
//             x は auto になる）。意図して横にスクロールさせる一覧（HSCROLL_ALLOWED）は数えず allowed に入れる
//   hclip     縦にスクロールする入れ物（overflow-x: hidden）で、中身が横にはみ出して切れている
//   serif     文字を持つ要素の計算後のフォントがブラウザ既定（serif。アプリのフォントを受け継いでいない）
export function inspect(rootSelector) {
  // 意図して横にスクロールさせる一覧（足すときはここと docs/release-checklist.md に理由を書く）
  // - .hangar-entries: ハンガーの機体の一覧。幅 640px 以下は 1 列の配置で、機体のカードを横に並べてスクロールする（7-C）
  // - .raid-result-wrap・.ranking-scroll: 結果・ランキングの表（列を折り返さず、狭い画面では表だけ横にスクロールする）
  // - .photo-bar・.photo-row: フォトモードの操作の帯（狭い画面ではボタンの列を横にスクロールする）
  const HSCROLL_ALLOWED = [
    '.hangar-entries',
    '.raid-result-wrap',
    '.ranking-scroll',
    '.photo-bar',
    '.photo-row',
  ];
  const inAllowed = (e) => HSCROLL_ALLOWED.some((sel) => e.closest(sel) !== null);
  const root = document.querySelector(rootSelector);
  const issues = [];
  const allowed = [];
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return (
      r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && e.closest('[hidden]') === null
    );
  };
  const label = (e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24);
  const path = (e) => {
    const parts = [];
    for (let n = e; n && n !== document.body && parts.length < 3; n = n.parentElement) {
      const cls = [...n.classList].slice(0, 2).join('.');
      parts.unshift(cls ? `${n.tagName.toLowerCase()}.${cls}` : n.tagName.toLowerCase());
    }
    return parts.join(' > ');
  };
  let count = 0;
  if (root) {
    const buttons = [...root.querySelectorAll('.ui-button, button.ui-toggle, .ui-seg-item')].filter(
      vis,
    );
    count = buttons.length;
    const rects = buttons.map((b) => b.getBoundingClientRect());
    // 重なりは見えている部分で見る（8-6d: スクロールして固定の見出しの下に隠れたボタンを数えない）
    const visibleRect = (e) => {
      const r = e.getBoundingClientRect();
      let { left, top, right, bottom } = r;
      for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) {
        const st = getComputedStyle(n);
        if (st.overflowX === 'visible' && st.overflowY === 'visible') continue;
        const c = n.getBoundingClientRect();
        left = Math.max(left, c.left);
        top = Math.max(top, c.top);
        right = Math.min(right, c.right);
        bottom = Math.min(bottom, c.bottom);
      }
      return { left, top, right, bottom };
    };
    const shown = buttons.map(visibleRect);
    buttons.forEach((b, i) => {
      const r = rects[i];
      const card = b.classList.contains('ui-item');
      if (!card) {
        const range = document.createRange();
        range.selectNodeContents(b);
        const tops = new Set(
          [...range.getClientRects()].filter((x) => x.width > 1).map((x) => Math.round(x.top)),
        );
        if (tops.size > 1) issues.push({ kind: 'wrap', target: label(b) });
        if (b.scrollWidth > b.clientWidth + 1) issues.push({ kind: 'clip', target: label(b) });
      } else {
        for (const c of b.children)
          if (c.tagName !== 'svg' && vis(c) && c.scrollWidth > c.clientWidth + 1)
            issues.push({
              kind: 'ellipsis',
              target: `${label(b).slice(0, 10)} / ${c.textContent.slice(0, 16)}`,
            });
      }
      if (r.height < 36)
        issues.push({ kind: 'small', target: `${label(b)} (${Math.round(r.height)}px)` });
      if ((r.left < -1 || r.right > innerWidth + 1) && !inAllowed(b))
        issues.push({ kind: 'offscreen', target: label(b) });
      for (let j = i + 1; j < buttons.length; j++) {
        const v = shown[i];
        const o = shown[j];
        const ix = Math.min(v.right, o.right) - Math.max(v.left, o.left);
        const iy = Math.min(v.bottom, o.bottom) - Math.max(v.top, o.top);
        if (ix > 2 && iy > 2 && !b.contains(buttons[j]) && !buttons[j].contains(b))
          issues.push({ kind: 'overlap', target: `${label(b)} × ${label(buttons[j])}` });
      }
    });
  } else if (rootSelector) issues.push({ kind: 'missing', target: rootSelector });
  if (
    document.documentElement.scrollWidth > innerWidth + 1 ||
    (root && root.scrollWidth > root.clientWidth + 1)
  )
    issues.push({ kind: 'hscroll', target: rootSelector });

  // 8-6d: 文書全体（root の外のダイアログ・お知らせも）
  const seenSerif = new Set();
  for (const e of document.body.querySelectorAll('*')) {
    if (e instanceof SVGElement || e.tagName === 'CANVAS' || !vis(e)) continue;
    const s = getComputedStyle(e);
    if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 1) {
      const item = {
        kind: 'hscrollEl',
        target: `${path(e)} (${e.scrollWidth} > ${e.clientWidth})`,
      };
      if (inAllowed(e)) allowed.push(item);
      else issues.push(item);
    }
    // 8-6d: 縦にスクロールする入れ物（overflow-x: hidden）で、中身が横にはみ出して切れている
    if (
      s.overflowX === 'hidden' &&
      (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
      e.scrollWidth > e.clientWidth + 1 &&
      !inAllowed(e)
    )
      issues.push({ kind: 'hclip', target: `${path(e)} (${e.scrollWidth} > ${e.clientWidth})` });
    const hasText = [...e.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== '',
    );
    // ブラウザ既定の serif（Chromium は Times New Roman、Safari は Times、Firefox は serif）。フォームの部品の既定
    // （Arial・system-ui）は serif ではないので数えない
    if (hasText && /times|georgia|mincho|明朝|(^|,)\s*serif\s*$/i.test(s.fontFamily)) {
      const key = path(e);
      if (!seenSerif.has(key)) {
        seenSerif.add(key);
        issues.push({ kind: 'serif', target: `${key}: ${s.fontFamily}` });
      }
    }
  }
  return {
    issues,
    allowed,
    vscroll: root ? root.scrollHeight > root.clientHeight + 1 : false,
    buttons: count,
  };
}
