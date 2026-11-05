// モード選択のカード・タイルの背景グリフ（7-D）: 線画の SVG をコードで作る（画像ファイルなし）。
// viewBox は 64 × 64。線は currentColor（CSS で HUD のシアン）・太さは表示の大きさによらず一定（non-scaling-stroke）
const SVG_NS = 'http://www.w3.org/2000/svg';

export const GLYPH_KINDS = [
  'fighter',
  'star',
  'cloudWing',
  'ring',
  'crossedJets',
  'kaiju',
  'radar',
  'target',
  'hangar',
  'play',
  'trophy',
  'gear',
  'info',
  'calendar',
  'medal',
] as const;
export type GlyphKind = (typeof GLYPH_KINDS)[number];

type Shape =
  | { readonly p: string }
  | { readonly c: readonly [number, number, number] }
  | { readonly e: readonly [number, number, number, number] };

const f = (n: number): string => n.toFixed(2);

/** 正多角形の星・歯車のような放射状の折れ線（radii を交互に使う） */
function radial(
  cx: number,
  cy: number,
  radii: readonly number[],
  count: number,
  phase: number,
): string {
  const pts: string[] = [];
  const n = count * radii.length;
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const r = radii[i % radii.length] ?? 0;
    pts.push(`${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)}`);
  }
  return `M${pts.join(' L')} Z`;
}

/** 上向きのジェット機（真上から）。交差する 2 機に使う */
const JET_TOP =
  'M32 10 L34.5 22 L50 32 L50 35.5 L34.5 31 L34 44 L39 48.5 L39 51 L32 49 L25 51 L25 48.5 L30 44 L29.5 31 L14 35.5 L14 32 L29.5 22 Z';

/** 歯車: 8 枚の歯（外 26・内 20 を 2 点ずつ）と軸穴 */
function gearPath(): string {
  const pts: string[] = [];
  const teeth = 8;
  for (let i = 0; i < teeth; i++) {
    const base = (i / teeth) * Math.PI * 2;
    const step = (Math.PI * 2) / teeth;
    for (const [t, r] of [
      [0, 20],
      [0.18, 26],
      [0.5, 26],
      [0.68, 20],
    ] as const) {
      const a = base + t * step;
      pts.push(`${f(32 + Math.cos(a) * r)} ${f(32 + Math.sin(a) * r)}`);
    }
  }
  return `M${pts.join(' L')} Z`;
}

