// 9-1 操作の診断: 集計を表（グループを列に並べる）にする。パイロット名は出さない
import { STICK_EDGE, STICK_LOW, TIMELINE_SECONDS } from './metrics';
import { median, Totals } from './totals';

export interface Group {
  readonly label: string;
  readonly totals: Totals;
}

const pct = (n: number, d: number): string => (d > 0 ? `${((100 * n) / d).toFixed(1)}%` : '-');
const per = (n: number, minutes: number): string => (minutes > 0 ? (n / minutes).toFixed(1) : '-');
const num = (v: number, digits = 1): string => (Number.isFinite(v) ? v.toFixed(digits) : '-');

type Row = readonly [string, (t: Totals) => string] | string;

const ANGLE_LABELS = ['≤2°', '2〜5°', '5〜10°', '10〜30°', '30〜90°', '>90°（後ろ）'];

const ROWS: readonly Row[] = [
  '■ 記録',
  ['記録の数（成功）', (t) => `${t.files}（${t.successes}）`],
  ['飛んでいた時間（分。撃墜中を除く）', (t) => num(t.aliveMinutes, 2)],
  ['アナログの入力（スティック）の割合', (t) => pct(t.analogSteps, t.aliveSteps)],
  ['戦域の外（警告）にいた時間', (t) => pct(t.outsideSteps, t.aliveSteps)],
  ['エイムアシストが補正を足した時間', (t) => pct(t.assistSteps, t.aliveSteps)],
  '■ スティックの倒し具合（ピッチ・ロールの合成。エイムアシストの分を引いた見積もり）',
  ['0（離している・デッドゾーン内）', (t) => pct(t.stick.zero, t.aliveSteps)],
  [`中央付近（< ${STICK_LOW}）`, (t) => pct(t.stick.low, t.aliveSteps)],
  [`中間（${STICK_LOW}〜${STICK_EDGE}）`, (t) => pct(t.stick.mid, t.aliveSteps)],
  [`端（≥ ${STICK_EDGE}）`, (t) => pct(t.stick.edge, t.aliveSteps)],
  [
    '  ピッチだけで端 / ロールだけで端',
    (t) => `${pct(t.pitchEdge, t.aliveSteps)} / ${pct(t.rollEdge, t.aliveSteps)}`,
  ],
  [
    '端に 1 秒以上倒しっぱなし（回/分・最長秒）',
    (t) => `${per(t.edgeHolds, t.aliveMinutes)}・${num(t.edgeLongest)}`,
  ],
  '■ 向きの反転（±0.25 をまたいで反対へ。回/分、うち 1 秒以内の往復）',
  [
    'ピッチ',
    (t) =>
      `${per(t.reversals.pitch, t.aliveMinutes)}（${per(t.quickReversals.pitch, t.aliveMinutes)}）`,
  ],
  [
    'ロール',
    (t) =>
      `${per(t.reversals.roll, t.aliveMinutes)}（${per(t.quickReversals.roll, t.aliveMinutes)}）`,
  ],
  [
    'ヨー',
    (t) =>
      `${per(t.reversals.yaw, t.aliveMinutes)}（${per(t.quickReversals.yaw, t.aliveMinutes)}）`,
  ],
  [
    '照準の行き過ぎ（機首の 10° 内で対象が反対側へ。回/分）',
    (t) => per(t.crossings, t.nearSteps / 3600),
  ],
  '■ 狙う敵（選択中の対象。機銃の射程内は予測照準点）',
  ['対象を選んでいた時間（分）', (t) => num(t.engagedSteps / 3600, 2)],
  [
    '対象の選び直し（回/分。タップ・切り替え・撃墜の後）',
    (t) => per(t.targetSwitches, t.steps / 3600),
  ],
  ['対象が画面の外にいた時間', (t) => pct(t.offScreenSteps, t.engagedSteps)],
  ...ANGLE_LABELS.map((label, i): Row => [
    `機首とのずれ ${label}`,
    (t) => pct(t.angleBins[i] ?? 0, t.engagedSteps),
  ]),
  [
    '見失って（>30°）から 10° 内に戻すまで（中央値 秒・回/分）',
    (t) => `${num(median(t.reacquire))}・${per(t.reacquire.length, t.engagedSteps / 3600)}`,
  ],
  '■ 機銃',
  ['撃っていた時間（対象を選んでいた時間に対して）', (t) => pct(t.fireSteps, t.engagedSteps)],
  [
    '撃った回数（回/分）・1 回の長さ（秒）',
    (t) => `${per(t.bursts, t.aliveMinutes)}・${num(t.fireSteps / 60 / Math.max(1, t.bursts))}`,
  ],
  '  撃っていた間の照準（機首にいちばん近い敵。予測照準点の近似）',
  ['撃っていた間: 照準の円（当たる範囲）に敵', (t) => pct(t.fire.inHitCone, t.fireSteps)],
  ['  当たる範囲の外・2° 以内', (t) => pct(t.fire.within2, t.fireSteps)],
  ['  2〜8°（エイムアシストの円錐）', (t) => pct(t.fire.withinAssist, t.fireSteps)],
  ['  8° より外', (t) => pct(t.fire.wide, t.fireSteps)],
  ['  射程（1500m）の外', (t) => pct(t.fire.outOfRange, t.fireSteps)],
  ['  対象なし', (t) => pct(t.fire.noTarget, t.fireSteps)],
  '  9-5b: 自動射撃と GUN ボタン（v1.0.6 からの記録。前の記録はどちらもボタンに数える）',
  [
    '自動射撃: 撃っていた時間・うち射程外',
    (t) =>
      t.fireKnown ? `${pct(t.fireAuto, t.fireSteps)}・${pct(t.fireAutoFar, t.fireAuto)}` : '-',
  ],
  [
    'GUN ボタン: 撃っていた時間・うち射程外',
    (t) =>
      t.fireKnown
        ? `${pct(t.fireButton, t.fireSteps)}・${pct(t.fireButtonFar, t.fireButton)}`
        : `（区別なし）・${pct(t.fireButtonFar, t.fireButton)}`,
  ],
  [
    '  前の記録: 自動射撃の条件の外で撃っていた（= GUN ボタン）',
    (t) => (t.fireKnown ? '-' : pct(t.fireSurelyButton, t.fireSteps)),
  ],
  [
    '追い越し（射程内で前にいた対象が後ろへ。回・回/分）',
    (t) => `${t.overtakes}・${per(t.overtakes, t.aliveMinutes)}`,
  ],
  ['弾数・命中率', (t) => `${t.shots}・${pct(t.hits, t.shots)}`],
  [
    '真上・真下（±70° より先）の横回転 >120°/秒（秒）・最大（°/秒。機体の軸）',
    (t) => `${num(t.verticalFastRoll / 60, 1)}・${num(t.verticalRollMax, 0)}`,
  ],
  ['撃墜・被撃墜', (t) => `${t.kills}・${t.downs}`],
  '■ ミサイル',
  ['発射（回/分）', (t) => `${t.missiles}（${per(t.missiles, t.aliveMinutes)}）`],
  ['  ロックしてから撃った', (t) => pct(t.missilesLocked, t.missiles)],
  ['  対象の近くで起爆（≒命中）', (t) => pct(t.missileDetonations, t.missiles)],
  ['  発射時の機首とのずれ（中央値）', (t) => `${num(median(t.missileAngles))}°`],
];

