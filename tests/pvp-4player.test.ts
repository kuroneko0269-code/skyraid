import { describe, expect, it } from 'vitest';
import { NOBODY } from '../src/combat/pvp-arena';
import { bestPlayer, standings, teamTotals } from '../src/combat/pvp-rules';
import { PVP_CONFIG } from '../src/data/pvp';
import type { EventMsg, ScoreEntry } from '../src/net/protocol';
import { getGroundHeight } from '../src/render/terrain-height';
import { pursue } from './pvp-bots';
import { startMatch, type Match } from './pvp-match';

/** 帯域の上限（4 機で 8KB/s） */
const BANDWIDTH_LIMIT = 8 * 1000;

/** ボット: 決めた相手を追い、機首が向いたら機銃、さらに近くで向いたらときどきミサイル */
function bots(m: Match, targetOf: (id: number, k: number) => number): (k: number) => void {
  return (k) => {
    for (let id = 0; id < 4; id++) {
      const own = m.owns[id];
      const t = m.host.arena.fighters.get(targetOf(id, k));
      const ctl = m.controls[id];
      const cmb = m.combat[id];
      if (!own || !t || !ctl || !cmb) continue;
      const angle = pursue(ctl, own, t);
      const p = own.state.position;
      const d = Math.hypot(t.position.x - p.x, t.position.y - p.y, t.position.z - p.z);
      cmb.fire = angle < 3 && d < 1500;
      if (angle < 6 && d < 2500 && (k + id * 37) % 300 === 0) {
        cmb.missile = true;
        cmb.locked = true;
        cmb.targetId = t.id;
      }
    }
  };
}

function count(events: readonly EventMsg[], f: (e: EventMsg) => boolean): number {
  return events.filter(f).length;
}

