// 10-7b: 怪獣の見た目の前後を同じ構図で撮る共通の仕組み（10-7a のネフィルガの kaiju2-shot.ts から共通にした。?dev=kshot の
// ときだけ読む遅延チャンク。遊ぶ人は読まない）。scripts/kaiju-visual-pilot.js がソロのレイドに出てから
// window.__kshot.shoot(<場面>, <天候>) を呼ぶ: 止めて、怪獣の状態を場面の形に置き（撮るためだけ。この飛行の結果は使わない）、
// 決まった構図のカメラで 2 倍の大きさで描いて縮め、webp にして返す。measure は怪獣を出して / 隠して描いた差（重さ）。
// 10-7f: art は怪獣選びの画像（scripts/render-kaiju-art.js。場面の形に置き、登録簿の構図で正方形に撮る）
import type { PerspectiveCamera } from 'three';
import type { KaijuOffset } from '../data/kaiju-look';
import type { RenderPipeline } from '../render/pipeline';

/** 場面（カメラと見る所は怪獣の基準点（体の中心と水平の向き）からの前・右・上 m） */
export interface KaijuShotDef {
  readonly id: string;
  readonly camera: KaijuOffset;
  readonly look: KaijuOffset;
  readonly fov: number;
}

export interface KaijuShotImage {
  readonly width: number;
  readonly height: number;
  readonly quality: number;
}

export interface KaijuShotParts<S extends KaijuShotDef> {
  readonly shots: readonly S[];
  readonly weathers: readonly { readonly id: string; readonly weather: string }[];
  readonly image: KaijuShotImage;
  /** 怪獣の基準点（体の中心と水平の前） */
  readonly subject: () => {
    readonly position: Readonly<{ x: number; y: number; z: number }>;
    readonly forward: Readonly<{ x: number; z: number }>;
  };
  /** レイドの経過（出てすぐを待つ）・今の位置と向き（基準の位置を決めるとき） */
  readonly elapsed: () => number;
  readonly where: () => Record<string, number>;
  /** 怪獣を場面の形に置く */
  readonly arrange: (s: S) => void;
  /** 場面の前に一度描いておく形（壊れる前など。無ければ null） */
  readonly preRoll?: (s: S) => S | null;
  /** 置いてから落ち着くまで描くフレームの数 */
  readonly settle: (s: S) => number;
  readonly camera: PerspectiveCamera;
  readonly pipeline: RenderPipeline;
  readonly weather: { set(id: string, instant?: boolean): void };
  readonly game: { transition(to: 'pause'): boolean };
  /** 演出（粒・破片）を止めている間も進める 1 フレームの秒数（null で普段どおり） */
  readonly setFxClock: (dt: number | null) => void;
  /** 計測: 怪獣（体・攻撃・粒）を描くか・形を動かす時間の中央値（ms） */
  readonly setKaijuShown: (shown: boolean) => void;
  readonly updateMs: () => number;
  /** 演出の場面を始める（登場の寄り・咆哮など） */
  readonly cue?: (scene: string) => void;
}

