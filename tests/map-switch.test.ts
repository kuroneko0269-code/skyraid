// 6-4: マップの切り替え（地形・街を捨てて作り直す。メモリが増え続けない）
import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import { ISLAND_MAP } from '../src/data/maps';
import { QUALITY_PRESETS } from '../src/data/quality';
import { ActiveMap } from '../src/missions/active-map';
import { World } from '../src/render/scene';
import { createHeightField } from '../src/render/terrain-height';

// Node の API（@types/node は入れていないので、使う分だけ型を書く）
interface NodeV8 {
  setFlagsFromString(flags: string): void;
}
interface NodeVm {
  runInNewContext(code: string): unknown;
}
interface NodeProcess {
  memoryUsage(): { heapUsed: number; arrayBuffers: number };
}

async function nodeModule<T>(name: string): Promise<T> {
  return (await import(/* @vite-ignore */ name)) as T;
}

/** 明示の GC（--expose_gc を後から有効にして、新しいコンテキストから gc を取り出す） */
async function gcFn(): Promise<() => void> {
  const v8 = await nodeModule<NodeV8>('node:v8');
  const vm = await nodeModule<NodeVm>('node:vm');
  v8.setFlagsFromString('--expose_gc');
  return vm.runInNewContext('gc') as () => void;
}

/** ヒープ + ArrayBuffer（ジオメトリ・テクスチャの配列）の MB */
function usedMb(): number {
  const proc = (globalThis as unknown as { process: NodeProcess }).process;
  const m = proc.memoryUsage();
  return (m.heapUsed + m.arrayBuffers) / 1024 / 1024;
}

describe('マップの切り替え', () => {
  it('切り替えるたびに作り直し、同じマップなら建て直すだけ。島の高さ関数は使い回す', () => {
    const map = new ActiveMap();
    const changes: string[] = [];
    map.onChange((m) => changes.push(m.def.id));
    expect(map.use('island')).toBe(false);
    expect(map.use('harbor')).toBe(true);
    const first = map.current;
    first.buildings?.destroy(0, 'kaiju');
    expect(map.use('harbor')).toBe(false);
    expect(first.buildings?.intactRatio).toBe(1);
    expect(map.use('island')).toBe(true);
    expect(map.buildings).toBeNull();
    expect(map.ground(0, 0)).toBeCloseTo(createHeightField().getGroundHeight(0, 0), 6);
    expect(changes).toEqual(['harbor', 'island']);
    expect(map.current.field).toBe(new ActiveMap(ISLAND_MAP).current.field);
  });

  it('描画（地形のチャンク・水深と海岸線のテクスチャ・木・街）も作り直し、街は港湾都市だけ', () => {
    const scene = new Scene();
    const world = new World(scene, 5000);
    world.applyQuality(QUALITY_PRESETS.medium);
    const map = new ActiveMap();
    map.onChange((m) => {
      world.setMap(m);
    });
    map.use('harbor');
    world.update({ x: 0, y: 400, z: 2500 }, 0.1);
    expect(world.city).not.toBeNull();
    expect(scene.children).toContain(world.city?.object);
    expect(world.city?.instanceCount).toBeGreaterThan(QUALITY_PRESETS.medium.cityBuildings - 1);
    const city = world.city;
    map.use('island');
    expect(world.city).toBeNull();
    expect(scene.children).not.toContain(city?.object);
    expect(world.terrain.field).toBe(map.current.field);
  });

  it('10 回切り替えても（描画を含めて）メモリの増加は 50MB 以内', async () => {
    const gc = await gcFn();
    const world = new World(new Scene(), 5000);
    world.applyQuality(QUALITY_PRESETS.medium);
    const map = new ActiveMap();
    map.onChange((m) => {
      world.setMap(m);
    });
    const visit = (id: string): void => {
      map.use(id);
      // 地形のブロックを作らせる（カメラを街の上と島の上へ）
      world.update({ x: 0, y: 300, z: 1000 }, 0.1);
      world.update({ x: 1500, y: 300, z: -1500 }, 0.2);
    };
    visit('harbor');
    visit('island');
    gc();
    const before = usedMb();
    for (let i = 0; i < 10; i++) visit(i % 2 === 0 ? 'harbor' : 'island');
    gc();
    const after = usedMb();
    expect(after - before).toBeLessThan(50);
  }, 120000);
});
