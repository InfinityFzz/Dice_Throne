# reskin 换皮预留包

这是未来重皮主题化（reskin）的预留目录。结构约定与 `../local-tts/` 完全一致：

```
reskin/
  manifest.json          # 逻辑 id → 相对 images/ 路径（confirmed: true，id 必须命中 catalog）
  images/<hero>/<kind>/… # 真实换皮素材（不入库，见根 .gitignore）
  vite.ts                # Vite 装配（已就绪，manifest 有条目即生效）
```

换皮三步（零代码改动）：
1. 把新素材按 `<hero>/<kind>/<name>.webp` 放进 `images/`；
2. 在 `manifest.json` 的 `entries` 里登记 `{ logicalId, kind, file, width, height, confirmed: true }`，
   `logicalId` 必须来自 catalog（`scripts/gen-asset-catalog.ts --check` 会拦截发明 id）；
3. 运行时 `setActivePack('reskin')` 或 `resolveAsset(id, kind, { pack: 'reskin' })`。

兜底链：reskin 缺图 → local-tts → placeholder（`resolveAsset` 的 `opts.chain` 可覆盖，末尾强制 placeholder）。
