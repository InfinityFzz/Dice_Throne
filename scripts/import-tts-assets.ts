/**
 * import-tts-assets.ts —— TTS 模组素材导入器（创意工坊 908560170，英文官方脚本版）。
 *
 * 管线：解析 mod json → 生成下载/切片计划 → 下载图集（本地缓存，防重复拉 175MB）→
 *       按行列切片 → sharp 转 webp → 按 <英雄>/<类别>/<序号>.webp 落盘 →
 *       产出 manifest.json（入库）+ mapping.draft.json（机器推断映射，待人工确认）+
 *       extracted-meta.json（文本元数据，供后续数值交叉校验）。
 *
 * 已实测确认的关键规则（勿改，改前先重验）：
 * - CardID 字符串 = <CustomDeck 键><两位卡索引>，索引是 **0-based**（实测 25/25 个图集
 *   最小索引均为 0；Pyromancer 的 33 张卡 = 索引 00..32 连续）。
 * - 切片定位：row = floor(idx / NumWidth)，col = idx % NumWidth（行优先）。
 *   「1-based 减一」的旧规则错误：按它切，idx 0 会落到 -1、idx 32 会落到图集填充区。
 * - 图集 CDN（steamusercontent-a.akamaihd.net）对 HEAD 返回 404，必须用 GET。
 * - TTS 骰子贴图实为 3×3 网格（顶排空白）：中排 [2,4,5]，下排 [1,3,6]；
 *   其中 1、6 在源图中旋转了 180°（导入时转正），3 正立。
 *
 * 用法：
 *   node --import tsx scripts/import-tts-assets.ts --dry-run
 *   node --import tsx scripts/import-tts-assets.ts [--only Pyromancer,Barbarian]
 *        [--categories cards,panels,dice,statuses] [--concurrency 2] [--force]
 *
 * 选项：
 *   --mod <path>        mod json 路径（默认本机 TTS 工坊缓存）
 *   --out <dir>         输出目录（默认 packages/web/src/assets/packs/local-tts）
 *   --cache <dir>       图集缓存目录（默认 <repoRoot>/.tts-cache，已 gitignore）
 *   --dry-run           只解析与产出映射草稿，不下载不写图
 *   --only <names>      只处理指定英雄（逗号分隔，按 Bag Nickname 匹配）
 *   --categories <csv>  cards,panels,dice,statuses 的子集（默认全部）
 *   --concurrency <n>   下载并发（默认 2，别把 CDN 打挂）
 *   --force             忽略缓存强制重新下载
 *   --quality <n>       webp 质量（默认 82）
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import sharp from 'sharp';

// ── 常量与默认值 ─────────────────────────────────────────────────

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MOD = 'D:/Users/InfinityFzz/Documents/My Games/Tabletop Simulator/Mods/Workshop/908560170.json';
const DEFAULT_OUT = join(ROOT, 'packages/web/src/assets/packs/local-tts');
const DEFAULT_CACHE = join(ROOT, '.tts-cache');

/** 非英雄容器：Box 是空盒子；DTA Demo 是冒险模式演示（Deck/DeckCustom 混装，非英雄卡组）。 */
const NON_HERO_BAGS = new Set(['Box', 'DTA Demo']);

/** 目标宽度规格（团队裁决）：卡 ~400 / 面板 ~800 / 骰面与状态 ~256。 */
const TARGET_WIDTH = { cards: 400, panels: 800, dice: 256, statuses: 256 } as const;
type Category = keyof typeof TARGET_WIDTH;

/** shared 内容层已有的英雄 id（从 heroes.ts 快照；本脚本不 import shared，保持单向依赖）。 */
const SHARED_HERO_IDS = new Set(['barbarian', 'pyromancer']);

/** TTS 状态令牌名 → shared 状态 id（exact match 后小写比对）。 */
const STATUS_NAME_TO_SHARED: Readonly<Record<string, string>> = {
  'burn': 'common:burn',
  'fire mastery': 'common:fireMastery',
  'evasive': 'common:evasive',
  'poison': 'common:poison',
};

