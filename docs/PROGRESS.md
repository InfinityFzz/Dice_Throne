# 项目进度与计划

> 更新时间：2026-10-14（**Shadow Thief 实装完成，M3 4/7 英雄**）
> 定位：**自用学习**，不公开部署、不分发、不商用；规则以官方为准；回合制不限时。
> 设计/架构原始文档在 `md/`（架构文档 `md/docs/architecture/`，设计文档 `md/design/`）；
> 官方数值校对记录在 `docs/content-audit-report.md`。

---

## 一、当前进度总览

| 里程碑 | 定义 | 状态 |
|---|---|---|
| **M0** | 规则引擎跑通单局脚本对战（确定性、可复现） | ✅ **完成**（且超额：四英雄已官方校准） |
| **M1** | 本地可对战，UI 走完整回合流程 | ✅ **完成**（本地热座 + 出牌闭环，见 §阶段 A） |
| **M2** | 联机完整联调（权威校验、重连、持久化恢复） | ✅ **完成**（`npm run e2e` 全绿，见 §阶段 B） |
| **M3** | 4+ 英雄完整内容 | 🔵 **4/7 实装**（Barbarian/Pyromancer/Gunslinger/ShadowThief 全部官方校准；余 3 英雄图已备好） |

提交历史（16 次）：

```
e9bac23  ShadowThief 实装 —— M3 第二位新英雄：4 项引擎扩展 + 三源校准零推定值（单测 247 → 310）
7462242  Gunslinger 实装 —— M3 第一位新英雄：4 项引擎扩展 + 三源校准零推定值（单测 184 → 247）
ee85cb9  docs: O-1 销项 + content-lint 前置完成记录（单测 184）
330d9da  content-lint 中文名守门 + 升级卡名中文化（M3 前置）
0a527fc  O-1 坐实并修复 —— postDefense 卡时机、伤害记账方向、打出门槛
e15c0f3  docs: 同步阶段 C 完成后的提交历史（10 次）
81ac6b1  C2 引擎条件三项全 PASS + C3 矛盾注释清理（单测 165 → 177）
4660c06  C1 描述层 describe(e, lang) —— 30 种 clause kind 全覆盖 + lint 守门（单测 41 → 165）
6d6dcf6  M2 联机完整联调 —— MatchActor 串行幂等 + append-only 持久化 + 重连/观战/选人
dad1abb  引擎条件补全 + 两个 Ultimate 官方值 + 中文包评估
5bddd0a  可玩闭环 —— legalActions 下发 + 出牌 UI + 本地热座
5b5cf14  新增 PROGRESS.md（进度/缺口/计划），同步 README 与 AGENTS
28e2adb  Barbarian 专属卡 5 张 + 卡名批量确认（真图命中 23/84 → 66/89）
b33ffc4  资产层接入 UI（启动即加载真实素材）
7ba14db  Pyromancer 官方校准 + 官方行动卡层 + 引擎机制扩展
f71eea6  Barbarian 官方数值校准
fbdedc7  M0 规则引擎 + TTS 素材资产隔离层
```

代码规模：约 7.6k 行 TS/TSX（引擎 ≈2.4k、内容层 ≈1.3k、服务端 ≈0.6k、前端 ≈0.9k、脚本 ≈2.4k）。

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
| Barbarian 狂战士 | 50 | 5 | 10 | 33（升级 10 + 专属 5+1PROMO + 通用 18） | 官方校准 |
| Pyromancer 焰术士 | 50 | 5 | 9 | 33（升级 10 + 专属 5+1PROMO + 通用 18） | 官方校准 |
| Gunslinger 神枪手 | 50 | 5 | 9 | 33（升级 9 + 专属 5+1PROMO + 通用 18） | 官方校准（**零推定值**，三源交叉） |
| ShadowThief 影贼 | 50 | 5 | 10 | 33（升级 8 + 专属 6+1PROMO + 通用 18） | 官方校准（**零推定值**，三源交叉） |

