// 10-3a: 白鯨アルビオンの確かめる場（?dev=albion）: URL の値・フリーフライトで出てリプレイで同じ・付けないときは今までと同じ・
// 撃てる・遅延読み込み（起動と本体の量を増やさない。量そのものは npm run perf の起動の量の上限 320KB）
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDevFlags } from '../src/core/debug-flags';
import { ALBION_PARTS } from '../src/data/albion';
import { attachAlbionDev, parseAlbionOptions } from '../src/missions/albion-dev';
import { attachFreeExtra, freeExtrasOf } from '../src/missions/free-extra';
import { simHash } from '../src/replay/sim';
import { BASE_START, createWorld, record, replay } from './replay-helpers';

describe('白鯨アルビオンの確かめる場（10-3a）', () => {
  it('?dev=albion: URL の値・フリーフライトで出てリプレイで同じ・付けていないときは今までと同じ', () => {
    expect(parseDevFlags('?dev=albion').has('albion')).toBe(true);
    expect(parseAlbionOptions('?abhp=40&abbreak=tail,body,foo,nestMid&abroute=bay')).toEqual({
      hpPercent: 40,
      broken: ['tail', 'nestMid'],
      bay: true,
    });
    const plainWorld = createWorld();
    const plain = record(plainWorld, BASE_START, { seconds: 3, hashes: true }).hashes;
    const mk = () => {
      const w = createWorld();
      const dev = attachAlbionDev(w.play, parseAlbionOptions(''), {
        ground: w.map.ordnanceGround,
        map: () => w.map.def,
      });
      return { w, dev };
    };
    const a = mk();
    const rec = record(a.w, BASE_START, { seconds: 25, hashes: true });
    expect(a.dev.flying).toBe(true);
    expect(a.dev.kaiju.elapsed).toBeGreaterThan(24);
    expect(a.dev.kaiju.swarm.spawned).toBeGreaterThan(0);
    expect(rec.hashes[2]).not.toBe(plain[2]);
    const b = mk();
    const back = replay(b.w, rec.data);
    expect(back.hashes).toEqual(rec.hashes);
    expect(simHash(b.w)).toBe(simHash(a.w));
    // 外すと今までと同じ
    const w3 = createWorld();
    attachAlbionDev(w3.play, parseAlbionOptions(''), {
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

  it('?dev=albion: 撃てる。部位に当てると体力が減り、子分は撃墜に数える。フリーフライトでは倒れない', () => {
    const w = createWorld();
    const dev = attachAlbionDev(w.play, parseAlbionOptions(''), {
      ground: w.map.ordnanceGround,
      map: () => w.map.def,
    });
    record(w, BASE_START, { seconds: 15 });
    const head = dev.partTargets.find((t) => ALBION_PARTS[t.partIndex] === 'head');
    expect(head?.active).toBe(true);
    const hp = dev.kaiju.parts.hp;
    head?.applyDamage(100);
    expect(dev.kaiju.parts.hp).toBeCloseTo(hp - 150, 5);
    expect(dev.partTargets.every((t) => !t.applyDamage(1e9))).toBe(true);
    expect(dev.kaiju.parts.hp).toBeGreaterThan(0);
    const idx = dev.minionTargets.findIndex((t) => t.active);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(dev.minionTargets[idx]?.applyDamage(500)).toBe(true);
    expect(dev.kaiju.swarm.kills).toBe(1);
  });

  it('遅延読み込み: アルビオンの判定・形・表示は入口（albion-link.ts）の import() からだけ読む（起動・本体の量を増やさない）', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.ts$/.test(e.name)) files.push(p);
      }
    };
    walk('src');
    // 10-4b: ゴウライの遅延チャンク（gourai-*）も体の当たり・弾き方・世界をアルビオンから借りる（本体ではない）
    // 10-5a: ゼノリス（遅延チャンク）もアルビオンの体の当たり・弾き方を使う
    const isAlbion = (f: string): boolean => /albion|gourai|xenolith/.test(f.replace(/\\/g, '/'));
    for (const f of files) {
      if (isAlbion(f)) continue;
      const src = readFileSync(f, 'utf8');
      const imports = [...src.matchAll(/^import[^;]*?from '([^']+)'/gms)].map((m) => m[1] ?? '');
      const albion = imports.filter((i) => /albion/.test(i));
      // 本体が静的に読んでよいのは入口だけ
      if (albion.length > 0)
        expect([f, albion]).toEqual([join('src', 'game-app.ts'), ['./ui/albion-link']]);
    }
    const link = readFileSync(join('src', 'ui', 'albion-link.ts'), 'utf8');
    expect(
      // 型だけの import（import type）は消えるので数えない
      [...link.matchAll(/^import(?! type)[^;]*?from '([^']+)'/gms)]
        .map((m) => m[1])
        .filter((i) => i?.includes('albion')),
      // 10-3b: 起動時に読むのはミッションの登録（名前と数値の参照だけ）
    ).toEqual(['../missions/albion-mission']);
    const mission = readFileSync(join('src', 'missions', 'albion-mission.ts'), 'utf8');
    expect(
      [...mission.matchAll(/^import[^;]*?from '([^']+)'/gms)]
        .map((m) => m[1])
        .filter((i) => i?.includes('albion')),
    ).toEqual([]);
    expect(link).toContain("import('./albion-runtime')");
  });
});
