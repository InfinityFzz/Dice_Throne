# 《王权骰铸》电子化 · 交付总览与跨成员一致性裁决

> 文档编号 DT-001｜主理人：游承峰｜状态：**已定稿**（架构 v0.2 评审 PASS；剩余阻塞均为非技术项）  
> 范围：网页端 1v1 线上对战，MVP 4 英雄（Barbarian / Moon Elf / Ninja / Pyromancer）

---

## 1. 项目定位

| 项      | 内容                                          |
| ------ | ------------------------------------------- |
| 原作     | Dice Throne（Roxley Games，2018–），即中文《王权骰铸》   |
| 形态     | 网页端 1v1 线上对战，服务端权威                          |
| MVP 范围 | 1v1 + 4 英雄，英雄数据驱动（新增英雄不改引擎代码，硬性验收标准）        |
| 技术栈    | TypeScript 全栈 + Node/Socket.IO + React/Vite |
| 不在 MVP | 2v2/3v3/多人乱斗、AI 陪练、回放、天梯、观战                 |

### 核心玩法一句话

五位英雄专属骰，每回合最多掷 3 次并逐次锁定（Yahtzee 式），骰型匹配英雄面板上的能力激活条件，命中后对手掷防御骰，双方交替用卡牌与状态效果干预，先把对手 50 点生命打空者胜。

### 回合八阶段

维持 → 收入（+1CP/抽1牌）→ 主要阶段 1 → 进攻掷骰 → 选靶（1v1 跳过）→ 防御掷骰 → 主要阶段 2 → 弃牌（弃至 6 张，每张换 1CP）

---

## 2. 交付物索引

| 文件                                              | 作者       | 内容                                                                                            |
| ----------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `design/dice-throne-design-spec.md`             | 文策渊      | 规则可移植性三分类（A20/B13/C16）、回合与掷骰状态机、结算管线 P1–P8、能力/卡牌 DSL、UX 规格、数字化增强点 D1–D15、风险 R1–R8、开放问题 Q1–Q10 |
| `design/hero-schema-draft.md`                   | 文策渊      | 完整 TS 类型定义 + 4 英雄实例化（验证 DSL 表达力）                                                              |
| `docs/alignment-dt-001.md`                      | 游承峰（主理人） | **本文件**：跨成员一致性裁决 11 条、待拍板问题、已知风险、里程碑                                                          |
| `design/alignment-with-arch.md`                 | 文策渊      | 设计与架构接口契约：结算阶梯映射、三类卡时机矩阵、autoResolve 全表、DSL→IR 降级、6 条规则裁定                                     |
| `docs/architecture/dice-throne-architecture.md` | 程基岩      | 分层架构、规则引擎、数据模型、Epic/Story 与里程碑、测试策略 T1–T36 + C1–C16 映射、架构评审                                   |
| `docs/architecture/adr/adr-001` ~ `adr-006`     | 程基岩      | 实时通信 / 权威与同步 / 引擎范式 / 随机性 / 持久化 / 单体 vs 服务                                                    |

---

## 3. 跨成员一致性裁决（主理人裁定）

交叉核对设计侧 §2.3 结算管线（P1–P8）与架构侧 §2.4 结算管线（R0–R8）后，发现 **5 处实质性不一致**。裁决依据：**design 侧是玩法权威且模型更精细，冲突处以 design 为准**。

### 裁决 1 · 结算阶梯统一为 P1–P8

架构侧 R0–R8 重映射至设计侧 P1–P8：

| 统一后                | 含义                                                             | 架构侧原位置               |
| ------------------ | -------------------------------------------------------------- | -------------------- |
| P1 ACTIVATE        | 计算候选能力集合并让玩家单选/PASS。**注：这是阶段级挂起点 `abilityAnnounce`，不是结算阶梯的一步** | ❌ 缺失，需新增             |
| P2 ULTIMATE GATE   | Ultimate 激活 → 对手 `actionPermission = NONE` 至 P8；Blind 生效则激活失败  | ❌ 缺失，需新增（功能缺口）       |
| P3 EFFECT WALK     | 非伤害立即生效；伤害入桶不改 HP；Stun 立即施加且早于伤害；`then` 节点开窗                   | R0 + R1 + R2         |
| P4 RESPONSE WINDOW | 可重入窗口栈                                                         | W1/W2/W3（形态不同，见裁决 2） |
| P5 DEFENSIVE ROLL  | 防守方单次掷骰，不可重掷，结果入桶                                              | R4                   |
| P6 SIMULTANEOUS    | 封桶 + 同时应用 HP 变化 + 死亡判定                                         | R5 + R6              |
| P7 POST / THEN     | `onDamageDealt` 等后置钩子；新 effect 回到 P3（受深度限制）                    | R7                   |
| P8 CLEANUP         | 胜负检查（含平局）、写结构化日志、恢复权限、推进阶段机                                    | R8                   |

