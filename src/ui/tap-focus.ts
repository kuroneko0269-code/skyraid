// タッチ端末のホバー・フォーカスの貼り付き対策（7-C）。
// タッチでタップすると、ブラウザはその位置に :hover を残し、ボタンにフォーカスも残る（iOS はスクリプトの focus() でも
// :focus-visible の枠が出る）。そのためモード選択で「さっき触ったカード」と「フォーカスしたカード」が同時に光っていた。
// - ホバーの見た目は CSS の @media (hover: hover) の中だけ（theme.css）
// - 最後の操作の種類を <html data-input="touch|mouse|key"> に書き、touch の間は :focus-visible の枠を出さない
// - タッチのタップの後はフォーカスを外す（入力欄・選択欄は外さない）

export type InputKind = 'touch' | 'mouse' | 'key';

/** pointerdown の pointerType → 操作の種類（ペンはタッチと同じ扱い） */
export function inputKindOf(pointerType: string): InputKind {
  return pointerType === 'mouse' ? 'mouse' : 'touch';
}

/** タップの後にフォーカスを外す要素か（ボタン類だけ。文字の入力欄・選択欄・スライダーは外さない） */
export function shouldBlurAfterTap(tag: string, type: string | null): boolean {
  const t = tag.toUpperCase();
  if (t === 'BUTTON' || t === 'A' || t === 'SUMMARY') return true;
  if (t !== 'INPUT') return false;
  return type === 'button' || type === 'submit' || type === 'checkbox' || type === 'radio';
}

export function installTapFocus(doc: Document): void {
  const root = doc.documentElement;
  const set = (kind: InputKind): void => {
    if (root.dataset.input !== kind) root.dataset.input = kind;
  };
  doc.addEventListener(
    'pointerdown',
    (e) => {
      set(inputKindOf(e.pointerType));
    },
    true,
  );
  doc.addEventListener(
    'keydown',
    () => {
      set('key');
    },
    true,
  );
  // クリックの処理（ダイアログを開いて次のボタンに focus() するなど）が終わった後に外す
  doc.addEventListener('click', () => {
    if (root.dataset.input !== 'touch') return;
    const active = doc.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (shouldBlurAfterTap(active.tagName, active.getAttribute('type'))) active.blur();
  });
}
