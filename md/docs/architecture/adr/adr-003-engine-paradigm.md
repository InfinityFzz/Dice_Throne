# ADR-003：规则引擎实现范式

- **状态**：**Accepted**
- **日期**：2025-xx-xx（架构基线）
- **v0.2 修订**：2025-xx-xx（DT-ARCH-002 对齐轮）—— S2 改 P1–P8、S3 改 DamageBucket、S4 改为「`next` 保序 + `openWindowThen` 开窗」。
  - ✅ **原「2 项待 design 确认（主文档 B1 / B2）已全部 RESOLVED**，不再附带条件。
  - B1（结算阶梯对齐）→ 采用 design 的 **P1–P8**；B2（`then` / `onDamageDealt` 语义）→ `hitSuccess` 与 `onDamageDealt` 分离，后者基准 `net > 0`。
- **决策者**：程基岩（engineering-lead）
- **相关**：ADR-002（权威）、ADR-004（随机性）、主文档 §2.4 / §2.7 / §3

## 背景

《王权骰铸》的规则引擎需要同时满足四个互相拉扯的诉求：

1. **表达力**：能力/卡牌效果千变万化（掷骰、改骰、施加状态、偷 CP、反噬、链式 then、伤害成功造成后触发、需要玩家选择……），且 MVP 后还要加英雄。
2. **确定性**：同一 seed + 同一 action 序列必须得到逐位相同的结果（回放、反作弊、回归测试都依赖它）。
3. **可测试**：规则 bug 只能靠测试兜底；我们希望「写完一个英雄配置就能跑脚本化对局验证」。
4. **可挂起**：某些效果需要玩家输入（选择、排序、确认），执行到一半要能停下来、序列化、等待、恢复。

同时有两个约束来自上层决策：
- 前端要复用引擎做 AI 推演/回放 → 引擎必须零 IO、可在浏览器运行。
- 规则源（GDD/DSL）由 design-strategist 产出 → 引擎必须能消费「声明式配置」而非硬编码 if-else。

## 决策

**采用「纯函数 Reducer + FSM 阶段门控 + EffectQueue 结算 + 事件流副产品」的组合范式。**

```
reduce(state: GameState, env: ActionEnvelope): ReduceResult
```

四个组成部分各司其职：

| 组件 | 职责 | 不负责 |
|---|---|---|
| **Reducer**（纯函数） | 状态推进的唯一入口；不变量保证；产出事件 | 不表达效果细节 |
| **FSM**（八阶段 + 结算阶梯） | 「什么时候能做什么」的门控；自动推进；挂起/恢复的坐标系 | 不知道具体效果怎么算 |
| **EffectQueue** | 效果表达式的求值、链式 `then`、递归防环 | 不管回合/阶段 |
| **Event 流** | 广播协议、动画驱动、日志、测试快照 | 不作为真相源（真相源是 state；回放真相源是 seed + actionLog） |

### 关键子决策

**S1：状态即真相，事件是副产品（不是纯事件溯源）**

- 运行时真相 = 内存中由 `reduce` 推进的 `GameState`。
- 持久化真相 = `{ seed, setup, actions[] }`（ADR-004/005）。事件流可从它重算。
- 事件只用于：广播（ADR-002）、动画、日志、测试快照。
- 理由：避免 ES 的三大负担（快照压缩、read-model 版本迁移、查询重放），同时拿到 ES 的三项收益（可回放、可审计、天然广播协议）。

**S2：结算用「阶段阶梯 P1–P8」而非「数值优先级栈」**（v0.2 修订）

结算拆成**八个**固定子阶段，与 design `dice-throne-design-spec.md` §2.3 **逐条 1:1 锁定**：

| 步 | `ResolutionStep` | 职责 | 开响应窗口 |
|---|---|---|---|
| P1 | `activate` | 算候选能力集合 → 玩家单选 / **PASS** | ❌（PASS 直跳 P8） |
| P2 | `ultimateGate` | Ultimate → 对手 `actionPermission='none'`；Blind → 激活失败跳 P8 | ❌ |
| P3 | `effectWalk` | 非伤害立即生效；伤害/治疗/减伤**入桶**；**Stun 立即施加**；遇 Then 节点开窗 | ✅ `trigger:'then'` |
| P4 | `responseWindow` | **窗口栈非空时引擎的停留态**（可重入，不是固定步骤） | — |
| P5 | `defensiveRoll` | 有 `defendable` 伤害 → 单次不可重掷的防御掷骰；之后**必再开一次窗** | ✅ `trigger:'postDefense'` |
| P6 | `simultaneous` | **flush bucket** → 唯一允许写 HP 的地方 → 死亡判定 | ❌ |
| P7 | `postThen` | `additionally` 段落 + `onDamageDealt` / `attackResolved`；条件卡可打 | 🆕 可选 `'postFlush'` |
| P8 | `cleanup` | 胜负检查（含平局）、结构化日志、销毁临时骰池、**释放权限令牌**、推进阶段机 | ❌ |

