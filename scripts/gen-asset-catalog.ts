/**
 * gen-asset-catalog.ts —— 资产目录生成器 + id 对应 lint（守门脚本）。
 *
 * 职责（架构裁决，见 packages/web/src/assets/types.ts 头注）：
 * 1. 从 packages/shared 内容层派生全部逻辑 id（heroPanel / abilityIcon / dieFace / statusIcon / card），
 *    生成 packages/web/src/assets/catalog.ts（唯一从内容层到资产层的桥，运行时不 import shared）。
 * 2. `--check` 模式：
 *    a) 重新生成并与已提交的 catalog.ts 逐字节比对（过期即失败）；
 *    b) 孤立 id 检查：catalog 里任何 derived id 必须能从 shared 派生；
 *    c) 遗漏 id 检查：shared 派生出的每个 id 必须出现在 catalog；
 *    d) local-tts/reskin 包 manifest 校验：confirmed 条目的 logicalId 必须命中 catalog，
 *       未确认条目必须符合临时 id 方案且 confirmed=false（不允许发明 id 混进内容层）。
 *
 * 用法：
 *   node --import tsx scripts/gen-asset-catalog.ts           # 重新生成 catalog.ts
 *   node --import tsx scripts/gen-asset-catalog.ts --check   # CI 守门（不写盘）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  BARBARIAN,
  PYROMANCER,
  GUNSLINGER,
  SHADOWTHIEF,
  COMMON_CARDS,
  COMMON_STATUSES,
  type HeroDef,
  type CardDef,
} from '../packages/shared/src/index.js';
import type { AssetKind, CardVisualKind, CatalogEntry } from '../packages/web/src/assets/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = join(ROOT, 'packages/web/src/assets/catalog.ts');
const LOCAL_TTS_MANIFEST = join(ROOT, 'packages/web/src/assets/packs/local-tts/manifest.json');
const RESKIN_MANIFEST = join(ROOT, 'packages/web/src/assets/packs/reskin/manifest.json');

const HEROES: readonly HeroDef[] = [BARBARIAN, PYROMANCER, GUNSLINGER, SHADOWTHIEF];

/** 展示名 → shared 卡牌 kind（结构与 types.ts 的 CardVisualKind 对齐） */
function cardVisualKind(kind: CardDef['kind']): CardVisualKind {
  return kind; // 字面量集合一致：upgrade | mainPhase | rollPhase | instant
}

/** 确定性色相：FNV-1a 哈希 → 0..359。同一 id 永远同色，占位图跨次构建稳定。 */
function hueOf(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 360);
}

interface Draft extends Omit<CatalogEntry, 'hue'> {
  hue?: number;
}

function buildDraft(): Draft[] {
  const out: Draft[] = [];
  const push = (e: Draft): void => { out.push(e); };

  // 纯表现层：桌面背景（不参与内容 id 校验）
  push({ key: 'background:table', kind: 'background', id: 'table', label: '对战桌面', sublabel: '表现层', derived: false });

  for (const hero of HEROES) {
    push({
      key: `heroPanel:${hero.id}`, kind: 'heroPanel', id: hero.id,
      label: hero.name, sublabel: `HP ${hero.startHp} · 骰×${hero.diceCount}`,
      derived: true, heroId: hero.id,
      slots: hero.abilities.map((a) => ({ id: a.id, label: a.name, kind: a.kind, tierCount: a.tiers.length })),
    });
    for (const ability of hero.abilities) {
      push({
        key: `abilityIcon:${ability.id}`, kind: 'abilityIcon', id: ability.id,
        label: ability.name, sublabel: hero.name,
        derived: true, heroId: hero.id, abilityKind: ability.kind, tierCount: ability.tiers.length,
      });
    }
    for (const face of hero.dieFaces) {
      const id = `${hero.id}:face:${face.value}`;
      push({
        key: `dieFace:${id}`, kind: 'dieFace', id,
        label: `骰面 ${face.value}`, sublabel: face.symbols.join('+') || '—',
        derived: true, heroId: hero.id, dieValue: face.value, dieSymbols: face.symbols,
      });
    }
    for (const card of hero.deck) {
      if (card.defId.startsWith('common:')) continue; // common 卡统一在循环外登记，避免重复且不归属英雄
      push({
        key: `card:${card.defId}`, kind: 'card', id: card.defId,
        label: card.name, sublabel: `${card.costCp} CP`,
        derived: true, heroId: hero.id, cardKind: cardVisualKind(card.kind),
        costCp: card.costCp, tier: card.tier,
        ownerId: card.targetAbilityId,
      });
    }
  }
  for (const status of COMMON_STATUSES) {
    push({
      key: `statusIcon:${status.id}`, kind: 'statusIcon', id: status.id,
      label: status.name, sublabel: status.persistent ? '持续' : '临时',
      derived: true, polarity: status.polarity, stackLimit: status.stackLimit,
    });
  }
  // common 卡没有所属英雄：ownerId 留空，heroId 不设
  for (const card of COMMON_CARDS) {
    push({
      key: `card:${card.defId}`, kind: 'card', id: card.defId,
      label: card.name, sublabel: `${card.costCp} CP`,
      derived: true, cardKind: cardVisualKind(card.kind), costCp: card.costCp,
    });
  }
  return out;
}

