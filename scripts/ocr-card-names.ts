/**
 * ocr-card-names.ts —— 卡面卡名识别器（tesseract.js 纯 JS，无系统依赖）。
 *
 * 背景：TTS 模组（创意工坊 908560170）的 json 里 **没有** 卡名字段（已全字段扫描确认，
 * 见 packages/web/src/assets/packs/local-tts/text-mining-report.md），
 * 所以 230 张卡面必须靠图上的卡名文字反推「第 N 张切片是哪张牌」。
 *
 * 管线：读 manifest.json 的 card 条目 → 卡名带自适应定位（行墨迹剖面）
 *       → 灰度/反相/归一化/放大/二值化 → tesseract(psm 7) → 置信度 + 清洗 → 落盘。
 *
 * 卡名带定位（实测稳定，勿凭感觉改）：卡图 400×621，卡名文字固定落在 y≈42..62（≈6.8%..10%）。
 *   为避免把卡名下方的装饰裂纹（y≈71..88）读成噪声，这里不写死常量，而是
 *   用「行墨迹剖面」找第一段连续高墨迹行 —— 对 7 个英雄模板都稳。
 *
 * 版权边界（硬性）：
 *   - 卡名（单行短语）→ 允许写入 ocr-results.json / manifest / mapping.draft（入库）。
 *   - 卡面效果正文（官方规则文本）→ **只允许**写 ocr-raw-text.json（已 gitignore，不入库），
 *     用途仅限人工核对数值。严禁进 packages/shared。
 *
 * 用法：
 *   node --import tsx scripts/ocr-card-names.ts                 # 全量（带断点续跑）
 *   node --import tsx scripts/ocr-card-names.ts --hero pyromancer
 *   node --import tsx scripts/ocr-card-names.ts --limit 20 --force
 *   node --import tsx scripts/ocr-card-names.ts --no-body       # 不 OCR 效果正文
 *
 * 选项：
 *   --hero <slug>     只处理指定英雄（可逗号分隔）
 *   --limit <n>       只处理前 n 张未识别的
 *   --force           忽略已有结果，全部重跑
 *   --no-body         跳过效果正文 OCR（只出卡名；ocr-raw-text.json 不更新）
 *   --save-crops      把卡名带裁剪图落盘到 .ocr-work/crops/（人工复核用）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACK_DIR = join(ROOT, 'packages/web/src/assets/packs/local-tts');
const MANIFEST_PATH = join(PACK_DIR, 'manifest.json');
const RESULTS_PATH = join(PACK_DIR, 'ocr-results.json');
/** 官方效果正文的原始 OCR —— 不入库（见根 .gitignore），仅供人工核对数值。 */
const RAW_TEXT_PATH = join(PACK_DIR, 'ocr-raw-text.json');
const CROPS_DIR = join(ROOT, '.ocr-work/crops');

// ── CLI ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f: string): boolean => argv.includes(f);
const val = (f: string, d: string): string => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : d;
};
const FORCE = has('--force');
const WITH_BODY = !has('--no-body');
const SAVE_CROPS = has('--save-crops');
const HERO_FILTER = val('--hero', '').split(',').map((s) => s.trim()).filter(Boolean);
// OCR 语言：英文官方版用 eng；中文版 mod（3446854288）用 chi_sim（首次运行会自动下载语言包）
const LANG = val('--lang', 'eng');
const LIMIT = Number.parseInt(val('--limit', '0'), 10) || 0;

// ── 类型 ─────────────────────────────────────────────────────────
interface ManifestEntry {
  logicalId: string;
  kind: string;
  file: string;
  width: number;
  height: number;
  confirmed: boolean;
  source?: string;
}
interface Manifest {
  pack: string;
  modWorkshopId: number;
  generatedAt: string;
  entries: ManifestEntry[];
}