/**
 * TTS 骰贴图布局（实测：墨迹行分布 y≈384..640 与 y≈736..992，顶 1/3 空白）：
 * 贴图是 3 列 × 3 行（≈341px 方格），6 个面占**中排与下排**，顶排为空。
 * 中排 = 点数 2/4/5（正立）；下排 = 点数 1/3/6，其中 1、6 在贴图里旋转了 180°
 *（导入时转正），3 本来就正立。已用 Pyromancer 贴图逐面目检确认。
 * 其余英雄骰共用同一骰子模型/UV 模板（置信 medium，draft 里有注记）。
 */
const DIE_CELL_TO_VALUE: readonly { readonly row: number; readonly col: number; readonly value: number; readonly rotate180: boolean }[] = [
  { row: 1, col: 0, value: 2, rotate180: false },
  { row: 1, col: 1, value: 4, rotate180: false },
  { row: 1, col: 2, value: 5, rotate180: false },
  { row: 2, col: 0, value: 1, rotate180: true },
  { row: 2, col: 1, value: 3, rotate180: false },
  { row: 2, col: 2, value: 6, rotate180: true },
];
/** 骰贴图网格：3 列 × 3 行 */
const DIE_GRID = { w: 3, h: 3 } as const;

// ── mod json 类型（只声明用到的字段） ────────────────────────────

interface TtsObject {
  Name?: string;
  Nickname?: string;
  Description?: string;
  GMNotes?: string;
  GUID?: string;
  CardID?: number | string;
  DeckIDs?: readonly (number | string)[];
  CustomDeck?: Record<string, TtsCustomDeck>;
  ContainedObjects?: readonly TtsObject[];
  CustomImage?: { ImageURL?: string; ImageSecondaryURL?: string };
  CustomMesh?: { DiffuseURL?: string };
  MeshURL?: string;
  DiffuseURL?: string;
}
interface TtsCustomDeck {
  FaceURL?: string;
  BackURL?: string;
  NumWidth: number;
  NumHeight: number;
}
interface TtsMod {
  SaveName?: string;
  LuaScript?: string;
  ObjectStates?: readonly TtsObject[];
}

interface DeckRecord {
  /** CustomDeck 键（deckKey，位数不固定） */
  key: string;
  spec: { w: number; h: number };
  faceURL: string;
  /** 0-based 切片索引（去重升序） */
  indices: number[];
  /** 实例数（含重复，即牌堆张数） */
  instances: number;
}
interface StatusRecord { name: string; url: string }
interface HeroRecord {
  ttsName: string;
  decks: DeckRecord[];
  panelURL: string | null;
  diceURL: string | null;
  diceCount: number;
  statuses: StatusRecord[];
}
interface Harvest {
  nicknames: string[];
  descriptions: string[];
  gmNotes: string[];
  luaScriptChars: number;
}

// ── 解析 ─────────────────────────────────────────────────────────

/** 从对象链解析 CardID → { deckKey, index }。优先用自身的 CustomDeck，不匹配则回溯祖先。 */
function tryParseCardId(
  cardId: number | string,
  ownCustomDeck: Record<string, TtsCustomDeck> | null,
  ancestorCustomDeck: Record<string, TtsCustomDeck> | null,
): { key: string; index: number } | null {
  const s = String(cardId);
  if (s.startsWith('-')) return null;
  for (const table of [ownCustomDeck, ancestorCustomDeck]) {
    if (!table) continue;
    const keys = Object.keys(table).sort((a, b) => b.length - a.length);
    for (const k of keys) {
      if (s.startsWith(k) && s.length > k.length) {
        const rest = s.slice(k.length);
        if (/^\d{1,3}$/.test(rest)) return { key: k, index: Number(rest) };
      }
    }
  }
  return null;
}