> v0.1 的 R0–R8（10 步）**作废**。映射：R0→并入 P3；R1+R2→P3；R4→P5；R5+R6→P6；R7→P7；R8→P8；`finalCardWindow` **从枚举移除**（改为可重入 `WindowStack`）。`targeting` 保留枚举位供多人扩展，1v1 恒为 no-op。

理由：本作的结算顺序天然是阶段性的（design 的规则文本就是这么写的），用阶段表达直接映射规则；用数值优先级需要给每个效果分配魔法数字，新增效果要重新排号，且「同优先级怎么办」总要补规则。

**职责分离（v0.2 新增）**：阶梯管**顺序**（`LADDER[i].opensWindow?: WindowSpec`），**窗口栈管交互**（轮转 / pass 计数 / 动作上限 / 超时）。两者不再是同一层——这是「`then` 既能保序又能开窗」的前提。

**S3：伤害走分桶，不直接扣血**（v0.2 修订）

`DamageLedger`（扁平）→ **`DamageBucket`（六桶）**：`defendable` / `undefendable` / `collateral` / `healing` / `prevention` / `avoidFlags`。**只在 P6 SIMULTANEOUS flush 一次写 HP**。

```ts
const net  = Math.max(0, (avoided ? 0 : defendable) - prevention) + undefendable + (avoided ? 0 : collateral);
const hpRaw = hp - net + healing;                       // 治疗可救回死亡（design C5）
hp = hpRaw <= 0 ? hpRaw : Math.min(startHp + 10, hpRaw); // 封顶不救死亡（design A2）
if (hpRaw <= 0) → pendingDefeat(seat)，P8 统一裁决
```

为什么必须分桶（而不是 v0.1 的 `net = prevent ? 0 : max(0, gross - reduce)`）：**该公式无法表达「不可防御伤害不受减伤 / 闪避影响」这一核心规则**。减伤只吃 `defendable`，闪避只清 `defendable + collateral`，`undefendable` / `pure` / `ultimate` 全程不受影响——这是设计侧的核心裁决（C7），扁平账本表达不了。

**S4：`next` 用 pushFront 保序；`openWindowThen` 先保序、再开窗**

v0.2 把 v0.1 的单个 `then` **拆成两个语义完全不同的构造**，两者都保留，先后固定：

| 构造 | 语义 | 挂起 | 队列行为 |
|---|---|---|---|
| `EffectDef.next`（v0.1 `then` 更名） | 链式后续，紧随父效果执行 | ❌ | **pushFront** |
| `{ kind:'openWindowThen', steps }` | design 的 **Then 节点**：开窗，关闭后继续 `steps` | ✅ | ① pushFront(steps) **保序** → ② push 窗口栈挂起 → ③ 关闭后继续跑 steps |
| `{ kind:'additionally', effects }` | design 的 Additionally，延迟到 **P7** | ❌ | push 到 `deferredToPostThen` |

**先后是明确的**：**先保序（入队时 pushFront，保证 steps 不被全局队尾插队）→ 再开窗（执行时压栈 + 挂起）→ 窗口关闭后继续跑 steps。**
「保序」与「开窗」不是二选一，而是**同一节点的两个连续动作**——这也是 design 的 `then` 语义的完整表达（design §2.3 P3 第 4 条）。

**为什么必须改名**：design 术语里 "Then" 专指「响应窗口节点」。若 IR 的 `EffectDef.then`（不开窗）与 DSL 的 `then`（开窗）共用一词，内容作者必然配错。**改名成本 = 一次全仓库重命名；收益 = 消除一类高频规则 bug。**
**硬约束**：DSL 的 `then` **只能**编译到 `openWindowThen`，**禁止**编译到 `next` —— 由 `content-lint` 断言（主文档 §2.7 硬约束 1）。

**S5：效果通过注册表执行，数据只存 `kind`**

