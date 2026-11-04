// チュートリアル（9-5c）の段階の図: 左に「その方式で何を動かすか」（スティック・端末の傾き・指・キー・パッド）、右に「何が起きるか」
// （機首の印と照準の○・画面の端の矢印など）を、コードで描いた小さな SVG（120 × 64）で出す。色は currentColor と HUD の色
import type { Action } from '../data/keybinds';
import type { TutorialFigure } from '../data/tutorial';
import type { TutorialVariant } from './tutorial-text';

const NS = 'http://www.w3.org/2000/svg';

/** 入力の向き（右・上が正。0,0 は離す） */
interface Push {
  readonly x: number;
  readonly y: number;
}

/** 図ごとの入力: 倒す向き（操縦）か、押すボタン */
type Input =
  | { readonly kind: 'steer'; readonly push: Push; readonly hold?: boolean }
  | { readonly kind: 'button'; readonly touch: string; readonly key: Action; readonly pad: string };

const STEER = (x: number, y: number, hold = false): Input => ({
  kind: 'steer',
  push: { x, y },
  hold,
});
const BUTTON = (touch: string, key: Action, pad: string): Input => ({
  kind: 'button',
  touch,
  key,
  pad,
});

const INPUTS: Readonly<Record<TutorialFigure, Input>> = {
  steer: STEER(1, 0),
  release: STEER(0, 0),
  climb: STEER(0, 1),
  throttle: BUTTON('THR', 'throttleDown', 'R↓'),
  ab: BUTTON('AB', 'afterburner', 'LB'),
  follow: BUTTON('THR', 'throttleDown', 'R↓'),
  aim: STEER(0.35, 0.2),
  fire: BUTTON('GUN', 'fire', 'RB'),
  lead: STEER(0.5, 0),
  missile: BUTTON('MSL', 'missile', 'A'),
  resupply: BUTTON('MSL', 'missile', 'A'),
  flare: BUTTON('FLR', 'flare', 'B'),
  loop: STEER(0, 1, true),
  reverse: STEER(0, 0),
  select: BUTTON('TAP', 'targetNext', 'Y'),
  behind: STEER(-1, 0, true),
};

