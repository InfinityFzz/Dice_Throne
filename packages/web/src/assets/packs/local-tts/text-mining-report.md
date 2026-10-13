# 卡名文本挖掘报告（text-mining-report）

> 任务：DT-OCR-001 · 目标 —— 在不 OCR 的前提下，尽量从 TTS 模组内部文本确定 230 张卡面各自是哪张牌。
> 结论先行：**从模组文本挖到 0 个卡名（覆盖率 0%）**。该模组的自动化脚本是「位置/状态驱动」而非「卡名驱动」，
> 卡名只存在于卡图位图里。因此本任务的卡名必须走 OCR（见 `ocr-results.json`）。
> 下面是可复现的排查过程与证据，以及顺带挖到的、确实有用的结构信息。

- 数据源：`D:\Users\InfinityFzz\Documents\My Games\Tabletop Simulator\Mods\Workshop\908560170.json`（1 306 806 B）
- 模组：`Dice Throne [official] [scripted]` v13.3（脚本署名 `Script by Ken Cunningham with CodedCardboard`）
- 排查时间：本次会话；脚本化产物 = 顶层 `LuaScript` + 各对象 `LuaScript`/`Description`/`GMNotes`/`Nickname`/`XmlUI`

---

## 1. 扫了哪些字段、怎么扫的

对整份 JSON 做了**递归全字段遍历**（不是只看顶层），把所有字符串值收集起来统一分析：

| 字段 | 命中数 | 总字符量级 | 是否含卡名 |
|---|---|---|---|
| `LuaScript`（顶层全局） | 1 | 21 559 | ❌ 仅 onload 编排 / 按钮注册 |
| `LuaScript`（各对象） | 38 | 3 874–16 320 | ❌ Flex Table 控件、CP/HP 计数器、Feather 令牌 |
| `LuaScriptState` | 0 | — | 空 |
| `XmlUI` | 1 | 81 | ❌ 仅一行 HTML 注释 |
| `Description` | 24 | ≤92 | ❌ 仅弃牌堆说明、状态名 |
| `GMNotes` | 90 | 4 | ❌ 全部是字面量 `Demo` |
| `Nickname` | 57 | — | ❌ 仅英雄名/状态令牌名/物件名（见 §4） |
| `Name` / `Tooltip` | — | — | ❌ 仅 TTS 内置类型名 |
| `TabStates` / `Note` / `Tags` | — | — | ❌ 空白 / 默认规则页 |

共 6 302 个字符串值、182 个不同的「首字母大写短语」。

### 关键否证证据

1. **Title Case 词频表**（首字母大写、1–4 词的短语，按频次降序取前 80）里，
   高频项全是 TTS/脚本自身的词：`Card ×353`、`Demo ×92`、`Activates ×84`、`Global ×74`、
   `Scale/Adds/Prevents/Subtracts` 等 —— 没有任何一项是骰铸卡名。
2. **针对性关键词 grep**（卡名最可能出现的形式）：`Transference`=0、`Fireball`=0、`Slash`=0、
   `Ultimate`=0、`Bash`=0、`Meditate`=0。只有 `Damage`×4、`Heal`×6（出现在 CP/HP 计数器的
   通用日志模板里，不是卡名）。
3. **顶层 `LuaScript` 通读**：全部是 `getObjectFromGUID` 取对象 → `createButton` 注册按钮 →
   `setInvisibleTo` 收尾。全文没有卡名常量表、没有卡组定义数组、没有 `CardID → 卡名` 字典。
4. **本机其它 TTS 数据也没有**：扫描了 `Mods/Workshop/*.json`（20 个工坊物品）、
   `Saves/*.json`（7 个存档）、`Mods/Text`、`Mods/Assetbundles` —— 与骰铸相关的只有 908560170 本身，
   `grep -i fireball` 全库仅命中另一个无关模组（Black Rose Wars）。

> 为什么脚本里没有卡名也合理：这套脚本靠**座位/区域/计数器**驱动（谁在哪个 Zone 里、CP/HP 多少），
> 卡牌本身是「哑」位图切片，牌义由玩家按纸质规则执行。所以它没有必要保存卡名。

---

## 2. 顺带挖到的、确实有用的结构信息

虽然没有卡名，但这次遍历把「切片 ↔ 牌堆槽位」的对应关系钉死了，OCR 之后的映射全靠它：

### 2.1 英雄容器（Bag）与卡组

| Bag `Nickname` | GUID | 卡组 GUID | 图集键 `CustomDeck` key | 图集规格 | 切片数 |
|---|---|---|---|---|---|
| Gunslinger | `cb1264` | `8771a8` | 137 | 10×7 | 33 |
| Pyromancer | `bf9830` | `b04f63` | 422 | 10×7 | 33 |
| ShadowThief | `deb7f6` | `8bdb9e` | 421 | 10×7 | 33 |
| MoonElf | `ae8a07` | `8b2ff2` | 449 | 10×7 | 33 |
| Barbarian | `c895fd` | `c67b01` | 773 | 10×7 | 33 |
| Ninja | `353683` | `fd77b4` | 1202 | 10×7 | 33 |
| Raveness | `fff34c` | `6a1c91` | 774 | 10×7 | 32 |

- `DeckIDs` 是 33 个**互不重复**的 `CardID`，形如 `42200..42232`（每英雄 = `<图集键>00..<图集键>32`）；
  由导入器已实测确认的规则 `CardID = <CustomDeck 键> + <两位 0-based 索引>`，
  可反推每张卡在图集里的**格位索引**，也就是 `card-NN.webp` 的 `NN`。
- 顶层脚本里另有各英雄的**状态令牌袋**（Stun / Burn / Poison / …），
  它们与卡组无关，是 §4 里已确认的 statusIcon 来源。

### 2.2 非英雄容器
`Box`（空盒）、`DTA Demo`（骰铸冒险 Demo，87 个子对象，Deck/DeckCustom 混装，不是英雄卡组）。

---

## 3. 覆盖率结论

| 指标 | 数值 |
|---|---|
| 卡面总数 | 230 |
| **从模组文本确定的卡名** | **0** |
| 覆盖率 | **0 %** |

→ 卡名必须来自卡图 OCR。这部分结果见 `ocr-results.json` 与 `review-queue.md`。

---

## 4. 未做 OCR 而已能确定的资产（本次不新增，仅记录）

这些在上一轮 DT-ASSET-001 已确认并写进 `manifest.json`（`confirmed: true`），
本次遍历再次验证其来源字段就是 `Nickname`：

- `statusIcon`：来自状态令牌袋的 `Nickname`（如 `Evasive` → `common:evasive`）。
- `heroPanel`：来自 `Leaflet` 物件。
- `dieFace`：来自 `Custom_Dice` 的 `CustomDeck` 贴图（3×3 取 6 格）。

## 5. 复现方式

```bash
# 1) 递归收集全部字符串字段
node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.env.MOD,'utf8'));const s=[];(function w(o){if(o==null)return;if(typeof o==='string')return void s.push(o);if(Array.isArray(o))return o.forEach(w);if(typeof o==='object')return Object.keys(o).forEach(k=>w(o[k]));})(j);console.log(s.length)"

# 2) 针对性关键词
grep -o -i -E 'transference|fireball|ultimate|meditate' "$MOD" | sort | uniq -c
```

> 注：`MOD="D:/Users/InfinityFzz/Documents/My Games/Tabletop Simulator/Mods/Workshop/908560170.json"`
