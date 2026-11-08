// 10-4a: メカ怪獣ゴウライの確かめる場（?dev=gourai）: URL の値・フリーフライトで出てリプレイで同じ・付けないときは今までと同じ・
// 撃てる・遅延読み込み（起動と本体の量を増やさない。量そのものは npm run perf と ui-audit --release の起動の量の上限 320KB）
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDevFlags } from '../src/core/debug-flags';
import { GOURAI_PARTS } from '../src/data/gourai';
import { attachGouraiDev, parseGouraiOptions } from '../src/missions/gourai-dev';
import { attachFreeExtra, freeExtrasOf } from '../src/missions/free-extra';
import { simHash } from '../src/replay/sim';
import { BASE_START, createWorld, record, replay } from './replay-helpers';

const mk = () => {
  const w = createWorld();
  const dev = attachGouraiDev(w.play, parseGouraiOptions(''), {
    ground: w.map.ordnanceGround,
    map: () => w.map.def,
  });
  return { w, dev };
};

describe('メカ怪獣ゴウライの確かめる場（10-4a）', () => {
  it('?dev=gourai: URL の値・フリーフライトで出てリプレイで同じ・付けていないときは今までと同じ', () => {
    expect(parseDevFlags('?dev=gourai').has('gourai')).toBe(true);
    expect(parseGouraiOptions('?grhp=30&grbreak=gunL,hull,armor,foo,exhaustR&grroute=bay')).toEqual(
      {
        hpPercent: 30,
        broken: ['gunL', 'exhaustR'],
        bay: true,
      },
    );
    const plainWorld = createWorld();
    const plain = record(plainWorld, BASE_START, { seconds: 3, hashes: true }).hashes;
    const a = mk();
    const rec = record(a.w, BASE_START, { seconds: 30, hashes: true });
    expect(a.dev.flying).toBe(true);
    expect(a.dev.kaiju.elapsed).toBeGreaterThan(29);
    expect(a.dev.kaiju.fired.gun + a.dev.kaiju.fired.missile).toBeGreaterThan(0);
    expect(rec.hashes[2]).not.toBe(plain[2]);
    const b = mk();
    const back = replay(b.w, rec.data);
    expect(back.hashes).toEqual(rec.hashes);
    expect(simHash(b.w)).toBe(simHash(a.w));
    // 外すと今までと同じ
    const w3 = createWorld();
    attachGouraiDev(w3.play, parseGouraiOptions(''), {
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

  it('?dev=gourai: 撃てる。前の装甲は ×0.2、核は閉じている間は撃てない、砲台を壊すと撃てる物から外れる。倒れない', () => {
    const { w, dev } = mk();
    record(w, BASE_START, { seconds: 5 });
    const of = (id: (typeof GOURAI_PARTS)[number]) =>
      dev.partTargets.find((t) => GOURAI_PARTS[t.partIndex] === id);
    const armor = of('armor');
    const core = of('core');
    const gun = of('gunL');
    expect(armor?.active).toBe(true);
    expect(core?.active).toBe(false);
    const hp = dev.kaiju.parts.hp;
    armor?.applyDamage(100);
    expect(dev.kaiju.parts.hp).toBeCloseTo(hp - 20, 5);
    gun?.applyDamage(1e6);
    expect(gun?.active).toBe(false);
    expect(dev.kaiju.turretsAlive).toBe(5);
    expect(dev.partTargets.every((t) => !t.applyDamage(1e9))).toBe(true);
    expect(dev.kaiju.parts.hp).toBeGreaterThan(0);
  });

  it('遅延読み込み: ゴウライの判定・形・表示は入口（gourai-link.ts）の import() からだけ読む（起動・本体の量を増やさない）', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.ts$/.test(e.name)) files.push(p);
      }
    };
    walk('src');
    // 10-5a: ゼノリス（遅延チャンク）もゴウライの形の部品（primitives）を使う
    const isGourai = (f: string): boolean => /gourai|xenolith/.test(f.replace(/\\/g, '/'));
    for (const f of files) {
      if (isGourai(f)) continue;
      const src = readFileSync(f, 'utf8');
      const imports = [...src.matchAll(/^import[^;]*?from '([^']+)'/gms)].map((m) => m[1] ?? '');
      const gourai = imports.filter((i) => /gourai/.test(i));
      // 本体が静的に読んでよいのは入口だけ
      if (gourai.length > 0)
        expect([f, gourai]).toEqual([join('src', 'game-app.ts'), ['./ui/gourai-link']]);
    }
    const link = readFileSync(join('src', 'ui', 'gourai-link.ts'), 'utf8');
    expect(
      // 型だけの import（import type）は消えるので数えない
      [...link.matchAll(/^import(?! type)[^;]*?from '([^']+)'/gms)]
        .map((m) => m[1])
        .filter((i) => i?.includes('gourai')),
      // 10-4b: 起動時に読むのはミッションの登録（名前と数値の参照だけ）
    ).toEqual(['../missions/gourai-mission']);
    const mission = readFileSync(join('src', 'missions', 'gourai-mission.ts'), 'utf8');
    expect(
      [...mission.matchAll(/^import[^;]*?from '([^']+)'/gms)]
        .map((m) => m[1])
        .filter((i) => i?.includes('gourai')),
    ).toEqual([]);
    expect(link).toContain("import('./gourai-runtime')");
  });
});
