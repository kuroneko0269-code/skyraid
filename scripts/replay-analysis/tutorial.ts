// 9-5c チュートリアルの通し（`--tutorial`）: 模擬の人・初心者役が、6 方式（方向へ倒す・傾き・ドラッグ・ピッチとロール・キーボード・パッド）で
// 飛ぶ 8 章を通せるか（tests/tutorial-bot.ts のボット。打ち切り 300 秒）。章 × 方式ごとに、達成した回数・かかった秒（中央値・最大）・出たヒント
import { TUTORIAL_FLIGHT_CHAPTERS } from '../../src/data/tutorial';
import {
  TUTORIAL_BOT_MODES,
  runTutorialChapter,
  type TutorialBotRole,
} from '../../tests/tutorial-bot';
import { median } from './totals';

export function runTutorialMatrix(
  seeds: number,
  progress: (line: string) => void,
  roles: readonly TutorialBotRole[] = ['human', 'beginner'],
): string {
  const out = [
    '役 | 章 | ' + TUTORIAL_BOT_MODES.join(' | '),
    '--- | --- | ' + TUTORIAL_BOT_MODES.map(() => '---').join(' | '),
  ];
  const hints = new Map<string, number>();
  for (const role of roles)
    for (const c of TUTORIAL_FLIGHT_CHAPTERS) {
      const cells: string[] = [];
      for (const mode of TUTORIAL_BOT_MODES) {
        let ok = 0;
        const times: number[] = [];
        for (let seed = 1; seed <= seeds; seed++) {
          const r = runTutorialChapter(c, mode, role, seed, 300);
          if (r.status === 'success') {
            ok++;
            times.push(r.seconds);
          }
          for (const [k, n] of Object.entries(r.hints)) hints.set(k, (hints.get(k) ?? 0) + n);
        }
        cells.push(
          times.length > 0
            ? `${ok}/${seeds}・${median(times).toFixed(0)} 秒（最大 ${Math.max(...times).toFixed(0)}）`
            : `${ok}/${seeds}`,
        );
      }
      out.push([role === 'human' ? '模擬の人' : '初心者役', c, ...cells].join(' | '));
      progress(out[out.length - 1] ?? '');
    }
  out.push(
    '',
    `出たヒント（全部の回の合計）: ${[...hints.entries()].map(([k, n]) => `${k} ${n}`).join('・')}`,
  );
  return out.join('\n');
}