- 卡牌 **78 张**（通用 18 + Barbarian 15 + Pyromancer 15 + Gunslinger 15 + ShadowThief 15），
  全部读官方卡图机制化，无官方 flavor text。
- 状态库 **11 个**：burn / poison / evasive / fireMastery / stun / concussion / knockdown
  + gunslinger 专属 reload（装填）/ bounty（悬赏）+ shadowthief 专属 shadows（隐入暗影）/ sneakAttack（偷袭）。
  `common:poison` 已于 2026-10-14 官方化为 stackLimit 3 + Persistent（原 5/非持续为早期未记录值）。
- 已知偏差（2026-10-14 复核更正，以代码为准）：
  - ✅ **Ultimate 官方值已补**：`bloodlust`（Stun + 15 不可防御）、`scorchTheEarth`（12 不可防御 + 2 溅射），双源确认。
    ⚠️ 代码里 Ultimate 上方仍残留「official:false 占位推定」的旧注释，与下方官方值注释自相矛盾 —— **待清理**（C3）。
  - ✅ Smack 4-of-a-kind 不可防御、Fortitude 3-of-a-kind 移除状态、Better D! 防御重掷 —— 均已声明接入（dad1abb），**行为正确性复核中**（C2）。
  - ⚠️ **L1 数值仍有多处推定**：`heroes.ts` 约 10 处 `official:false L1 推定`（此前文档误记为"L1 已齐备"）。

### 3. 服务端（`packages/server/src`）

| 模块 | 职责 |
|---|---|
| `matchActor.ts` | **一个房间唯一写入者**：Promise 链串行队列 + per-seat `clientSeq` 幂等去重 + 队内写盘 |
| `matchLog.ts` | 对局日志的文件后端，append-only，合并多次 append 为一次 syscall |
| `roomManager.ts` | 大厅（选人/准备）→ 对局 → 结束；重连令牌校验、观战位、断线保留座位、启动恢复 |
| `index.ts` | Socket.IO 接线：`room:join / room:rejoin / room:pick / room:ready / game:action / room:sync` |

- 持久化：`.matches/<roomId>.jsonl`，行类型 `meta`（建局参数）/ `room`（房间元信息，**取最后一条**）/ `snapshot`（周期全量）/ `act`（已接受动作）。
  恢复 = 最后一条 snapshot + 顺序 replay 其后的 act；默认每 25 个动作一条快照。
- **为什么从不覆盖写**：覆盖式 `writeFile` 在受限/只读挂载上会 EPERM，且半行恢复困难；
  append-only 天然可恢复（写坏最后一行，前面的仍可用，`parseLog` 丢弃半行）。
- 广播：每个连接只收到自己那份投影（座位 → `PlayerView`，观战 → `SpectatorView`），
  事件按 `visibility` 过滤（`server` 可见性永不下发）。
- 动作 ack **总是回带最新 view**，客户端因此不需要额外的 resync 接口；漏一次广播也不会卡在旧状态。

### 4. 前端（`packages/web/src`）

- Vite + React，房间加入、骰盘锁定/重掷、能力激活、阶段推进、日志。
- **资产层接入**（`b33ffc4`）：`bootstrapAssets()` 启动即注册真实素材包；`AssetImage` 单一渲染入口（缺图自动落占位 SVG，永不白屏）；`AssetAudit` 自检面板显示命中率与预览。
- 已渲染：英雄面板、骰面、状态图标、手牌卡图、能力图标。
- **对局面板 `Board` 本地/联机共用**：联机与本地热座走同一个组件，差别只在「动作发给谁」。
- **联机 hook `online.ts`**：令牌落 `sessionStorage`；刷新页面自动 `room:rejoin` 回原座位；
  socket.io 断线自动重连后用令牌 rejoin（而非重新 join，否则会被判成第三个连接进观战位）；
  `clientSeq` 存 ref 保证跨重连单调递增。