### 裁决 2 · 响应窗口改为「可重入窗口栈」

架构侧原设计是挂在阶梯上的三个固定窗口 W1/W2/W3；设计侧的模型是**窗口栈**——`then` 节点本身即可打开一个窗口。

统一参数：

- 轮转顺序：非行动方先，双方交替响应
- 关闭条件：**连续 2 次 pass**
- 防循环：单窗口**硬上限 4 个响应动作**，超限报 `EngineGuardTripped` 并强制关闭
- 超时：**12 秒/次视为 pass**（架构侧原写 30s；MAIN 阶段保持 60s）
- `then` 语义 = 打开响应窗口，窗口关闭后再继续执行后续 steps（pushFront 保序与开窗两者并存，需在 ADR-003 中说清先后）

**三个具名窗口与 `mutableScope`（关键补充）**：

| 窗口            | 改进攻骰                         | 改防御骰 | 改临时骰池 | 改账本 |
| ------------- | ---------------------------- | ---- | ----- | --- |
| `thenNode`    | 可                            | 否    | 可     | 可   |
| `preDefense`  | 可                            | 否    | 否     | 可   |
| `postDefense` | **否**（已锁为 Final Dice Result） | 可    | 否     | 可   |

`ResponseSpec` 必须带 `mutableScope` 字段，否则"在防御掷骰后打出改进攻骰的卡"会静默失效。Roll Phase Action 卡在 `thenNode` 与 `postDefense` **两个窗口都能打**，用途不同：前者改进攻骰/临时骰池，后者改防御骰结果（官方允许）。

**短路优化（体验关键）**：开窗前先枚举合法动作，若对手无牌可打且无可消耗状态 → 直接跳过窗口、不产生 `PendingRequest`。MVP 实际弹窗数因此约 2 个。

### 裁决 3 · Roll Phase Action 卡的时机矩阵

| # | 可打时机                           |
| - | ------------------------------ |
| 1 | 每次 `ROLL` 之前的 `AWAIT_DECISION` |
| 2 | `FINAL_LOCKED` 之后、**确认激活之前**   |
| 3 | 能力效果序列中的 `Then` 节点             |
| 4 | 防御掷骰前后                         |

补充裁决：**Instant 类卡 MVP 不支持真打断**，只在响应窗口内打出（采纳 design C12/Q9）。理由：真打断需要效果序列的可中断点模型，是引擎复杂度炸弹；桌游中 Instant 的绝大多数用途都能被响应窗口覆盖。

### 裁决 4 · 伤害账本改为分桶模型

架构侧原公式 `net = prevent ? 0 : max(0, gross - reduce)` 无法表达「不可防御伤害不受减伤影响」这一核心规则。改用设计侧 Bucket：

```
if (avoidFlags.length > 0) { defendable = 0; collateral = 0; }   // 不作用于 undefendable
netDefendable = max(0, Σdefendable − Σprevention)
netDamage     = netDefendable + Σundefendable + Σcollateral
hpAfter       = hp − netDamage + Σhealing
hp            = min(startHp + 10, hpAfter)
if (hpAfter <= 0) → 判负
```

