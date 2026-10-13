# 资产层（assets/）

> 架构约束（裁决，勿推翻）：`packages/shared` 内容层**不含任何图片引用**；本目录的
> manifest 是全项目唯一的「逻辑 id → 资产」耦合点。本目录**不 import shared**，
> 逻辑 id 通过 `scripts/gen-asset-catalog.ts` 生成快照桥接（`catalog.ts`）。

## 三层结构

```
assets/
  types.ts        契约：AssetKind / AssetPack / AssetRef / CatalogEntry
  catalog.ts      ⚠️ 生成文件：45 条「逻辑 id + 展示元数据」（勿手改）
  manifest.ts     resolveAsset：fallback 链解析，永不返回 null（占位兜底）
  placeholder.ts  程序化 SVG 占位图（确定性，零依赖）
  assets.test.ts  资产层单测（node --test，无 DOM/Vite 依赖）
  packs/
    placeholder/  内置兜底包（generated，永 resolve 成功）
    local-tts/    TTS 导入包（908560170 英文官方脚本版）
      manifest.json        真实素材清单（入库）
      mapping.draft.json   切片→逻辑 id 映射草稿（入库，待人工确认）
      extracted-meta.json  mod 文本元数据（入库，供数值交叉校验）
      images/              真图（**不入库**，见根 .gitignore）
      vite.ts / index.ts   包实现（index 可测，vite 负责浏览器 URL 表）
    reskin/       换皮预留包（结构同 local-tts，manifest 有条目即生效）
```

## UI 用法

```ts
import { bootstrapAssets, resolveAsset, setActivePack } from './assets/index.js';

bootstrapAssets();                       // 注册 local-tts + reskin，激活 local-tts
const ref = resolveAsset('common:burn', 'statusIcon');
<img src={ref.url} />                    // ref.source === 'file' 真图 | 'generated' 占位
ref.substituted                          // true = 该包缺图，落到了兜底（占位图上已标注「缺图: <包名>」）

setActivePack('reskin');                 // 切包即时生效
resolveAsset('pyromancer', 'heroPanel', { pack: 'placeholder' }); // 也可单次指定
```

- 逻辑 id 必须来自 catalog（来源 = shared 内容层 + `background:table` 表现层 id），
  未知 id 直接抛错 —— id 不许发明，`scripts/gen-asset-catalog.ts --check` 在 CI 守门。
- fallback 链默认 `[当前激活包, 'placeholder']`，可用 `opts.chain` 覆盖
  （如 `['reskin', 'local-tts']`），末尾强制补 `'placeholder'`。
- 占位图按 kind 有默认尺寸（卡 380×590 / 面板 800×1100 / 图标 256），可用 `opts.width/height` 覆盖。

## 命令

```bash
# 生成/校验 catalog（id lint：孤立 id、遗漏 id、包 manifest 合法性）
node --import tsx scripts/gen-asset-catalog.ts            # 内容层变更后重新生成
node --import tsx scripts/gen-asset-catalog.ts --check    # CI 守门（不写盘）

# 资产层单测
node --import tsx --test packages/web/src/assets/assets.test.ts
```

## 导入 TTS 真实素材

```bash
# 1. 先 dry-run：只解析 mod + 产出映射草稿，不下载不写图（快速迭代）
node --import tsx scripts/import-tts-assets.ts --dry-run

# 2. 实际导入（下载图集 → 本地缓存 .tts-cache/ → 切片 → webp 落盘 images/）
node --import tsx scripts/import-tts-assets.ts

# 常用选项
--only Pyromancer,Barbarian       # 只处理指定英雄（按 TTS Bag Nickname）
--categories cards,panels,dice,statuses
--concurrency 2                   # 下载并发（默认 2，别打挂 CDN）
--force                           # 忽略缓存重新下载
--quality 82                      # webp 质量
```

输入默认取本机 `Tabletop Simulator/Mods/Workshop/908560170.json`（可用 `--mod` 覆盖）。
下载缓存放仓库根 `.tts-cache/`（已 gitignore）；真图落到 `packs/local-tts/images/`（已 gitignore）。

### 产出

| 文件 | 入库 | 说明 |
|---|---|---|
| `images/<hero>/cards/card-NN.webp` | 否 | 卡面，宽 400px；NN = 图集 0-based 切片索引 |
| `images/<hero>/panels/panel.webp` | 否 | Leaflet 技能板，宽 800px |
| `images/<hero>/dice/face-N.webp` | 否 | 骰面（贴图 3×3 取 6 格，1/6 已转正），宽 256px |
| `images/<hero>/statuses/<name>.webp` | 否 | 状态令牌图标，宽 256px |
| `manifest.json` | **是** | local-tts 包清单；已确认条目用 shared id，未确认用 `tts-<hero>-card-NN` 临时 id（`confirmed: false`） |
| `mapping.draft.json` | **是** | 每个切片 → 候选逻辑 id + 置信度 + 备注，供人工确认 |
| `extracted-meta.json` | **是** | 英雄/卡组/状态/图集规格 + 全量 Nickname/Description/GMNotes 文本 |

### 切片规则（实测确认，改前必须重验）

- `CardID = <CustomDeck 键><两位索引>`，索引 **0-based**（25/25 图集最小索引为 0；
  Pyromancer 33 张 = `42200..42232`）。
- 行优先：`row = floor(idx / NumWidth)`、`col = idx % NumWidth`。
  （⚠️ 早期「1-based 减一」规则是错的：idx 0 会越界、idx 32 会落到图集填充区。）
- 骰子贴图 3×3（顶排空白）：中排 = 点数 2/4/5；下排 = 1/3/6，其中 **1、6 源图旋转 180°**
  （导入时转正，3 正立不动）。已逐面目检 Pyromancer 并抽查 Gunslinger，其余英雄同模板。
- 图集 CDN 对 HEAD 返回 404，必须 GET（导入器已按 GET + 重试实现）。

### 人工确认流程

1. 打开 `mapping.draft.json`，按 `confidence` 从高到低核对 `candidateLogicalId`
   （卡面候选是**位置法猜测**，置信一律 low，必须目检卡图上的卡名）。
2. 确认无误后：把 `manifest.json` 里对应条目的 `logicalId` 改为 shared id、`confirmed: true`
   （文件名不必改）；lint 会拒绝发明 id。
3. 重跑 `node --import tsx scripts/gen-asset-catalog.ts --check` 应保持绿色。
