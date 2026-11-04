// 9-1 操作の診断: 9-2（スティック）・9-3（自動追尾・自動射撃）の推奨値を決める実験。
// 「模擬の人」に同じミッションを飛ばし、スティックのカーブ・感度・エイムアシストの強さ・自動射撃を 1 つずつ変えて比べる。
// ゲームの数値（src/data）は変えず、この実験の中だけで差し替える
import {
  AIM_ASSIST_CONFIG,
  AIM_ASSIST_LEVEL_SPECS,
  AIM_ASSIST_LEVELS,
} from '../../src/data/assist';
import { BEGINNER_SKILL, findRole, flyMission, type FlightTweaks } from './flight';
import { DEFAULT_HANDS } from './hands';
import { TimedAnalyzer } from './kill-timer';
import type { ControlAnalyzer } from './metrics';
import { median, Totals } from './totals';

export interface Experiment {
  readonly id: string;
  readonly label: string;
  readonly tweaks: FlightTweaks;
}

const A = AIM_ASSIST_CONFIG;
const hands = (o: Partial<typeof DEFAULT_HANDS>): typeof DEFAULT_HANDS => ({
  ...DEFAULT_HANDS,
  ...o,
});

/**
 * 難しさの原因の分解: 初心者役のボットから 1 つずつ人の条件を足す（最後が「模擬の人」と同じ）
 */
const NO_HANDS = hands({ noise: 0, delay: 0, yaw: true });
export const DECOMPOSE: readonly Experiment[] = [
  { id: 'd0', label: '初心者役のボット', tweaks: { skill: BEGINNER_SKILL, hands: null } },
  {
    id: 'd1',
    label: '+ 円いスティック（ピッチとロールの合成が 1 で頭打ち）',
    tweaks: { skill: BEGINNER_SKILL, hands: NO_HANDS },
  },
  {
    id: 'd2',
    label: '+ ヨーを使わない（タッチのヨーはボタン）',
    tweaks: { skill: BEGINNER_SKILL, hands: { ...NO_HANDS, yaw: false } },
  },
  {
    id: 'd3',
    label: '+ 反応の遅れ 0.2 秒',
    tweaks: { skill: BEGINNER_SKILL, hands: { ...NO_HANDS, yaw: false, delay: 0.2 } },
  },
  { id: 'd4', label: '+ 指のぶれ 0.12', tweaks: { skill: BEGINNER_SKILL, hands: DEFAULT_HANDS } },
  { id: 'd5', label: '+ 狙いのずれ 4°・9° で撃つ（= 模擬の人）', tweaks: {} },
];

export const EXPERIMENTS: readonly Experiment[] = [
  { id: 'base', label: '今の操作（直線・感度 1.0・アシスト 8°/0.25）', tweaks: {} },
  // 9-2: スティック
  { id: 'curve1.5', label: 'カーブ 1.5', tweaks: { hands: hands({ curve: 1.5 }) } },
  { id: 'curve2', label: 'カーブ 2.0', tweaks: { hands: hands({ curve: 2 }) } },
  { id: 'sens0.8', label: '感度 0.8（直線）', tweaks: { hands: hands({ sensitivity: 0.8 }) } },
  { id: 'sens0.6', label: '感度 0.6（直線）', tweaks: { hands: hands({ sensitivity: 0.6 }) } },
  { id: 'sens1.3', label: '感度 1.3（直線）', tweaks: { hands: hands({ sensitivity: 1.3 }) } },
  {
    id: 'calm',
    label: '（参考）ぶれ半分・遅れ 0.1 秒',
    tweaks: { hands: hands({ noise: 0.1, delay: 0.1 }) },
  },
  { id: 'direct', label: '方式: 画面の上の方向へ倒す', tweaks: { direct: true } },
  {
    id: 'direct1.5',
    label: '方式: 方向へ倒す・カーブ 1.5',
    tweaks: { direct: true, hands: hands({ curve: 1.5 }) },
  },
  // 9-3: 自動追尾（エイムアシストの円錐と補正の強さ）・自動射撃・判定の拡大
  {
    id: 'assist12',
    label: 'アシスト 12°/0.4',
    tweaks: { assist: { ...A, coneDeg: 12, maxCorrection: 0.4, fullCorrectionDeg: 5 } },
  },
  {
    id: 'assist15',
    label: 'アシスト 15°/0.5',
    tweaks: { assist: { ...A, coneDeg: 15, maxCorrection: 0.5, fullCorrectionDeg: 6 } },
  },
  {
    id: 'assist20',
    label: 'アシスト 20°/0.7',
    tweaks: { assist: { ...A, coneDeg: 20, maxCorrection: 0.7, fullCorrectionDeg: 8 } },
  },
  {
    id: 'track',
    label: '追尾 15°/0.5・1.5° で最大（機首の近くで強く合わせる）',
    tweaks: { assist: { ...A, coneDeg: 15, maxCorrection: 0.5, fullCorrectionDeg: 1.5 } },
  },
  {
    id: 'track10',
    label: '追尾 10°/0.35・1.5° で最大',
    tweaks: { assist: { ...A, coneDeg: 10, maxCorrection: 0.35, fullCorrectionDeg: 1.5 } },
  },
  {
    id: 'track8',
    label: '追尾 8°/0.25・1.5° で最大（今の円錐と強さのまま）',
    tweaks: { assist: { ...A, fullCorrectionDeg: 1.5 } },
  },
  {
    id: 'track-auto',
    label: '追尾 15°/0.5・1.5° で最大 + 自動射撃',
    tweaks: {
      assist: { ...A, coneDeg: 15, maxCorrection: 0.5, fullCorrectionDeg: 1.5 },
      autoFireScale: 1,
    },
  },
  {
    id: 'hit1.7',
    label: '判定の拡大 ×1.7（P-3 の案 B）',
    tweaks: { assist: { ...A, gunHitRadiusScale: 1.7 } },
  },
  { id: 'auto1', label: '自動射撃（当たる範囲）', tweaks: { autoFireScale: 1 } },
  { id: 'auto2', label: '自動射撃（当たる範囲 ×2）', tweaks: { autoFireScale: 2 } },
  {
    id: 'combo',
    label: '組み合わせ（カーブ 1.5・アシスト 15°/0.5・自動射撃）',
    tweaks: {
      hands: hands({ curve: 1.5 }),
      assist: { ...A, coneDeg: 15, maxCorrection: 0.5, fullCorrectionDeg: 6 },
      autoFireScale: 1,
    },
  },
  {
    id: 'direct-combo',
    label: '組み合わせ（方向へ倒す・カーブ 1.5・追尾 15°/0.5/1.5°・自動射撃）',
    tweaks: {
      direct: true,
      hands: hands({ curve: 1.5 }),
      assist: { ...A, coneDeg: 15, maxCorrection: 0.5, fullCorrectionDeg: 1.5 },
      autoFireScale: 1,
    },
  },
];