- **治疗可以救回死亡**（design C5）：HP=5 受伤 10 治疗 8 → `hpAfter = 3`，存活
- **区分两个钩子**：`hitSuccess`（命中成功，即使被 avoid 也触发后置效果）vs `onDamageDealt`（需 `net > 0` 才触发）——两者语义不同，不得合并
- **伤害类型 = 4 值**（`attack` / `undefendable` / `collateral` / `pure`）+ **正交轴 `DamageSourceKind`**（`ability` / `status` / `ultimate` / `recoil`）。三轴正交：类型轴（能否防御/被 avoid/被增强）、来源轴（谁产生）、目标轴（打谁，含 self）。**原先把 `self` / `ultimate` 塞进类型轴是错的**——那会让下游每个 `switch(type)` 都长特判
- **封口公式纠正**：架构侧原 `net = prevent ? 0 : max(0, gross - reduce)` 会让 `preventAll` 连不可防御伤害一起清零，与规则冲突。正解是三分账：`net = max(0, grossDef − reduce) + grossCol + grossRaw`，avoid/preventAll 只清 Def 与 Col
- 新增 `TargetRef += { r:'attacker' }`——反伤没有它无法表达

### 裁决 5 · DSL 与 IR 的分层关系

设计侧 §3.2–3.3 是**作者友好的 DSL**（含 `graded` 分档匹配器、`NumExpr` 数值表达式、`Condition` 条件表达式、`bindRemovedTo` 变量绑定、`rollDice.cases`、`optional`）；架构侧 §3.3 是**引擎可执行 IR**（`EffectDef`，禁止闭包）。

统一表述：DSL 是作者层，IR 是引擎层，两者之间有一次**编译/降级**。需明确降级规则，尤其：`graded` 如何降级、`rollDice.cases` 如何降级、`bindRemovedTo` 的变量绑定在 IR 中如何表达、`optional` 如何产生 `PendingRequest`。校验器 `validateContent()` 覆盖 DSL 层；内容包必须提供 `describe(e, lang)` 模板化描述函数。

### 裁决 6 · autoResolve 超时默认值表

| 挂起点                                           | 超时  | 默认动作                       | 理由                                                                  |
| --------------------------------------------- | --- | -------------------------- | ------------------------------------------------------------------- |
| `abilityAnnounce`（选能力）                        | 20s | **PASS（不激活）**              | 激活会耗 CP、可能触发反噬、可能抢回合，全不可逆；PASS 是唯一零副作用项                             |
| `defensiveRoll`                               | 12s | **自动掷骰**                   | 唯一例外：4 个防御能力产出全是非负（治疗/减伤/反伤/token），掷是弱占优；随机来自服务端 RNG，不违反"不替玩家做随机决策" |
| `cardWindow`（打牌窗口）                            | 12s | PASS                       | 打牌耗 CP 且不可逆                                                         |
| `discard`                                     | 15s | 确定性排序键自动弃                  | 每张 +1CP，非负收益；排序键 `[kindRank, -costCP, defId]`，升级卡最后弃                |
| `choice`                                      | 15s | 内容作者标记的 `isDefault:true` 项 | "最保守项"无法机械判定 → 改为作者显式标记，content-lint 强制每个 choice 恰好一个 default       |
| `optionalPrompt`                              | 15s | 不行使                        | 永不替玩家消耗资源                                                           |
| `knockdownPay`                                | 15s | **付费（CP≥2 时）**             | 全表唯一会花玩家钱的默认值：丢整个进攻回合（≈10–20 伤害）远比 2 CP 严重                          |
| `chooseDice` / `chooseStatus` / `chooseCards` | 15s | 索引 / 字典序升序取前 N             | 确定性优先                                                               |
| `upkeepOrder`                                 | —   | **不产生挂起**                  | 排序权不给玩家，见裁决 9                                                       |

新增挂起点 kind：`chooseDice` / `chooseStatus` / `chooseCards` / `chooseTarget` / `optionalPrompt` / `knockdownPay`。

超时默认刻意选「不掷了 / 不动了」而非「自动再掷一次」——自动再掷会改变玩家的期望收益，等于服务端替玩家做了不可逆的随机决策。

### 裁决 7 · 其余待确认项

