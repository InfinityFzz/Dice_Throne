/**
 * apply-card-name-mapping.ts —— 把 OCR 卡名落成可用的映射（基准表校正 + shared 内容层对齐 + 复核清单）。
 *
 * 三步：
 *   1. 基准表校正：OCR 对个别卡名不稳（逗号读成句点、罗马数字丢档，"CARDucopia" 之类），
 *      这里用「视觉逐张复核过」的基准表把 cleanedText 修正到最终值；纯 OCR 结果保留在 ocrCleanedText。
 *   2. 对齐 shared 内容层：只有「官方卡名 slug == shared defId slug 且档位一致」才敢标 confirmed。
 *      其余一律保留 `tts-<hero>-card-NN` 且 confirmed=false（lint 只认已确认条目命中内容层）。
 *   3. 落盘 manifest.json / mapping.draft.json / review-queue.md。
 *
 * ⚠️ 关于覆盖率（重要，别误读）：shared 内容层目前只有 barbarian / pyromancer 两个英雄，
 * 且它们的卡组是「机制自洽的自制数值」（见 heroes.ts 头注），**不等于**印刷版卡组。
 * 因此 230 张卡里能对上内容层的只有 5 张（名字 + 档位都吻合的那 5 张升级卡）。
 * 其余 225 张不是「识别失败」，而是「内容层还没有对应的 id」——识别结果都在，
 * 等 M3 内容层扩充后可以一键提升为 confirmed。
 *
 * 用法：
 *   node --import tsx scripts/apply-card-name-mapping.ts
 *   node --import tsx scripts/apply-card-name-mapping.ts --self-check 10   # 另附自检抽样
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACK = join(ROOT, 'packages/web/src/assets/packs/local-tts');
const MANIFEST_PATH = join(PACK, 'manifest.json');
const MAPPING_PATH = join(PACK, 'mapping.draft.json');
const RESULTS_PATH = join(PACK, 'ocr-results.json');
const REVIEW_PATH = join(PACK, 'review-queue.md');

// ── 卡名基准表（**逐张读卡图人工视觉复核**，是本次的 ground truth）───────────
/**
 * 索引 00–17 是「通版卡」：7 个英雄的图集里都有、卡名完全相同（7 份独立 OCR 一致 + 视觉复核）。
 * 索引 18+ 是英雄专属卡。
 * 复核手段：把每张卡的卡名带 + 整卡缩略图拼成带序号的联系表后逐行目读（见 PR 描述）。
 */
const GENERIC_NAMES: readonly string[] = [
  'Transference!',        // 00
  'What Status Effects?', // 01
  'Vegas Baby!',          // 02
  'Get That Outta Here!', // 03
  'Triple Up!',           // 04
  'Double Up!',           // 05
  'Buh, Bye!',            // 06  ← 卡面是逗号，OCR 一律读成句点
  'Tip It!',              // 07
  'Getting Paid!',        // 08
  'Not This Time!',       // 09
  'Twice As Wild!',       // 10
  'Try, Try Again!',      // 11  ← 同上，逗号
  'So Wild!',             // 12
  'Samesies!',            // 13
  'One More Time!',       // 14
  'Helping Hand',         // 15
  'Better D!',            // 16
  'Six-It!',              // 17
];

