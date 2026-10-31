// 7-C: 起動直後の写しの書き戻し（7-B）の後に、runner・race・defense の今の値を購読者（HUD）へ知らせ直す。
// 知らせないと、防衛戦の後にレイド・レースへ移っても防衛戦の HUD が残っていた
import { describe, expect, it } from 'vitest';
import { StateSnapshot } from '../src/replay/state-walk';
import { simSkip } from '../src/replay/sim';
import { startDefenseSim } from './defense-bots';

describe('書き戻しの後の知らせ直し', () => {
  it('写しで defense が null に戻ったら、announceModes で null を知らせる', () => {
    const sim = startDefenseSim({ seed: 1 });
    const play = sim.play;
    const seen: (boolean | null)[] = [];
    // 防衛戦の前の写し（起動直後の写しの代わり）
    play.startFree();
    const pristine = StateSnapshot.take([play], simSkip(play));
    play.onDefenseChange((d) => seen.push(d !== null));
    const d = play.startDefense(sim.defense.map, 'normal');
    expect(play.defense).toBe(d);
    pristine.restore();
    expect(play.defense).toBeNull();
    // 書き戻しだけでは知らせない（startDefense の true だけ）
    expect(seen).toEqual([true]);
    play.announceModes();
    expect(seen).toEqual([true, false]);
  });
});
