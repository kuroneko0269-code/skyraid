// 画面の切り替え直後の押し抜けを止める（9-9b。判定は src/core/tap.ts の isStaleClick、数値は TAP_CONFIG.switchGuardMs）。
// 原因: 8-6 のタップの自前判定（tap-rescue.ts）は touchend で click() を呼び、その場で画面が切り替わる。ブラウザが
// その後に作るクリック（iOS の互換のクリック・止められなかった touchend の後のクリック）は、切り替わった後の画面で
// 当たる要素へ届く。8-6 は「同じボタンへのクリック」だけを捨てていたので、次の画面のボタン（日替わりの「モード選択に
// 戻る」の下にあるレイド・ランキングなど）が押された。
// 対策: 新しい画面が出た時刻を覚え、それより前に押し始めたタップのクリックは、切り替えから少しの間は捨てる
// （どの画面の切り替えでも共通。setScreenShown が呼ぶ）。キーボードのクリックと、切り替えの後に押したタップは通す
import { isStaleClick, pressTimeOf } from '../core/tap';

let touchAt = -Infinity;
let mouseAt = -Infinity;
let switchAt = -Infinity;
let installed = false;

/** 新しい画面が出た（setScreenShown(…, true) で隠れていた画面が出た）。押し抜けの見張りの起点 */
export function noteScreenSwitch(): void {
  switchAt = performance.now();
}

/** 見張りを入れる（起動時に 1 回） */
export function installSwitchGuard(doc: Document): void {
  if (installed) return;
  installed = true;
  // タッチとマウスの押し始めを分けて覚える（iOS はタップの後に互換の mousedown を作るので、それを押し始めにすると
  // 切り替えの後に押したことになってしまう。pressTimeOf）
  doc.addEventListener(
    'touchstart',
    () => {
      touchAt = performance.now();
    },
    { capture: true, passive: true },
  );
  doc.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse') mouseAt = performance.now();
      else touchAt = performance.now();
    },
    { capture: true, passive: true },
  );
  doc.addEventListener(
    'click',
    (e) => {
      if (!e.isTrusted) return;
      const now = performance.now();
      const stale = isStaleClick({
        pressAt: pressTimeOf(touchAt, mouseAt, now),
        switchAt,
        now,
        fromPointer: e.detail > 0,
      });
      if (!stale) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
}