/**
 * 9-2 の変更前後（`--compare`）: 今の操作（ピッチ・ロール・直線）と、9-2 の初期値（方向へ倒す・カーブ 1.5）と、設定で選べるほかの組み合わせ。
 * 「方向へ倒す」はリング・戦域外から戻る区間も含めて全部この方式で飛ぶ（9-1 の実験はリング・戻る区間は今の方式だった）
 */
export const STICK_COMPARE: readonly Experiment[] = [
  { id: 'before', label: '変更前: ピッチ・ロール・カーブ 1.0', tweaks: {} },
  {
    id: 'after',
    label: '変更後: 方向へ倒す・カーブ 1.5',
    tweaks: { direct: true, hands: hands({ curve: 1.5 }) },
  },
  {
    id: 'after-screen',
    label: '変更後・画面の上の方向で読む人（傾いた画面のまま倒す）',
    tweaks: { direct: 'screen', hands: hands({ curve: 1.5 }) },
  },
  { id: 'direct1', label: '方向へ倒す・カーブ 1.0', tweaks: { direct: true } },
  {
    id: 'direct2',
    label: '方向へ倒す・カーブ 2.0',
    tweaks: { direct: true, hands: hands({ curve: 2 }) },
  },
  {
    id: 'classic1.5',
    label: 'ピッチ・ロール・カーブ 1.5',
    tweaks: { hands: hands({ curve: 1.5 }) },
  },
  { id: 'classic2', label: 'ピッチ・ロール・カーブ 2.0', tweaks: { hands: hands({ curve: 2 }) } },
];

/**
 * 9-3 の効果（`--assist`）: 9-2 の初期値（方向へ倒す・カーブ 1.5）の模擬の人で、狙いの補助の強さ（弱 = 4-12 の値・標準・強）×
 * 自動射撃（OFF / ON）。補助・自動射撃は本番と同じ数値と判定（AIM_ASSIST_LEVEL_SPECS・autoFireReady）
 */
const LEVEL_LABELS = { weak: '弱', normal: '標準', strong: '強' } as const;
export const ASSIST_COMPARE: readonly Experiment[] = AIM_ASSIST_LEVELS.flatMap((level) =>
  [false, true].map((auto): Experiment => ({
    id: `${level}${auto ? '-auto' : ''}`,
    label: `補助 ${LEVEL_LABELS[level]}・自動射撃 ${auto ? 'ON' : 'OFF'}`,
    tweaks: {
      direct: true,
      hands: hands({ curve: 1.5 }),
      assist: AIM_ASSIST_LEVEL_SPECS[level],
      autoFireScale: auto ? 1 : 0,
    },
  })),
);

/**
 * 9-4 の傾き・ドラッグ（`--tilt`）: 9-2 の初期値（方向へ倒す・カーブ 1.5）の模擬の人と、同じ組み立てに傾き・ドラッグ相当の入力を
 * 渡す人。狙いの補助・自動射撃は初期値（標準・ON）。人の手の数値は推定（実機の記録が無いので）:
 * - 傾き: 手首で端末を傾ける。遅れ 0.25 秒（スティックより大きい）・ぶれ 0.06（両手で持つので小さい。端 25° の 1.5°）・
 *   相関 0.5 秒・デッドゾーン 12%・カーブ 1.5・センサーの平滑 0.08 秒
 * - ドラッグ: 行きたい所を指で押さえる。遅れ 0.2 秒・ぶれ 0.05（押さえた指は動かしにくい）・直線・デッドゾーンなし。
 *   地平線で読む人（方式の説明どおり）と、画面（傾いたカメラ）に見える所を押さえる人
 */