| 项              | 裁决                                                                                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 反伤分类           | **最终定为 `pure`**（推翻先前的 `collateral`）：不可防御、不可被 Attack Modifier 增强、不触发新增防御掷骰。**硬理由：反伤来自防御能力，而防御能力不是 Attack，按官方原则「非攻击来源的伤害没有伤害类型」= `pure`；且 `collateral` 可被 `avoid` 抹除，等于给反伤发了"可防御"资格，会破坏「一次 Roll Phase 内防御掷骰恒 ≤ 1 次」的终止性，出现反伤→反伤的递归** |
| Ultimate 与响应窗口 | 不是"跳过窗口"，而是让**对手** `actionPermission = NONE`、被剔除出响应者集合——窗口本身照常存在（行动方自己可能要花 CP 增强）。理由：代码路径统一，不需要 `if(isUltimate) bypassWindow()` 分支                                                                                                 |
| 起始数值           | HP 50 / CP 2 / 起手 4 张 / HP 上限 60 / 牌库空洗弃牌堆 / 平局可能                                                                                                                                                                                  |
| 骰子状态机          | `rollAttemptsLeft` 初始 3；锁定/解锁任意时刻可切换；**骰子操作卡不消耗 Roll Attempt**；允许全锁；防御掷骰单次不可重掷但可被卡牌修改结果                                                                                                                                            |
| 骰子随机性          | 服务端权威 + 种子化 PRNG，**种子不下发客户端**（防预知），回放 = 种子 + 指令流                                                                                                                                                                                   |

### 裁决 8 · Upkeep 死亡判定改为两段式

原表述「每结算一个状态做一次死亡判定」与「同时结算」规则冲突——那样 Upkeep 阶段的治疗就救不回 Upkeep 阶段的扣血。改为：

1. **damage 段**：所有扣血类状态（Poison / Burn）全部写入账本
2. **一次 flush + 死亡判定**
3. **decay 段**：资源衰减类状态

### 裁决 9 · IR 需新增 8 个 EffectClause

设计侧实例化 4 个英雄后验证：架构侧现有 IR 无法表达全部能力。必须新增：

| kind                            | 原因                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `conditional` + `ConditionExpr` | **最刚缺**：IR 中完全没有条件表达式。缺它则 4 英雄有 6 个能力无法表达（Overpower 阈值、Reckless 的 hitSuccess、Burning Soul 分支、Thick Skin II、`graded` 展开） |
| `avoidDamage`                   | 与 prevent 语义不同：prevent 是数值减法只吃可防御部分；avoid 是清零可防御+附带且保留 hitSuccess                                                       |
| `switchOnSymbol`                | `rollDice{cases}` 是「按符号去重、每符号至多结算一次」，既不是 choice 也不是 sequence                                                            |
| `responseWindow`                | `then` = 先开窗再执行 steps；架构侧的 `EffectDef.then` 只是 pushFront，**不开窗**                                                        |
| `bind`                          | 变量绑定（Overpower 的 rollTotal、Combustion 的 burned 数）                                                                       |
| `grantExtraOffensiveRollPhase`  | Stun 抢回合：必须先 flush + 死亡判定再回 P1                                                                                          |
| `modifyStackLimit`              | per-player、持续整局                                                                                                         |
| `discardCards`                  | 需 `mode: 'random' \| 'choice'`                                                                                          |

另需约 15 项字段/枚举扩展，关键项：伤害类型扩为 5 值、`MitigationEntry.kind += 'avoidAll'`、`TargetRef += attacker`、`Expr += var / diceCountSymbol / diceSum`、`removeStatus += bindTo`（**必须返回实际移除数，不能预先计算**）、`rollDice += pool`、`setDice` 改用面索引、`StatusEffectDef += spendable / spendEffect`、`GameState += lastRoll / tempDicePool`、`EffectQueueState += bindings`、`ChoiceOption += isDefault`。

**可在编译期展开、无需新增 kind**：`optional`（→二值 choice）、`sequence`（→展平）、`graded`（→条件分支）、`log`（丢弃）、`min/max`（→clamp）。

> `graded` 为何展开为条件分支而非拆成 tier 级 ability：拆开会破坏 `abilityId` 稳定性（升级卡按 abilityId 定位面板槽位），且 UI 候选区会出现三条同名能力，违反「焦点唯一」。

### 裁决 10 · 术语更名与最终落地签名

**关键更名**：`EffectDef.then` → **`EffectDef.next`**。  
原因：design 语境里的 "Then" 专指「响应窗口节点」，而 IR 里的 `then` 原本只是 pushFront 链式后续。同名必然配错。落地后：

