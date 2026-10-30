// 影の縁のフィルタ（4-12b）: three r186 の PCF は 5 タップの Vogel ディスクを画素ごとのノイズ（interleaved gradient noise）で
// 回し、TAA で均す前提のディザになっている。このゲームは TAA を使わないので、縁が点の模様のまま残り、数テクセル幅の機体の影は
// 縁だけの点線に見えた。回転を画素によらず 0 にして、ハードウェアの PCF（タップごとに 2×2 の補間）でなめらかにぼかす。
// タップの数・描画パスは変えない（PCFSoftShadowMap は r186 で廃止され、指定しても PCF に戻される）
import { ShaderChunk } from 'three';

/** PCF のタップの回転（画素ごとのノイズ）。r186 の shadowmap_pars_fragment にある式 */
export const SHADOW_NOISE_ROTATION = 'interleavedGradientNoise( gl_FragCoord.xy ) * PI2';

/** シェーダーのソースの、画素ごとのタップの回転を 0 にする。置き換えた数も返す（three の更新で式が変わったら 0） */
export function removeShadowNoise(source: string): { source: string; replaced: number } {
  const parts = source.split(SHADOW_NOISE_ROTATION);
  return { source: parts.join('0.0'), replaced: parts.length - 1 };
}

let installed = false;

/** three の影のシェーダー部品を書き換える。マテリアルを最初にコンパイルする前（起動時）に 1 回呼ぶ */
export function installStableShadowFilter(): number {
  if (installed) return 0;
  installed = true;
  const r = removeShadowNoise(ShaderChunk.shadowmap_pars_fragment);
  ShaderChunk.shadowmap_pars_fragment = r.source;
  return r.replaced;
}