/** 英雄专属卡（索引 18 起，连续） */
const HERO_CARD_NAMES: Readonly<Record<string, readonly string[]>> = {
  gunslinger: [
    'Duel II', 'Showdown II', 'Showdown III', 'Revolver II', 'Fan The Hammer II',
    'Bounty Hunter II', 'Take Cover II', 'Deadeye II',
    'Wild West!', 'Wanted!', 'Spin The Chamber!', 'Roulette!', 'Eat Lead!', 'Quick Draw II', 'Run And Gun!',
  ],
  pyromancer: [
    'Fireball II', 'Pyroblast II', 'Pyroblast III', 'Burning Soul II', 'Combustion II',
    'Hot Streak II', 'Ignite II', 'Meteorite II', 'Molten Armor II', 'Molten Armor III',
    'Warm Up!', 'Fire Up!', 'Red Hot!', 'Huzzah!', 'Infernal Infusion!',
  ],
  shadowthief: [
    'Dagger Strike II', 'Pickpocket II', 'Shifty Strike II', 'Insidious Strike II', 'Shadow Dance II',
    'Carducopia II', 'Shadow Defense II', 'Counter Strike II',
    'Sneaky!', 'Poison Wound!', 'Wild Shadow!', 'Shadow Coin!', 'Enter The Shadows!', 'Card Trick!', 'Shadow Meld!',
  ],
  moonelf: [
    'Longbow II', 'Longbow III', 'Demising Shot II', 'Covered Shot II', 'Exploding Arrow II',
    'Exploding Arrow III', 'Entangling Shot II', 'Blinding Shot II', 'Eclipse II', 'Missed Me II',
    'Moon Magic!', 'Take That!', 'Volley!', 'Evade!', 'Lunar Umbra!',
  ],
  barbarian: [
    'Smack II', 'Smack III', 'Sturdy Blow II', 'Sturdy Blow III', 'Mighty Blow II',
    'Crit Bash II', 'Fortitude II', 'Overpower II', 'Reckless II', 'Thick Skin II',
    'Concuss!', 'Head Bash!', 'Get Some!', "Feelin' Good!", 'Adrenaline Surge!',
  ],
  ninja: [
    'Slash II', 'Death Blossom II', 'Smokescreen II', 'Walk The Line II', 'Poison Blade II',
    'Shadow Fang II', 'Shadewalk II', 'Shade Shift II',
    'Poison Dart!', 'Throwing Stars!', 'Fan Of Knives!', 'Smoke Offering!', 'Train!', 'Escape!', 'Dojo!',
  ],
  raveness: [
    'Peck II', 'Fowl Friend II', 'Craven II', 'Chamber II', 'Murder Of Crows II',
    'Raven Sight II', 'Beguile II', 'Nothing More II',
    'Midnight Dreary!', 'Nevermore Attack!', 'Talon Strike!', 'Stone Beak!', 'Broken Stillness!', 'Cull!',
  ],
};

// ── 官方卡名 → shared 内容层 defId ──────────────────────────────
/**
 * ⚠️ 只登记「卡名 slug 与 defId slug 完全一致、且档位一致」的条目。
 * 不做语义近似：shared 的卡组是自制数值（heroes.ts 头注），拿"意思差不多"去凑会污染内容层。
 *
 * 命名空间以 packages/shared/src/content/heroes.ts 为准：`barbarian:` / `pyromancer:` / `common:`。
 * （任务书里的 `barb:` / `pyro:` 前缀在代码里不存在，这里不采用。）
 */
const NAME_TO_SHARED: Readonly<Record<string, string>> = {
  'fireball ii': 'pyromancer:fireball:2',
  'combustion ii': 'pyromancer:combustion:2',
  'ignite ii': 'pyromancer:ignite:2',
  'molten armor ii': 'pyromancer:moltenArmor:2',
  'reckless ii': 'barbarian:reckless:2',
};

/** 内容层已有、但印刷版卡组里**没有**对应卡的 defId（会被记为「无图」缺口，供 M3 参考）。 */
const SHARED_DEFS_WITHOUT_CARD: readonly string[] = [
  'pyromancer:fireball:3',
  'barbarian:heavyBlow:2',
  'barbarian:heavyBlow:3',
  'barbarian:whirlwind:2',
  'barbarian:whirlwind:3',
  'barbarian:ironWill:2',
];