describe('4 人の対戦（5-4。インメモリ transport・遅延 40ms + 揺らぎ・ロス 2%）', () => {
  it('4 人が 5 分撃ち合う: 帯域は 8KB/s 以下、判定は全員で一致、リザルトの順位が正しい', async () => {
    const m = await startMatch(
      3,
      { latencyMs: 40, jitterMs: 15, lossRate: 0.02 },
      { timeLimitSeconds: 300, scoreLimit: 99 },
      PVP_CONFIG.countdownSeconds,
      getGroundHeight,
    );
    const seconds = 300 + PVP_CONFIG.countdownSeconds;
    // 2 組の撃ち合い（互いに追う）。75 秒ごとに組み合わせを変える（0-1・2-3 → 0-2・1-3 → 0-3・1-2）
    const pairs = [
      [1, 0, 3, 2],
      [2, 3, 0, 1],
      [3, 2, 1, 0],
    ];
    await m.run(
      seconds + 1,
      bots(m, (id, k) => pairs[Math.floor(k / (75 * 60)) % 3]?.[id] ?? 0),
    );
    // 流しきる
    await m.run(1);
    const net = m.lobby.net;
    const hostId = m.lobby.host.transportId;
    // 時間切れで終わり、全員に最後の成績（over）が届いている
    expect(m.host.finished).toBe(true);
    expect(m.host.match.ended).toBe('time');
    const final = m.scores[0];
    if (!final) throw new Error('score');
    expect(final.over).toBe(true);
    for (let id = 1; id < 4; id++) {
      expect(m.scores[id]?.over).toBe(true);
      expect(m.scores[id]?.players).toEqual(final.players);
    }
    expect(m.lobby.host.players).toHaveLength(4);
    // 帯域: ホスト → 各クライアント、各クライアント → ホスト（再送のない経路も含めた送信バイト）
    for (const c of m.lobby.clients) {
      const down = (net.bytes.get(`${hostId}>${c.transportId}`) ?? 0) / seconds;
      const up = (net.bytes.get(`${c.transportId}>${hostId}`) ?? 0) / seconds;
      expect(down).toBeLessThanOrEqual(BANDWIDTH_LIMIT);
      expect(up).toBeLessThanOrEqual(BANDWIDTH_LIMIT);
      // 状態だけで 4 機 155 バイト × 15Hz ≈ 2.3KB/s（測れていることの確認）
      expect(down).toBeGreaterThan(2000);
    }
    // 判定: ホストの撃墜・被撃墜・命中は、各クライアントに届いた event の数と一致する
    const players: ScoreEntry[] = final.players;
    let kills = 0;
    let hits = 0;
    for (const s of players) {
      kills += s.kills;
      hits += s.hits;
      for (let viewer = 0; viewer < 4; viewer++) {
        const ev = m.events[viewer] ?? [];
        expect(count(ev, (e) => e.kind === 'kill' && e.a === s.id && e.b !== s.id)).toBe(s.kills);
        expect(count(ev, (e) => e.kind === 'kill' && e.b === s.id)).toBe(s.deaths);
        expect(count(ev, (e) => e.kind === 'hit' && e.a === s.id)).toBe(s.hits);
      }
      expect(s.bestStreak).toBeLessThanOrEqual(s.kills);
      expect(s.hits).toBeLessThanOrEqual(s.shots);
    }
    // 撃ち合いになっている（命中・撃墜がある）
    expect(hits).toBeGreaterThan(50);
    expect(kills).toBeGreaterThan(0);
    // 被撃墜の合計 = 撃墜の合計 + 墜落
    const crashes = count(m.events[0] ?? [], (e) => e.kind === 'kill' && e.a === NOBODY);
    expect(players.reduce((n, s) => n + s.deaths, 0)).toBe(kills + crashes);
    // リザルトの順位: 撃墜数の多い順 → 被撃墜数の少ない順、同じなら同順位
    const ranked = standings(players);
    for (let i = 1; i < ranked.length; i++) {
      const a = ranked[i - 1];
      const b = ranked[i];
      if (!a || !b) continue;
      const ok =
        a.score.kills > b.score.kills ||
        (a.score.kills === b.score.kills && a.score.deaths <= b.score.deaths);
      expect(ok).toBe(true);
      const tie = a.score.kills === b.score.kills && a.score.deaths === b.score.deaths;
      expect(b.rank).toBe(tie ? a.rank : i + 1);
    }
    expect(ranked[0]?.rank).toBe(1);
    const best = bestPlayer(players);
    expect(best?.kills).toBe(Math.max(...players.map((s) => s.kills)));
  }, 180_000);

  it('チーム戦（2 対 2）を 90 秒: 味方への命中・撃墜は 0、チームの合計は各自の撃墜数の和', async () => {
    const m = await startMatch(
      3,
      { latencyMs: 40, jitterMs: 10 },
      { mode: 'team', timeLimitSeconds: 90, scoreLimit: 99 },
      0,
      getGroundHeight,
      23,
    );
    const teamOf = (id: number): number | undefined =>
      m.lobby.host.players.find((p) => p.id === id)?.team;
    expect([0, 1, 2, 3].map(teamOf)).toEqual([0, 1, 0, 1]);
    // わざと味方を追って撃つ（0 → 2、1 → 3 …）時間と、敵を追う時間を半分ずつ
    const friendly = bots(m, (id) => (id + 2) % 4);
    const enemy = bots(m, (id) => [1, 0, 3, 2][id] ?? 0);
    await m.run(45, friendly);
    const friendlyHits = count(m.events[0] ?? [], (e) => e.kind === 'hit');
    expect(friendlyHits).toBe(0);
    expect(m.host.arena.all.every((f) => f.hits === 0)).toBe(true);
    await m.run(47, enemy);
    const ev = m.events[1] ?? [];
    const sameTeam = (e: EventMsg): boolean =>
      e.a !== NOBODY && e.a !== e.b && teamOf(e.a) === teamOf(e.b);
    expect(count(ev, (e) => (e.kind === 'hit' || e.kind === 'kill') && sameTeam(e))).toBe(0);
    expect(count(ev, (e) => e.kind === 'hit')).toBeGreaterThan(0);
    const final = m.scores[1];
    if (!final) throw new Error('score');
    expect(final.over).toBe(true);
    const totals = teamTotals(final.players, teamOf);
    expect((totals.get(0) ?? 0) + (totals.get(1) ?? 0)).toBe(
      final.players.reduce((n, s) => n + s.kills, 0),
    );
  }, 120_000);
});