const GLYPHS: Readonly<Record<GlyphKind, readonly Shape[]>> = {
  // 戦闘機の側面図（機首は右）
  fighter: [
    { p: 'M5 36 L17 33 L43 32 Q55 32 61 35 Q55 38 43 38 L17 38 Z' },
    { p: 'M40 32 Q46 26.5 52 32.4' },
    { p: 'M9 34.5 L5 21 L11 21 L20 33' },
    { p: 'M25 38 L19 45 L32 45 L38 38' },
    { p: 'M28 35 L40 35' },
  ],
  // ミッションの星（星と、まわりを回る軌道）
  star: [{ p: radial(32, 33, [20, 8.5], 5, -Math.PI / 2) }, { e: [32, 33, 28, 9] }],
  // 雲と翼
  cloudWing: [
    { p: 'M9 48 Q8 40 16 40 Q18 32 27 33 Q33 26 41 32 Q50 31 51 39 Q58 40 57 48 Z' },
    { p: 'M20 22 L46 13 L56 15 L33 26 Z' },
    { p: 'M38 18 L44 21' },
  ],
  // リング（斜めから見た輪と、くぐる線）
  ring: [
    { e: [34, 32, 13, 22] },
    { e: [34, 32, 9, 17] },
    { p: 'M4 34 L58 30' },
    { p: 'M52 26 L58 30 L53 35' },
  ],
  // 交差する 2 機（真上から）
  crossedJets: [{ p: JET_TOP }, { p: JET_TOP }],
  // 怪獣の頭部のシルエット（左向き。背の結晶のとげ）
  kaiju: [
    {
      p: 'M6 41 L13 35 L22 33 L26 26 L30 31 L34 21 L38 28 L44 18 L46 27 L54 24 L52 33 L59 40 L57 52 L41 54 L31 49 L22 49 L15 47 L6 45 Z',
    },
    { p: 'M17 38 L23 36.5' },
    { p: 'M6 43 L21 44 L27 47' },
  ],
  // 基地のレーダー塔（脚・横木・皿・電波）
  radar: [
    { p: 'M23 59 L32 26 L41 59' },
    { p: 'M26.5 47 L37.5 47 M29 37 L35 37 M26.5 47 L35 37 M37.5 47 L29 37' },
    { p: 'M17 15 Q32 32 47 15 Z' },
    { p: 'M32 23.5 L32 26 M32 23.5 L38 12' },
    { p: 'M50 8 Q55 13 51 19 M54 4 Q62 13 55 23' },
  ],
  // 練習場の的（9-5。二重の円・十字の目盛り・中心の点）
  target: [
    { c: [32, 32, 22] },
    { c: [32, 32, 11] },
    { p: 'M32 4 L32 17 M32 47 L32 60 M4 32 L17 32 M47 32 L60 32' },
    { c: [32, 32, 2.5] },
  ],
  // 格納庫（かまぼこ屋根・扉）
  hangar: [
    { p: 'M5 53 L5 38 Q32 6 59 38 L59 53' },
    { p: 'M2 53 L62 53' },
    { p: 'M20 53 L20 33 L44 33 L44 53 M32 33 L32 53' },
    { p: 'M14 27 Q32 12 50 27' },
  ],
  // 再生マーク
  play: [{ c: [32, 32, 23] }, { p: 'M27 21 L45 32 L27 43 Z' }],
  // トロフィー
  trophy: [
    { p: 'M20 11 L44 11 L42 29 Q32 40 22 29 Z' },
    { p: 'M20.5 15 Q11 15 13 23 Q15 29 22.5 30 M43.5 15 Q53 15 51 23 Q49 29 41.5 30' },
    { p: 'M32 37 L32 45' },
    { p: 'M23 53 L41 53 L39 45 L25 45 Z' },
  ],
  // 歯車
  gear: [{ p: gearPath() }, { c: [32, 32, 8] }],
  // 日めくり（9-9。日替わりチャレンジ。枠・綴じ具・日付の線と星）
  calendar: [
    { p: 'M10 15 L54 15 L54 56 L10 56 Z' },
    { p: 'M10 25 L54 25' },
    { p: 'M21 9 L21 19 M43 9 L43 19' },
    { p: radial(32, 41, [10, 4.2], 5, -Math.PI / 2) },
  ],
  // 勲章（9-10。リボンと円と星）
  medal: [
    { p: 'M22 8 L30 28 M42 8 L34 28 M22 8 L30 8 M42 8 L34 8' },
    { c: [32, 40, 16] },
    { p: radial(32, 40.5, [9, 3.8], 5, -Math.PI / 2) },
  ],
  // i
  info: [
    { c: [32, 32, 24] },
    { c: [32, 20, 2.6] },
    { p: 'M28 28 L33 28 L33 45 M27.5 45 L38.5 45' },
  ],
};

/** 交差する 2 機の回転（1 機目・2 機目） */
const CROSS_ROTATIONS = [35, -35] as const;

/** グリフの SVG を作る（className は CSS で大きさ・位置を決める。読み上げでは無視） */
export function createGlyph(kind: GlyphKind, className = 'glyph'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  GLYPHS[kind].forEach((s, i) => {
    let node: SVGElement;
    if ('p' in s) {
      node = document.createElementNS(SVG_NS, 'path');
      node.setAttribute('d', s.p);
    } else if ('c' in s) {
      node = document.createElementNS(SVG_NS, 'circle');
      node.setAttribute('cx', String(s.c[0]));
      node.setAttribute('cy', String(s.c[1]));
      node.setAttribute('r', String(s.c[2]));
    } else {
      node = document.createElementNS(SVG_NS, 'ellipse');
      node.setAttribute('cx', String(s.e[0]));
      node.setAttribute('cy', String(s.e[1]));
      node.setAttribute('rx', String(s.e[2]));
      node.setAttribute('ry', String(s.e[3]));
    }
    if (kind === 'crossedJets')
      node.setAttribute('transform', `rotate(${CROSS_ROTATIONS[i] ?? 0} 32 32)`);
    node.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(node);
  });
  return svg;
}

/** 形の数（テスト用: すべての種類に 1 つ以上の線がある） */
export function glyphShapeCount(kind: GlyphKind): number {
  return GLYPHS[kind].length;
}
