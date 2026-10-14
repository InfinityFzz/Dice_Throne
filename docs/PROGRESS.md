# 项目进度与计划

> 更新时间：2026-10-14（阶段 A 完成，P0 清零；提交见 §一）
> 定位：**自用学习**，不公开部署、不分发、不商用；规则以官方为准；回合制不限时。
> 设计/架构原始文档在 `md/`（架构文档 `md/docs/architecture/`，设计文档 `md/design/`）；
> 官方数值校对记录在 `docs/content-audit-report.md`。

---

## 一、当前进度总览

| 里程碑 | 定义 | 状态 |
|---|---|---|
| **M0** | 规则引擎跑通单局脚本对战（确定性、可复现） | ✅ **完成**（且超额：两英雄已官方校准） |
| **M1** | 本地可对战，UI 走完整回合流程 | ✅ **完成**（本地热座 + 出牌闭环，见 §阶段 A） |
| **M2** | 联机完整联调（权威校验、重连、持久化恢复） | 🟡 **服务端骨架在，未联调** |
| **M3** | 4+ 英雄完整内容 | 🔵 **2/2 已校准，图已备好其余 5 英雄** |

提交历史（6 次）：

```
5b5cf14  新增 PROGRESS.md（进度/缺口/计划），同步 README 与 AGENTS
28e2adb  Barbarian 专属卡 5 张 + 卡名批量确认（真图命中 23/84 → 66/89）
b33ffc4  资产层接入 UI（启动即加载真实素材）
7ba14db  Pyromancer 官方校准 + 官方行动卡层 + 引擎机制扩展
f71eea6  Barbarian 官方数值校准
fbdedc7  M0 规则引擎 + TTS 素材资产隔离层
```

代码规模：约 6.6k 行 TS/TSX（引擎 ≈2.4k、内容层 ≈1.3k、服务端 108、前端 ≈0.5k、脚本 ≈2k）。

---

## 二、已交付清单

### 1. 规则引擎（`packages/shared/src/engine`）

- 阶段状态机 + **结算阶梯 P1–P8**（`ladderStep`，与 design §2.3 对齐）+ EffectQueue。
- **伤害分桶 `DamageBucket`**：HP 只在 P6 flush 被写一次；`DamageType`（4 值）× `DamageSourceKind`（4 值）× `TargetRef` 三轴正交；反伤 = `pure`。
- 挂起/恢复 `pending`：待响应动作、选项列表、座位归属；回合制不限时，无倒计时。
- 骰型匹配器 `matcher.ts`：同类 / 顺子 / 分档 / 组合；防御能力 matcher 以防御骰为作用域求值。
- 随机 `rng.ts`：sfc32 种子化、命名流、种子不下发；同种子逐字节可复现。
- 视图投影 `project.ts`：**白名单构造**，per-seat `PlayerView` 字段层面不存在 rng / 牌库顺序 / bucket。
- 动作管线已实现的动作：`selectHero / ready / playCard / buyUpgrade / sellCard / endMainPhase / performRoll / toggleLock / announceAbility / passAbility / defensiveRoll / respondPass / chooseOption / discardCards / concede`。

已为官方机制扩展的引擎能力（第二轮）：

| 能力 | 用途 |
|---|---|
| `dealDamage.recoilOnHit` | 条件反噬（Reckless：目标 net ≥ 1 才反噬） |
| `rollDicePool.perDie` | 每颗命中骰各结算一次（Pyroblast / Get Some!） |
| `increaseStackLimit` | per-player `statusCapOverrides`（Fire Up!） |
| `Expr.ceilDiv` / `adjustDie` / `copyDieFace` | Vegas Baby! / Tip It! / Samesies! |
| `transferStatus 'any'` / `rerollDice` 带目标 | Transference! / Helping Hand |

### 2. 内容层（`packages/shared/src/content`）

| 英雄 | HP | 骰 | 能力槽 | 牌库 | 状态 |
|---|---|---|---|---|---|
| Barbarian 狂战士 | 50 | 5 | 10 | 33（升级 10 + 专属 5 + 通用 18） | 官方校准 |
| Pyromancer 焰术士 | 50 | 5 | 9 | 33（升级 10 + 专属 5 + 通用 18） | 官方校准 |

- 卡牌 **48 张**（通用 18 + Barbarian 15 + Pyromancer 15），全部读官方卡图机制化，无官方 flavor text。
- 状态库 **7 个**：burn / poison / evasive / fireMastery / stun / concussion / knockdown。
- 已知偏差（记录在审计报告 §10）：双英雄 **L1 与 Ultimate 数值为占位**；Smack 的 4-of-a-kind 不可防御、Fortitude 的 3-of-a-kind 移除状态缺引擎条件；Better D! 空效果（待防御重掷窗口）。

### 3. 服务端（`packages/server/src`）

Socket.IO 房间：加入/座位分配、per-seat 广播投影、动作校验（`reduce` 返回错误即拒绝）、断线不判负（保留座位）、JSONL 追加持久化（当前仅摘要行：`seq/turn/ts`）。

### 4. 前端（`packages/web/src`）

- Vite + React，房间加入、骰盘锁定/重掷、能力激活、阶段推进、日志。
- **资产层接入**（`b33ffc4`）：`bootstrapAssets()` 启动即注册真实素材包；`AssetImage` 单一渲染入口（缺图自动落占位 SVG，永不白屏）；`AssetAudit` 自检面板显示命中率与预览。
- 已渲染：英雄面板、骰面、状态图标、手牌卡图、能力图标。

### 5. 资产层（`packages/web/src/assets`）