- **大厅**：两个座位各选英雄（英雄卡面缩略图）→ 各自点准备 → 双方齐了自动开局；第三个连接进观战位。

### 5. 资产层（`packages/web/src/assets`）

- 三档资源包：`placeholder`（程序化 SVG，入库）/ `local-tts`（本地 TTS 导入，**真图不入库**）/ `reskin`。
- TTS 官方图包切片 **300 张**（7 英雄 × cards/dice/panels/statuses），OCR 卡名 230 条。
- 命中率 **66/89**（card 类 48/48 全命中）；剩余缺 23 = abilityIcon 19 + statusIcon 3 + background 1，均为 TTS 图包本身没有的图。
- 工具链：`npm run assets:import`（切片+OCR）、`assets:catalog`（生成目录）、`assets:check`（守门）、`assets:confirm`（卡名批量确认）。

### 六、验收指标（当前）

```
3 包 tsc --noEmit       零错误
npm test                310 / 310（引擎+MatchActor+Gunslinger 55 + ShadowThief 11 / describe 178 / conditions 16 / lint 3）
npm run test:assets     10 / 10
npm run assets:check    153 条目录项，无孤立/遗漏（Gunslinger 89 → 120 → ShadowThief 153）
npm run match           完整局（25 回合），同种子 md5 一致
npm run e2e             M2 端到端联调全绿（见 §四 阶段 B）
vite build              通过（257 webp / 9.7M），真图未入库
```

Gunslinger 引擎扩展（2026-10-14，全部通用机制、零英雄特判，详见审计报告 §22）：
`StatusDef.onAttacked`（Bounty 契约）/ `Condition.boundCompare`（双 roll 比较）/
`Expr.incomingDamage`(防止½来袭) / `rollDicePool.owner`（按对手英雄骰面掷）。

ShadowThief 引擎扩展（2026-10-14，同样全部通用、零英雄特判，详见审计报告 §26）：
`StatusDef.onAttacked.avoid`（阴影避伤，Ultimate/非攻击伤害豁免）/ `discardAtTurnEnd` + `sinceTurn`
（回合末弃置时序）/ `defensiveRoll.abilityId` + `AbilityTier.defenseDiceCount`（双防御掷骰前二选一）；
注册表 `upgradeCostCP` 校验由「严格递增」放宽为「非递减」（官方匕首打击 II 为 0 CP 升级）。

---

## 三、缺口清单（按优先级）

### ~~P0 —— 阻塞「能玩起来」~~（2026-10-14 已全部清零）

1. ✅ 出牌闭环：`playCard / buyUpgrade / sellCard / chooseOption / discardCards` 全部有 UI 入口。
2. ✅ `legalActions` 下发（架构 §2.2.3）：新增 `engine/legal.ts`，UI 只渲染这个集合。
3. ✅ T14 投影泄漏属性测试（架构 §2.2.2）：`engine/legal.test.ts`。

### ~~P1 —— 阻塞「联机可靠」~~（2026-10-14 已全部清零）

4. ✅ `MatchActor` 串行命令队列（架构 §1.3）：`server/matchActor.ts`，Promise 链排队，`matchActor.test.ts` 验证并发提交 ≡ 顺序提交。
5. ✅ 持久化可恢复：append-only JSONL（meta / room / snapshot / act），`npm run e2e` 阶段 5 验证 kill 后重启逐字节一致。
6. ✅ 断线重连：`room:rejoin` 令牌校验；座位与令牌跨断线保留；重连后视图与断线前逐字节一致。
7. ✅ 房间英雄选择 + 观战位：大厅选人/准备开局；第三个连接进观战位并收到 `SpectatorView`。

### P2 —— 阻塞「内容完整」（8–11 已清零；11 首位英雄 Gunslinger 已完成 2026-10-14）