export interface OcrEntry {
  file: string;
  hero: string;
  index: number;
  /** tesseract 原始输出（未清洗，含噪声） */
  rawText: string;
  /** 最终卡名（Title Case，去噪）。可能被卡名基准表校正过，见 nameSource */
  cleanedText: string;
  /** 纯 OCR 清洗结果（未经基准表校正），用于统计真实 OCR 准确率 */
  ocrCleanedText: string;
  /** cleanedText 的来源：ocr = 直接来自 OCR；canonical = 基准表校正（视觉复核） */
  nameSource: 'ocr' | 'canonical';
  /** tesseract 置信度 0–100 */
  confidence: number;
  /** 已能对上 shared 内容层的逻辑 id；对不上为 null */
  suggestedId: string | null;
  /** 现行 manifest 里的临时 id（未确认条目保留它） */
  provisionalId: string;
  /** 建议 id：未解析时给出 tts-<hero>-<slug> 形式的候选 */
  proposedId: string;
  /** text-mining = 从 mod 文本直接得到；ocr = 靠卡图识别；unresolved = 都没结果 */
  source: 'text-mining' | 'ocr' | 'unresolved';
  /** 卡名带定位结果（行号），便于复现与调参 */
  band: { top: number; height: number };
  /** 实际采用的预处理变体（A 默认 / B 兜底重试） */
  variant: 'A' | 'B';
}

interface RawTextEntry {
  file: string;
  hero: string;
  index: number;
  /** ⚠️ 官方效果正文，不入库。仅人工核对数值用。 */
  bodyRawText: string;
}

// ── 卡图预处理 ───────────────────────────────────────────────────

/** 卡名带：行墨迹剖面找第一段连续高墨迹行。返回原图像素坐标。 */
async function locateNameBand(file: string): Promise<{ top: number; height: number }> {
  const meta = await sharp(file).metadata();
  const W = meta.width ?? 400;
  const H = meta.height ?? 621;
  const bandH = Math.max(24, Math.round(H * 0.2));
  const { data, info } = await sharp(file)
    .extract({ left: 0, top: 0, width: W, height: bandH })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const ink = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let bright = 0;
    for (let x = 0; x < w; x++) {
      // 卡名一律是深色石纹底上的亮色字（7 个英雄模板一致）；只用「亮墨迹」，
      // 用暗墨迹会被卡面上缘的深色边框误判成文字带（实测过，勿改回去）。
      if ((data[y * w + x] ?? 0) > 180) bright++;
    }
    ink[y] = bright / w;
  }

  // 卡名带在 y∈[0.05H, 0.105H] 之间（实测 42..62 of 621）；再往下 0.11H..0.14H 是
  // 卡面装饰裂纹（会被读成噪声），所以窗口上界必须卡在 0.105H。
  const start = Math.round(H * 0.05);
  const stop = Math.round(H * 0.105);
  // 取「窗口内墨迹总量最大的那一段连续行」，而不是第一段。
  // 原因：升级卡（Fireball II 之类）在 y≈14..27 有一条近乎全亮的白色抬头条，
  // 它的尾巴会以 0.05~0.07 的墨迹渗进窗口，用「第一段」会误判成卡名带（实测踩过）。
  const runs: Array<{ lo: number; hi: number; sum: number }> = [];
  let lo = -1;
  let hi = -1;
  let gap = 0;
  let sum = 0;
  const flush = (): void => {
    if (lo >= 0) runs.push({ lo, hi, sum });
    lo = -1;
    hi = -1;
    sum = 0;
    gap = 0;
  };
  for (let y = start; y < stop; y++) {
    // 阈值 0.06：短卡名（如 "TIP IT!"）行墨迹只有 ~0.08，用 0.15 会整个漏掉。
    if ((ink[y] ?? 0) >= 0.06) {
      if (lo < 0) lo = y;
      hi = y;
      sum += ink[y] ?? 0;
      gap = 0;
    } else if (lo >= 0) {
      gap++;
      if (gap > 3) flush();
    }
  }
  flush();
  let best = runs[0];
  for (const r of runs) if (best === undefined || r.sum > best.sum) best = r;

  const pad = 3;
  const padLo = best?.lo ?? Math.round(H * 0.055);
  const padHi = best?.hi ?? Math.round(H * 0.1);
  const top = Math.max(0, padLo - pad);
  const bottom = Math.min(H, padHi + pad);
  return { top, height: Math.max(10, bottom - top) };
}

/** 卡名带 → 高对比位图（给 tesseract 吃）。
 *  两套预处理：A（默认）清晰度优先；B 阈值更低、无模糊 —— 少数卡（如 Pyromancer
 *  card-29 "FIRE UP!"）在 A 下会整条读空，在 B 下能到 96 分，所以两者做兜底重试。 */
