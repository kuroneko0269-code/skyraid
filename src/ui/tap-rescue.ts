// メニューのタップの取りこぼし対策（8-6。判定は src/core/tap.ts、数値は src/data/touch.ts の TAP_CONFIG）。
// 原因: ブラウザはタップの間に指が少し動くとクリックを取り消す（Chrome は約 15px、iOS はもっと小さい）。スクロールできる
// 画面の中では、少し動いただけでスクロールが始まってクリックが取り消される。押した瞬間に :active で光るので「光るだけで
// 選ばれない」に見えた（ゲーム用のタッチ処理はメニューでは隠れていて、タッチを取っていない）。
// 対策: メニューのボタン（button・role=button / tab / radio・summary）を 1 本指で押したときは、離したときに自分で判定し、
// タップならそのボタンの click() を呼ぶ。そのときは touchend の既定の動作を止めてブラウザのクリックを作らせない（二重に
// ならない。止められない touchend の後に来たクリックは、少しの間だけ捨てる）。タップでなければブラウザに任せる
import { isTap } from '../core/tap';
import { TAP_CONFIG } from '../data/touch';

const SELECTOR = 'button, [role="button"], [role="tab"], [role="radio"], summary';
/** 自分で click() した後、同じボタンへのブラウザのクリックを捨てる時間（ms） */
const SUPPRESS_MS = 700;

interface Press {
  readonly target: HTMLElement;
  readonly x: number;
  readonly y: number;
  readonly time: number;
  moved: number;
  /** スクロールできる祖先と、押したときのスクロールの位置 */
  readonly scrollers: readonly { el: Element; top: number; left: number }[];
}

function isDisabled(el: HTMLElement): boolean {
  if (el instanceof HTMLButtonElement && el.disabled) return true;
  return el.getAttribute('aria-disabled') === 'true' || el.closest('[inert]') !== null;
}

function scrollersOf(el: Element): { el: Element; top: number; left: number }[] {
  const out: { el: Element; top: number; left: number }[] = [];
  for (let n: Element | null = el.parentElement; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX))
      out.push({ el: n, top: n.scrollTop, left: n.scrollLeft });
  }
  return out;
}

export function installTapRescue(doc: Document): void {
  let press: Press | null = null;
  let fired: { target: HTMLElement; time: number } | null = null;

  doc.addEventListener(
    'touchstart',
    (e) => {
      press = null;
      const t = e.touches[0];
      if (e.touches.length !== 1 || !t || !(e.target instanceof Element)) return;
      const target = e.target.closest(SELECTOR);
      if (!(target instanceof HTMLElement) || isDisabled(target)) return;
      press = {
        target,
        x: t.clientX,
        y: t.clientY,
        time: e.timeStamp,
        moved: 0,
        scrollers: scrollersOf(target),
      };
    },
    { capture: true, passive: true },
  );
  doc.addEventListener(
    'touchmove',
    (e) => {
      const t = e.touches[0];
      if (!press || !t) return;
      if (e.touches.length !== 1) press = null;
      else
        press.moved = Math.max(press.moved, Math.hypot(t.clientX - press.x, t.clientY - press.y));
    },
    { capture: true, passive: true },
  );
  doc.addEventListener(
    'touchcancel',
    () => {
      press = null;
    },
    { capture: true, passive: true },
  );
  doc.addEventListener(
    'touchend',
    (e) => {
      const p = press;
      press = null;
      const t = e.changedTouches[0];
      if (!p || !t || e.touches.length > 0 || !p.target.isConnected || isDisabled(p.target)) return;
      const r = p.target.getBoundingClientRect();
      let scrolled = 0;
      for (const s of p.scrollers)
        scrolled = Math.max(
          scrolled,
          Math.abs(s.el.scrollTop - s.top),
          Math.abs(s.el.scrollLeft - s.left),
        );
      const tap = isTap(
        {
          moved: Math.max(p.moved, Math.hypot(t.clientX - p.x, t.clientY - p.y)),
          ms: e.timeStamp - p.time,
          end: { x: t.clientX, y: t.clientY },
          rect: r,
          scrolled,
        },
        TAP_CONFIG,
      );
      if (!tap) return;
      if (e.cancelable) e.preventDefault();
      fired = { target: p.target, time: performance.now() };
      p.target.click();
    },
    { capture: true, passive: false },
  );
  // 止められなかった touchend の後のブラウザのクリック（自分で click() したもの）は捨てる
  doc.addEventListener(
    'click',
    (e) => {
      const f = fired;
      if (!f || !e.isTrusted || performance.now() - f.time > SUPPRESS_MS) return;
      if (!(e.target instanceof Node) || !f.target.contains(e.target)) return;
      fired = null;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
}