- 三档资源包：`placeholder`（程序化 SVG，入库）/ `local-tts`（本地 TTS 导入，**真图不入库**）/ `reskin`。
- TTS 官方图包切片 **300 张**（7 英雄 × cards/dice/panels/statuses），OCR 卡名 230 条。
- 命中率 **66/89**（card 类 48/48 全命中）；剩余缺 23 = abilityIcon 19 + statusIcon 3 + background 1，均为 TTS 图包本身没有的图。
- 工具链：`npm run assets:import`（切片+OCR）、`assets:catalog`（生成目录）、`assets:check`（守门）、`assets:confirm`（卡名批量确认）。

### 6. 验收指标（当前）

```
3 包 tsc --noEmit       零错误
npm test（引擎单测）     22 / 22
npm run test:assets     10 / 10
npm run assets:check    89 条目录项，无孤立/遗漏
npm run match           完整局（25 回合），同种子 md5 一致
```

---

## 三、缺口清单（按优先级）

### ~~P0 —— 阻塞「能玩起来」~~（2026-10-14 已全部清零）

1. ✅ 出牌闭环：`playCard / buyUpgrade / sellCard / chooseOption / discardCards` 全部有 UI 入口。
2. ✅ `legalActions` 下发（架构 §2.2.3）：新增 `engine/legal.ts`，UI 只渲染这个集合。
3. ✅ T14 投影泄漏属性测试（架构 §2.2.2）：`engine/legal.test.ts`。

### P1 —— 阻塞「联机可靠」

4. **`MatchActor` 串行命令队列**（架构 §1.3「必须在 M1 落地」）：当前 `game:action` 直接同步 `reduce`，多事件并发时无串行化保证。
5. **持久化不可恢复**：JSONL 只写摘要，进程重启无法重建对局。需全量快照或事件日志回放（用户拍板后持久化已升 P1）。
6. **断线重连**：座位已保留，但重连后无 `rejoin` 身份校验与状态重放。
7. **房间英雄选择**：`room:join` 只取 `heroId` 参数，UI 无选人界面。

### P2 —— 阻塞「内容完整」

8. **`describe(e, lang)` 描述层**（design E6 / 附录 A 第 7 条）：缺一个 kind 即 lint 失败、内容不允许上线。
9. **引擎条件补全**：4-of-a-kind（Smack 不可防御）、3-of-a-kind（Fortitude 移除状态）、防御重掷窗口（Better D!）。
10. **两个 Ultimate 为占位**：`barbarian:bloodlust`（血怒）、`pyromancer:scorchTheEarth`（焦土）。
    L1 数值已齐备（Barbarian 官方技能板 / Pyromancer 升级卡面），无需补。
11. **其余 5 英雄**：Gunslinger / ShadowThief / MoonElf / Ninja / Raveness —— 卡图与卡名已就位，实装后扩 `name-map.json` 再跑 `assets:confirm` 即可自动挂图。

---

## 四、下一步计划

### 阶段 A：M1 收尾（可玩闭环） ✅ 已完成 2026-10-14

| # | 任务 | 状态 |
|---|---|---|
| A1 | 合法动作下发 `legalActions`，UI 按集合渲染 | ✅ `engine/legal.ts` + 投影下发 |
| A2 | 手牌点击出牌（行动卡/升级卡/卖牌换 CP） | ✅ 卡片上「打出 / 卖 +1」按钮 |
| A3 | `chooseOption` 选择 UI | ✅ 按 pending.options 渲染 |
| A4 | 买升级入口（按 CP 与 tier 可选） | ✅ 能力面板「升 L2/L3」 |
| A5 | T14 投影泄漏属性测试 | ✅ `engine/legal.test.ts` |
| A6 | 本地热座模式 | ✅ `web/src/local.ts`，浏览器内跑引擎 |

验收：`npm run dev:web` 打开即可打完一局（默认本地热座），无需服务端。

### 阶段 B：M2 联机

| # | 任务 | 验收 |
|---|---|---|
| B1 | `MatchActor` 串行命令队列 + `clientSeq` 幂等 | 并发动作不丢不乱序 |
| B2 | 持久化：事件日志/快照可重建对局 | kill -9 后重启能恢复 |
| B3 | 断线重连：`rejoin` 校验 + 状态重放 | 刷新页面回到原座位继续 |
| B4 | 房间选人界面 + 观战位 | 两个浏览器可自选英雄开局 |
| B5 | 端到端联调：两个客户端完整一局 | 服务端权威校验全程无泄漏 |

### 阶段 C：M3 内容

| # | 任务 | 验收 |
|---|---|---|
| C1 | `describe()` 描述层 + lint 守门 | 缺 kind 即 CI 失败 |
| C2 | 引擎条件补全（4/3-of-a-kind、防御重掷） | Smack / Fortitude / Better D! 语义正确 |
| C3 | 补齐 L1 / Ultimate 官方数值 | 占位项清零 |
| C4 | 其余 5 英雄实装（图与卡名现成） | 真图命中率同步提升到 ≈85% |

---

## 五、待决事项

| 项 | 现状 | 需谁定 |
|---|---|---|
| IP 路径 | 自用学习、真素材不入库、零官方文本 | 已拍板，保持不变 |
| 官方数值来源 | 英文 TTS mod（908560170）读图；**两个 Ultimate 仍占位** | 用户订阅中文版 mod（3446854288）后按 SOP 接入（见审计报告 §14） |
| 5 英雄优先级 | 图与卡名齐备，实装顺序未定 | 用户指定（建议 Gunslinger → MoonElf → Ninja） |
| 下一步方向 | 阶段 A 完成 | 用户选择：M2 联机联调 / M3 加英雄 / 先补引擎条件与 Ultimate |