const width = (s: string): number => {
  let w = 0;
  for (const ch of s) w += /[\u3000-\uffff]/.test(ch) ? 2 : 1;
  return w;
};
const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - width(s)));

/** グループを列に並べた表 */
export function formatTable(groups: readonly Group[]): string {
  const labelW = Math.max(...ROWS.map((r) => (typeof r === 'string' ? 0 : width(r[0])))) + 2;
  const cells = ROWS.map((r) => (typeof r === 'string' ? [] : groups.map((g) => r[1](g.totals))));
  const colW = groups.map(
    (g, i) => Math.max(width(g.label), ...cells.map((c) => width(c[i] ?? ''))) + 2,
  );
  const lines = [pad('', labelW) + groups.map((g, i) => pad(g.label, colW[i] ?? 0)).join('')];
  ROWS.forEach((r, k) => {
    if (typeof r === 'string') lines.push(r);
    else
      lines.push(pad(r[0], labelW) + (cells[k] ?? []).map((c, i) => pad(c, colW[i] ?? 0)).join(''));
  });
  return lines.join('\n');
}

/** 1 本の記録の推移（区切りごとの平均のずれ・画面の内・射撃） */
export function formatTimeline(t: Totals): string {
  const lines = [
    `推移（${TIMELINE_SECONDS} 秒ごと。対象を選んでいた区切りだけ）`,
    '  時刻   平均のずれ  画面の内  撃っていた  ずれ（■ = 10°）',
  ];
  t.buckets.forEach((b, i) => {
    if (b.engaged === 0) return;
    const mean = b.angleSum / b.engaged;
    const from = i * TIMELINE_SECONDS;
    const clock = `${Math.floor(from / 60)}:${String(from % 60).padStart(2, '0')}`;
    const bar = '■'.repeat(Math.min(18, Math.round(mean / 10)));
    lines.push(
      `  ${clock.padStart(5)}  ${num(mean).padStart(8)}°  ${pct(b.onScreen, b.engaged).padStart(8)}  ${pct(b.firing, b.engaged).padStart(9)}  ${bar}`,
    );
  });
  return lines.join('\n');
}
