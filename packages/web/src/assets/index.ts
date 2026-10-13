/**
 * 资产层公共出口（浏览器侧 bootstrap）。
 *
 * UI 只 import 这里：
 *   import { resolveAsset, setActivePack, listCatalogIds } from './assets/index.js';
 *
 * 单测不 import 本文件（Vite 专属 API 在 vite.ts 里），直接用 manifest.ts + 伪造包。
 */
import { registerPack, setActivePack } from './manifest.js';
import { localTtsPack } from './packs/local-tts/vite.js';
import { reskinPack } from './packs/reskin/vite.js';

let wired = false;

/** 注册真实素材包并激活。默认激活 local-tts（缺图自动落到 placeholder，不白屏）。 */
export function bootstrapAssets(active: 'local-tts' | 'reskin' = 'local-tts'): void {
  if (!wired) {
    registerPack(localTtsPack);
    registerPack(reskinPack);
    wired = true;
  }
  setActivePack(active);
}

export { resolveAsset, setActivePack, getActivePack, listPacks, listCatalogIds, getCatalogEntry } from './manifest.js';
export { ASSET_CATALOG } from './catalog.js';
export type { AssetRef, AssetKind, PackId } from './types.js';