function finalize(draft: Draft[]): CatalogEntry[] {
  const seen = new Set<string>();
  const out: CatalogEntry[] = [];
  for (const d of draft) {
    if (seen.has(d.key)) throw new Error(`catalog: 重复 key ${d.key}`);
    seen.add(d.key);
    out.push(Object.freeze({ ...d, hue: hueOf(d.key) }) as CatalogEntry);
  }
  return out;
}

function renderCatalog(entries: readonly CatalogEntry[]): string {
  const body = entries
    .map((e) => {
      const fields: string[] = [
        `key: ${JSON.stringify(e.key)}`,
        `kind: ${JSON.stringify(e.kind)}`,
        `id: ${JSON.stringify(e.id)}`,
        `label: ${JSON.stringify(e.label)}`,
        `sublabel: ${JSON.stringify(e.sublabel)}`,
        `hue: ${e.hue}`,
        `derived: ${e.derived}`,
      ];
      if (e.ownerId !== undefined) fields.push(`ownerId: ${JSON.stringify(e.ownerId)}`);
      if (e.heroId !== undefined) fields.push(`heroId: ${JSON.stringify(e.heroId)}`);
      if (e.cardKind !== undefined) fields.push(`cardKind: ${JSON.stringify(e.cardKind)}`);
      if (e.costCp !== undefined) fields.push(`costCp: ${e.costCp}`);
      if (e.tier !== undefined) fields.push(`tier: ${e.tier}`);
      if (e.abilityKind !== undefined) fields.push(`abilityKind: ${JSON.stringify(e.abilityKind)}`);
      if (e.dieValue !== undefined) fields.push(`dieValue: ${e.dieValue}`);
      if (e.dieSymbols !== undefined) fields.push(`dieSymbols: [${e.dieSymbols.map((s) => JSON.stringify(s)).join(', ')}]`);
      if (e.polarity !== undefined) fields.push(`polarity: ${JSON.stringify(e.polarity)}`);
      if (e.stackLimit !== undefined) fields.push(`stackLimit: ${e.stackLimit}`);
      if (e.slots !== undefined) {
        fields.push(`slots: [${e.slots.map((s) => `{ id: ${JSON.stringify(s.id)}, label: ${JSON.stringify(s.label)}, kind: ${JSON.stringify(s.kind)}, tierCount: ${s.tierCount} }`).join(', ')}]`);
      }
      return `  { ${fields.join(', ')} },`;
    })
    .join('\n');
  return `/**
 * ⚠️ 本文件由 scripts/gen-asset-catalog.ts 生成 —— 勿手改。
 * 重新生成：node --import tsx scripts/gen-asset-catalog.ts
 * 守门检查：node --import tsx scripts/gen-asset-catalog.ts --check
 *
 * 数据来源：packages/shared/src/content/{heroes,cards,statuses}.ts（生成期快照）。
 * 运行时资产层不 import shared，本文件是唯一的桥。
 */
import type { CatalogEntry } from './types.js';

export const ASSET_CATALOG: readonly CatalogEntry[] = Object.freeze([
${body}
]);
`;
}

// ── lint：孤立 id / 遗漏 id / 包 manifest 校验 ────────────────────