- `EffectDef.next` = 链式后续，**不开窗**
- `openWindowThen` = design 的 Then，开窗 + 挂起（新增 kind）

**结算阶梯最终签名**：

```ts
type LadderStep = 'activate' | 'ultimateGate' | 'effectWalk' | 'responseWindow'
                | 'defensiveRoll' | 'simultaneous' | 'postThen' | 'cleanup';
type ReservedStep = 'targeting';        // 1v1 恒 no-op，为 2v2/多人预留
type ResolutionStep = LadderStep | ReservedStep;
```

`finalCardWindow` 已从枚举中移除，改为独立窗口栈：

```ts
interface ResponseWindow {
  id; trigger;                          // 'then'|'preDefense'|'postDefense'|'preFlush'|'rollPool'|'postFlush'
  openedAtStep; openedAtSeq;
  eligibleSeats;                        // 受 effectivePermission() 约束
  allowedActions;
  order;                                // 固定 [非行动方, 行动方]
  cursor; passStreak;                   // ≥2 关闭
  actionCount; timeoutMs; deadlineAt;
}
interface WindowStack { stack; nextSeq; totalActionsThisResolution; }
```

窗口规则写成常量表：固定顺序、2-pass 关闭、4 动作上限（超限报 `engineGuardTripped{guardReason:'windowActionLimit'}`）、超时自动 pass、**内层窗口关闭不重置外层 `passStreak`**、空窗跳过。

**`describe` 的实现约束**：函数住在 `DESCRIBERS: Record<ClauseKind, Describer>` 注册表里，**不住在 `EffectDef` 内部**——因此不破坏「IR 禁止闭包」的可序列化约束。

**其余 IR 落地**：`applyStatus→inflictStatus`、`consumeStatus→spendStatus`、`discardRandom→discard{mode}`、`setDice→setDieFace`、阶段掷骰 `rollDice→performRollAttempt`（与效果内的 `rollDicePool` 区分）、`removeStatus` 增 `bindRemovedTo`。`graded` **不进 EffectClause**——它在 P1 由 matcher 求值产出 `tier`，引擎取 `tiers[tier].effects`。

### 裁决 11 · 伤害模型最终态（含一个被抓出的潜伏 bug）

**「造成的伤害」判定**（`damageDealtAtLeast` 条件卡与 `turnDamageDealt` 统计的依据）由**正交轴**决定，与 `DamageType` 无关：

```ts
function countsAsDamageDealt(e: BucketEntry): boolean {
  return e.toSeat !== e.fromSeat        // target !== self
      && e.sourceKind !== 'recoil';      // 自我反噬不算「造成」
}
```

- `turnDamageDealt[seat]` **按 `turnIndex` 重置**——防止防守方在对手回合造成的反伤，泄漏到他自己回合的条件卡判定
- 因此：**防御反伤计入**（`sourceKind:'ability'`，target = 攻击者），**自我反噬不计入**（`barb:reckless`）

**潜伏 bug（正交化带来的意外收益）**：`barb:reckless` 两级自我反噬原写作 `type:'undefendable'`，而 `undefendable` 的语义含「可被 Attack Modifier 增强」，反噬又来自进攻能力 ⇒ **反噬会被误加成**（L1 反噬 4 变 6）。已改为 `type:'pure', sourceKind:'recoil'`，并新增 content-lint 规则：`sourceKind === 'recoil'` 时 `target` 必须是 `self`。

**新增硬不变量**：**一次 Roll Phase 结算内防御掷骰次数恒 ≤ 1**，防御链一步收敛。这是终止性证明，不是平衡取舍。

---


## 4. 待用户拍板（design 侧 Q1–Q13 精简）

