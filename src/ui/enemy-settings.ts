// ポーズメニューの設定「敵 ON/OFF」「難易度」（2-3）。部品の見た目はほかの設定（.settings-item）と同じ。
// 変えたらすぐ保存して、敵を出し直す
import { isDifficulty, loadEnemySettings, saveEnemySettings } from '../core/enemy-settings';
import type { StorageLike } from '../core/settings';
import { DIFFICULTIES, DIFFICULTY_LABELS, type Difficulty } from '../data/ai';
import { createToggleButton } from './mobile';

/** 敵の設定を読み、変更を受け付ける部品を panel に置く。apply は起動時と変更のたびに呼ぶ */
export function createEnemySettings(
  panel: HTMLElement,
  storage: StorageLike | null,
  apply: (enabled: boolean, difficulty: Difficulty) => void,
): void {
  const settings = loadEnemySettings(storage);
  const changed = (): void => {
    saveEnemySettings(storage, settings);
    apply(settings.enabled, settings.difficulty);
  };
  apply(settings.enabled, settings.difficulty);
  createToggleButton(panel, '敵', settings.enabled, () => {
    settings.enabled = !settings.enabled;
    changed();
    return settings.enabled;
  });
  createDifficultySelect(panel, settings.difficulty, (difficulty) => {
    settings.difficulty = difficulty;
    changed();
  });
}

export function createDifficultySelect(
  parent: HTMLElement,
  initial: Difficulty,
  onSelect: (difficulty: Difficulty) => void,
): HTMLSelectElement {
  const label = document.createElement('label');
  label.className = 'ui-toggle settings-item';
  label.textContent = '難易度 ';
  const select = document.createElement('select');
  for (const d of DIFFICULTIES) {
    const option = document.createElement('option');
    option.value = d;
    option.textContent = DIFFICULTY_LABELS[d];
    select.appendChild(option);
  }
  select.value = initial;
  select.addEventListener('change', () => {
    if (isDifficulty(select.value)) onSelect(select.value);
    select.blur();
  });
  label.appendChild(select);
  parent.appendChild(label);
  return select;
}
