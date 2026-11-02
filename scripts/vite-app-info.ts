// 7-D: 「情報」画面の中身をビルド時に作る仮想モジュール virtual:app-info（版・BGM の有無）と virtual:app-licenses
// （使用ライブラリのライセンス一覧。8-2 で分けた: 本文が大きいので、情報画面を開いたときに読むチャンクにだけ入れる）。
// 版は package.json の version。ライセンスは package.json の dependencies から依存をたどり（実行時に配信される JS に入るもの）、
// Service Worker（vite-plugin-pwa の generateSW）が埋め込む workbox を足す。各パッケージの package.json と LICENSE を読む
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { Plugin } from 'vite';

export interface LicenseEntry {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly url: string;
  readonly text: string;
}

const VIRTUAL_ID = 'virtual:app-info';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const LICENSES_ID = 'virtual:app-licenses';
const RESOLVED_LICENSES_ID = `\0${LICENSES_ID}`;
/** Service Worker に入る workbox（generateSW の出力が import するもの） */
export const SW_PACKAGES = [
  'workbox-core',
  'workbox-precaching',
  'workbox-routing',
  'workbox-strategies',
] as const;

type Json = Record<string, unknown>;

function isJson(v: unknown): v is Json {
  return typeof v === 'object' && v !== null;
}

function readJson(path: string): Json {
  const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return isJson(v) ? v : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 依存のディレクトリ（入れ子の node_modules を先に探す） */
function packageDir(root: string, from: string, name: string): string | null {
  for (const base of [from, root]) {
    const dir = `${base}/node_modules/${name}`;
    if (existsSync(`${dir}/package.json`)) return dir;
  }
  return null;
}

function licenseText(dir: string): string {
  const file = readdirSync(dir).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
  return file ? readFileSync(`${dir}/${file}`, 'utf8').trim() : '';
}

function repoUrl(pkg: Json): string {
  const repo = pkg.repository;
  const raw = isJson(repo) ? str(repo.url) : str(repo);
  const home = str(pkg.homepage);
  const url = (home || raw).replace(/^git\+/, '').replace(/\.git$/, '');
  return url.startsWith('http') ? url : '';
}

function deps(pkg: Json): string[] {
  const d = pkg.dependencies;
  return isJson(d) ? Object.keys(d) : [];
}

/** package.json の dependencies（と SW の workbox）から推移的にたどったライセンスの一覧（名前順） */
export function collectLicenses(root: string): LicenseEntry[] {
  const seen = new Map<string, LicenseEntry>();
  const queue: { name: string; from: string }[] = [
    ...deps(readJson(`${root}/package.json`)),
    ...SW_PACKAGES,
  ].map((name) => ({ name, from: root }));
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || seen.has(next.name)) continue;
    const dir = packageDir(root, next.from, next.name);
    if (!dir) continue;
    const pkg = readJson(`${dir}/package.json`);
    const lic = pkg.license;
    seen.set(next.name, {
      name: next.name,
      version: str(pkg.version),
      license: isJson(lic) ? str(lic.type) : str(lic),
      url: repoUrl(pkg),
      text: licenseText(dir),
    });
    for (const d of deps(pkg)) queue.push({ name: d, from: dir });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * public/ の下のフォルダにあるファイル（8-1: BGM の受け口。無いファイルを読みに行って console に 404 を出さないよう、
 * ビルド時にあるものだけを渡す）。開発サーバーでは起動時の中身（足したら再起動）
 */
export function listPublic(root: string, dir: string): string[] {
  const path = `${root}/public/${dir}`;
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((f) => !f.startsWith('.'))
    .map((f) => `${dir}/${f}`)
    .sort();
}

export function appInfo(root: string): Plugin {
  return {
    name: 'skyraid-app-info',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      return id === LICENSES_ID ? RESOLVED_LICENSES_ID : null;
    },
    load(id) {
      if (id === RESOLVED_LICENSES_ID)
        return `export const LICENSES = ${JSON.stringify(collectLicenses(root))};`;
      if (id !== RESOLVED_ID) return null;
      const version = str(readJson(`${root}/package.json`).version);
      return [
        `export const APP_VERSION = ${JSON.stringify(version)};`,
        `export const BGM_FILES = ${JSON.stringify(listPublic(root, 'audio/bgm'))};`,
      ].join('\n');
    },
  };
}
