import './volume-settings.css';
import type { Volumes } from '../audio/engine';
import type { SaveStore } from '../progression/save-store';

const LABELS: Readonly<Record<keyof Volumes, string>> = {
  master: 'マスター',
  sfx: '効果音',
  bgm: 'BGM',
};

/**
 * 音量（4-4）: ポーズメニューの設定に「マスター / 効果音 / BGM」の 3 本のスライダー（0〜100）。
 * 動かしている間は音に反映し、離したらセーブの設定に保存する。設定の最下部（セーブデータ）より上に置く
 */
export function createVolumeSettings(
  panel: HTMLElement,
  save: SaveStore,
  apply: (v: Readonly<Volumes>) => void,
): void {
  const current: Volumes = { ...save.settings.volume };
  apply(current);
  const box = document.createElement('div');
  box.className = 'volume-settings';
  for (const key of Object.keys(LABELS) as (keyof Volumes)[]) {
    const label = document.createElement('label');
    label.className = 'ui-toggle settings-item volume-item';
    const name = document.createElement('span');
    name.className = 'volume-name';
    name.textContent = LABELS[key];
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.value = String(Math.round(current[key] * 100));
    input.setAttribute('aria-label', `${LABELS[key]}の音量`);
    const value = document.createElement('span');
    value.className = 'volume-value';
    value.textContent = input.value;
    input.addEventListener('input', () => {
      current[key] = Number(input.value) / 100;
      value.textContent = input.value;
      apply(current);
    });
    input.addEventListener('change', () => {
      save.setSetting('volume', { ...current });
      // フォーカスが残ると矢印キー（ピッチ/ロール）で値が変わってしまうため外す
      input.blur();
    });
    label.append(name, input, value);
    box.appendChild(label);
  }
  panel.insertBefore(box, panel.querySelector(':scope > .save-settings'));
}
