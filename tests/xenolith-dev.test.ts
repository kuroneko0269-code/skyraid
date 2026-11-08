// 10-5a: UFO ゼノリスの確かめる場（?dev=xenolith）: URL の値・フリーフライトで出てリプレイで同じ・付けないときは今までと同じ・
// 撃てる（バリアの間は殻の中に効かない・発生器は効く）・体を通り抜けられない・遅延読み込み（起動と本体の量を増やさない。量そのものは
// npm run perf と ui-audit --release の起動の量の上限 320KB）・解放の条件（10-5b で登録簿に入れた）
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDevFlags } from '../src/core/debug-flags';
import { XENOLITH_PARTS } from '../src/data/xenolith';
import { RAID_KAIJU, XENOLITH_UNLOCK } from '../src/data/raid-kaiju';
import { attachXenolithDev, parseXenolithOptions } from '../src/missions/xenolith-dev';
import { attachFreeExtra, freeExtrasOf } from '../src/missions/free-extra';
import { raidUnlockState } from '../src/progression/raid-unlock';
import { simHash, stepWorld } from '../src/replay/sim';
import { createCombatInput } from '../src/combat/combat-input';
import { BASE_START, createWorld, record, replay } from './replay-helpers';

const mk = () => {
  const w = createWorld();
  const dev = attachXenolithDev(w.play, parseXenolithOptions(''), {
    ground: w.map.ordnanceGround,
    map: () => w.map.def,
  });
  return { w, dev };
};

