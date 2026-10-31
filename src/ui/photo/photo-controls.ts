// フォトモード（7-A）の UI の部品: スライダー・ON/OFF・選択肢の組（4-10 のデザインシステムの .ui-toggle）。
// どの部品も data-silent（UI のタップ音を鳴らさない。音はシャッターだけ）の中に置く
export interface Slider {
  readonly root: HTMLLabelElement;
  readonly input: HTMLInputElement;
  set(value: number): void;
  setDisabled(disabled: boolean): void;
}

export interface SliderSpec {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  /** 表示する値の文字 */
  readonly format: (v: number) => string;
}

export function createSlider(
  parent: HTMLElement,
  spec: SliderSpec,
  onInput: (v: number) => void,
): Slider {
  const root = document.createElement('label');
  root.className = 'ui-toggle photo-slider';
  const name = document.createElement('span');
  name.className = 'photo-slider-name';
  name.textContent = spec.label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  const value = document.createElement('span');
  value.className = 'photo-slider-value';
  root.append(name, input, value);
  parent.appendChild(root);
  const set = (v: number): void => {
    input.value = String(v);
    value.textContent = spec.format(Number(input.value));
  };
  set(spec.value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    value.textContent = spec.format(v);
    onInput(v);
  });
  return {
    root,
    input,
    set,
    setDisabled: (d) => {
      input.disabled = d;
      root.classList.toggle('is-disabled', d);
    },
  };
}

export interface Toggle {
  readonly button: HTMLButtonElement;
  set(on: boolean): void;
  readonly on: boolean;
}

/** 押すたびに ON/OFF（aria-pressed） */
export function createToggle(
  parent: HTMLElement,
  label: string,
  initial: boolean,
  onChange: (on: boolean) => void,
): Toggle {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ui-toggle photo-chip';
  parent.appendChild(button);
  let on = initial;
  const set = (v: boolean): void => {
    on = v;
    button.setAttribute('aria-pressed', String(v));
    button.textContent = `${label} ${v ? 'ON' : 'OFF'}`;
  };
  set(initial);
  button.addEventListener('click', () => {
    set(!on);
    onChange(on);
  });
  return {
    button,
    set,
    get on() {
      return on;
    },
  };
}

/** 押すだけのボタン */
export function createChip(
  parent: HTMLElement,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ui-toggle photo-chip';
  button.textContent = label;
  button.addEventListener('click', onClick);
  parent.appendChild(button);
  return button;
}

export interface Choice<T extends string> {
  select(value: T | null): void;
  readonly buttons: ReadonlyMap<T, HTMLButtonElement>;
}

/** 1 つだけ選べる組（選んだものを aria-pressed） */
export function createChoice<T extends string>(
  parent: HTMLElement,
  items: readonly { readonly value: T; readonly label: string }[],
  initial: T | null,
  onSelect: (value: T) => void,
): Choice<T> {
  const buttons = new Map<T, HTMLButtonElement>();
  const select = (value: T | null): void => {
    for (const [v, b] of buttons) b.setAttribute('aria-pressed', String(v === value));
  };
  for (const item of items) {
    const b = createChip(parent, item.label, () => {
      select(item.value);
      onSelect(item.value);
    });
    buttons.set(item.value, b);
  }
  select(initial);
  return { select, buttons };
}

/** 部品を並べる行（横に流れる）。title は小さな見出し */
export function createRow(parent: HTMLElement, title?: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'photo-row';
  if (title) {
    const h = document.createElement('span');
    h.className = 'photo-row-title';
    h.textContent = title;
    row.appendChild(h);
  }
  parent.appendChild(row);
  return row;
}

/** 小さな注記（「画質「高」のみ」など） */
export function createNote(parent: HTMLElement, text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'photo-note';
  p.textContent = text;
  parent.appendChild(p);
  return p;
}