function collectIndices(obj: TtsObject): number[] {
  const out: number[] = [];
  if (obj.DeckIDs) {
    for (const id of obj.DeckIDs) {
      const n = Number(id);
      if (Number.isFinite(n) && n >= 0) out.push(n);
    }
  } else if (obj.CardID !== undefined && Number(obj.CardID) >= 0) {
    out.push(Number(obj.CardID));
  }
  return out;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

interface ParseResult {
  saveName: string;
  heroes: HeroRecord[];
  harvest: Harvest;
  atlasSpecs: { url: string; w: number; h: number }[];
}

function parseMod(mod: TtsMod): ParseResult {
  const heroMap = new Map<string, HeroRecord>();
  const harvest: Harvest = { nicknames: [], descriptions: [], gmNotes: [], luaScriptChars: (mod.LuaScript ?? '').length };
  const atlasSpecs = new Map<string, { url: string; w: number; h: number }>();

  const harvestText = (o: TtsObject): void => {
    if (o.Nickname) harvest.nicknames.push(o.Nickname);
    if (o.Description) harvest.descriptions.push(o.Description);
    if (o.GMNotes) harvest.gmNotes.push(o.GMNotes);
  };

  const walk = (o: TtsObject, heroName: string | null, ancestorDeck: Record<string, TtsCustomDeck> | null): void => {
    const isHeroBag = o.Name === 'Bag' && !!o.Nickname && !NON_HERO_BAGS.has(o.Nickname);
    const currentHero = isHeroBag ? o.Nickname! : heroName;
    if (currentHero && !heroMap.has(currentHero)) {
      heroMap.set(currentHero, { ttsName: currentHero, decks: [], panelURL: null, diceURL: null, diceCount: 0, statuses: [] });
    }
    if (!isHeroBag) harvestText(o);

    const deckTable = o.CustomDeck ?? ancestorDeck;
    if (o.CustomDeck) {
      for (const [k, v] of Object.entries(o.CustomDeck)) {
        if (v.FaceURL) atlasSpecs.set(v.FaceURL, { url: v.FaceURL, w: v.NumWidth, h: v.NumHeight });
      }
    }

    const hero = currentHero ? heroMap.get(currentHero)! : null;
    if (hero) {
      // 卡组：Name === 'DeckCustom'（英雄卡组）；'Deck' 只出现在 DTA Demo，不收
      if (o.Name === 'DeckCustom' && o.CustomDeck) {
        for (const [key, spec] of Object.entries(o.CustomDeck)) {
          if (!spec.FaceURL) continue;
          const ids = collectIndices(o);
          const parsed: number[] = [];
          for (const raw of ids) {
            const p = tryParseCardId(raw, o.CustomDeck, ancestorDeck);
            if (p && p.key === key) parsed.push(p.index);
          }
          const existing = hero.decks.find((d) => d.faceURL === spec.FaceURL);
          if (existing) {
            existing.instances += parsed.length;
            for (const i of parsed) if (!existing.indices.includes(i)) existing.indices.push(i);
          } else {
            hero.decks.push({
              key, faceURL: spec.FaceURL,
              spec: { w: spec.NumWidth, h: spec.NumHeight },
              indices: [...new Set(parsed)].sort((a, b) => a - b),
              instances: parsed.length,
            });
          }
        }
      }
      // 技能板（Leaflet）
      if (o.Nickname === 'Leaflet' && o.CustomImage?.ImageURL) hero.panelURL = o.CustomImage.ImageURL;
      // 骰子
      if (o.Name === 'Custom_Dice') {
        const url = o.CustomImage?.ImageURL || o.CustomMesh?.DiffuseURL || o.MeshURL;
        if (url && !hero.diceURL) hero.diceURL = url;
        if (url) hero.diceCount += 1;
      }
      // 状态令牌：Custom_Model_Infinite_Bag 的 Nickname 是状态名，子对象的贴图是图标
      if (o.Name === 'Custom_Model_Infinite_Bag' && o.Nickname) {
        const child = (o.ContainedObjects ?? [])[0];
        const url = child?.CustomImage?.ImageURL ?? child?.CustomMesh?.DiffuseURL ?? child?.MeshURL;
        if (url && !hero.statuses.some((s) => s.name === o.Nickname)) {
          hero.statuses.push({ name: o.Nickname, url });
        }
      }
    }

    for (const c of o.ContainedObjects ?? []) walk(c, currentHero, deckTable ?? null);
  };

  for (const o of mod.ObjectStates ?? []) walk(o, null, null);

  // 卡组里散落的单卡（ContainedObjects 内的 Card 对象）——walk 已通过 DeckIDs/CardID 合并进 decks
  return {
    saveName: mod.SaveName ?? '(unknown)',
    heroes: [...heroMap.values()],
    harvest: {
      ...harvest,
      nicknames: [...new Set(harvest.nicknames)],
      descriptions: [...new Set(harvest.descriptions)],
      gmNotes: [...new Set(harvest.gmNotes)],
    },
    atlasSpecs: [...atlasSpecs.values()],
  };
}

// ── 下载（带重试/超时/并发限制/本地缓存） ─────────────────────────

/** TTS 命名规则：URL 去掉所有非字母数字字符，作为缓存文件名。 */
function cacheName(url: string): string {
  const alnum = url.replace(/[^a-zA-Z0-9]/g, '');
  const short = createHash('sha1').update(url).digest('hex').slice(0, 10);
  return `${alnum.slice(0, 60)}_${short}.png`;
}

async function fetchWithRetry(url: string, timeoutMs: number, attempts: number): Promise<Response> {
  let lastErr: Error = new Error('unreachable');
  for (let i = 1; i <= attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}（注意：该 CDN 对 HEAD 返回 404，GET 一般正常）`);
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e as Error;
      if (i < attempts) await new Promise((r) => setTimeout(r, 1000 * 2 ** (i - 1)));
    }
  }
  throw lastErr;
}

async function downloadToCache(url: string, cacheDir: string, opts: { force: boolean; timeoutMs: number; attempts: number }): Promise<string> {
  const path = join(cacheDir, cacheName(url));
  if (!opts.force && existsSync(path) && statSync(path).size > 0) return path;
  const res = await fetchWithRetry(url, opts.timeoutMs, opts.attempts);
  // Steam CDN 有时对老资源返回 application/octet-stream：不信任 content-type，校验魔数
  const buf = Buffer.from(await res.arrayBuffer());
  const isPng = buf.subarray(0, 4).toString('hex') === '89504e47';
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
  const isWebp = buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  const isGif = buf.subarray(0, 3).toString('ascii') === 'GIF';
  if (!isPng && !isJpg && !isWebp && !isGif) {
    throw new Error(`响应不是图片（content-type=${res.headers.get('content-type') ?? '?'}，magic=${buf.subarray(0, 8).toString('hex')}）`);
  }
  writeFileSync(path, buf);
  return path;
}

/** 简单并发池 */
async function runPool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<{ ok: number; failed: { item: T; error: string }[] }> {
  const failed: { item: T; error: string }[] = [];
  let ok = 0;
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      try {
        await fn(item);
        ok += 1;
      } catch (e) {
        failed.push({ item, error: (e as Error).message });
      }
    }
  });
  await Promise.all(workers);
  return { ok, failed };
}

// ── 映射推断 ─────────────────────────────────────────────────────

export type Confidence = 'high' | 'medium' | 'low';
export interface MappingEntry {
  /** 落盘文件（相对 images/） */
  readonly file: string;
  readonly category: Category;
  readonly hero: string;
  /** 机器推断的 shared 逻辑 id；null = 无候选（英雄不在内容层等） */
  readonly candidateLogicalId: string | null;
  readonly confidence: Confidence;
  /** 临时 id（未确认条目在 manifest 里用它，UI 不会按它查询） */
  readonly provisionalId: string | null;
  readonly manifestLogicalId: string;
  readonly confirmed: boolean;
  readonly note: string;
  readonly source: string;
}

interface Ctx {
  outDir: string;
  dryRun: boolean;
  quality: number;
  force: boolean;
  concurrency: number;
  timeoutMs: number;
  attempts: number;
}

async function sliceCell(
  atlasPath: string,
  spec: { w: number; h: number },
  index: number,
  target: Category,
  outPath: string,
  ctx: Ctx,
  rotate180 = false,
): Promise<{ width: number; height: number }> {
  const meta = await sharp(atlasPath).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const left = Math.round((index % spec.w) * W / spec.w);
  const right = Math.round(((index % spec.w) + 1) * W / spec.w);
  const top = Math.round(Math.floor(index / spec.w) * H / spec.h);
  const bottom = Math.round((Math.floor(index / spec.w) + 1) * H / spec.h);
  // 注意：sharp 的固定操作顺序是 rotate → extract → resize。若在同一管线上又 rotate 又 extract，
  // extract 坐标会被套在**已旋转的全图**上而切错区域（实测：切出纯色空块）。
  // 因此分两段：先切出单元格，再独立旋转。
  const cell = await sharp(atlasPath)
    .extract({ left, top, width: right - left, height: bottom - top })
    .png()
    .toBuffer();
  let img = sharp(cell);
  if (rotate180) img = img.rotate(180);
  const out = await img
    .resize({ width: TARGET_WIDTH[target], withoutEnlargement: false })
    .webp({ quality: ctx.quality })
    .toBuffer({ resolveWithObject: true });
  writeFileSync(outPath, out.data);
  return { width: out.info.width, height: out.info.height };
}

async function processHero(hero: HeroRecord, atlasDirs: Map<string, string>, ctx: Ctx, categories: ReadonlySet<Category>):
Promise<{ mapping: MappingEntry[]; manifest: PackEntry[]; stats: { cards: number; panels: number; dice: number; statuses: number } }> {
  const slug = slugify(hero.ttsName);
  const sharedHeroId = SHARED_HERO_IDS.has(slug) ? slug : null;
  const mapping: MappingEntry[] = [];
  const manifest: PackEntry[] = [];
  const stats = { cards: 0, panels: 0, dice: 0, statuses: 0 };
  const imagesDir = join(ctx.outDir, 'images');

  // ── cards ──
  if (categories.has('cards')) {
    for (const deck of hero.decks) {
      const atlasPath = atlasDirs.get(deck.faceURL);
      const deckNote = sharedHeroId
        ? '位置法猜测：按 shared 牌组展开顺序对位（低置信），需人工目检确认'
        : `英雄 ${hero.ttsName} 尚不在 shared 内容层（M3）`;
      for (const idx of deck.indices) {
        const file = `${slug}/cards/card-${String(idx).padStart(2, '0')}.webp`;
        const provisionalId = `tts-${slug}-card-${String(idx).padStart(2, '0')}`;
        const candidate = sharedHeroId ? positionalCandidate(sharedHeroId, idx) : null;
        mapping.push({
          file, category: 'cards', hero: hero.ttsName,
          candidateLogicalId: candidate, confidence: candidate ? 'low' : 'low',
          provisionalId, manifestLogicalId: provisionalId, confirmed: false,
          note: deckNote,
          source: `atlas#${deck.key} idx=${idx} ${deck.spec.w}x${deck.spec.h}`,
        });
        stats.cards += 1;
        if (atlasPath && !ctx.dryRun) {
          const outPath = join(imagesDir, file);
          mkdirSync(dirname(outPath), { recursive: true });
          const dim = await sliceCell(atlasPath, deck.spec, idx, 'cards', outPath, ctx);
          manifest.push({ logicalId: provisionalId, kind: 'card', file, width: dim.width, height: dim.height, confirmed: false, source: `tts:908560170 ${hero.ttsName} idx=${idx}` });
        }
      }
    }
  }

  // ── panels ──
  if (categories.has('panels') && hero.panelURL) {
    const file = `${slug}/panels/panel.webp`;
    const logicalId = sharedHeroId; // heroPanel 逻辑 id = shared 英雄 id
    mapping.push({
      file, category: 'panels', hero: hero.ttsName,
      candidateLogicalId: logicalId, confidence: logicalId ? 'high' : 'low',
      provisionalId: logicalId ? null : `tts-${slug}-panel`,
      manifestLogicalId: logicalId ?? `tts-${slug}-panel`,
      confirmed: !!logicalId,
      note: logicalId ? 'Leaflet 技能板 → shared 英雄面板（直接可用）' : `英雄 ${hero.ttsName} 尚不在 shared 内容层`,
      source: 'Leaflet CustomImage.ImageURL',
    });
    stats.panels += 1;
    const atlasPath = atlasDirs.get(hero.panelURL);
    if (atlasPath && !ctx.dryRun) {
      const outPath = join(imagesDir, file);
      mkdirSync(dirname(outPath), { recursive: true });
      // 面板不是图集：NumWidth/NumHeight = 1
      const dim = await sliceCell(atlasPath, { w: 1, h: 1 }, 0, 'panels', outPath, ctx);
      manifest.push({ logicalId: logicalId ?? `tts-${slug}-panel`, kind: 'heroPanel', file, width: dim.width, height: dim.height, confirmed: !!logicalId, source: 'tts:908560170 Leaflet' });
    }
  }

  // ── dice ──
  if (categories.has('dice') && hero.diceURL) {
    const atlasPath = atlasDirs.get(hero.diceURL);
    for (const cell of DIE_CELL_TO_VALUE) {
      const file = `${slug}/dice/face-${cell.value}.webp`;
      const logicalId = sharedHeroId ? `${sharedHeroId}:face:${cell.value}` : null;
      mapping.push({
        file, category: 'dice', hero: hero.ttsName,
        candidateLogicalId: logicalId, confidence: logicalId ? 'medium' : 'low',
        provisionalId: logicalId ? null : `tts-${slug}-face-${cell.value}`,
        manifestLogicalId: logicalId ?? `tts-${slug}-face-${cell.value}`,
        confirmed: !!logicalId,
        note: logicalId
          ? `骰贴图 3×3 格位实测（中排 2/4/5；下排 1/3/6，其中 1、6 源图旋转 180° 已转正）→ shared ${logicalId}；建议目检一张`
          : `英雄 ${hero.ttsName} 尚不在 shared 内容层`,
        source: `Custom_Dice texture cell r${cell.row}c${cell.col}`,
      });
      stats.dice += 1;
      if (atlasPath && !ctx.dryRun) {
        const outPath = join(imagesDir, file);
        mkdirSync(dirname(outPath), { recursive: true });
        const dim = await sliceCell(atlasPath, DIE_GRID, cell.row * DIE_GRID.w + cell.col, 'dice', outPath, ctx, cell.rotate180);
        manifest.push({ logicalId: logicalId ?? `tts-${slug}-face-${cell.value}`, kind: 'dieFace', file, width: dim.width, height: dim.height, confirmed: !!logicalId, source: `tts:908560170 die cell r${cell.row}c${cell.col}` });
      }
    }
  }

  // ── statuses ──
  if (categories.has('statuses')) {
    for (const st of hero.statuses) {
      const file = `${slug}/statuses/${slugify(st.name)}.webp`;
      const candidate = STATUS_NAME_TO_SHARED[st.name.toLowerCase()] ?? null;
      mapping.push({
        file, category: 'statuses', hero: hero.ttsName,
        candidateLogicalId: candidate, confidence: candidate ? 'high' : 'low',
        provisionalId: candidate ? null : `tts-${slug}-status-${slugify(st.name)}`,
        manifestLogicalId: candidate ?? `tts-${slug}-status-${slugify(st.name)}`,
        confirmed: !!candidate,
        note: candidate ? `状态令牌名精确匹配 → ${candidate}` : `状态 "${st.name}" 在 shared 内容层无对应（新增内容时回填）`,
        source: 'Custom_Model_Infinite_Bag child tile',
      });
      stats.statuses += 1;
      const atlasPath = atlasDirs.get(st.url);
      if (atlasPath && !ctx.dryRun) {
        const outPath = join(imagesDir, file);
        mkdirSync(dirname(outPath), { recursive: true });
        const dim = await sliceCell(atlasPath, { w: 1, h: 1 }, 0, 'statuses', outPath, ctx);
        manifest.push({ logicalId: candidate ?? `tts-${slug}-status-${slugify(st.name)}`, kind: 'statusIcon', file, width: dim.width, height: dim.height, confirmed: !!candidate, source: `tts:908560170 status ${st.name}` });
      }
    }
  }

  return { mapping, manifest, stats };
}