8. ✅ **`describe(e, lang)` 描述层**（design E6 / 附录 A 第 7 条）：`content/describe.ts` 703 行，
   **30 种 clause kind 全覆盖**、zh/en 双语；lint 守门 = 类型层强制穷尽 + 测试层 key 集合双向比对。
9. ✅ **引擎条件补全**：`conditions.test.ts` 12 例取证，Smack / Fortitude / Better D! **三项全部 PASS**（详见 §四 阶段 C）。
10. ✅ **Ultimate**：官方值已补齐 + 自相矛盾的旧注释已清理（C3）。
    ⚠️ 残余缺口是 **L1 数值**：约 10 处 `official:false` 推定，需官方值替换。
11. **其余 3 英雄**（M3 进行中）：MoonElf / Ninja / Raveness —— 卡图与卡名已就位（ShadowThief 已完成），
    实装后扩 `name-map.json` 再跑 `assets:confirm` 即可自动挂图。
    ✅ **Gunslinger 已完成**（2026-10-14）：三源交叉校准零推定值 + 4 项引擎扩展
    （onAttacked / boundCompare / incomingDamage / rollDicePool.owner）+ 取证测试 14 例。
    实装流程已定型：读 panel → 逐张读专属卡 → 交叉官方规则书 → 扩 name-map → assets:catalog。
    ✅ 实装前置 **content-lint 已就位**（`content/lint.test.ts`，2026-10-14 `330d9da`）：
    英雄/能力/状态/卡名必须含 CJK、zh 渲染不得回落英文 id；本轮再次实战抓到
    gunslinger 能力/状态词表缺登记（describe 词表已改为随 ALL_HEROES 数据自动构建）。

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

### 阶段 B：M2 联机 ✅ 已完成 2026-10-14

| # | 任务 | 状态 | 验收证据 |
|---|---|---|---|
| B1 | `MatchActor` 串行队列 + `clientSeq` 幂等 | ✅ | `matchActor.test.ts`：并发 fire 24 个动作 ≡ 顺序提交；重复提交 `duplicate=true` 且状态不动；序号倒退判过期 |
| B2 | 持久化：append-only 日志 + 快照可重建 | ✅ | `persistence.test.ts`：离线回放 ≡ 在线推进（3 seed / 3 种快照间隔 / 半行截断）；e2e 阶段 5：kill 服务 → 重启 → 视图逐字节一致 |
| B3 | 断线重连：令牌校验 + 状态重放 | ✅ | e2e 阶段 4：座位 0 掉线 → 新连接凭令牌 rejoin → 同座位、同英雄、视图逐字节一致 |
| B4 | 房间选人界面 + 观战位 | ✅ | e2e 阶段 1/6：大厅选英雄（未知英雄被拒）、双方准备才开局、第三个连接进观战位 |
| B5 | 端到端联调：两个客户端完整一局 | ✅ | e2e 阶段 2/6：全程只用服务端 `legalActions`，零「合法动作被拒」；每 10 步扫视图无 rng/bucket/手牌 uid |

顺带补齐的基础件：
- `shared/types/net.ts`：联机协议契约（房间/座位/加入回执/动作回执/update 包），前后端共用同一份类型。
- `shared/types/spectator.ts` + `projectSpectator()`：观战投影，两侧都只见手牌张数、无 `legalActions`；
  T14 观战泄漏属性测试 + 事件 `visibility` 过滤测试。
- `filterEvents()`：`server` 可见性事件永不下发，`seat` 事件只给本人，观战者只收 public。

复现方式：
```bash
npm run e2e      # 起真实服务端 + 两个客户端 + 故障注入，六个阶段
npm test         # 41 个单测
```

已知边界（不修，记录备查）：
- 幂等缓存不跨进程保留 —— 重启后首次重发不会被识别为 duplicate（但状态仍正确，因为序号是单调的）。
- 房间元信息（含重连令牌）也在 JSONL 里，token 落盘；自用学习场景可接受，若要对外需改存服务端会话。

