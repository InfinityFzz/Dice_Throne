/**
 * DT-OCR-002 —— 用官方卡名基准表（name-map.json）把 manifest 中的 provisional
 * 卡条目批量确认到内容层 defId。
 *
 * 规则：
 * - 仅处理 kind === 'card' 且有 cardName 的条目；卡名规范化（小写 + 去非字母数字）后查表。
 * - 命中且该 defId 尚未被占用 → logicalId 改为 defId、confirmed=true（nameSource 升为 canonical）。
 * - 同一 defId 出现多张图（通用卡在两个英雄牌堆各一张）→ 只确认第一张（按 file 排序稳定），
 *   其余标记 duplicate 保留 provisional id，避免 index 覆盖歧义。
 * - 未命中（其他英雄未实装）→ 保持原样，等待 M3。
 *
 * 用法：node --import tsx scripts/confirm-tts-mapping.ts [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packDir = join(root, 'packages/web/src/assets/packs/local-tts');
const dryRun = process.argv.includes('--dry-run');

/**
 * 卡名规范化：小写 + 去掉所有非字母数字、非汉字的字符（标点/空白/引号等）。
 * 保留汉字是为了中文版 mod（3446854288）的卡名能直接进 name-map 对照。
 */
const normalize = (name: string): string => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

interface Entry {
  logicalId: string; kind: string; file: string; confirmed?: boolean;
  cardName?: string; nameSource?: string; ocrConfidence?: number; [k: string]: unknown;
}
interface Manifest { entries: Entry[]; [k: string]: unknown }
interface DraftEntry { file: string; confirmed?: boolean; manifestLogicalId?: string; candidateLogicalId?: string | null; note?: string; [k: string]: unknown }
interface Draft { entries: DraftEntry[]; summary: Record<string, unknown>; [k: string]: unknown }

const manifest = JSON.parse(readFileSync(join(packDir, 'manifest.json'), 'utf8')) as Manifest;
const nameMap = JSON.parse(readFileSync(join(packDir, 'name-map.json'), 'utf8')) as Record<string, string>;
const draftPath = join(packDir, 'mapping.draft.json');
const draft = JSON.parse(readFileSync(draftPath, 'utf8')) as Draft;
const draftByFile = new Map<string, DraftEntry>(draft.entries.map((e) => [e.file, e]));

const occupied = new Set<string>(
  manifest.entries.filter((e) => e.kind === 'card' && e.confirmed).map((e) => e.logicalId),
);
const byFile = [...manifest.entries].sort((a, b) => a.file.localeCompare(b.file));

let confirmed = 0, duplicates = 0;
const unmatched: string[] = [];

for (const e of byFile) {
  if (e.kind !== 'card' || !e.cardName) continue;
  if (e.confirmed) continue; // 已确认（含此前的手工条目）不动
  const defId = nameMap[normalize(e.cardName)];
  if (!defId) {
    unmatched.push(`${e.file} "${e.cardName}"`);
    continue;
  }
  if (occupied.has(defId)) {
    duplicates++;
    const d = draftByFile.get(e.file);
    if (d) d.note = `与 ${defId} 重复（通用卡多英雄各一张），仅首张挂图`;
    continue;
  }
  const d = draftByFile.get(e.file);
  e.logicalId = defId;
  e.confirmed = true;
  e.nameSource = 'canonical';
  if (d) { d.confirmed = true; d.manifestLogicalId = defId; d.candidateLogicalId = defId; }
  occupied.add(defId);
  confirmed++;
}

draft.summary.cardsConfirmedToShared = manifest.entries.filter((e) => e.kind === 'card' && e.confirmed).length;
draft.summary.confirmedThisRun = confirmed;
draft.summary.duplicateSkipped = duplicates;
draft.summary.unmatchedCardNames = unmatched.length;

console.log(`[confirm-tts-mapping] 本轮确认 ${confirmed} 张；重复跳过 ${duplicates} 张；未匹配 ${unmatched.length} 张`);
if (unmatched.length > 0) console.log('  未匹配（内容层未实装，保持 provisional）:\n   ' + unmatched.join('\n   '));

if (!dryRun) {
  writeFileSync(join(packDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(draftPath, JSON.stringify(draft, null, 2) + '\n');
  console.log('[confirm-tts-mapping] manifest.json / mapping.draft.json 已写回');
} else {
  console.log('[confirm-tts-mapping] --dry-run，未写盘');
}