// ── 类型 ─────────────────────────────────────────────────────────
interface ManifestEntry {
  logicalId: string;
  kind: string;
  file: string;
  width: number;
  height: number;
  confirmed: boolean;
  source?: string;
  cardName?: string;
  nameSource?: string;
  ocrConfidence?: number;
}
interface MappingEntry {
  file: string;
  category: string;
  hero: string;
  candidateLogicalId: string | null;
  confidence: string;
  provisionalId: string;
  manifestLogicalId: string;
  confirmed: boolean;
  note: string;
  source: string;
  cardName?: string;
  nameSource?: string;
  ocrConfidence?: number;
}
interface OcrEntry {
  file: string;
  hero: string;
  index: number;
  rawText: string;
  cleanedText: string;
  ocrCleanedText: string;
  nameSource: 'ocr' | 'canonical';
  confidence: number;
  suggestedId: string | null;
  provisionalId: string;
  proposedId: string;
  source: 'text-mining' | 'ocr' | 'unresolved';
  band: { top: number; height: number };
  variant: 'A' | 'B';
}

const slug = (s: string): string =>
  s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function canonicalName(hero: string, index: number): string | null {
  if (index < GENERIC_NAMES.length) return GENERIC_NAMES[index] ?? null;
  return HERO_CARD_NAMES[hero]?.[index - GENERIC_NAMES.length] ?? null;
}

// ── main ─────────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
  pack: string; modWorkshopId: number; generatedAt: string; entries: ManifestEntry[];
};
const mapping = JSON.parse(readFileSync(MAPPING_PATH, 'utf8')) as {
  generatedAt: string; mod: string; summary: Record<string, unknown>; entries: MappingEntry[];
};
const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8')) as {
  generatedAt: string; engine: string; method: string;
  summary: Record<string, unknown>; entries: OcrEntry[];
};

const mapByFile = new Map(mapping.entries.map((e) => [e.file, e]));
const usedShared = new Set<string>();

for (const ocr of results.entries) {
  const canon = canonicalName(ocr.hero, ocr.index);
  if (canon !== null) {
    ocr.cleanedText = canon;
    ocr.nameSource = canon === ocr.ocrCleanedText ? 'ocr' : 'canonical';
  }
  // 纯 OCR 没读出名字的，就算基准表补上了也标 canonical，方便统计真实 OCR 命中率。
  if (ocr.ocrCleanedText === '' && canon !== null) ocr.nameSource = 'canonical';
  if (ocr.cleanedText === '') ocr.source = 'unresolved';

  const defId = ocr.cleanedText ? (NAME_TO_SHARED[ocr.cleanedText.toLowerCase()] ?? null) : null;
  // 同一个 shared defId 只能有一条 confirmed（资产包 index 是 last-wins，重复会互相覆盖）
  const canClaim = defId !== null && !usedShared.has(defId);
  if (canClaim) usedShared.add(defId!);
  ocr.suggestedId = canClaim ? defId : null;
  ocr.proposedId = canClaim ? defId! : (ocr.cleanedText ? `tts-${ocr.hero}-${slug(ocr.cleanedText)}` : ocr.provisionalId);

  const mEntry = manifest.entries.find((e) => e.kind === 'card' && e.file === ocr.file);
  if (!mEntry) continue;
  mEntry.cardName = ocr.cleanedText || undefined;
  mEntry.nameSource = ocr.nameSource;
  mEntry.ocrConfidence = ocr.confidence;
  if (canClaim) {
    mEntry.logicalId = defId!;
    mEntry.confirmed = true;
  }
  const dEntry = mapByFile.get(ocr.file);
  if (dEntry) {
    dEntry.candidateLogicalId = canClaim ? defId : null;
    dEntry.confidence = canClaim ? 'high' : ocr.confidence >= 70 ? 'medium' : 'low';
    dEntry.manifestLogicalId = mEntry.logicalId;
    dEntry.confirmed = mEntry.confirmed;
    dEntry.cardName = ocr.cleanedText || undefined;
    dEntry.nameSource = ocr.nameSource;
    dEntry.ocrConfidence = ocr.confidence;
    dEntry.note = canClaim
      ? `卡名「${ocr.cleanedText}」与 shared defId 同名同档，已确认`
      : (ocr.hero === 'barbarian' || ocr.hero === 'pyromancer')
        ? `卡名「${ocr.cleanedText}」；shared 内容层无同名 defId（自制卡组），待内容层对齐（M3）`
        : `卡名「${ocr.cleanedText}」；英雄 ${ocr.hero} 尚不在 shared 内容层（M3）`;
  }
}