describe('UFO ゼノリスの確かめる場（10-5a）', () => {
  it('?dev=xenolith: URL の値・フリーフライトで出てリプレイで同じ・付けていないときは今までと同じ', () => {
    expect(parseDevFlags('?dev=xenolith').has('xenolith')).toBe(true);
    expect(parseXenolithOptions('?xnhp=25&xnbreak=gen0,hull,foo,emitter3')).toEqual({
      hpPercent: 25,
      broken: ['gen0', 'emitter3'],
    });
    const plainWorld = createWorld();
    const plain = record(plainWorld, BASE_START, { seconds: 3, hashes: true }).hashes;
    const a = mk();
    const rec = record(a.w, BASE_START, { seconds: 40, hashes: true });
    expect(a.dev.flying).toBe(true);
    expect(a.dev.kaiju.elapsed).toBeGreaterThan(39);
    expect(a.dev.kaiju.warp.warps).toBeGreaterThan(0);
    expect(a.dev.kaiju.attacksUsed.sweep + a.dev.kaiju.attacksUsed.charged).toBeGreaterThan(0);
    expect(rec.hashes[2]).not.toBe(plain[2]);
    const b = mk();
    const back = replay(b.w, rec.data);
    expect(back.hashes).toEqual(rec.hashes);
    expect(simHash(b.w)).toBe(simHash(a.w));
    // 外すと今までと同じ
    const w3 = createWorld();
    attachXenolithDev(w3.play, parseXenolithOptions(''), {
      ground: w3.map.ordnanceGround,
      map: () => w3.map.def,
    });
    attachFreeExtra(w3.play, null);
    expect(freeExtrasOf(w3.play).length).toBe(0);
    expect(record(w3, BASE_START, { seconds: 3, hashes: true }).hashes).toEqual(plain);
    // ミッションを始めると止まる
    record(a.w, { ...BASE_START, mode: 'mission', missionId: 'training' }, { seconds: 1 });
    expect(a.dev.flying).toBe(false);
    expect(a.dev.active).toBe(false);
  });

  it('?dev=xenolith: 撃てる。バリアの間は殻の中に効かず、発生器は効く。壊れた発生器は撃てる物から外れる。倒れない', () => {
    const { w, dev } = mk();
    record(w, BASE_START, { seconds: 2 });
    const of = (id: (typeof XENOLITH_PARTS)[number]) =>
      dev.partTargets.find((t) => XENOLITH_PARTS[t.partIndex] === id);
    const dome = of('dome');
    const gen = of('gen0');
    expect(dev.kaiju.barrier.absorbs).toBe(true);
    const hp = dev.kaiju.parts.hp;
    dome?.applyDamage(100);
    expect(dev.kaiju.parts.hp).toBe(hp);
    gen?.applyDamage(1e6);
    expect(gen?.active).toBe(false);
    expect(dev.kaiju.brokenGens).toBe(1);
    expect(dev.kaiju.parts.hp).toBeLessThan(hp);
    dev.kaiju.barrier.phase = 'down';
    expect(dev.partTargets.every((t) => !t.applyDamage(1e9))).toBe(true);
    expect(dev.kaiju.parts.hp).toBeGreaterThan(0);
  });

  it('体は通り抜けられない（10-5b: 10-4c の扱い）: 自機をゼノリスの真ん中へ向けて飛ばすと、最大 HP の約 8 割のダメージ（弾かない・続けて当たらない）', () => {
    const { w, dev } = mk();
    record(w, BASE_START, { seconds: 1 });
    const k = dev.kaiju;
    const s = w.play.session;
    const a = s.aircraft;
    // 体の真横 150m・同じ高さに置き、体へ向ける（体が動いても当たるよう毎ステップ向け直す）
    const b = k.body.position;
    a.state.position.x = b.x + 150;
    a.state.position.y = b.y + 2;
    a.state.position.z = b.z;
    a.prevPosition.x = a.state.position.x;
    a.prevPosition.y = a.state.position.y;
    a.prevPosition.z = a.state.position.z;
    const before = s.player.hp;
    k.cooldown = 1e9;
    k.warpTimer = 1e9;
    k.orbsEnabled = false;
    for (let i = 0; i < 600 && dev.taken.body === 0; i++) {
      // 機首（−Z）を体へ向け直す（体も動く）
      const dx = k.body.position.x - a.state.position.x;
      const dy = k.body.position.y - a.state.position.y;
      const dz = k.body.position.z - a.state.position.z;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      // 方位（Y 軸）→ 仰角（X 軸）の順の回転
      const cy = Math.cos(yaw / 2);
      const sy = Math.sin(yaw / 2);
      const cp = Math.cos(pitch / 2);
      const sp = Math.sin(pitch / 2);
      a.state.orientation.w = cy * cp;
      a.state.orientation.x = cy * sp;
      a.state.orientation.y = sy * cp;
      a.state.orientation.z = -sy * sp;
      a.state.speed = 250;
      stepWorld(w.play, w.buildings(), w.controls, createCombatInput(), 1 / 60);
    }
    expect(dev.taken.body).toBe(1);
    expect(before - s.player.hp).toBeCloseTo(s.player.maxHp * 0.8, 0);
    // 通り抜ける間（続けて当たらない 1.5 秒）はもう当たらない
    for (let i = 0; i < 30; i++)
      stepWorld(w.play, w.buildings(), w.controls, createCombatInput(), 1 / 60);
    expect(dev.taken.body).toBe(1);
  });

  it('遅延読み込み: ゼノリスの判定・形・表示は入口（xenolith-link.ts）の import() からだけ読む（起動・本体の量を増やさない）', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.ts$/.test(e.name)) files.push(p);
      }
    };
    walk('src');
    const isXenolith = (f: string): boolean => /xenolith/.test(f.replace(/\\/g, '/'));
    for (const f of files) {
      if (isXenolith(f)) continue;
      const src = readFileSync(f, 'utf8');
      const imports = [...src.matchAll(/^import[^;]*?from '([^']+)'/gms)].map((m) => m[1] ?? '');
      const xen = imports.filter((i) => /xenolith/.test(i));
      // 本体が静的に読んでよいのは入口だけ
      if (xen.length > 0)
        expect([f, xen]).toEqual([join('src', 'game-app.ts'), ['./ui/xenolith-link']]);
    }
    const link = readFileSync(join('src', 'ui', 'xenolith-link.ts'), 'utf8');
    expect(
      // 型だけの import（import type）は消えるので数えない
      [...link.matchAll(/^import(?! type)[^;]*?from '([^']+)'/gms)]
        .map((m) => m[1])
        .filter((i) => i?.includes('xenolith')),
      // 10-5b: 起動時に読むのはミッションの登録（名前と数値の参照だけ）
    ).toEqual(['../missions/xenolith-mission']);
    const mission = readFileSync(join('src', 'missions', 'xenolith-mission.ts'), 'utf8');
    expect(
      [...mission.matchAll(/^import[^;]*?from '([^']+)'/gms)]
        .map((m) => m[1])
        .filter((i) => i?.includes('xenolith')),
    ).toEqual([]);
    expect(link).toContain("import('./xenolith-runtime')");
    // 10-5b で公開: プリキャッシュする（オフラインでも遊べる）
    expect(readFileSync('vite.config.ts', 'utf8')).not.toContain('xenolith-runtime');
  });

  it('解放の条件: ほかの 4 体のうち 2 体を通常でクリア（高難度は通常にも数える）。10-5b で登録簿の最後に入れた', () => {
    expect(RAID_KAIJU.at(-1)?.id).toBe('xenolith');
    expect(RAID_KAIJU.at(-1)?.unlock).toBe(XENOLITH_UNLOCK);
    expect(XENOLITH_UNLOCK).toEqual({
      kaiju: ['vorgas', 'nephirga', 'albion', 'gourai'],
      count: 2,
      difficulty: 'normal',
    });
    const def = { id: 'xenolith', unlock: XENOLITH_UNLOCK };
    const save = (best: Record<string, number>, wins: Record<string, number> = {}) => ({
      records: { raidBestMs: best },
      stats: { counts: wins },
    });
    type Save = Parameters<typeof raidUnlockState>[0];
    const st = (s: ReturnType<typeof save>) => raidUnlockState(s as unknown as Save, def, '');
    expect(st(save({})).unlocked).toBe(false);
    expect(st(save({ normal: 1 })).have).toBe(1);
    expect(st(save({ normal: 1, 'gourai:hard': 2 })).unlocked).toBe(true);
    expect(st(save({ hard: 1, 'nephirga:normal': 2 })).unlocked).toBe(true);
    expect(st(save({ 'albion:normal': 1 })).unlocked).toBe(false);
  });
});