`EFFECT_HANDLERS: Record<ClauseKind, Handler>`。**硬约束：`EffectDef` 内禁止函数/闭包/class 实例**——这是 EffectQueue 可序列化（可挂起、可持久化、可回放）的前提，也是「数据驱动」的前提。

**S6：校验与执行合并**

不写 `canDo()` + `doIt()` 两份逻辑。`reduce` 返回 `Result`，非法则 state 不变。`legalActions` 枚举也复用 `reduce` 试跑。**一份规则实现，三个用途。**

**S7：引擎守卫**

`MAX_RESOLVE_DEPTH = 64`、`MAX_FRAMES_PER_RESOLUTION = 512`。超限 → `engineGuardTripped` 事件 + 告警 + 安全兜底（应用已入账伤害，忽略剩余）。**绝不静默吞掉。**

**S8：响应窗口 = 可重入的栈，不是阶梯上的固定步骤**（v0.2 新增 —— 裁决 1）

`finalCardWindow` 从 `ResolutionStep` **移除**。窗口的生命周期与轮转下沉到独立的 `WindowStack`：

```ts
export interface ResponseWindow {
  readonly id: string;
  readonly trigger: WindowTrigger;        // 'then' | 'preDefense' | 'postDefense' | 'preFlush' | 'rollPool' | 'postFlush'
  readonly openedAtStep: LadderStep;
  readonly eligibleSeats: readonly Seat[]; // 受 effectivePermission() 约束
  readonly order: readonly Seat[];         // 固定轮转序列：非行动方先、行动方后
  readonly cursor: number;                 // 当前响应权下标
  readonly passStreak: number;             // ≥2 关闭
  readonly actionCount: number;            // 硬上限 4
  readonly timeoutMs: number;              // 15000
}
export interface WindowStack { readonly stack: readonly ResponseWindow[]; readonly nextSeq: number; … }
```

规则（design §1.2，硬编码为引擎常量，内容不可覆盖）：**固定顺序 + `cursor`**（不是交替计数 —— 固定序列可序列化、可确定性重放）；**连续 2 次 pass 关闭**；**单窗口 4 动作硬上限**，超限 → `engineGuardTripped{guardReason:'windowActionLimit'}` + 强制关闭（不抛异常、不判负、已完成动作保持有效）；**15s/次超时自动 pass**（区别于其他 PendingRequest 的 30s）；**可重入**，内层关闭后外层 `passStreak` **不重置**（防用嵌套卡刷新计数）；**所有 eligible seat 都无牌可打且无 spendable 状态 → 根本不开窗**（design R7 强制，见主文档 §2.4.3）。

**S9：flush 公式以 design 的 Bucket 公式为准**（v0.2 新增 —— 裁决 2）

```
net     = max(0, defendable − prevention) + undefendable + collateral
hpRaw   = hp − net + healing              // 治疗可把本次致死救回来（C5）
hpAfter = hpRaw <= 0 ? hpRaw : min(startHp + 10, hpRaw)   // 封顶不救死亡（A2）
```

`avoidDamage` 清 `defendable` + `collateral`（`undefendable`/`pure` 不受影响，C7）；`preventDamage` 只吃可防御部分 —— **两者是不同 clause kind、不同 bucket 字段，必须可区分**。双方同时归零 → `draw`。

**伤害三轴正交（design §8.4-④-e）**：`DamageType` **恒 4 类**（`attack`/`undefendable`/`collateral`/`pure`），来源走正交的 `DamageSourceKind`（`'ability'\|'status'\|'ultimate'\|'recoil'`），目标走 `TargetRef`。原 `self`/`ultimate` 两个伪类型**删除** —— 「能否防御/能否增强」与「来源是谁/打向谁」是两条语义轴，混进一个枚举会让每个 switch 长出例外分支。

**反伤 = `type:'pure'`**（design §8.4-④，不是 `undefendable`、更不是 `collateral`）。走同一 bucket 的反向条目；不可防御、不可被 Attack Modifier 增强、不置 `hitSuccess`、不计入 `damageDealtAtLeast`，但**计入 `onDamageDealt`**。**工程硬理由：反伤可防御 ⇒ 存在 `攻击→防御→反伤→再防御→…` 链条；`pure` 保证一次 Roll Phase 内防御掷骰恒 ≤ 1 次，防御链一步收敛（终止性证明）。**

**S10：`onDamageDealt` 触发基准 = `net > 0`**（v0.2 新增 —— 裁决 3）