// ── 统计 ─────────────────────────────────────────────────────────
const cards = results.entries;
const confirmedCards = manifest.entries.filter((e) => e.kind === 'card' && e.confirmed);
const ocrExact = cards.filter((e) => e.ocrCleanedText === e.cleanedText).length;
const ocrEmpty = cards.filter((e) => e.ocrCleanedText === '').length;
const avgConf = cards.reduce((s, e) => s + e.confidence, 0) / cards.length;
const pending = cards
  .filter((e) => e.suggestedId === null)
  .sort((a, b) => a.confidence - b.confidence || a.file.localeCompare(b.file));

console.log(`[mapping] 卡面 ${cards.length} 张`);
console.log(`[mapping] 纯 OCR 与基准表完全一致：${ocrExact}/${cards.length}（含 ${ocrEmpty} 张读空后由基准表补全）`);
console.log(`[mapping] 已确认命中 shared 内容层：${confirmedCards.length} 张`);
console.log(`[mapping] 平均 OCR 置信度：${avgConf.toFixed(1)}`);

// ── 写盘 ─────────────────────────────────────────────────────────
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

mapping.summary = {
  ...mapping.summary,
  cardsNamed: cards.filter((e) => e.cleanedText !== '').length,
  cardsConfirmedToShared: confirmedCards.length,
  cardsAwaitingContentLayer: pending.length,
  cardNameSource: 'ocr + 基准表（人工视觉复核）',
};
writeFileSync(MAPPING_PATH, `${JSON.stringify(mapping, null, 2)}\n`);

results.summary = {
  ...results.summary,
  named: cards.filter((e) => e.cleanedText !== '').length,
  unresolved: cards.filter((e) => e.cleanedText === '').length,
  mappedToSharedContent: confirmedCards.length,
  avgConfidence: Math.round(avgConf * 10) / 10,
  ocrExactVsCanonical: ocrExact,
  canonicalNameSource: '人工视觉复核（卡名带 + 整卡缩略图联系表逐行目读）',
};
writeFileSync(RESULTS_PATH, `${JSON.stringify(results, null, 2)}\n`);

// ── review-queue.md ──────────────────────────────────────────────
const row = (e: OcrEntry): string => {
  const flag = e.confidence < 50 ? '🔴' : e.confidence < 70 ? '🟡' : '🟢';
  const mismatch = e.ocrCleanedText !== e.cleanedText
    ? `OCR「${e.ocrCleanedText || '（空）'}」→ 修正「${e.cleanedText}」`
    : '—';
  return `| ${flag} ${e.confidence.toFixed(0)} | \`${e.file}\` | ${e.cleanedText || '（未识别）'} | \`${e.proposedId}\` | ${mismatch} |`;
};

const inSharedHeroes = pending.filter((e) => e.hero === 'barbarian' || e.hero === 'pyromancer');
const otherHeroes = pending.filter((e) => e.hero !== 'barbarian' && e.hero !== 'pyromancer');

const review = `# 卡名核对清单（review-queue）

> 由 \`scripts/apply-card-name-mapping.ts\` 生成，**按 OCR 置信度升序**（低置信排最前）。
> 卡名基准来自对卡图卡名带的**逐张视觉复核**；OCR 原始值保留在 \`ocr-results.json\` 的 \`ocrCleanedText\`。
> 结果：卡面 ${cards.length} 张 · 已确认映射 ${confirmedCards.length} 张 · 待人工 ${pending.length} 张 · 未识别 ${cards.filter((e) => e.cleanedText === '').length} 张。

## 结论先说：待确认的不是「卡名」，而是「内容层 id」

绝大多数卡名已可判读，**真正卡住的是 shared 内容层的覆盖面**：

| 批次 | 张数 | 说明 | 需要谁决策 |
|---|---|---|---|
| A. 已确认 | ${confirmedCards.length} | 卡名与 shared defId 同名同档，已写 \`confirmed: true\` | 请复核我对齐得对不对 |
| B. barb/pyro 未对齐 | ${inSharedHeroes.length} | 英雄已在内容层，但印刷版卡名在 shared 里**没有同名 defId** | 文策渊：是否让内容层改成与印刷版卡组同 id（M3） |
| C. 其余 5 英雄 | ${otherHeroes.length} | 英雄本身还没进内容层 | 文策渊 + 主理人：M3 排期 |
| D. OCR 读空 | ${ocrEmpty} | 读空但已由基准表补全 | 已处理，仅记录 |

> 命名空间以代码为准：\`barbarian:\` / \`pyromancer:\` / \`common:\`（\`barb:\` / \`pyro:\` 在仓库里不存在）。

### 内容层缺图提醒（shared 有 defId、但印刷版卡组里没有对应卡）
${SHARED_DEFS_WITHOUT_CARD.map((d) => `- \`${d}\``).join('\n')}

