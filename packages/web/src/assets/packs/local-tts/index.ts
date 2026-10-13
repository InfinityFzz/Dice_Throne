/**
 * local-tts 包 —— 从本地 TTS 模组（创意工坊 908560170，英文官方脚本版）导入的真实素材。
 *
 * - manifest.json 与 images/ 均由 scripts/import-tts-assets.ts 产出：
 *   manifest.json 入库（小 JSON，是「真实素材清单」），images/ 真图不入库（见根 .gitignore）。
 * - 本文件不含 Vite 专属 API；浏览器侧用 vite.ts 包装（import.meta.glob 产 URL 表），
 *   测试侧直接注入伪造 URL 表 —— 同一套 resolve 逻辑两端复用。
 * - 未确认（provisional）条目使用临时 id（tts-<hero>-card-NN），UI 永远不会按这种 id
 *   查询，所以它们只是等待人工确认的「库存」，不会泄漏进内容层。
 */
import type { AssetPack, AssetKind, AssetRef } from '../../types.js';

export interface LocalTtsManifestEntry {
  readonly logicalId: string;
  readonly kind: AssetKind;
  /** 相对 images/ 的文件路径，如 pyromancer/cards/card-07.webp */
  readonly file: string;
  readonly width: number;
  readonly height: number;
  /** true = 已确认对应 shared 内容层 id；false = 临时 id（待人工确认） */
  readonly confirmed: boolean;
  /** 导入来源备注（图集 URL 指纹、切片索引等，便于人工核对） */
  readonly source?: string;
}

export interface LocalTtsManifest {
  readonly pack: 'local-tts';
  readonly modWorkshopId: 908560170;
  readonly generatedAt: string;
  readonly entries: readonly LocalTtsManifestEntry[];
}

/** 索引结构：`${kind}:${logicalId}` → entry */
export function indexManifest(manifest: LocalTtsManifest): Map<string, LocalTtsManifestEntry> {
  const map = new Map<string, LocalTtsManifestEntry>();
  for (const e of manifest.entries) {
    map.set(`${e.kind}:${e.logicalId}`, e);
    if (e.confirmed === false && !map.has(`${e.kind}:${e.logicalId}`)) {
      map.set(`${e.kind}:${e.logicalId}`, e);
    }
  }
  return map;
}

/**
 * 工厂：urls = 「images/ 相对路径 → 可访问 URL」。
 * 缺文件（图未导入）→ resolve 返回 null → manifest 走 fallback 链兜底。
 */
export function createLocalTtsPack(
  manifest: LocalTtsManifest,
  urls: ReadonlyMap<string, string>,
): AssetPack {
  const index = indexManifest(manifest);
  return {
    id: 'local-tts',
    label: '本地 TTS 导入',
    kind: 'file',
    resolve: (logicalId: string, kind: AssetKind): AssetRef | null => {
      const entry = index.get(`${kind}:${logicalId}`);
      if (!entry) return null;
      const url = urls.get(entry.file);
      if (!url) return null; // 真图缺失（未导入或被 gitignore 清掉）
      return {
        logicalId,
        kind,
        pack: 'local-tts',
        url,
        source: 'file',
        substituted: false,
        width: entry.width,
        height: entry.height,
      };
    },
  };
}