/**
 * 位置法候选：把 shared 牌组按 count 展开成 33 张的序列，TTS 卡组索引直接对位。
 * 官方与自制的共同部分（common 卡在前）大致成立，但排序无 JSON 证据 → 一律 low。
 */
function positionalCandidate(heroId: string, ttsIndex: number): string | null {
  const expansion = DECK_EXPANSIONS.get(heroId);
  if (!expansion) return null;
  return expansion[ttsIndex] ?? null;
}

/** 由 heroes.ts 快照手工展开（本脚本不 import shared；内容层变更时同步此处并重跑 --dry-run） */
const DECK_EXPANSIONS = new Map<string, readonly string[]>([
  ['pyromancer', expandDeck([
    ['common:minorHeal', 3], ['common:quickStudy', 3], ['common:focus', 3], ['common:powerSurge', 3], ['common:evasiveManeuver', 2],
    ['pyromancer:fireball:2', 2], ['pyromancer:fireball:3', 1], ['pyromancer:ignite:2', 2], ['pyromancer:combustion:2', 1], ['pyromancer:moltenArmor:2', 1],
  ])],
  ['barbarian', expandDeck([
    ['common:minorHeal', 3], ['common:quickStudy', 3], ['common:focus', 3], ['common:powerSurge', 3], ['common:evasiveManeuver', 2],
    ['barbarian:heavyBlow:2', 2], ['barbarian:heavyBlow:3', 1], ['barbarian:whirlwind:2', 2], ['barbarian:whirlwind:3', 1], ['barbarian:reckless:2', 1], ['barbarian:ironWill:2', 1],
  ])],
]);
function expandDeck(spec: readonly (readonly [string, number])[]): string[] {
  const out: string[] = [];
  for (const [id, n] of spec) for (let i = 0; i < n; i++) out.push(id);
  return out;
}