这些 id 目前**拿不到实体卡图**，UI 会回落到占位图。要么在 M3 补齐卡图，要么从内容层移除。

---

## B 组：barbarian / pyromancer（英雄已在内容层，等卡组 id 对齐）

需要确认的是：**是否把 shared 的卡组替换/对齐成印刷版卡组**。当前 shared 是自制数值卡组，
卡名（中文）与印刷版英文卡名对不上，所以我只对齐了 5 张同名同档的升级卡。

${inSharedHeroes.length === 0 ? '_（无）_' : `| 置信 | 文件 | 识别卡名 | 建议 id | OCR 与基准差异 |
|---|---|---|---|---|
${inSharedHeroes.map(row).join('\n')}`}

---

## C 组：其余 5 个英雄（等内容层扩充）

${otherHeroes.length === 0 ? '_（无）_' : `| 置信 | 文件 | 识别卡名 | 建议 id | OCR 与基准差异 |
|---|---|---|---|---|
${otherHeroes.map(row).join('\n')}`}

---

## A 组：本次已写 \`confirmed: true\` 的映射（请复核）

| 文件 | 卡名 | logicalId | 依据 |
|---|---|---|---|
${confirmedCards
    .filter((e) => e.kind === 'card')
    .map((e) => `| \`${e.file}\` | ${e.cardName} | \`${e.logicalId}\` | 卡名 slug == defId slug，档位一致（${e.nameSource === 'canonical' ? '视觉复核' : 'OCR 直接命中'}） |`)
    .join('\n')}

---

## 怎么用这份清单

1. 先看 C 组里标 🔴 的（置信 <50）：这些是 OCR 最不确定的，请对着 \`images/<hero>/cards/card-NN.webp\` 目视确认卡名。
2. B 组不是「名字对不对」的问题，而是**产品决策**：shared 内容层的卡组要不要改成印刷版卡组。
3. 确认后把 \`manifest.json\` 里该条的 \`logicalId\` 改成 shared id、\`confirmed: true\`（文件名不用动），
   然后 \`node --import tsx scripts/gen-asset-catalog.ts --check\` 必须保持绿色。
`;
writeFileSync(REVIEW_PATH, review);

// ── 可选自检抽样 ─────────────────────────────────────────────────
const scIdx = process.argv.indexOf('--self-check');
if (scIdx >= 0) {
  const n = Number.parseInt(process.argv[scIdx + 1] ?? '10', 10) || 10;
  // 确定性抽样（无 RNG，可复现）
  const step = Math.floor(cards.length / n);
  const sample = Array.from({ length: n }, (_, i) => cards[(i * step) % cards.length]!);
  console.log('\n[self-check] 确定性抽样（step=' + step + '）：');
  for (const e of sample) {
    console.log(`  ${e.file.padEnd(34)} OCR="${e.ocrCleanedText || '(空)'}" 基准="${e.cleanedText}" conf=${e.confidence} ${e.ocrCleanedText === e.cleanedText ? '✅' : '❌'}`);
  }
  const ok = sample.filter((e) => e.ocrCleanedText === e.cleanedText).length;
  console.log(`[self-check] 完全一致 ${ok}/${n}`);
}