按 **（`resolutionId`，目标 seat，`flushBatch`）** 三元组各触发一次；`net === 0`（完全预防 / 完全闪避）**不触发**；同一结算中多批 flush **分批分别触发**。与 `hitSuccess`（命中即置位，驱动 Then / Additionally / 条件卡）严格分离，不可互换。

**S11：DSL 与 IR 分两层，加载期一次编译**（v0.2 新增）

引擎只认 IR；DSL→IR 在 `ContentRegistry` 初始化时编译并缓存，产物进 `__ir_snapshots__/`（主文档 §2.7）。两条硬约束：**DSL 的 `then` 只能编译到 `openWindowThen`**；**降级必须保语义且可 diff**。内容包同时必须提供 `describe(e, lang)`（design E6），通过 `DESCRIBERS` 注册表实现 —— 函数住在注册表里、不住在 `EffectDef` 里，因此 S5 的可序列化约束不被破坏。

## 备选方案

| 方案 | 优点 | 为什么不选 |
|---|---|---|
| **A. 纯 reducer + FSM（无 EffectQueue）** | 最简单，心智负担低 | 无法表达「链式 then」「需要玩家输入的中间步骤」「伤害成功造成后触发」。要么把效果逻辑硬编码进 reducer（破坏数据驱动），要么把效果展开成巨大的状态机（状态爆炸）。**表达力不足** |
| **B. 命令模式 + 事件溯源（事件即真相）** | 可回放性最强、审计天然、广播协议天然 | 三项负担在 MVP 阶段不划算：① 快照与日志压缩策略；② read-model（投影）版本迁移；③ 每次查询都要 fold。而我们用「reducer 顺带产出事件」已经拿到了 ES 的核心收益（S1）。**过度工程** |
| **C. ECS（Entity-Component-System）** | 数据局部性好、易并行、易扩展实体 | ECS 的全部收益在本项目为零：一局只有 2 玩家 + ~20 手牌 + ~10 token + 5 骰（实体量级 10¹），回合制无帧预算压力。而它最不擅长的恰恰是我们的核心：**链式效果顺序、同时结算、需要玩家输入的中间步骤**（都要靠命令缓冲 + 多帧延迟 + 隐式顺序实现，反而更难测）。**收益为零，复杂度为负** |
| **D. 规则脚本化（Lua / JS eval / CEL 表达式）** | 表达力最强，改规则不用重新构建 | ① 引入沙箱/注入安全面（内容若来自用户/第三方则更危险）；② 破坏确定性（除非极严格控制）；③ 破坏可序列化（脚本在队列里无法安全持久化）；④ 调试与静态分析能力大幅下降；⑤ 类型安全归零。**与安全/确定性/可测试三大目标全面冲突** |
| **E. XState 之类的状态机库驱动全部逻辑** | 可视化状态机、内建 actor 模型 | XState 擅长「阶段/流程」，不擅长「数据驱动的效果求值」。用它表达全部 4 英雄 × 20 卡的效果会导致状态机图爆炸且无法数据配置。我们只把 FSM 用于**阶段门控**（这部分可以自己写 50 行，也可以局部用 XState），效果仍走 EffectQueue |
| **F. 规则引擎用现成库（如 boardgame.io）** | 开箱有房间/状态同步 | boardgame.io 的模型是「共享 state + 客户端可跑」，与 ADR-002 的 per-seat 投影防作弊模型冲突；且其插件生态针对的是通用桌游，本作的「结算阶梯 + 账本 + 挂起队列」仍需完全自建。引入后收益 < 约束 |
| **G. 响应窗口做成阶梯上的一个固定步骤（v0.1 的 `finalCardWindow`）** | 类型更简单，一眼能看懂 | 无法表达 design 的三条硬性规则：① **Then 节点在 P3 中途开窗**；② **P5 之后再开一次**；③ **窗口内打出的卡自身含 Then → 嵌套**。固定步骤必然要靠隐式状态打补丁，补丁一多就回到「散落的 if」。**被 S8 取代** |

## 理由

1. **表达力与可控性的最佳交点**：EffectQueue 提供程序式表达力（链式、递归、挂起），`EffectDef` IR 提供数据驱动（配置化、可校验、可序列化），两者通过「kind + 注册表」解耦。
2. **确定性可工程化保证**：reducer 纯函数 + 随机来自 state（ADR-004）+ 状态内集合用数组 + 全整数运算 + 禁用 API 清单，可通过 lint + 属性测试机械验证（T15）。
3. **可测试性直接来自纯函数**：`runScript(seed, actions[])` 一行搞定一局；事件序列语义化快照作为回归基线。
4. **挂起/恢复是刚需**：EffectQueue 状态在 `GameState` 内 → 天然可序列化、可持久化、可重连恢复。这是选 EffectQueue 而非「递归函数直接执行」的决定性理由。
5. **lean 友好**：核心调度器预计 300–500 行，handler 每个 10–40 行。M0 可在 2–3 周内完成（不含内容数据）。

