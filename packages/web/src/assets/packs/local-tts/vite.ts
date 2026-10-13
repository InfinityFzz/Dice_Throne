/**
 * local-tts 包 · Vite 侧装配 —— 用 import.meta.glob 把 images/ 下所有 webp 变成 URL 表。
 * 仅浏览器构建使用；单测请直接用 index.ts 的 createLocalTtsPack 注入伪造 URL 表。
 */
import manifestJson from './manifest.json' with { type: 'json' };
import type { LocalTtsManifest } from './index.js';
import { createLocalTtsPack } from './index.js';

const modules = import.meta.glob<string>('./images/**/*.webp', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const urls = new Map<string, string>();
for (const [key, url] of Object.entries(modules)) {
  // key 形如 './images/pyromancer/cards/card-07.webp' → 归一为 manifest 里的相对路径
  urls.set(key.replace(/^\.\//, '').replace(/^images\//, ''), url);
}

export const localTtsPack = createLocalTtsPack(manifestJson as unknown as LocalTtsManifest, urls);
