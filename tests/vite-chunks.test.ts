import { describe, expect, it } from 'vitest';
import { CHUNK_RULES } from '../scripts/vite-chunks';

/** 起動時のモジュールが入る組（上から最初に合うもの） */
const groupOf = (id: string): string | undefined => CHUNK_RULES.find((r) => r.test.test(id))?.name;

describe('チャンクの分け方（8-2）', () => {
  it('three の本体と WebGL の部分・examples を分ける', () => {
    expect(groupOf('/r/node_modules/three/build/three.core.js')).toBe('three-core');
    expect(groupOf('/r/node_modules/three/build/three.module.js')).toBe('three-webgl');
    expect(groupOf('/r/node_modules/three/examples/jsm/postprocessing/Pass.js')).toBe(
      'three-webgl',
    );
  });

  it('判定（Three.js に依存しない層）・描画・画面に分ける', () => {
    expect(groupOf('/r/src/flight/flight-model.ts')).toBe('game');
    expect(groupOf('/r/src/missions/game-play.ts')).toBe('game');
    expect(groupOf('/r/src/replay/recorder.ts')).toBe('game');
    expect(groupOf('/r/src/render/scene.ts')).toBe('render');
    expect(groupOf('/r/src/ui/screens.ts')).toBe('app');
    expect(groupOf('/r/src/main.ts')).toBe('app');
  });

  it('起動時の CSS はどこから読んでも app（1 ファイル・並びを変えない）', () => {
    expect(groupOf('/r/src/render/x.css')).toBe('app');
    expect(groupOf('/r/src/ui/theme.css')).toBe('app');
  });
});
