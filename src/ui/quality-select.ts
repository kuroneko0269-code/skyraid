import './quality-select.css';
import { QUALITY_LABELS, QUALITY_LEVELS, type QualityLevel } from '../data/quality';
import { isQualityLevel } from '../core/settings';

/** 品質セレクト（ポーズメニューの設定に置く）。選択が変わると onSelect を呼ぶ */
export function createQualitySelect(
  parent: HTMLElement,
  initial: QualityLevel,
  onSelect: (level: QualityLevel) => void,
): HTMLSelectElement {
  const label = document.createElement('label');
  label.className = 'ui-toggle settings-item quality-select';
  label.textContent = '画質 ';

  const select = document.createElement('select');
  for (const level of QUALITY_LEVELS) {
    const option = document.createElement('option');
    option.value = level;
    option.textContent = QUALITY_LABELS[level];
    select.appendChild(option);
  }
  select.value = initial;
  select.addEventListener('change', () => {
    if (isQualityLevel(select.value)) onSelect(select.value);
    // フォーカスが残ると矢印キー（ピッチ/ロール）で選択が変わってしまうため外す
    select.blur();
  });

  label.appendChild(select);
  parent.appendChild(label);
  return select;
}