async function cropName(
  file: string,
  band: { top: number; height: number },
  variant: 'A' | 'B' = 'A',
  scale = 4,
): Promise<Buffer> {
  const meta = await sharp(file).metadata();
  const W = meta.width ?? 400;
  // 左右各留 6%：卡名一律居中；卡面两侧有装饰性小竖条（会被读成 "I"/"l"），必须裁掉。
  const inset = Math.round(W * 0.06);
  const base = sharp(file)
    .extract({ left: inset, top: band.top, width: W - inset * 2, height: band.height })
    .grayscale()
    .negate()
    .normalize()
    .resize({ width: (W - inset * 2) * scale, kernel: 'lanczos3' });
  const stage = variant === 'A' ? base.blur(0.4).threshold(150) : base.threshold(120);
  return stage.png().toBuffer();
}

/** 效果正文区（下半张卡）→ 位图。仅用于 ocr-raw-text.json。 */
async function cropBody(file: string): Promise<Buffer> {
  const meta = await sharp(file).metadata();
  const W = meta.width ?? 400;
  const H = meta.height ?? 621;
  const top = Math.round(H * 0.46);
  const left = Math.round(W * 0.08);
  return sharp(file)
    .extract({ left, top, width: W - left * 2, height: Math.round(H * 0.93) - top })
    .grayscale()
    .resize({ width: (W - left * 2) * 2, kernel: 'lanczos3' })
    .png()
    .toBuffer();
}

// ── 卡名清洗 ─────────────────────────────────────────────────────

/**
 * 罗马数字还原：tesseract 对升级卡的 "II"/"III" 极不稳定，实测读成
 * "Ii" / "Nl" / "nl" / "Ni" / "Lil" / "Ini" / "Ill" / "Iii" 等。
 * 这些形近符集合 = {I,i,1,|,L,l,N,n}，统一映射成 I 后按长度还原成 I/II/III。
 * 骰铸升级卡只有 II / III 两档，长度 ≥4 一律不认（宁可保留原样交人工）。
 */
const ROMAN_CHARS = /^[Ii1|LlNn]{1,3}$/;
function normalizeRoman(token: string): string | null {
  if (!ROMAN_CHARS.test(token)) return null;
  const n = token.replace(/[i1|LlNn]/g, 'I').replace(/I/g, 'I').length;
  if (n < 1 || n > 3) return null;
  return 'I'.repeat(n);
}

/** 单字符噪声 token（卡面两侧装饰竖条 / 裂纹线被读成的孤立字符）。 */
const SINGLE_NOISE = /^[^\sA-Za-z0-9]$|^[IiLlFfJj1|]$/;

