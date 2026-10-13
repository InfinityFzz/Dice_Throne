/**
 * 资产 manifest —— 全项目唯一的「逻辑 id → 资产」解析入口（架构裁决，勿推翻）。
 *
 * - UI 只调 resolveAsset(logicalId, kind)，拿 AssetRef.url 直接用。
 * - 解析顺序 = fallback 链：默认 [当前激活包, 'placeholder']，可用 opts.chain 覆盖
 *   （末尾强制补 'placeholder'，保证永不返回 null、永不白屏）。
 * - 包只回答「我有没有」，兜底永远由本模块负责（链序唯一可控）。
 */
import { ASSET_CATALOG } from './catalog.js';
import type { AssetKind, AssetPack, AssetRef, CatalogEntry, PackId, ResolveOptions } from './types.js';
import { placeholderSpecFor, renderPlaceholder, KIND_DEFAULT_SIZE } from './placeholder.js';
import { createPlaceholderPack } from './packs/placeholder.js';

const packRegistry = new Map<PackId, AssetPack>();
let activePackId: PackId = 'placeholder';

registerPack(createPlaceholderPack());

// ── 包注册与切换 ─────────────────────────────────────────────────

export function registerPack(pack: AssetPack): void {
  if (pack.id === 'placeholder' && packRegistry.has('placeholder')) {
    throw new Error('manifest: placeholder 包是内置兜底，不允许覆盖注册');
  }
  packRegistry.set(pack.id, pack);
}

export function unregisterPack(id: PackId): void {
  if (id === 'placeholder') throw new Error('manifest: placeholder 包不允许注销');
  packRegistry.delete(id);
  if (activePackId === id) activePackId = 'placeholder';
}

export function listPacks(): readonly PackId[] {
  return [...packRegistry.keys()];
}

export function setActivePack(id: PackId): void {
  if (!packRegistry.has(id)) throw new Error(`manifest: 未注册的资源包 ${id}`);
  activePackId = id;
}

export function getActivePack(): PackId {
  return activePackId;
}

// ── catalog 查询 ─────────────────────────────────────────────────

export function getCatalogEntry(logicalId: string, kind: AssetKind): CatalogEntry | undefined {
  return ASSET_CATALOG.find((e) => e.kind === kind && e.id === logicalId);
}

/** 全部已知逻辑 id（kind 可选过滤）。UI 预热/测试断言用。 */
export function listCatalogIds(kind?: AssetKind): readonly { readonly kind: AssetKind; readonly id: string }[] {
  return ASSET_CATALOG
    .filter((e) => kind === undefined || e.kind === kind)
    .map((e) => ({ kind: e.kind, id: e.id }));
}

// ── 解析 ─────────────────────────────────────────────────────────

function buildChain(opts: ResolveOptions | undefined): readonly PackId[] {
  const requested = opts?.chain ?? [opts?.pack ?? activePackId];
  const chain: PackId[] = [];
  for (const id of requested) {
    if (!packRegistry.has(id)) throw new Error(`manifest: 未注册的资源包 ${id}`);
    if (!chain.includes(id)) chain.push(id);
  }
  if (!chain.includes('placeholder')) chain.push('placeholder');
  return chain;
}

/**
 * 解析逻辑 id → 资产引用。对未知 id（不在 catalog）抛错：
 * 逻辑 id 必须来自内容层或 catalog 声明的表现层 id，UI 拿错 id 是 bug，不应静默出占位图。
 */
export function resolveAsset(logicalId: string, kind: AssetKind, opts?: ResolveOptions): AssetRef {
  const entry = getCatalogEntry(logicalId, kind);
  if (!entry) throw new Error(`manifest: 未知逻辑 id "${kind}:${logicalId}"（不在 catalog，请检查 id 拼写或先跑 gen-asset-catalog）`);

  const chain = buildChain(opts);
  const requested = chain[0] ?? 'placeholder';
  const defaults = KIND_DEFAULT_SIZE[kind];
  const size = { width: opts?.width ?? defaults.width, height: opts?.height ?? defaults.height };
  const annotate = opts?.annotateMissing !== false && requested !== 'placeholder';

  let fallbackRef: AssetRef | null = null;
  for (const packId of chain) {
    const pack = packRegistry.get(packId);
    if (!pack) continue;
    const ref = pack.resolve(logicalId, kind, opts ?? {});
    if (!ref) continue;
    if (packId !== requested) {
      // 命中 fallback：若包给的是占位（如 placeholder 包），补上缺口标注
      if (packId === 'placeholder') {
        fallbackRef = {
          ...ref,
          url: renderPlaceholder(placeholderSpecFor(entry, size, annotate ? `缺图: ${requested}` : undefined)),
          substituted: true,
          pack: packId,
          logicalId,
          kind,
        };
        break;
      }
      return { ...ref, substituted: true };
    }
    return { ...ref, substituted: false };
  }
  // chain 末尾必有 placeholder 且必 resolve，正常不会走到这里；防御性兜底：
  if (fallbackRef) return fallbackRef;
  return {
    logicalId,
    kind,
    pack: 'placeholder',
    url: renderPlaceholder(placeholderSpecFor(entry, size)),
    source: 'generated',
    substituted: requested !== 'placeholder',
    width: size.width,
    height: size.height,
  };
}