### 阶段 C：内容收尾（C1–C3） ✅ 已完成 2026-10-14

| # | 任务 | 状态 | 验收证据 |
|---|---|---|---|
| C1 | `describe()` 描述层 + lint 守门 | ✅ | `content/describe.ts` 703 行 + `describe.test.ts` 124 例；**30/30 kind 全覆盖**（原估 31 系 grep 目测误差，以 `core.ts` × `EFFECT_HANDLERS` 双向比对为准）；故意删 `heal` 模板 → 守门报 `['heal']` |
| C2 | 引擎条件补全（4/3-of-a-kind、防御重掷） | ✅ | `engine/conditions.test.ts` 12 例（含正例+反例+骰池归属哨兵）；Smack / Fortitude / Better D! **三项全 PASS**，已无缺陷固化断言 |
| C3 | Ultimate 官方值 + 矛盾注释清理 | ✅ | 官方值 dad1abb 已补；本轮删 3 行与官方值自相矛盾的「数值未知/占位推定」旧注释，官方来源注释全保留 |

**C2 修掉的三个缺陷**（质量复核发现，非文档假设）：

| 缺陷 | 级别 | 根因 | 修法 |
|---|---|---|---|
| 防御窗口打出的卡把防御骰清空 | **Blocker** | `effects.ts:520` `runEffects` 末尾无条件清 `tempDice` | 重定**骰池归属契约**：谁把池放进 `tempDice` 谁负责取出。防御骰池 owner = 防御阶梯（跨多次 runEffects 存活），临时骰池 owner = 本次 runEffects（掷过则回滚到进入时的池，不是清空） |
| 4 同点时守方 defensiveRoll 拒绝码误导 | Minor | pending 守卫先于 phase 守卫 | `defensiveRoll` 的 phase 守卫前置；只改变**已被拒绝**动作的拒绝码，不存在由拒变收 |
| Fortitude「3 同点移除状态」永不生效 | Major | `optional` handler 恒返回 `[]` | 解开内容层 `optional` 包裹改必发（方案 B，见下） |

**关键决策：Fortitude 走「MVP 必发」而非「引擎层自动行使 optional」（方案 A→B 改判）**

- **A**：改引擎 `optional` handler 为自动行使 → 内容层保留官方 `may` 声明。
- **B**：解开内容层 `optional` 包裹改 `conditional + removeStatus` → 引擎桩保持 no-op。
- **选 B 的决定性理由（失败模式）**：A 的契约是「引擎对任何 `optional` 一律自动行使」，
  下轮 M3 要实装 5 个英雄，一旦出现「可选且带代价」的效果（如「可选：受 2 点伤害以获得 X」），
  引擎会**替玩家做出损害性决定**；B 的失败模式是「效果不生效」，属保守失败。
  引擎层默认行为在「多做一件事」与「少做一件事」之间，必须默认选后者。
- 官方 `may` 与 MVP 必发的偏差以**已知偏差注释**显式记账（不是静默偏差），并在 `effects.ts` 留回滚锚点。

**已知边界（不修，记录备查）**：

- **Fortitude 必发会吃掉正面状态（已实测复现，非理论）**：`removeStatus('any')` 走负面优先，
  但身上**一个负面状态都没有**时会退而移除正面状态 —— 实测只挂 `fireMastery 2` 时打出三同点 → `fireMastery 2→1`。
  1v1 下 Barbarian 自身可能携带 burn/knockdown/stun/concussion/poison，触发概率低但**路径确实存在**。
  当前无「身上存在负面状态」条件可用于加守卫，待条件能力补齐后收紧。
- **描述层 4 处与求值语义不一致**（C1 发现，未修）：`nOfAKind.target` 在防御上下文被静默忽略；
  `discardCards mode:'choice'` 实际固定取手牌第一张；`cards.ts:55/57` 用 `stacks: 99` 当「全部」哨兵（描述直出"99 层"）；
  `adjustDie` / `copyDieFace` 的自动取位规则未体现在文案。
