// ハンガーの「塗装」タブ（7-3）の部品: 色の見本の行・デカールのアイコン（多角形から作る SVG）・スライダー。
// 本体は src/ui/paint-panel.ts
import { SKIN_PALETTE, type DecalId } from '../data/skins';
import { decalShape, shapePath } from '../render/skin/decal-shapes';
import { el } from './hud-dom';
import { createButton } from './screen';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** デカールのアイコン（SVG。innerHTML は使わず要素を組み立てる） */
export function decalIcon(parent: HTMLElement, id: DecalId | null, number: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'paint-decal-icon');
  svg.setAttribute('aria-hidden', 'true');
  parent.appendChild(svg);
  setDecalIcon(svg, id, number);
  return svg;
}

export function setDecalIcon(svg: SVGSVGElement, id: DecalId | null, number: number): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (id === null) {
    svg.setAttribute('viewBox', '-0.5 -0.5 1 1');
    const line = document.createElementNS(SVG_NS, 'path');
    line.setAttribute('d', 'M-0.3 0.3L0.3 -0.3');
    line.setAttribute('class', 'paint-decal-none');
    svg.appendChild(line);
    return;
  }
  const shape = decalShape(id, number);
  const a = shape.aspect;
  svg.setAttribute('viewBox', `${(-a / 2).toFixed(3)} -0.5 ${a.toFixed(3)} 1`);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', shapePath(shape));
  path.setAttribute('fill-rule', 'evenodd');
  svg.appendChild(path);
}

function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/** パレット 12 色の見本の行。押すと onPick（パレットの番号） */
export class SwatchRow {
  private readonly buttons: HTMLButtonElement[] = [];

  constructor(parent: HTMLElement, label: string, onPick: (index: number) => void) {
    const row = el('div', 'paint-row', parent);
    el('span', 'paint-row-label', row, label);
    const list = el('div', 'paint-swatches', row);
    list.setAttribute('role', 'radiogroup');
    list.setAttribute('aria-label', label);
    SKIN_PALETTE.forEach((c, i) => {
      const b = createButton(list, 'paint-swatch', '', () => {
        onPick(i);
      });
      b.style.backgroundColor = cssColor(c.hex);
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.setAttribute('role', 'radio');
      this.buttons.push(b);
    });
  }

  update(selected: number): void {
    this.buttons.forEach((b, i) => {
      b.setAttribute('aria-checked', String(i === selected));
    });
  }
}

/** 0〜255 のスライダー（input で試し塗り、change（離したとき）で保存）。text は値の表示 */
export class PaintSlider {
  private readonly input: HTMLInputElement;
  private readonly value: HTMLSpanElement;

  constructor(
    parent: HTMLElement,
    label: string,
    private readonly text: (v: number) => string,
    onInput: (v: number) => void,
    onCommit: () => void,
  ) {
    const row = el('label', 'paint-slider', parent);
    el('span', 'paint-row-label', row, label);
    const input = el('input', 'paint-range', row);
    input.type = 'range';
    input.min = '0';
    input.max = '255';
    input.step = '1';
    this.value = el('span', 'paint-slider-value', row);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      this.value.textContent = this.text(v);
      onInput(v);
    });
    input.addEventListener('change', onCommit);
    this.input = input;
  }

  set(v: number): void {
    this.input.value = String(v);
    this.value.textContent = this.text(v);
  }

  set disabled(d: boolean) {
    this.input.disabled = d;
  }
}
