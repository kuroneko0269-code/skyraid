// ブランド素材の受け口（4-10）: public/brand/logo.png があればタイトルのロゴを画像にする
import { BRAND_ASSETS } from '../data/app';

export type LogoKind = 'image' | 'text';

/** 画像が読めるかを調べる関数（DOM では probeImage。テストでは差し替える） */
export type ImageProbe = (url: string) => Promise<boolean>;

/**
 * ロゴを画像にするかテキストにするか。読めれば画像、読めない・調べられない（例外）ならテキスト。
 * Cloudflare Pages は無いファイルに index.html を返すことがあるので、「200 が返る」ではなく「画像として読める」で決める
 */
export async function resolveLogo(probe: ImageProbe, url: string = logoUrl()): Promise<LogoKind> {
  try {
    return (await probe(url)) ? 'image' : 'text';
  } catch {
    return 'text';
  }
}

/** ロゴ画像の URL（Vite の base を前に付ける） */
export function logoUrl(): string {
  return `${import.meta.env.BASE_URL}${BRAND_ASSETS.logo}`;
}

/** 画像として読み込めて大きさがあれば true */
export const probeImage: ImageProbe = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve(img.naturalWidth > 0);
    };
    img.onerror = () => {
      resolve(false);
    };
    img.src = url;
  });