function node<K extends keyof SVGElementTagNameMap>(
  parent: Element,
  tag: K,
  attrs: Readonly<Record<string, string | number>>,
  text?: string,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

function arrow(g: Element, x1: number, y1: number, x2: number, y2: number, cls = 'tf-arrow'): void {
  node(g, 'line', { x1, y1, x2, y2, class: cls, 'marker-end': 'url(#tf-head)' });
}

/** 左の入力の絵（中心 30,32） */
function drawInput(
  g: Element,
  input: Input,
  v: TutorialVariant,
  keyName: (a: Action) => string,
): void {
  if (input.kind === 'button') {
    const label = v === 'keys' ? keyName(input.key) : v === 'pad' ? input.pad : input.touch;
    const w = Math.max(30, label.length * 8 + 14);
    node(g, 'rect', {
      x: 30 - w / 2,
      y: 18,
      width: w,
      height: 28,
      rx: v === 'pad' ? 14 : 6,
      class: 'tf-key is-on',
    });
    node(g, 'text', { x: 30, y: 37, class: 'tf-label' }, label);
    return;
  }
  const p = input.push;
  const released = p.x === 0 && p.y === 0;
  if (v === 'keys') {
    // ↑↓←→ に当たるキー（押すキーを光らせる）
    const keys: [Action, number, number, boolean][] = [
      ['pitchDown', 30, 12, p.y < 0],
      ['rollLeft', 12, 34, p.x < 0],
      ['pitchUp', 30, 34, p.y > 0],
      ['rollRight', 48, 34, p.x > 0],
    ];
    for (const [a, x, y, on] of keys) {
      node(g, 'rect', {
        x: x - 8,
        y: y - 8,
        width: 16,
        height: 16,
        rx: 3,
        class: on ? 'tf-key is-on' : 'tf-key',
      });
      node(g, 'text', { x, y: y + 4, class: 'tf-label is-small' }, keyName(a).slice(0, 3));
    }
    if (released) node(g, 'text', { x: 30, y: 60, class: 'tf-label is-small' }, '—');
    return;
  }
  if (v === 'tilt') {
    // 端末の傾き（左右は回して、上下は手前 / 奥の矢印）
    const deg = p.x * 20;
    const phone = node(g, 'g', { transform: `rotate(${deg} 30 32)` });
    node(phone, 'rect', { x: 8, y: 20, width: 44, height: 24, rx: 4, class: 'tf-device' });
    if (p.y !== 0) arrow(g, 30, 32, 30, 32 - p.y * 14);
    if (released) node(g, 'text', { x: 30, y: 60, class: 'tf-label is-small' }, '0°');
    return;
  }
  if (v === 'drag') {
    // 画面と、押さえる指の位置（離すなら指なし）
    node(g, 'rect', { x: 4, y: 12, width: 52, height: 40, rx: 4, class: 'tf-device' });
    node(g, 'circle', { cx: 30, cy: 32, r: 1.5, class: 'tf-dot' });
    if (!released) {
      const fx = 30 + p.x * 20;
      const fy = 32 - p.y * 15;
      node(g, 'circle', { cx: fx, cy: fy, r: 6, class: 'tf-finger' });
    }
    return;
  }
  // スティック（タッチ・パッド）。ピッチとロール・パッドは上へ倒すのが「引く」で下
  const pull = v === 'classic' || v === 'pad';
  node(g, 'circle', { cx: 30, cy: 32, r: 20, class: 'tf-device' });
  const kx = 30 + p.x * 12;
  const ky = 32 + (pull ? p.y : -p.y) * 12;
  if (!released) arrow(g, 30, 32, kx + Math.sign(kx - 30) * 4, ky + Math.sign(ky - 32) * 4);
  node(g, 'circle', { cx: kx, cy: ky, r: 7, class: input.hold ? 'tf-knob is-hold' : 'tf-knob' });
}

/** 右の「何が起きるか」の絵（x 64〜120） */
function drawResult(g: Element, f: TutorialFigure): void {
  const plane = (x: number, y: number, rot = 0): void => {
    node(g, 'path', {
      d: `M ${x} ${y - 7} L ${x + 2} ${y + 3} L ${x + 8} ${y + 5} L ${x - 8} ${y + 5} L ${x - 2} ${y + 3} Z`,
      class: 'tf-plane',
      transform: `rotate(${rot} ${x} ${y})`,
    });
  };
  const nose = (x: number, y: number): void => {
    node(g, 'circle', { cx: x, cy: y, r: 4, class: 'tf-nose' });
    node(g, 'line', { x1: x - 10, y1: y, x2: x - 4, y2: y, class: 'tf-nose' });
    node(g, 'line', { x1: x + 4, y1: y, x2: x + 10, y2: y, class: 'tf-nose' });
  };
  switch (f) {
    case 'steer':
      plane(80, 40);
      node(g, 'path', {
        d: 'M 80 30 Q 84 14 104 14',
        class: 'tf-arrow',
        'marker-end': 'url(#tf-head)',
      });
      return;
    case 'release':
    case 'reverse':
      if (f === 'reverse') {
        node(g, 'path', {
          d: 'M 70 52 L 96 52 A 14 14 0 0 0 96 24 L 74 24',
          class: 'tf-arrow',
          'marker-end': 'url(#tf-head)',
        });
        return;
      }
      node(g, 'line', { x1: 70, y1: 32, x2: 114, y2: 32, class: 'tf-horizon' });
      plane(92, 32);
      return;
    case 'climb':
      plane(92, 34);
      arrow(g, 106, 40, 106, 14);
      arrow(g, 78, 28, 78, 54);
      return;
    case 'throttle':
    case 'ab':
    case 'follow':
      node(
        g,
        'text',
        { x: 92, y: 26, class: 'tf-label is-hud' },
        f === 'ab' ? '360' : f === 'follow' ? 'AUTO' : '220',
      );
      node(g, 'text', { x: 92, y: 42, class: 'tf-label is-small' }, f === 'follow' ? 'THR' : 'm/s');
      if (f === 'follow') {
        plane(74, 54, 90);
        plane(110, 54, 90);
      }
      return;
    case 'aim':
    case 'fire':
    case 'lead':
      node(g, 'circle', {
        cx: 100,
        cy: 26,
        r: 9,
        class: f === 'fire' ? 'tf-pipper is-ready' : 'tf-pipper',
      });
      node(g, 'circle', { cx: 100, cy: 26, r: 1.5, class: 'tf-dot' });
      if (f === 'lead') {
        node(g, 'path', { d: 'M 76 26 L 84 26 L 80 20 Z', class: 'tf-plane' });
        arrow(g, 86, 26, 92, 26, 'tf-arrow is-dashed');
      }
      nose(f === 'aim' ? 86 : 100, f === 'aim' ? 40 : 26);
      if (f === 'aim') arrow(g, 90, 37, 96, 31);
      node(g, 'text', { x: 92, y: 58, class: 'tf-label is-small' }, '≤1.5km');
      return;
    case 'missile':
      node(g, 'rect', { x: 82, y: 14, width: 22, height: 22, class: 'tf-lock' });
      node(g, 'path', { d: 'M 93 21 L 97 25 L 93 29 L 89 25 Z', class: 'tf-target' });
      node(g, 'text', { x: 93, y: 52, class: 'tf-label is-hud' }, 'LOCK');
      return;
    case 'resupply':
      node(g, 'text', { x: 92, y: 30, class: 'tf-label is-hud' }, '0 → 4');
      node(g, 'text', { x: 92, y: 48, class: 'tf-label is-small' }, 'MSL');
      return;
    case 'flare':
      node(g, 'text', { x: 92, y: 22, class: 'tf-label is-warn' }, 'MISSILE');
      plane(92, 40);
      for (const [x, y] of [
        [82, 52],
        [88, 56],
        [96, 56],
        [102, 52],
      ] as const)
        node(g, 'circle', { cx: x, cy: y, r: 2, class: 'tf-flare' });
      return;
    case 'loop':
      node(g, 'path', {
        d: 'M 72 54 L 92 54 A 16 16 0 1 0 76 38',
        class: 'tf-arrow',
        'marker-end': 'url(#tf-head)',
      });
      node(g, 'text', { x: 92, y: 12, class: 'tf-label is-small' }, 'AB');
      return;
    case 'select':
      node(g, 'path', { d: 'M 80 22 L 85 27 L 80 32 L 75 27 Z', class: 'tf-target' });
      node(g, 'path', {
        d: 'M 104 30 L 109 35 L 104 40 L 99 35 Z',
        class: 'tf-target is-selected',
      });
      arrow(g, 86, 30, 97, 34);
      return;
    case 'behind':
      node(g, 'rect', { x: 66, y: 10, width: 52, height: 44, rx: 4, class: 'tf-device' });
      node(g, 'path', { d: 'M 70 32 L 78 26 L 78 38 Z', class: 'tf-edge' });
      node(g, 'text', { x: 96, y: 36, class: 'tf-label is-small' }, 'BEHIND');
      return;
  }
}

/** 図（SVG）を作る */
export function createTutorialFigure(
  f: TutorialFigure,
  v: TutorialVariant,
  keyName: (a: Action) => string,
): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 124 64');
  svg.setAttribute('class', 'tutorial-figure');
  svg.setAttribute('aria-hidden', 'true');
  const defs = node(svg, 'defs', {});
  const m = node(defs, 'marker', {
    id: 'tf-head',
    viewBox: '0 0 8 8',
    refX: 6,
    refY: 4,
    markerWidth: 5,
    markerHeight: 5,
    orient: 'auto-start-reverse',
  });
  node(m, 'path', { d: 'M 0 0 L 8 4 L 0 8 Z', class: 'tf-head' });
  drawInput(node(svg, 'g', {}), INPUTS[f], v, keyName);
  node(svg, 'line', { x1: 60, y1: 10, x2: 60, y2: 54, class: 'tf-divider' });
  drawResult(node(svg, 'g', {}), f);
  return svg;
}