const frames = (n: number): Promise<void> =>
  new Promise((resolve) => {
    let left = n;
    const tick = (): void => {
      if (--left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

function place<S extends KaijuShotDef>(p: KaijuShotParts<S>, s: KaijuShotDef): void {
  const k = p.subject();
  const len = Math.hypot(k.forward.x, k.forward.z) || 1;
  const fx = k.forward.x / len;
  const fz = k.forward.z / len;
  const at = (o: KaijuOffset) => ({
    x: k.position.x + fx * o.forward - fz * o.right,
    y: k.position.y + o.up,
    z: k.position.z + fz * o.forward + fx * o.right,
  });
  const c = at(s.camera);
  const l = at(s.look);
  const camera = p.camera;
  camera.position.set(c.x, c.y, c.z);
  camera.up.set(0, 1, 0);
  camera.fov = s.fov;
  camera.lookAt(l.x, l.y, l.z);
  camera.updateProjectionMatrix();
}

/** 10-7f: 画像の構図（src/data/raid-kaiju.ts の KaijuArtScene と同じ形） */
export interface KaijuArtView {
  readonly shot: string;
  readonly weather: string;
  readonly camera: KaijuOffset;
  readonly look: KaijuOffset;
  readonly fov: number;
}

/** 怪獣を場面 s の形に置き、view の構図で撮る（止めて・天候を変えて・2 倍の大きさで描いて縮める） */
async function shootAs<S extends KaijuShotDef>(
  p: KaijuShotParts<S>,
  s: S,
  view: S,
  weather: string,
  I: KaijuShotImage,
): Promise<string> {
  p.game.transition('pause');
  p.weather.set(weather, true);
  p.setFxClock(1 / 30);
  const pre = p.preRoll?.(s) ?? null;
  if (pre) {
    p.arrange(pre);
    place(p, view);
    await frames(3);
  }
  p.arrange(s);
  place(p, view);
  p.cue?.(s.id);
  // 天候・影・粒が落ち着くまで描く
  await frames(p.settle(s));
  place(p, view);
  const big = p.pipeline.capture(I.width * 2, I.height * 2);
  p.setFxClock(null);
  const out = document.createElement('canvas');
  out.width = I.width;
  out.height = I.height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(big, 0, 0, out.width, out.height);
  return out.toDataURL('image/webp', I.quality);
}

export function linkKaijuShot<S extends KaijuShotDef>(p: KaijuShotParts<S>): void {
  const api = {
    scenes: p.shots.map((s) => s.id),
    weathers: p.weathers.map((w) => w.id),
    elapsed: (): number => p.elapsed(),
    where: () => p.where(),
    /** 撮って webp の data URL を返す */
    shoot: async (sceneId: string, weatherId: string): Promise<string> => {
      const s = p.shots.find((x) => x.id === sceneId);
      const w = p.weathers.find((x) => x.id === weatherId);
      if (!s || !w) throw new Error(`unknown shot: ${sceneId} ${weatherId}`);
      return shootAs(p, s, s, w.weather, p.image);
    },
    /**
     * 10-7f: レイドの怪獣選びの画像（scripts/render-kaiju-art.js）。怪獣を場面 v.shot の形に置き、天候 v.weather（天候の id）・
     * v のカメラ（場面と同じ基準点から）で、image の大きさ（正方形）に撮る
     */
    art: async (v: KaijuArtView, image: KaijuShotImage): Promise<string> => {
      const s = p.shots.find((x) => x.id === v.shot);
      if (!s) throw new Error(`unknown shot: ${v.shot}`);
      return shootAs(p, s, { ...s, camera: v.camera, look: v.look, fov: v.fov }, v.weather, image);
    },
    /**
     * 怪獣の描画の重さ: 今の構図で、怪獣を出して / 隠して 描いた差（draw call・三角形・描く時間の中央値 ms。gl.finish まで）。
     * 時間は描く間だけ（クラウドはソフトウェアの描画なので目安）。update は怪獣の形を動かす時間（ms・中央値）
     */
    measure: async (sceneId: string): Promise<Record<string, number>> => {
      const s = p.shots.find((x) => x.id === sceneId);
      if (!s) throw new Error(`unknown shot: ${sceneId}`);
      place(p, s);
      const run = (shown: boolean) => {
        p.setKaijuShown(shown);
        const times: number[] = [];
        for (let i = 0; i < 7; i++) {
          const t0 = performance.now();
          p.pipeline.render();
          p.pipeline.finish();
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        const st = p.pipeline.lastStats;
        return { calls: st.drawCalls, triangles: st.triangles, ms: times[3] ?? 0 };
      };
      await frames(2);
      const on = run(true);
      const off = run(false);
      p.setKaijuShown(true);
      return {
        calls: on.calls - off.calls,
        triangles: on.triangles - off.triangles,
        renderMs: on.ms - off.ms,
        frameMs: on.ms,
        updateMs: p.updateMs(),
      };
    },
  };
  Object.assign(window, { __kshot: api });
}