interface PackEntry {
  readonly logicalId: string;
  readonly kind: 'card' | 'heroPanel' | 'dieFace' | 'statusIcon';
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly confirmed: boolean;
  readonly source?: string;
}

// ── main ─────────────────────────────────────────────────────────

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (flag: string): boolean => process.argv.includes(flag);

async function main(): Promise<void> {
  const modPath = resolve(argValue('--mod') ?? DEFAULT_MOD);
  const outDir = resolve(argValue('--out') ?? DEFAULT_OUT);
  const cacheDir = resolve(argValue('--cache') ?? DEFAULT_CACHE);
  const dryRun = hasFlag('--dry-run');
  const force = hasFlag('--force');
  const quality = Number(argValue('--quality') ?? 82);
  const concurrency = Number(argValue('--concurrency') ?? 2);
  const timeoutMs = Number(argValue('--timeout-ms') ?? 120000);
  const attempts = Number(argValue('--attempts') ?? 3);
  const onlyNames = argValue('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
  const categories = new Set<Category>(
    (argValue('--categories')?.split(',').map((s) => s.trim()).filter(Boolean) ?? ['cards', 'panels', 'dice', 'statuses']) as Category[],
  );
  const ctx: Ctx = { outDir, dryRun, quality, force, concurrency, timeoutMs, attempts };

  console.log(`[tts-import] mod = ${modPath}`);
  const mod = JSON.parse(readFileSync(modPath, 'utf8')) as TtsMod;
  const parsed = parseMod(mod);

  let heroes = parsed.heroes;
  if (onlyNames) heroes = heroes.filter((h) => onlyNames.some((n) => h.ttsName.toLowerCase() === n.toLowerCase()));
  console.log(`[tts-import] 英雄（Bag）= ${parsed.heroes.map((h) => h.ttsName).join(', ')}`);
  console.log(`[tts-import] 本次处理 = ${heroes.map((h) => h.ttsName).join(', ') || '（无）'}`);
  console.log(`[tts-import] 唯一图集 = ${parsed.atlasSpecs.length}`);

  // 规格分布
  const specDist = new Map<string, number>();
  for (const a of parsed.atlasSpecs) {
    const k = `${a.w}x${a.h}`;
    specDist.set(k, (specDist.get(k) ?? 0) + 1);
  }
  console.log(`[tts-import] 图集规格分布 = ${[...specDist.entries()].sort().map(([k, v]) => `${k}×${v}`).join(', ')}`);

  const totalSlices = heroes.reduce((acc, h) => acc + h.decks.reduce((n, d) => n + d.indices.length, 0), 0);
  console.log(`[tts-import] 待切片卡面 = ${totalSlices}${dryRun ? '（dry-run：不下载不写图）' : ''}`);

  // ── 下载（去重 URL）──
  const urls = new Set<string>();
  for (const a of parsed.atlasSpecs) urls.add(a.url);
  for (const h of heroes) {
    if (h.panelURL) urls.add(h.panelURL);
    if (h.diceURL) urls.add(h.diceURL);
    for (const s of h.statuses) urls.add(s.url);
  }
  const atlasDirs = new Map<string, string>();
  if (!dryRun) {
    mkdirSync(cacheDir, { recursive: true });
    console.log(`[tts-import] 下载 ${urls.size} 个唯一资源 → ${cacheDir}（并发 ${concurrency}）`);
    const urlList = [...urls];
    const res = await runPool(urlList, concurrency, async (url) => {
      const path = await downloadToCache(url, cacheDir, { force, timeoutMs, attempts });
      atlasDirs.set(url, path);
    });
    for (const f of res.failed) console.error(`[tts-import] 下载失败: ${f.item} —— ${f.error}`);
    console.log(`[tts-import] 下载成功 ${res.ok}/${urlList.length}，失败 ${res.failed.length}`);
    if (res.failed.length > 0 && res.ok === 0) {
      console.error('[tts-import] 全部下载失败，中止写图（映射草稿仍会输出）');
    }
  }

  // ── 切片 + 映射 ──
  const allMapping: MappingEntry[] = [];
  const allManifest: PackEntry[] = [];
  let totals = { cards: 0, panels: 0, dice: 0, statuses: 0 };
  for (const hero of heroes) {
    const r = await processHero(hero, atlasDirs, ctx, categories);
    allMapping.push(...r.mapping);
    allManifest.push(...r.manifest);
    totals = { cards: totals.cards + r.stats.cards, panels: totals.panels + r.stats.panels, dice: totals.dice + r.stats.dice, statuses: totals.statuses + r.stats.statuses };
    console.log(`[tts-import] ${hero.ttsName}: 卡 ${r.stats.cards}（实例 ${hero.decks.reduce((n, d) => n + d.instances, 0)}）· 面板 ${r.stats.panels} · 骰面 ${r.stats.dice} · 状态 ${r.stats.statuses}`);
  }

  // ── 产出 ──
  mkdirSync(outDir, { recursive: true });
  const manifestPath = join(outDir, 'manifest.json');
  if (!dryRun) {
    const manifestJson = {
      pack: 'local-tts',
      modWorkshopId: 908560170,
      generatedAt: new Date().toISOString(),
      entries: allManifest,
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifestJson, null, 2)}\n`);
  } // dry-run 不写 manifest.json：防止用空清单覆盖已有导入结果

  const autoHigh = allMapping.filter((m) => m.confirmed && m.confidence === 'high').length;
  const autoMed = allMapping.filter((m) => m.confirmed && m.confidence === 'medium').length;
  const manual = allMapping.filter((m) => !m.confirmed).length;
  const draft = {
    generatedAt: new Date().toISOString(),
    mod: modPath,
    summary: {
      slices: allMapping.length,
      autoConfirmedHigh: autoHigh,
      autoConfirmedMedium: autoMed,
      needsHumanReview: manual,
      byHero: Object.fromEntries(heroes.map((h) => [h.ttsName, allMapping.filter((m) => m.hero === h.ttsName).length])),
    },
    entries: allMapping,
  };
  writeFileSync(join(outDir, 'mapping.draft.json'), `${JSON.stringify(draft, null, 2)}\n`);

  const meta = {
    source: { workshopId: 908560170, saveName: parsed.saveName, modPath, extractedAt: new Date().toISOString() },
    heroes: heroes.map((h) => ({
      ttsName: h.ttsName,
      slug: slugify(h.ttsName),
      inSharedContentLayer: SHARED_HERO_IDS.has(slugify(h.ttsName)),
      deck: h.decks.map((d) => ({ atlasKey: d.key, spec: `${d.spec.w}x${d.spec.h}`, distinctSlices: d.indices.length, instances: d.instances, indices: d.indices })),
      diceCount: h.diceCount,
      panelURL: h.panelURL,
      statuses: h.statuses.map((s) => ({ name: s.name, sharedCandidate: STATUS_NAME_TO_SHARED[s.name.toLowerCase()] ?? null })),
    })),
    nonHeroBags: [...NON_HERO_BAGS],
    atlasSpecs: parsed.atlasSpecs.map((a) => ({ spec: `${a.w}x${a.h}`, url: a.url })),
    harvest: parsed.harvest,
  };
  writeFileSync(join(outDir, 'extracted-meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

  console.log(`[tts-import] 映射草稿：高置信 ${autoHigh} · 中置信 ${autoMed} · 待人工 ${manual} → ${join(outDir, 'mapping.draft.json')}`);
  console.log(`[tts-import] manifest 条目 ${allManifest.length} → ${manifestPath}${dryRun ? '（dry-run：条目为空，重跑非 dry-run 生成）' : ''}`);
  console.log(`[tts-import] extracted-meta.json → ${join(outDir, 'extracted-meta.json')}`);
}

main().catch((e) => {
  console.error('[tts-import] 失败:', e);
  process.exit(1);
});