| #       | 问题                                  | 影响面              | 建议                                                                 |
| ------- | ----------------------------------- | ---------------- | ------------------------------------------------------------------ |
| Q1      | **IP 路径**：自用学习 / 重皮主题化公开 / 争取授权？    | 决定美术方向、命名、能否公开匹配 | MVP 先按自用原型推进，数据层保持重皮就绪；公开发布前必须重皮                                   |
| Q2/Q3   | 治疗时序（与伤害净额同步 or 立即生效）？治疗能否救回死亡？     | 死亡判定手感           | 同步结算 + 能救回（更友好、与"同时结算"自洽）                                          |
| Q5      | 断线/超时：判负 or 暂停计时？                   | 竞技公平性            | 休闲 60s 判负、排位暂停计时；MVP 用休闲规则                                         |
| Q9      | Instant 卡是否支持真打断？                   | 引擎复杂度            | 不支持（已按此裁决推进）                                                       |
| Q6      | MVP 后第一优先级：加英雄 or 做回放/AI/天梯？        | 排期               | 加 2–4 英雄（数据驱动边际成本最低）                                               |
| **Q12** | **选能力超时（20s）时，若候选恰好只有 1 项，是否自动激活？** | 体验缺口 vs 不可逆风险    | 维持 PASS，但做成开关。**这条争议最大**：掉线时掷出大顺却白掷是明显体验缺口；但自动激活会耗 CP、可能触发反噬、可能抢回合 |
| **Q13** | 反伤不可减伤会让 Pyromancer（玻璃大炮）强度上升，是否接受？ | 平衡               | 接受，若实测失衡请**改数值不要改类型**——类型改动会破坏终止性证明                                |

---

## 5. 已知风险

| #  | 风险                                        | 严重度 | 缓解                                                          |
| -- | ----------------------------------------- | --- | ----------------------------------------------------------- |
| R1 | **IP 版权**：官方数字版 2027 上线，美术/文本/商标受保护       | 高   | MVP 定位自用原型；数据层零 flavor text；公开前重皮（换名/换美术/换世界观），机制本身通常不受版权保护 |
| R2 | 随机性挫败感（3 次掷骰全空）                           | 中高  | 概率提示（把运气游戏变概率决策游戏）+ 赛后骰运报告 + 教程用最直接的英雄                      |
| R3 | 规则边界爆炸（Ultimate 不可响应、Stun 额外回合、`then` 开窗） | 中   | 管线统一为权限令牌 + 窗口栈两个机制；每个雷区至少 3 条单测                            |
| R4 | 信息隐藏做错 = 作弊                               | 中   | 结构化白名单投影（非深拷贝后 delete）+ 传输层断言 + 属性测试                        |
| R5 | 4 英雄内容深度有限（10 个 matchup）                  | 中低  | 数据驱动使后续英雄只加数据；AI 陪练补单人场景                                    |
| R6 | 数值校准（部分英雄数值待核对）                           | 中   | 上线前安排一次 rules-lawyering pass；DSL 使其只改数据不改代码                 |

---

## 6. 评审状态与下一步

### 架构评审

| 版本   | 判定       | 说明                                          |
| ---- | -------- | ------------------------------------------- |
| v0.1 | CONCERNS | 4 项阻塞（结算阶梯未对齐、`onDamageDealt` 语义未定、IP、内容数据） |
| v0.2 | **PASS** | 两条技术阻塞已解除，交叉核对未发现新技术不可行项，可进入 M0             |

### 剩余阻塞

| 编号 | 内容                         | 性质                                              | 谁来定        |
| -- | -------------------------- | ----------------------------------------------- | ---------- |
| B3 | **IP 路径**（自用 / 重皮主题化 / 授权） | 非技术。**只阻塞公开发布，不阻塞 M0**                          | **用户**     |
| B4 | 4 英雄内容数据准确性                | 排期。工作量约为引擎内核的 1.5 倍，不可低估                        | 用户         |
| B5 | `collateral` 在 1v1 的归属     | 低                                               | design（已转） |
| B6 | DSL↔IR 编译契约端到端验证           | 中。**M0 出口条件**：Barbarian + Pyromancer 编译产物须经双方评审 | 双方         |
| B7 | `describe` 中英文案模板          | 中。缺一个 kind 的模板即 lint 失败、内容无法上线                  | design     |
| B8 | rules-lawyering 数值校准 pass  | 低，0.5–1 人日，只改数据                                 | design     |

### 里程碑

```
M0 引擎可跑通单局脚本对战
M1 本地双人对战（热座，验证信息隐藏）
M2 联机 1v1 可用（含断线重连与超时托管）
M3 4 英雄完整 + 体验打磨
```

M0 是生死线：从种子喂一串指令跑完整局到分出胜负，事件序列快照稳定。**M0 测试基线不稳，后续皆是沙上建塔。**