- **`optionalPrompt` 挂起（正解 C）未做**：骨架齐全（`PendingKind` 有枚举、`legal.ts` 有下发分支、`Action.chooseOption` 存在），
  缺 `reduce` 的 chooseOption 空实现 + UI 入口。**UI 入口就绪前挂起会让本地热座与联机卡死在 pending**，故本轮不做。
- **~~O-1~~（已坐实并修复，`0a527fc`）**：行为级探针证实为**三层缺陷** ——
  ① 伤害记账方向反了（flushNow 把承受方净伤记给承受方自己，实测攻方造成 8 记 0）；
  ② headBash 官方语义是**攻击方**在防御结算后打出的门槛型行动卡（卡面 card-29 重读确认），
  原实现放进防守方 flush 前窗口，条件恒不成立；
  ③ 缺打出门槛（无效打出也消耗卡）。修法：记账归对手 + 防守窗口收窄 preDefense-only +
  新增 `CardDef.playIf`（reduce 拒绝 / legalActions 灰显 / describe 渲染三处同口径）。
  `conditions.test.ts` C2-4 组 4 例取证。
- **Minor**：`hasDefenseWindowCards` 的 CP 口径 —— **已随 O-1 顺手修复**（两分支统一）。
- **英文版描述是键位映射简版**：复数/冠词不讲究，`optional` / `promptNumber` 的 prompt 文案直接透传作者写的中文。真要上英文需 prompt 双语字段。
- **e2e 步数/回合数每次不同**：`roomManager.ts:101` 用 `Date.now()+randomBytes` 当 seed，判绿只看「全部通过」一行，**不能据步数归因**。

---

## 五、待决事项

| 项 | 现状 | 需谁定 |
|---|---|---|
| IP 路径 | 自用学习、真素材不入库、零官方文本 | 已拍板，保持不变 |
| 官方数值来源 | **Ultimate 已补齐**（2026-10-14 双源）；**L1 约 10 处 `official:false` 推定**待官方值 | 用户订阅中文版 mod（3446854288）后按 SOP 接入（审计报告 §14） |
| 5 英雄优先级 | ✅ Gunslinger + ShadowThief 已完成（均三源校准零推定值） | 下一位建议 MoonElf / Ninja / Raveness |
| 描述层接入 UI | `describe()` 已实现并导出、**前端尚未调用** | 用户决定是否排入下轮 |
| O-1 排查 | ✅ **已坐实并修复**（`0a527fc`，三层缺陷 + C2-4 组 4 例） | 已销项 |
| thenNode 打出窗口 | Roll Phase Action 卡（Get Some!/redHot/Eat Lead!）暂只能在 main 宽松打出、伤害悬桶 | 独立引擎任务，建议排入 M3 收尾 |
| spendStatus 玩家入口 | Reload/Evasive 数据完备但无法主动消耗（Quick Draw/Wild West 因此不生效） | 独立引擎任务（挂起/选择语义），与 optionalPrompt 一并考虑 |
| 下一步方向 | 单测 310、M3 4/7 | 其余 3 英雄（MoonElf/Ninja/Raveness）/ L1 数值补齐 / 描述层接 UI / thenNode+spend 入口 |

---

## 六、联机使用方式（M2）

```bash
npm run dev:server        # :3001，持久化到 ./.matches
npm run dev:web           # :5173
```

1. 浏览器 A 打开 :5173 → 切「联机」→ 房间号 `room-1` → 加入 → 选英雄 → 准备。
2. 浏览器 B（或另一个标签页）同样进 `room-1` → 选另一个英雄 → 准备 → 双方齐了自动开局。
3. 第三个连接自动进观战位（只见双方 HP/CP/手牌张数，看不到任何手牌内容）。
4. 刷新页面：凭 `sessionStorage` 里的令牌自动回到原座位继续；服务端重启也会自动恢复对局。