function deriveSharedIds(): Map<AssetKind, Set<string>> {
  const map = new Map<AssetKind, Set<string>>();
  const add = (k: AssetKind, id: string): void => {
    const set = map.get(k) ?? new Set<string>();
    set.add(id);
    map.set(k, set);
  };
  for (const hero of HEROES) {
    add('heroPanel', hero.id);
    for (const a of hero.abilities) add('abilityIcon', a.id);
    for (const f of hero.dieFaces) add('dieFace', `${hero.id}:face:${f.value}`);
    for (const c of hero.deck) add('card', c.defId);
  }
  for (const c of COMMON_CARDS) add('card', c.defId);
  for (const s of COMMON_STATUSES) add('statusIcon', s.id);
  return map;
}

interface PackManifestEntry {
  readonly logicalId: string;
  readonly kind: AssetKind;
  readonly file: string;
  readonly confirmed?: boolean;
}
interface PackManifest {
  readonly pack: string;
  readonly entries?: readonly PackManifestEntry[];
}

/** 未确认库存的临时 id 方案：tts-<英雄slug>-card-NN / -panel / -face-N / -status-<名>。 */
const PROVISIONAL_ID = /^tts-[a-z0-9]+(-[a-z0-9]+)*$/;

function checkPackManifest(path: string, label: string, sharedIds: Map<AssetKind, Set<string>>, errors: string[]): void {
  if (!existsSync(path)) return; // 包未导入过资产：合法（全走 fallback）
  let manifest: PackManifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8')) as PackManifest;
  } catch (e) {
    errors.push(`${label}: manifest.json 解析失败 —— ${(e as Error).message}`);
    return;
  }
  for (const e of manifest.entries ?? []) {
    const known = sharedIds.get(e.kind)?.has(e.logicalId) ?? false;
    if (known) {
      if (e.confirmed === false) errors.push(`${label}: ${e.kind}:${e.logicalId} 已命中内容层却标记 confirmed=false`);
      continue;
    }
    // 未命中内容层：只允许未确认的临时 id（tts-<slug>-… 的导入库存，等待内容层扩充/人工确认）
    if (PROVISIONAL_ID.test(e.logicalId) && e.confirmed === false) continue;
    errors.push(`${label}: 孤立资产 id "${e.kind}:${e.logicalId}"（不在 shared 内容层，且不符合临时 id 方案）`);
  }
}

function runCheck(entries: readonly CatalogEntry[]): string[] {
  const errors: string[] = [];
  const sharedIds = deriveSharedIds();

  // 孤立 id：catalog 中 derived 条目必须能从 shared 派生
  for (const e of entries) {
    if (!e.derived) continue;
    if (!sharedIds.get(e.kind)?.has(e.id)) {
      errors.push(`孤立 id：catalog 含 ${e.kind}:${e.id}，但 shared 内容层派生不出它`);
    }
  }
  // 遗漏 id：shared 派生的每个 id 都要在 catalog
  for (const [kind, ids] of sharedIds) {
    const inCatalog = new Set(entries.filter((e) => e.kind === kind && e.derived).map((e) => e.id));
    for (const id of ids) {
      if (!inCatalog.has(id)) errors.push(`遗漏 id：shared 内容层的 ${kind}:${id} 不在 catalog 中`);
    }
  }
  // 包 manifest 校验
  checkPackManifest(LOCAL_TTS_MANIFEST, 'local-tts', sharedIds, errors);
  checkPackManifest(RESKIN_MANIFEST, 'reskin', sharedIds, errors);
  return errors;
}

// ── main ─────────────────────────────────────────────────────────
const checkOnly = process.argv.includes('--check');
const entries = finalize(buildDraft());
const rendered = renderCatalog(entries);

const existing = existsSync(CATALOG_PATH) ? readFileSync(CATALOG_PATH, 'utf8') : null;
if (checkOnly) {
  const errors = runCheck(entries);
  if (existing !== rendered) {
    errors.push('catalog.ts 已过期：与 shared 内容层不一致，请运行 node --import tsx scripts/gen-asset-catalog.ts 重新生成');
  }
  if (errors.length > 0) {
    console.error(`[gen-asset-catalog] --check 失败（${errors.length} 项）：`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`[gen-asset-catalog] --check 通过：${entries.length} 条目录项，无孤立/遗漏 id，包 manifest 合法`);
  process.exit(0);
}

writeFileSync(CATALOG_PATH, rendered);
console.log(`[gen-asset-catalog] 已写入 ${CATALOG_PATH}（${entries.length} 条）`);
const errors = runCheck(entries);
if (errors.length > 0) {
  console.error(`[gen-asset-catalog] lint 发现 ${errors.length} 个问题：`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