const ASSIST_DEFAULT = {
  assist: AIM_ASSIST_LEVEL_SPECS.normal,
  autoFireScale: 1,
} as const;
export const TILT_COMPARE: readonly Experiment[] = [
  {
    id: 'stick',
    label: 'スティック（方向へ倒す・カーブ 1.5）',
    tweaks: { direct: true, hands: hands({ curve: 1.5 }), ...ASSIST_DEFAULT },
  },
  {
    id: 'tilt',
    label: '傾き',
    tweaks: {
      direct: true,
      hands: hands({ curve: 1.5, delay: 0.25, noise: 0.06, tau: 0.5, smoothing: 0.08 }),
      ...ASSIST_DEFAULT,
    },
  },
  {
    id: 'drag',
    label: 'ドラッグ（地平線で読む人。画面が傾いていなければ同じ）',
    tweaks: {
      direct: true,
      hands: hands({ curve: 1, deadzone: 0, noise: 0.05 }),
      ...ASSIST_DEFAULT,
    },
  },
  {
    id: 'drag-screen',
    label: '（参考）画面の傾きで戻さない場合の、画面に見える所を押さえる人',
    tweaks: {
      direct: 'screen',
      hands: hands({ curve: 1, deadzone: 0, noise: 0.05 }),
      ...ASSIST_DEFAULT,
    },
  },
  {
    id: 'drag-screen-comp',
    label: 'ドラッグ（画面に見える所を押さえる人・本番: 画面の傾きで戻す）',
    tweaks: {
      direct: 'screen-comp',
      hands: hands({ curve: 1, deadzone: 0, noise: 0.05 }),
      ...ASSIST_DEFAULT,
    },
  },
];

const SETS = {
  tune: EXPERIMENTS,
  decompose: DECOMPOSE,
  compare: STICK_COMPARE,
  assist: ASSIST_COMPARE,
  tilt: TILT_COMPARE,
} as const;
export type ExperimentSet = keyof typeof SETS;

const pct = (n: number, d: number): string => (d > 0 ? `${((100 * n) / d).toFixed(1)}%` : '-');

/** 実験を走らせて表にする。only を渡せばその id だけ */
export function runExperiments(
  missions: readonly string[],
  seeds: number,
  progress: (line: string) => void,
  only: readonly string[] = [],
  set: ExperimentSet = 'tune',
): string {
  const role = findRole('human');
  const rows: string[] = [
    [
      '実験',
      ...missions.map((m) => `${m} 成功`),
      '命中率',
      '照準の円',
      'ずれ≤5°',
      '画面外',
      '行き過ぎ/分',
      '往復/分',
      '端',
      '見失い→戻す秒',
      '撃墜',
      '撃墜まで秒（中央値）',
      '被撃墜',
      '戦域外',
      '墜落',
    ].join(' | '),
  ];
  for (const ex of SETS[set]) {
    if (only.length > 0 && !only.includes(ex.id)) continue;
    const total = new Totals();
    const ok: number[] = [];
    for (const m of missions) {
      let n = 0;
      for (let seed = 1; seed <= seeds; seed++) {
        const box: { a: ControlAnalyzer | null } = { a: null };
        const r = flyMission(m, seed, role, {
          tweaks: ex.tweaks,
          analyzer: (play) =>
            (box.a = new TimedAnalyzer(play, { aspect: 2.16, assist: ex.tweaks.assist })),
        });
        if (r.status === 'success') n++;
        if (box.a) total.merge(box.a.finish());
      }
      ok.push(n);
    }
    const t = total;
    const quick = t.quickReversals.pitch + t.quickReversals.roll;
    rows.push(
      [
        `${ex.id}（${ex.label}）`,
        ...ok.map((n) => `${n}/${seeds}`),
        pct(t.hits, t.shots),
        pct(t.fire.inHitCone, t.fireSteps),
        pct((t.angleBins[0] ?? 0) + (t.angleBins[1] ?? 0), t.engagedSteps),
        pct(t.offScreenSteps, t.engagedSteps),
        (t.crossings / Math.max(1e-9, t.nearSteps / 3600)).toFixed(1),
        (quick / Math.max(1e-9, t.aliveMinutes)).toFixed(1),
        pct(t.stick.edge, t.aliveSteps),
        median(t.reacquire).toFixed(1),
        String(t.kills),
        t.killSeconds.length > 0 ? median(t.killSeconds).toFixed(1) : '-',
        String(t.downs),
        pct(t.outsideSteps, t.aliveSteps),
        String(t.crashes),
      ].join(' | '),
    );
    progress(rows[rows.length - 1] ?? '');
  }
  return rows.join('\n');
}