## 后果与风险

**正面**

- 新增英雄/卡牌 = 加配置数据 +（若需要）加一个 handler，不改调度器。
- 任何对局可脚本化复现 → bug 修复流程可固化为「先补一条脚本化用例」。
- 引擎可在浏览器跑 → AI 推演、回放器、离线教学关均能复用。
- 事件流天然成为前端动画的时间线。

**负面 / 需管理**

| 风险 | 缓解 |
|---|---|
| **规则边界情况爆炸，handler 数量膨胀** | ① 注册表收敛，新增效果不改调度器；② 黄金对局脚本库做回归基线；③ 每个 bug fix 必须补一条脚本化用例（写进 DoD）；④ 定期审视 handler 列表，抽象公共子模式（如「施加状态」统一走 status 模块） |
| **非确定性悄悄混入**（`Object.keys` 顺序、Map/Set 迭代顺序、浮点、并行） | 控制清单禁用 API + grep 单测；T15 双跑 + 重放一致性；全整数；状态内集合一律数组 |
| **EffectQueue 可序列化约束易被违反**（有人往配置里塞闭包） | `content-lint` 第 8 项：深遍历断言无非序列化值；`EffectDef` 类型不含函数签名（TS 层面先挡一层） |
| **`next` / `openWindowThen` / `additionally` 三者顺序语义易错**（pushFront vs pushBack vs 延迟到 P7） | 控制清单第 7 条固化；单测覆盖「A `next` B，队列中有 C」的三种排列；**T35 断言 DSL 的 `then` 无一编译成 `next`** |
| ~~**结算阶梯与设计侧定义漂移**（主文档 B1）~~ | ✅ **RESOLVED**：v0.2 已锁定 design 的 **P1–P8**，`ResolutionStep` 枚举由双方共同锁定、写入术语对齐表，**任一侧改名必须同步**。阶梯定义写成数据常量便于 diff review |
| **递归/循环触发导致无限结算** | 引擎守卫（S7）+ 单测构造自触发状态效果 |
| **EffectDef IR 表达力不足，遇到规则特例要硬编码** | 预留 `kind:'noop'` 与 `EffectContext.source` 供 handler 做上下文特判；但**特判必须写在 handler 内并记录在 ADR 补充条目**，不允许散落。若某英雄需要大量特判，说明 IR 需要扩展 → 走 ADR 修订而不是打补丁 |

## 落地检查项

- [ ] `reduce.ts` 为唯一入口，`GameState` 全部 `readonly`
- [ ] `EFFECT_HANDLERS` 注册表 + `content-lint` 校验所有 `kind` 已注册
- [x] ~~`ResolutionStep` 枚举与 design 状态机 1:1 对齐~~ → **v0.2 完成**，锁定为 **P1–P8**
- [ ] 深度/帧数守卫 + `engineGuardTripped` 事件（含 `guardReason:'windowActionLimit'`）
- [ ] **T5–T9 + T17–T36** 边界用例全绿（含 design C1–C16 逐条映射，主文档 §7.5）
- [ ] T15 确定性双跑与重放一致性
- [ ] 控制清单 1–9、13、16–20 条进入 ESLint 或单测强制
- [ ] **T19 权限令牌泄漏属性断言**（结算后双方 `effectivePermission()` 必为 `'all'`）
- [ ] **T35 DSL→IR 编译快照**入库；**T36 `describe` 输出校验**通过
- [ ] `docs/CHANGELOG-engine.md` 建立，事件序列变更规则写入 PR 模板

## 复核触发条件

- 需要新增的 `EffectClause` kind 在 1 个英雄内超过 5 个（说明 IR 设计需要重新审视）
- 引擎核心（不含内容）超过 1500 行（说明抽象层次出了问题）
- 出现无法用 IR 表达、必须硬编码进 reducer 的规则（→ 走 ADR 修订，记录理由）
- 需要 2–6 人扩展时（→ 评估 `players` 结构与 targeting 抽象，但引擎核心应不变）
