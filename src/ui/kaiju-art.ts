// 9-10d: レイドの怪獣選びの画像を、ゲームの描画で撮る（?dev=kaiju-art のときだけ読む遅延チャンク。遊ぶ人は読まない）。
// scripts/render-kaiju-art.js がソロのレイドに出てから window.__kaijuArt.shoot(<怪獣>) を呼ぶ: 天候を場面に合わせ、
// 怪獣の基準点からの決まった位置にカメラを置き（src/data/kaiju-profiles.ts の scene）、2 倍の大きさで描いて縮め、webp にして返す
import type { PerspectiveCamera } from 'three';
import { findKaijuProfile, KAIJU_ART, type KaijuArtScene } from '../data/kaiju-profiles';
import type { GamePlay } from '../missions/game-play';
import type { FlightFrame } from '../render/flight-frame';
import type { RenderPipeline } from '../render/pipeline';
import { raidKaijuHooks, type ArtAnchor } from '../missions/raid-kaiju-hooks';

export interface KaijuArtParts {
  readonly frame: FlightFrame;
  readonly camera: PerspectiveCamera;
  readonly pipeline: RenderPipeline;
  readonly play: GamePlay;
  readonly weather: { set(id: string, instant?: boolean): void };
  readonly game: { transition(to: 'pause'): boolean };
}

type Anchor = ArtAnchor;

/**
 * 今の怪獣の基準点と向き（ヴォルガスは足元。ほかの怪獣は登録した基準点: ネフィルガは体の中心。10-2 で
 * src/missions/raid-kaiju-hooks.ts の artAnchor に）。いなければ null
 */
function anchorOf(id: string, play: GamePlay): Anchor | null {
  if (id === 'vorgas') {
    const k = play.session.props.kaiju;
    return { ...k.feet, fx: -Math.sin(k.heading), fz: -Math.cos(k.heading) };
  }
  return raidKaijuHooks(id)?.artAnchor?.() ?? null;
}

function place(camera: PerspectiveCamera, a: Anchor, s: KaijuArtScene): void {
  // 右 = 前を上から見て時計回りに 90°
  const rx = -a.fz;
  const rz = a.fx;
  const at = (o: KaijuArtScene['camera']) => ({
    x: a.x + a.fx * o.forward + rx * o.right,
    y: a.y + o.up,
    z: a.z + a.fz * o.forward + rz * o.right,
  });
  const c = at(s.camera);
  const l = at(s.look);
  camera.position.set(c.x, c.y, c.z);
  camera.up.set(0, 1, 0);
  camera.fov = s.fov;
  camera.lookAt(l.x, l.y, l.z);
  camera.updateProjectionMatrix();
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

export function linkKaijuArt(p: KaijuArtParts): void {
  const api = {
    /** 飛行の経過秒（ミッションの時計） */
    elapsed: (): number => p.play.runner?.elapsed ?? 0,
    /** 場面の待ち秒 */
    waitSeconds: (id: string): number => findKaijuProfile(id)?.scene.waitSeconds ?? 0,
    /** 撮って webp の data URL を返す */
    shoot: async (id: string): Promise<string> => {
      const profile = findKaijuProfile(id);
      if (!profile) throw new Error(`unknown kaiju: ${id}`);
      const s = profile.scene;
      p.weather.set(s.weather, true);
      const fov = p.camera.fov;
      p.frame.cameraOverride = {
        update: () => {
          const a = anchorOf(id, p.play);
          if (!a) return false;
          place(p.camera, a, s);
          return true;
        },
      };
      // 天候・影・カメラが落ち着くまで数フレーム描く
      await frames(20);
      // 止めてから撮る（ネフィルガの形は描画の後に動かすので、動いている間は 1 フレーム遅れて写る）
      p.game.transition('pause');
      await frames(8);
      const a = anchorOf(id, p.play);
      if (!a) throw new Error(`kaiju not found: ${id}`);
      place(p.camera, a, s);
      // 2 倍の大きさで描いて縮める（縁のギザギザを減らす）
      const big = p.pipeline.capture(KAIJU_ART.size * 2, KAIJU_ART.size * 2);
      const out = document.createElement('canvas');
      out.width = out.height = KAIJU_ART.size;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(big, 0, 0, out.width, out.height);
      p.frame.cameraOverride = null;
      p.camera.fov = fov;
      p.camera.updateProjectionMatrix();
      return out.toDataURL('image/webp', KAIJU_ART.quality);
    },
  };
  Object.assign(window, { __kaijuArt: api });
}
