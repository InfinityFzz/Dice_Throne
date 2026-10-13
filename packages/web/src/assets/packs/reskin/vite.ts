/**
 * reskin 包 · Vite 侧装配 —— 与 local-tts 同构，但目录独立（预留换皮通道）。
 * 目前 manifest.json 为空壳：任何 reskin 请求都会落到 fallback 链（local-tts → placeholder）。
 * 换皮流程：把新图放进 images/、按 catalog 逻辑 id 填 manifest.json，无需改任何代码。
 */
import manifestJson from './manifest.json' with { type: 'json' };
import type { LocalTtsManifest } from '../local-tts/index.js';
import { createLocalTtsPack } from '../local-tts/index.js';

const modules = import.meta.glob<string>('./images/**/*.webp', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const urls = new Map<string, string>();
for (const [key, url] of Object.entries(modules)) {
  urls.set(key.replace(/^\.\//, '').replace(/^images\//, ''), url);
}

/** reskin 与 local-tts 共用条目结构，仅 pack id 不同（覆盖 id 字段）。 */
export const reskinPack = {
  ...createLocalTtsPack(manifestJson as unknown as LocalTtsManifest, urls),
  id: 'reskin' as const,
  label: '换皮资源包',
};