/** 去噪声字符、统一 Title Case。断言：卡名不含阿拉伯数字（费用在图标上，不在名字里）。 */
export function cleanCardName(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  // 去掉首尾非字母噪声（裂纹线常被读成数字/符号）
  s = s.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z!?.']+$/, '');
  // 尾部单独的数字/符号簇（裂纹噪声）
  s = s.replace(/\s+[0-9|/\\]+\s*$/, '');
  s = s.replace(/\s+/g, ' ').trim();

  const parts = s.split(' ').filter((p) => p.length > 0);
  const isRomanToken = (t: string): boolean => /^(I|II|III)$/.test(t);

  // 1) 剥前导孤立噪声 token（"F So Wild!" 的 "F"、旧版的 "i"/"l"）。
  while (parts.length > 1 && SINGLE_NOISE.test(parts[0]!) && !isRomanToken(parts[0]!)) parts.shift();

  // 2) 先剥**尾部**孤立噪声（"j" / "'" / "."），再还原罗马数字。
  //    顺序反了会漏：raw = "SHOWDOWN Ill j" 时尾部是 "j"，先还原会判定「不是罗马数字」，
  //    接着把 "Ill" 当普通 token 留着，档位就丢了。
  while (parts.length > 1 && SINGLE_NOISE.test(parts[parts.length - 1]!) && !isRomanToken(parts[parts.length - 1]!)) parts.pop();

  // 3) 尾部罗马数字还原（"Ii"/"Nl"/"Nl"/"Ill" → II / III）。
  if (parts.length > 1) {
    const bare = parts[parts.length - 1]!.replace(/[^A-Za-z]/g, '');
    const roman = normalizeRoman(bare);
    if (roman !== null) parts[parts.length - 1] = roman;
  }

  s = parts.join(' ');
  if (!/[A-Za-z]{2}/.test(s)) return '';
  // 注意：不能先 toLowerCase 再判罗马数字 —— 那样 "II" 会变成 "ii"，判不出来，又被 Title Case
  // 成 "Ii"。必须先判罗马（此时已由 normalizeRoman 统一成大写），再对普通词做 Title Case。
  return parts
    .map((w) => (isRomanToken(w) ? w : w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/** 卡名 → 文件名安全 slug。 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── 卡名 → shared 内容层 defId ───────────────────────────────────
// 归属：本脚本只负责把卡名读出来；「卡名 → shared defId」的映射以及 manifest 落盘
// 都在 scripts/apply-card-name-mapping.ts 里做（那里也有卡名基准表）。

// ── main ─────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  let cards = manifest.entries.filter((e) => e.kind === 'card');
  if (HERO_FILTER.length > 0) cards = cards.filter((e) => HERO_FILTER.includes(e.file.split('/')[0]!));

  const prev: Record<string, OcrEntry> = existsSync(RESULTS_PATH)
    ? Object.fromEntries(
      (JSON.parse(readFileSync(RESULTS_PATH, 'utf8')) as { entries: OcrEntry[] }).entries.map((e) => [e.file, e]),
    )
    : {};
  const prevRaw: Record<string, RawTextEntry> = existsSync(RAW_TEXT_PATH)
    ? Object.fromEntries(
      (JSON.parse(readFileSync(RAW_TEXT_PATH, 'utf8')) as { entries: RawTextEntry[] }).entries.map((e) => [e.file, e]),
    )
    : {};

  const todo = cards.filter((e) => FORCE || !prev[e.file] || prev[e.file]!.cleanedText === '');
  const queue = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;

  console.log(`[ocr] 卡面总数 ${cards.length}，待识别 ${queue.length}（已完成 ${cards.length - todo.length}）`);
  if (queue.length === 0) {
    console.log('[ocr] 无待处理项，直接重写汇总文件');
  }

  if (SAVE_CROPS) mkdirSync(CROPS_DIR, { recursive: true });

  const worker = await createWorker(LANG, undefined, {
    // tesseract.js 默认把下载的语言包写到 CWD（会把 5MB 的 eng.traineddata 丢到仓库根），
    // 显式指到已 gitignore 的 .ocr-work/tessdata。
    cachePath: join(ROOT, '.ocr-work/tessdata'),
  });
  const NAME_PARAMS = {
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    user_defined_dpi: '400',
    // 白名单必须含逗号：实测「BUH, BYE!」「TRY, TRY AGAIN!」的逗号不在表里时会被读成句点。
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!?:,'-. ",
  };
  const BODY_PARAMS = {
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    user_defined_dpi: '300',
  };
  await worker.setParameters(NAME_PARAMS);

  let done = 0;
  const t0 = Date.now();
  for (const entry of queue) {
    const [hero, , fileName] = entry.file.split('/');
    const abs = join(PACK_DIR, 'images', entry.file);
    const index = Number.parseInt((fileName ?? 'card-00.webp').replace(/\D+/g, ''), 10);

    if (!existsSync(abs)) {
      console.warn(`[ocr] 缺图，跳过：${entry.file}`);
      continue;
    }

    try {
      const band = await locateNameBand(abs);
      await worker.setParameters(NAME_PARAMS);

      let png = await cropName(abs, band, 'A');
      if (SAVE_CROPS) {
        writeFileSync(join(CROPS_DIR, `${hero}-${String(index).padStart(2, '0')}.png`), png);
      }
      let data = (await worker.recognize(png)).data;
      let cleaned = cleanCardName(data.text ?? '');
      let usedVariant: 'A' | 'B' = 'A';

      // 兜底重试：A 读空或置信度过低时换 B（低阈值、不模糊），取置信度更高者。
      if (cleaned === '' || (data.confidence ?? 0) < 40) {
        const pngB = await cropName(abs, band, 'B');
        const dataB = (await worker.recognize(pngB)).data;
        const cleanedB = cleanCardName(dataB.text ?? '');
        if (cleanedB !== '' && (cleaned === '' || (dataB.confidence ?? 0) > (data.confidence ?? 0))) {
          png = pngB;
          data = dataB;
          cleaned = cleanedB;
          usedVariant = 'B';
          if (SAVE_CROPS) {
            writeFileSync(join(CROPS_DIR, `${hero}-${String(index).padStart(2, '0')}.png`), png);
          }
        }
      }

      const rec: OcrEntry = {
        file: entry.file,
        hero: hero!,
        index,
        rawText: (data.text ?? '').replace(/\s+/g, ' ').trim(),
        cleanedText: cleaned,
        ocrCleanedText: cleaned,
        nameSource: 'ocr',
        confidence: Math.round((data.confidence ?? 0) * 10) / 10,
        // suggestedId / proposedId 由 scripts/apply-card-name-mapping.ts 在基准表校正后填。
        suggestedId: null,
        provisionalId: entry.logicalId,
        proposedId: entry.logicalId,
        source: cleaned === '' ? 'unresolved' : 'ocr',
        band,
        variant: usedVariant,
      };
      prev[entry.file] = rec;

      if (WITH_BODY) {
        const bodyPng = await cropBody(abs);
        await worker.setParameters(BODY_PARAMS);
        const { data: bd } = await worker.recognize(bodyPng);
        prevRaw[entry.file] = {
          file: entry.file,
          hero: hero!,
          index,
          bodyRawText: (bd.text ?? '').replace(/[ \t]+/g, ' ').trim(),
        };
      }

      done++;
      if (done % 10 === 0 || done === queue.length) {
        const rate = (Date.now() - t0) / done / 1000;
        console.log(`[ocr] ${done}/${queue.length}  ${entry.file} → "${cleaned}" (${rec.confidence})  ${rate.toFixed(2)}s/张`);
        writeOutputs(manifest, prev, prevRaw, WITH_BODY);
      }
    } catch (err) {
      console.error(`[ocr] 失败：${entry.file} —— ${(err as Error).message}`);
      prev[entry.file] = {
        file: entry.file, hero: hero!, index,
        rawText: '', cleanedText: '', ocrCleanedText: '', nameSource: 'ocr', confidence: 0,
        suggestedId: null, provisionalId: entry.logicalId,
        proposedId: entry.logicalId, source: 'unresolved',
        band: { top: 0, height: 0 }, variant: 'A',
      };
    }
  }

  await worker.terminate();
  writeOutputs(manifest, prev, prevRaw, WITH_BODY);
  console.log(`[ocr] 完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

function writeOutputs(
  manifest: Manifest,
  results: Record<string, OcrEntry>,
  raw: Record<string, RawTextEntry>,
  withBody: boolean,
): void {
  const all = manifest.entries
    .filter((e) => e.kind === 'card')
    .map((e) => results[e.file])
    .filter((x): x is OcrEntry => Boolean(x));

  const resolved = all.filter((e) => e.suggestedId !== null).length;
  const named = all.filter((e) => e.cleanedText !== '').length;
  const byHero: Record<string, { total: number; named: number; avgConfidence: number }> = {};
  for (const e of all) {
    const b = (byHero[e.hero] ??= { total: 0, named: 0, avgConfidence: 0 });
    b.total++;
    if (e.cleanedText !== '') b.named++;
    b.avgConfidence += e.confidence;
  }
  for (const b of Object.values(byHero)) b.avgConfidence = Math.round((b.avgConfidence / b.total) * 10) / 10;

  writeFileSync(RESULTS_PATH, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    engine: 'tesseract.js (eng, psm7)',
    method: '卡名带自适应定位（行墨迹剖面）→ 灰度/反相/归一化/4x/阈值 → OCR',
    summary: {
      total: all.length,
      named,
      unresolved: all.length - named,
      mappedToSharedContent: resolved,
      avgConfidence: all.length === 0 ? 0 : Math.round((all.reduce((s, e) => s + e.confidence, 0) / all.length) * 10) / 10,
      byHero,
    },
    entries: all,
  }, null, 1)}\n`);

  if (withBody) {
    const rawEntries = Object.values(raw).sort((a, b) => a.file.localeCompare(b.file));
    writeFileSync(RAW_TEXT_PATH, `${JSON.stringify({
      _warning: '⚠️ 官方卡面效果正文，严禁入库 / 严禁进 packages/shared。仅人工核对数值用。本文件已在根 .gitignore。',
      generatedAt: new Date().toISOString(),
      entries: rawEntries,
    }, null, 1)}\n`);
  }
}

main().catch((e) => {
  console.error('[ocr] 失败:', e);
  process.exit(1);
});
