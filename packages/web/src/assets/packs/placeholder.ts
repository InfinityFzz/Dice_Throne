/**
 * placeholder 包 —— 内置兜底包：永远 resolve 成功（程序化占位图）。
 * 只允许通过 manifest.registerPack 注册一次，不可覆盖。
 */
import type { AssetPack, AssetKind, AssetRef, ResolveOptions } from '../types.js';
import { ASSET_CATALOG } from '../catalog.js';
import { placeholderSpecFor, renderPlaceholder, KIND_DEFAULT_SIZE } from '../placeholder.js';

export function createPlaceholderPack(): AssetPack {
  const pack: AssetPack = {
    id: 'placeholder',
    label: '程序化占位',
    kind: 'generated',
    resolve: (logicalId: string, kind: AssetKind, opts?: ResolveOptions): AssetRef | null => {
      const entry = ASSET_CATALOG.find((e) => e.kind === kind && e.id === logicalId);
      if (!entry) return null; // manifest 层已在更早阶段拦未知 id；防御性返回 null
      const defaults = KIND_DEFAULT_SIZE[kind];
      const width = opts?.width ?? defaults.width;
      const height = opts?.height ?? defaults.height;
      return {
        logicalId,
        kind,
        pack: pack.id,
        url: renderPlaceholder(placeholderSpecFor(entry, { width, height })),
        source: 'generated',
        substituted: false,
        width,
        height,
      };
    },
  };
  return pack;
}
