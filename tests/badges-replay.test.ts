// 勲章（9-10）のリプレイ: 本番と同じ手順で記録しながら勲章を数え、別の世界で再生しながら数えると、同じ勲章・同じ数えになる。
// 数える役は判定の状態を変えない（記録の最後の状態ハッシュが再生と一致する）
import { describe, expect, it } from 'vitest';
import { createCombatInput } from '../src/combat/combat-input';
import { createControls } from '../src/entities/aircraft';
import { judgeSortie, SortieWatch } from '../src/missions/badges/sortie';
import { tallySortie } from '../src/missions/badges/tally';
import { ReplayPlayer } from '../src/replay/player';
import { ReplayRecorder } from '../src/replay/recorder';
import { applyFrame, captureFrame, simHash, startFromHeader, stepWorld } from '../src/replay/sim';
import { FRAME_CHANNELS, type ReplayData, type ReplayStart } from '../src/replay/types';
import { BASE_START, createWorld, ScriptedPilot, type TestWorld } from './replay-helpers';

const DT = 1 / 60;
const FLAGS = FRAME_CHANNELS.indexOf('flags');

/** 宙返り（全開・AB で引き続ける）→ 背面へ転がして保つ → 人に似せた操作（撃つ・ミサイル） */
function scripted(
  seconds: number,
): (
  t: number,
  c: ReturnType<typeof createControls>,
  i: ReturnType<typeof createCombatInput>,
) => void {
  const pilot = new ScriptedPilot(11);
  return (t, c, i) => {
    const s = t * DT;
    c.throttle = 1;
    c.yaw = 0;
    if (s < 1) {
      c.pitch = 0;
      c.roll = 0;
    } else if (s < 7.5) {
      c.pitch = 1;
      c.roll = 0;
      c.afterburner = true;
    } else if (s < 8.4) {
      c.pitch = 0;
      c.roll = 1;
      c.afterburner = false;
    } else if (s < seconds - 20) {
      c.pitch = 0;
      c.roll = 0;
    } else {
      pilot.next();
      Object.assign(c, pilot.controls);
      Object.assign(i, pilot.input);
    }
  };
}

function recordWithBadges(
  w: TestWorld,
  start: ReplayStart,
  seconds: number,
): { data: ReplayData; watch: SortieWatch; hash: string } {
  startFromHeader(w, start);
  // オートレベルなし（記録の印 1 で再生にも入る）
  w.play.session.aircraft.flight.options.autoLevel = false;
  const rec = new ReplayRecorder();
  rec.begin(start, {
    title: 't',
    pilotName: 'p',
    date: '2026-11-05T00:00:00Z',
    gameVersion: '1.0.14',
    startHash: simHash(w),
  });
  const watch = new SortieWatch();
  // 9-10b: 本番（ui/badge-link.ts）と同じく、落とした対象と武器を受ける
  w.play.session.combat.killFeed.on((target, weapon) => {
    watch.kill(target, weapon);
  });
  watch.begin(w.play);
  const controls = createControls();
  const input = createCombatInput();
  const drive = scripted(seconds);
  const steps = Math.round(seconds * 60);
  for (let t = 0; t < steps; t++) {
    drive(t, controls, input);
    const f = captureFrame(rec.frame, controls, input, w.play.session);
    applyFrame(f, w.controls, input, w.play.session);
    rec.push(f);
    stepWorld(w.play, w.buildings(), w.controls, input, DT);
    watch.step(w.play, DT, (f.flags & 8) !== 0);
  }
  const data = rec.finish(null);
  if (!data) throw new Error('no data');
  return { data, watch, hash: simHash(w) };
}

function replayWithBadges(data: ReplayData): { watch: SortieWatch; hash: string; w: TestWorld } {
  const w = createWorld();
  const player = new ReplayPlayer(w, data, w.controls);
  const watch = new SortieWatch();
  w.play.session.combat.killFeed.on((target, weapon) => {
    watch.kill(target, weapon);
  });
  player.onStep = (tick) => {
    const flags = data.channels[FLAGS]?.[tick - 1] ?? 0;
    watch.step(w.play, DT, (flags & 8) !== 0);
  };
  player.begin();
  watch.begin(w.play);
  while (player.step());
  return { watch, hash: simHash(w), w };
}

describe('勲章のリプレイ', () => {
  it('フリーフライト（敵あり）: 記録と再生で同じ操縦の勲章・撃墜の数え・判定', () => {
    const start: ReplayStart = { ...BASE_START, seed: 2026 };
    const live = createWorld();
    const rec = recordWithBadges(live, start, 40);
    expect(rec.watch.maneuvers.done.has('loop')).toBe(true);
    const assist = true;
    const liveIds = judgeSortie(start, live.play, rec.watch, assist);
    const liveTally = tallySortie(start, live.play, rec.watch, 'hard');
    expect(liveTally.stats.sortie).toBe(1);
    expect(liveTally.stats['sortie.m.free']).toBe(1);
    expect(liveTally.stats['mv.loop']).toBeGreaterThanOrEqual(1);
    expect(liveTally.stats.time).toBeGreaterThan(30);
    expect(liveTally.stats.dist).toBeGreaterThan(1000);
    // 2 回再生して同じ
    for (let k = 0; k < 2; k++) {
      const r = replayWithBadges(rec.data);
      expect(r.hash).toBe(rec.hash);
      expect([...r.watch.maneuvers.done].sort()).toEqual([...rec.watch.maneuvers.done].sort());
      expect(r.watch.fighterKills).toBe(rec.watch.fighterKills);
      expect(r.watch.missileUsed).toBe(rec.watch.missileUsed);
      expect(judgeSortie(rec.data.header, r.w.play, r.watch, assist).sort()).toEqual(
        [...liveIds].sort(),
      );
      // 9-10b: 通算の記録に足す分（撃墜の武器・種類・飛行時間・距離・機動の回数）も同じ
      expect(tallySortie(rec.data.header, r.w.play, r.watch, 'hard')).toEqual(liveTally);
    }
  });

  it('数える役は判定を変えない（数えずに記録したときと同じ状態ハッシュ）', () => {
    const start: ReplayStart = { ...BASE_START, seed: 77 };
    const a = recordWithBadges(createWorld(), start, 12);
    const r = replayWithBadges(a.data);
    // 再生は数える役を付けて進めた。付けずに進めた記録の世界と同じ
    const plain = createWorld();
    const player = new ReplayPlayer(plain, a.data, plain.controls);
    player.begin();
    while (player.step());
    expect(simHash(plain)).toBe(r.hash);
    expect(r.hash).toBe(a.hash);
  });
});
