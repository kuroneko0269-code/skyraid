// 10-7a: ネフィルガの見た目の試作の前後を撮る（?dev=k2shot のときだけ読む遅延チャンク。遊ぶ人は読まない）。
// scripts/kaiju2-visual-pilot.js がソロのレイドに出てから window.__k2shot.shoot(<場面>, <天候>) を呼ぶ: 止めて、怪獣の状態を
// 場面の形に置き（撮るためだけ。この飛行の結果は使わない）、決まった構図のカメラで 2 倍の大きさで描いて縮め、webp にして返す
import type { PerspectiveCamera } from 'three';
import { forcePerch } from '../ai/kaiju2-perch';
import {
  KAIJU2_SHOTS,
  KAIJU2_SHOT_IMAGE,
  KAIJU2_SHOT_WEATHERS,
  type Kaiju2ShotDef,
  type Kaiju2ShotOffset,
} from '../data/kaiju2-shots';
import { updateKaiju2Pose } from '../entities/kaiju2/kaiju2-pose';
import type { SkyKaiju } from '../entities/kaiju2/sky-kaiju';
import type { Kaiju2Raid } from '../missions/kaiju2-raid';
import type { RenderPipeline } from '../render/pipeline';

export interface Kaiju2ShotParts {
  readonly raid: () => Kaiju2Raid;
  readonly camera: PerspectiveCamera;
  readonly pipeline: RenderPipeline;
  readonly weather: { set(id: string, instant?: boolean): void };
  readonly game: { transition(to: 'pause'): boolean };
  /** 演出（粒・破片）を止めている間も進める 1 フレームの秒数（null で普段どおり） */
  readonly setFxClock: (dt: number | null) => void;
  /** 計測: 怪獣（体・雷球・粒）を描くか・形を動かす時間の中央値（ms） */
  readonly setKaijuShown: (shown: boolean) => void;
  readonly updateMs: () => number;
  /** 10-7a の後: 演出の場面を始める（登場の寄り・咆哮など。前の版には無いので省略可） */
  readonly cue?: (scene: Kaiju2ShotDef['id']) => void;
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

interface Base {
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
}

function place(camera: PerspectiveCamera, k: SkyKaiju, s: Kaiju2ShotDef): void {
  const len = Math.hypot(k.forward.x, k.forward.z) || 1;
  const fx = k.forward.x / len;
  const fz = k.forward.z / len;
  const at = (o: Kaiju2ShotOffset) => ({
    x: k.position.x + fx * o.forward - fz * o.right,
    y: k.position.y + o.up,
    z: k.position.z + fz * o.forward + fx * o.right,
  });
  const c = at(s.camera);
  const l = at(s.look);
  camera.position.set(c.x, c.y, c.z);
  camera.up.set(0, 1, 0);
  camera.fov = s.fov;
  camera.lookAt(l.x, l.y, l.z);
  camera.updateProjectionMatrix();
}

/** 怪獣を場面の形に置く（状態・姿勢・壊れた部位・倒した後） */
function arrange(raid: Kaiju2Raid, base: Base, s: Kaiju2ShotDef): void {
  const k = raid.body;
  k.position.x = base.x;
  k.position.y = base.y;
  k.position.z = base.z;
  k.forward.x = base.fx;
  k.forward.y = 0;
  k.forward.z = base.fz;
  for (const key of ['wingL', 'wingR', 'head', 'tail'] as const) k.broken[key] = false;
  k.flinch = 0;
  raid.dead = false;
  raid.deadTime = 0;
  raid.flash = 0;
  for (const o of k.orbs) o.active = false;
  k.setHpRatio(s.id === 'defeat' ? 0 : s.id === 'break' ? 0.55 : 1);
  if (s.id === 'orbs') {
    k.setState('windup', 'orbs');
  } else if (s.id === 'perch') {
    if (forcePerch(k)) {
      k.position.x = k.perch.x;
      k.position.y = k.perch.y;
      k.position.z = k.perch.z;
    }
    k.setState('perched', null);
  } else {
    k.setState('cruise', null);
  }
  // 姿勢の値を 3 秒ぶん寄せる（判定は進めない）
  for (let i = 0; i < 180; i++) updateKaiju2Pose(k, 1 / 60);
  if (s.id === 'orbs') k.stateTime = 1.4;
  if (s.id === 'defeat') {
    raid.dead = true;
    raid.deadTime = 1.6;
    Object.assign(k.pose, { wingFold: 0.75, flapAmount: 0, neckPitch: -0.7, throatGlow: 0 });
    const down = 0.6;
    k.forward.x = base.fx * Math.cos(down);
    k.forward.z = base.fz * Math.cos(down);
    k.forward.y = -Math.sin(down);
  }
  if (s.id === 'break') Object.assign(k.pose, { flapAmount: 0.3, neckPitch: -0.4 });
  k.pose.flapPhase = s.flapPhase;
  k.bank = k.prevBank = s.bank;
  k.beginStep();
}

export function linkKaiju2Shot(p: Kaiju2ShotParts): void {
  let base: Base | null = null;
  const api = {
    scenes: KAIJU2_SHOTS.map((s) => s.id),
    weathers: KAIJU2_SHOT_WEATHERS.map((w) => w.id),
    elapsed: (): number => p.raid().elapsed,
    /** 撮って webp の data URL を返す */
    shoot: async (sceneId: string, weatherId: string): Promise<string> => {
      const s = KAIJU2_SHOTS.find((x) => x.id === sceneId);
      const w = KAIJU2_SHOT_WEATHERS.find((x) => x.id === weatherId);
      if (!s || !w) throw new Error(`unknown shot: ${sceneId} ${weatherId}`);
      const raid = p.raid();
      const k = raid.body;
      p.game.transition('pause');
      if (!base) {
        const len = Math.hypot(k.forward.x, k.forward.z) || 1;
        base = { ...k.position, fx: k.forward.x / len, fz: k.forward.z / len };
      }
      p.weather.set(w.weather, true);
      p.setFxClock(1 / 30);
      // 壊れる前の形を一度描いてから壊す（破片の演出は壊れた瞬間に出る）
      if (s.id === 'break') {
        arrange(raid, base, { ...s, id: 'orbit' });
        place(p.camera, k, s);
        await frames(3);
      }
      arrange(raid, base, s);
      place(p.camera, k, s);
      p.cue?.(s.id);
      // 天候・影・粒が落ち着くまで描く（破片は 0.5 秒ぶん飛ぶ）
      await frames(s.id === 'break' ? 15 : 24);
      place(p.camera, k, s);
      const big = p.pipeline.capture(KAIJU2_SHOT_IMAGE.width * 2, KAIJU2_SHOT_IMAGE.height * 2);
      p.setFxClock(null);
      const out = document.createElement('canvas');
      out.width = KAIJU2_SHOT_IMAGE.width;
      out.height = KAIJU2_SHOT_IMAGE.height;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(big, 0, 0, out.width, out.height);
      return out.toDataURL('image/webp', KAIJU2_SHOT_IMAGE.quality);
    },
    /**
     * 怪獣の描画の重さ: 今の構図で、怪獣を出して / 隠して 描いた差（draw call・三角形・描く時間の中央値 ms。gl.finish まで）。
     * 時間は描く間だけ（クラウドはソフトウェアの描画なので目安）。update は怪獣の形を動かす時間（ms・中央値）
     */
    measure: async (sceneId: string): Promise<Record<string, number>> => {
      const s = KAIJU2_SHOTS.find((x) => x.id === sceneId);
      if (!s) throw new Error(`unknown shot: ${sceneId}`);
      const raid = p.raid();
      place(p.camera, raid.body, s);
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
  Object.assign(window, { __k2shot: api });
}
