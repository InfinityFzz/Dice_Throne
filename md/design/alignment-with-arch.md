# 设计与架构对齐决议（DT-DES-002）

> 任务号：**DT-DES-002**（DT-DES-001 的对齐补充轮）
> 作者：文策渊（design-strategist）　|　对象：engineering-lead（程基岩），经主理人中转
> 上游：`D:\workbuddy\design\dice-throne-design-spec.md`（规则裁决）、`D:\workbuddy\design\hero-schema-draft.md`（DSL 数据模型）
> 下游：`D:\workbuddy\docs\architecture\dice-throne-architecture.md` §2.4 / §3 / 附录 A / 附录 B

**本文效力**：本文是**设计裁定**，不是实现建议。凡本文与架构文档 §2.4 / 附录 B 冲突处，**以本文为准**（主理人已裁决：结算阶梯以 design 侧 P1–P8 为准）。凡本文与主规格 §1–§7 冲突处，**以本文为准**（本文是对主规格的自我修正，修正清单见 §6.2）。

**IP 规避声明**：本文只出现机制符号 id、类型名、数值与逻辑。零官方卡面文本、零 flavor text、零英雄/卡牌/世界观的叙事内容。

---

## §0 五条总原则（后续所有裁定的推导依据）

| # | 原则 | 用于解决什么问题 |
|---|---|---|
| **G1** | **永不替玩家消耗不可逆资源**（CP / token / 手牌） | 所有 `autoResolve` 的第一判据 |
| **G2** | **永不替玩家做随机决策**（掷骰、洗牌） | P1 自动 PASS 而非自动激活；但防御掷骰例外（见 G3） |
| **G3** | **弱占优动作可自动执行**（该动作在任何情况下都不比不做更差） | 防御掷骰超时视为"掷"（G2 的唯一例外，理由见 §3） |
| **G4** | **超时不重罚、也不白等** | 超时值收紧到 12–20s；默认动作必须零副作用或弱占优 |
| **G5** | **确定性优先于"最优"** | 所有自动选择必须是引擎可机械判定的规则（`defId` 字典序、索引升序），绝不允许"服务端挑一个最好的" |

---

## §1 结算阶梯对齐（P1–P8 ↔ 架构 R0–R8）

### 1.1 映射表

架构侧 `ResolutionStep` 目前 10 步（`effectEmit / nonDamage / targetEffects / targeting / defensiveRoll / finalCardWindow / ledgerClose / simultaneousApply / postTriggers / cleanup`）。按下表收敛到 8 步：

| P | 名称 | 吞掉的架构步 | 说明 |
|---|---|---|---|
| **P1** | ACTIVATE | —（**阶段级，不是阶梯步**） | 属于 `offensiveRoll` 阶段的 `abilityAnnounce` 挂起点：确定 Final Dice Result → 服务端算 candidates → 行动方单选 / PASS。PASS → 直接跳 P8 |
| **P2** | ULTIMATE GATE | `effectEmit` 的前置子步 | 入队前先做权限闸：Ultimate → 对手 `actionPermission := NONE`；Blind（P2 优先级）生效 → 能力激活失败跳 P8 |
| **P3** | EFFECT WALK | `effectEmit` + `nonDamage` + `targetEffects` | 按序执行 effect 序列。非伤害类立即生效；伤害/治疗/减伤写 Ledger；Stun 立即施加（C2）；遇 `then` → 开 P4b |
| **P4** | RESPONSE WINDOW | `finalCardWindow`（**改为可重入窗口栈，见 1.2**） | 三个具名入口：P4b(thenNode) / P4a(preDefense) / P4c(postDefense) |
| **P5** | DEFENSIVE ROLL | `targeting` + `defensiveRoll` | 1v1 targeting 无决策但仍产出事件；若 Ledger 有 defendable → 防守方掷 N 颗（一次性、不可重掷）；反伤/减伤写同一 Ledger 反向条目 |
| **P6** | SIMULTANEOUS | `ledgerClose` + `simultaneousApply` | **原子步，无任何输入点**。封口 → 按 §5.4 公式算 net → 写 HP → 死亡判定 |
| **P7** | POST / THEN | `postTriggers` | 执行 Additionally 段与延迟后置；`onDamageDealt`（net>0）钩子；条件卡窗口 P4d（**MVP 关闭**）；`grantExtraOffensiveRollPhase` 在此触发（C3：先 flush 再开新 ORP） |
| **P8** | CLEANUP | `cleanup` | 胜负检查（含平局）、清临时骰池、恢复 `actionPermission`、推进阶段机 |

### 1.2 关键结构性改造：`finalCardWindow` → 可重入窗口栈

架构侧把"最后一次打牌窗口"做成**阶梯中的一个固定步**（在 `defensiveRoll` 之后、`ledgerClose` 之前）。这与规则不符：窗口在 P3 内部就会被 `then` 节点打开，且可能打开多次。

**裁定：P4 不是阶梯中的一个步，而是一个可重入（reentrant）子状态。** 阶梯推进到某步时，"是否进入 P4"由该步的 `ResponseSpec` 决定；P4 退出后回到被打断的那一步继续。

```
P3 ──遇 then──▶ [P4b] ──▶ 执行 then.steps ──▶ 回到 P3
P3 走完 ──────▶ [P4a] ──▶ P5
P5 走完 ──────▶ [P4c] ──▶ P6
P7 走完 ──────▶ [P4d] ──▶ P8      (MVP: 关闭)
```

### 1.3 四个具名窗口 + 两个阶段级窗口

| 窗口 id | ladderStep | 触发点 | reentrant | MVP 启用 |
|---|---|---|---|---|
| `thenNode` | P3（then 节点处） | 每个 `then` 节点 | ✅ 每节点一次 | ✅ |
| `preDefense` | P3→P5 之间 | P3 全部走完 | ❌ 每次结算 1 次 | ✅ |
| `postDefense` | P5→P6 之间 | 防御掷骰结算完（含 P5 skip 时） | ❌ 每次结算 1 次 | ✅ |
| `postTrigger` | P7→P8 之间 | 后置触发结算完 | ❌ | ❌ **MVP 关闭**（4 英雄卡组无 `playCondition` 条件卡） |
| `mainPhaseEnd` | 阶段级（MAIN_1 / MAIN_2） | 行动方点「结束阶段/结束回合」 | ❌ 每阶段 1 次 | ❌ **MVP 关闭**（无 Instant 卡） |
| `abilityAnnounce` | 阶段级（P1） | 非窗口，是普通挂起点 | — | ✅ |

**窗口短路规则（R7，必做）**：窗口开启前，服务端先枚举 `eligiblePlayers` 的合法动作；**若全部为空，直接跳过该窗口，不产生 `PendingRequest`**。这条能把 MVP 实测窗口数从 3 降到 1–2，是节奏的救命优化。

**窗口合并规则（可选，P2）**：`thenNode` 窗口关闭后若到 `preDefense` 之前**无任何状态变更**（Ledger / 骰池 / status / CP / HP 均未变），两个窗口合并为一次（只开 `thenNode`）。配置位 `coalesceWithPreviousIfNoStateChange: true`。

**硬上限**：单次结算内 P4 窗口开启总数 ≤ 3；达到上限后不再开 `preDefense`。若实测节奏仍不可接受，**第一个要砍的是 `preDefense`**（单配置位关闭，不改代码）。

---

## §2 ① 三类卡时机矩阵（八阶段 × P1–P8）

### 2.1 图例

| 符号 | 含义 |
|---|---|
| ✅ | 可打（需满足 `costCP`、`playCondition`、`actionPermission`） |
| ❌ | 不可打（服务端返回 `Err('illegalAction')` / `Err('wrongPhase')`） |
| 🅡 | MVP 保留但不启用（数据层无此类内容，配置位关闭） |
| ✅ᴬ | 仅**行动方**可打 |
| ✅ᴰ | 仅**防守方**可打 |
| — | 该格子不存在输入点（原子步 / 自动推进） |

### 2.2 主矩阵

行 = 阶段（含阶段级子状态）；跨阶梯时按 P1–P8 展开。**列 = 三类卡 + Instant + 消耗型状态。**

| # | 阶段 / 子状态 | 阶梯步 | Upgrade | Main Phase Action | Roll Phase Action | Instant | spendable 状态 | 备注 |
|---|---|---|---|---|---|---|---|---|
| 1 | `UPKEEP` | — | ❌ | ❌ | ❌ | ❌ | ✅ | 无窗口。Upkeep 按 §6.2-C6 修正的固定顺序自动结算 |
| 2 | `INCOME` | — | ❌ | ❌ | ❌ | ❌ | ✅ | 纯自动（首回合先手跳过） |
| 3 | `MAIN_1` | — | ✅ᴬ | ✅ᴬ | ❌ | 🅡 | ✅ᴬ | 卖牌 ✅ᴬ。结束时对非行动方开 `mainPhaseEnd` 窗口（MVP 关闭） |
| 4 | `OFFENSIVE_ROLL` · `AWAIT_DECISION`（掷骰决策） | P1 前 | ❌ | ❌ | ✅ᴬ | ❌ | ✅ | 掷骰 / 锁定解锁 / 打骰子操作卡。**不是响应窗口**，无 pass 轮转、无超时 pass 语义 |
| 5 | `OFFENSIVE_ROLL` · `FINAL_LOCKED` → **P1 ACTIVATE** | P1 | ❌ | ❌ | ✅ᴬ | ❌ | ✅ | 挂起点 `abilityAnnounce`。改骰卡在此仍可打（改完重算 candidates）。超时 20s → **PASS** |
| 6 | **P2** ULTIMATE GATE | P2 | ❌ | ❌ | ✅ᴬ¹ | ❌ | ✅ᴬ¹ | ¹ **仅行动方**：对手 `actionPermission = NONE`，所有动作 `DENIED` + UI 灰化。非 Ultimate 时此步无输入点，直接过 |
| 7 | **P3** EFFECT WALK（非 then 段） | P3 | ❌ | ❌ | ❌ | ❌ | ❌ | **效果执行期间无任何输入点** —— 这就是"不真打断"（C12/Q9）。`optional`/`choose` 在此产生的是**效果内挂起点**（`optionalPrompt`/`choice`），不是打牌窗口 |
| 8 | **P4b** RESPONSE WINDOW · `thenNode` | P4 | ❌ | ❌ | ✅ | ✅🅡 | ✅ | 非行动方先；可改可变范围见 §2.3 |
| 9 | **P4a** RESPONSE WINDOW · `preDefense` | P4 | ❌ | ❌ | ✅ | ✅🅡 | ✅ | 同上 |
| 10 | **P5** DEFENSIVE ROLL | P5 | ❌ | ❌ | ❌ | ❌ | ✅ᴰ² | ² 挂起点 `defensiveRoll`。MVP 单防御能力 → 默认自动掷不弹窗（C15）；仍需给"消耗 Evasive 类状态"一个入口 |
| 11 | **P4c** RESPONSE WINDOW · `postDefense` | P4 | ❌ | ❌ | ✅ | ✅🅡 | ✅ | ★ 官方"最后一次打牌机会"。**Roll Phase Action 与 Instant 都在此可打** |
| 12 | **P6** SIMULTANEOUS | P6 | ❌ | ❌ | ❌ | ❌ | ❌ | **原子步**。Ledger 封口 + 写 HP + 死亡判定，中间无输入点 |
| 13 | **P7** POST / THEN | P7 | ❌ | ❌ | ❌³ | ❌³ | ❌ | ³ 仅经由 `postTrigger` 窗口（MVP 关闭）。`onDamageDealt` 钩子在此触发 |
| 14 | **P8** CLEANUP | P8 | ❌ | ❌ | ❌ | ❌ | ❌ | 自动 |
| 15 | `MAIN_2` | — | ✅ᴬ | ✅ᴬ | ❌ | 🅡 | ✅ᴬ | 同 #3 |
| 16 | `DISCARD` | — | ❌ | ❌ | ❌ | ❌ | ✅ᴬ | 挂起点 `discard`（选牌，不是打牌）。超时 15s → 确定性自动弃牌（§3） |
| — | `TARGETING`（1v1） | — | — | — | — | — | — | 1v1 直接 skip，无输入点 |

### 2.3 三个关键问题的直接回答

**Q：Roll Phase Action 卡在 P4 里，P3 的 then 窗口和 P5 之后的窗口都能打吗？**
**A：两者都能打。** `thenNode`（P4b）与 `postDefense`（P4c）的 `allowedActions` 都含 `rollPhaseCard`。理由：两类卡的核心用途不同——then 窗口改的是**进攻骰 / 临时骰池**（改变后续伤害），postDefense 窗口改的是**防御骰结果**（官方明确允许，见 C8/§2.2）。

**Q：那 P4a 和 P4c 都能改进攻骰吗？**
**A：不能。这就是必须加 `mutableScope` 的原因——**

| 窗口 | `mutableScope.offenseDice` | `mutableScope.defenseDice` | `mutableScope.tempDicePool` | `mutableScope.ledger` |
|---|---|---|---|---|
| `thenNode` (P4b) | ✅ | ❌（尚未掷） | ✅（"Roll N" 临时骰池，C8） | ✅ |
| `preDefense` (P4a) | ✅ | ❌（尚未掷） | ❌ | ✅ |
| `postDefense` (P4c) | ❌（已锁定为 Final Dice Result，改了无意义） | ✅ | ❌ | ✅ |

`mutableScope` 是服务端**拒绝**非法改骰请求的依据（不是靠 UI 灰化）。例：在 P4c 打出"把你 1 颗骰改成 flame" → `Err('illegalAction')`，因为能力已激活、伤害已入账。

**Q：Instant 卡到底标死在哪？**
**A：标死在 —— Instant 卡只能在显式响应窗口内打出，绝不能在 P3 效果序列执行期间打断。** 具名窗口清单：

| 窗口 | Instant 可打？ |
|---|---|
| `thenNode` / `preDefense` / `postDefense` | ✅ |
| `postTrigger`（P7）、`mainPhaseEnd` | ✅（配置就绪，MVP 因无 Instant 卡而关闭） |
| `AWAIT_DECISION` / `FINAL_LOCKED`（P1） | ❌ **—— 骰子操作需求已被 Roll Phase Action 卡完整覆盖；Instant 的价值在"响应对手"，不在"改自己的骰"** |
| P2 / P3 / P6 / P8 / INCOME / DISCARD / `UPKEEP` | ❌ |

> ⚠️ 需用户拍板（**Q11**）：若未来希望 Instant 能在 P1 改骰，只需把 `preActivate` 也模型化为一个 `ResponseSpec` 并把 `instantCard` 加进 `allowedActions`——**一个配置位的事**，不是引擎改造。MVP 无 Instant 卡（4 英雄 4 张行动卡全是 mainPhase / rollPhase），所以此裁定现在零成本。

### 2.4 可直接翻译的 `ResponseSpec` 配置

```ts
interface ResponseSpec {
  readonly kind: 'thenNode' | 'preDefense' | 'postDefense' | 'postTrigger' | 'mainPhaseEnd';
  readonly enabled: boolean;                       // postTrigger / mainPhaseEnd: false（MVP）
  readonly ladderStep: 'P3' | 'P4' | 'P5' | 'P7' | 'phase';
  readonly reentrant: boolean;                     // 仅 thenNode = true
  readonly eligible: 'bothSeats' | 'activeOnly' | 'defenderOnly';
  readonly eligibleOverrideByPermission: true;     // Ultimate/Stun 时把 NONE 方从 eligible 剔除
  readonly allowedActions: readonly ('rollPhaseCard' | 'instantCard' | 'mainPhaseCard' | 'upgradeCard' | 'spendStatus')[];
  readonly order: 'nonActiveFirst';                // 固定
  readonly passStreakToClose: 2;                   // 固定（C1）
  readonly maxActionsPerWindow: 4;                 // 固定（C1，防刷）
  readonly perActionTimeoutMs: 12000;              // 固定（§3）
  readonly autoResolve: 'pass';                    // 固定
  readonly mutableScope: {
    readonly offenseDice: boolean;
    readonly defenseDice: boolean;
    readonly tempDicePool: boolean;
    readonly ledger: boolean;
  };
  readonly skipIfNoLegalActions: true;             // 固定（R7）
  readonly coalesceWithPreviousIfNoStateChange?: true;   // 可选，P2
}

// 实际配置（MVP）
const WINDOW_SPECS = {
  thenNode:     { enabled:true,  ladderStep:'P3', reentrant:true,  eligible:'bothSeats',
                  allowedActions:['rollPhaseCard','instantCard','spendStatus'],
                  mutableScope:{ offenseDice:true,  defenseDice:false, tempDicePool:true,  ledger:true } },
  preDefense:   { enabled:true,  ladderStep:'P4', reentrant:false, eligible:'bothSeats',
                  allowedActions:['rollPhaseCard','instantCard','spendStatus'],
                  mutableScope:{ offenseDice:true,  defenseDice:false, tempDicePool:false, ledger:true } },
  postDefense:  { enabled:true,  ladderStep:'P4', reentrant:false, eligible:'bothSeats',
                  allowedActions:['rollPhaseCard','instantCard','spendStatus'],
                  mutableScope:{ offenseDice:false, defenseDice:true,  tempDicePool:false, ledger:true } },
  postTrigger:  { enabled:false, ladderStep:'P7', reentrant:false, eligible:'bothSeats',
                  allowedActions:['rollPhaseCard','instantCard','spendStatus'],
                  mutableScope:{ offenseDice:false, defenseDice:false, tempDicePool:false, ledger:true } },
  mainPhaseEnd: { enabled:false, ladderStep:'phase', reentrant:false, eligible:'bothSeats',
                  allowedActions:['instantCard','spendStatus'],
                  mutableScope:{ offenseDice:false, defenseDice:false, tempDicePool:false, ledger:true } },
} as const;
```

### 2.5 `postDefense` 的开启条件（补一条）

不只是"防御掷骰后"。精确条件：

```
开 postDefense  ⟺  ( ledger 中存在 defendable 或 collateral 条目 )      // 有可被 avoid/prevent 影响的东西
                    OR ( 任一 eligible 玩家有 ≥1 张合法可打的 rollPhase/instant 卡 )
                    OR ( 任一 eligible 玩家有 ≥1 个可消耗的 spendable 状态 )
```
若 Ledger 只有 `undefendable / pure / self`，且双方无牌可打无状态可消耗 → **服务端跳过**，`Err('wrongPhase')` 兜住任何迟到请求。这是 R7 的最高频生效点。

---

## §3 ② 每类挂起点的 `autoResolve` 默认值表

### 3.0 三条前置约定

1. **本表的 `timeoutMs` 覆盖架构 §2.4.3 的"单次 PendingRequest 30s"默认值。** 30s 对响应窗口太长（R7：等 15s 已经很难受），对主动决策又显得催促。按 kind 分级。
2. **`autoMode`（连续超时 3 次）不改变 `autoResolve` 的值**，只跳过 prompt 直接应用（秒回）。理由：两套默认值会让行为不可预测、无法测试。
3. 所有"自动选择"必须是**引擎可机械判定**的（G5）：`defId` 字典序、骰子索引升序、`options` 声明顺序。**绝不允许"服务端挑一个最优的"。**

### 3.1 主表

| # | `PendingRequest.kind` | 产生位置 | `timeoutMs` | `autoResolve` | 一句话理由 |
|---|---|---|---|---|---|
| 1 | **`abilityAnnounce`**（选择进攻能力，含 PASS） | P1 | **20s** | **`'pass'`**（不激活任何能力，跳 P8） | G1+G2：激活能力可能消耗 CP、触发自我反噬（Reckless 反噬 4–5 点）、触发 Stun 抢回合——全是不可逆的。PASS 是唯一零副作用选项。⚠️ 见下方 **Q12** 开关 |
| 2 | **`defensiveRoll`**（防御掷骰响应） | P5 | **12s** | **`'roll'`**（用该英雄默认防御能力自动掷） | **G3 例外**：MVP 四个防御能力（Thick Skin / Molten Armor / Moon Defense / Smoke Screen）产出全是**非负**（治疗 / 减伤 / 反伤 / 获得 token），掷是**弱占优**——不掷严格不优于掷。且掷的随机性来自服务端 RNG，与玩家选择无关，不违反 G2。⚠️ MVP 单防御能力 → 按 C15 **默认根本不弹窗**（自动掷 + 0.8s 动画），此行只在「保留确认」开关打开时生效 |
| 3 | **`cardWindow`**（打牌窗口：P4a/P4b/P4c） | P4 | **12s** | **`'pass'`**（不打牌） | G1：打牌消耗 CP 且不可逆。PASS 零副作用。12s 是 R7 的收紧值（原 C1 的 15s 已改为 12s，见 §6.2） |
| 4 | **`discard`**（弃牌阶段选牌） | DISCARD 阶段 | **15s** | **`'auto'`**（服务端按确定性排序键弃满 `overflow` 张） | 弃牌每张 **+1 CP**，对玩家是**非负收益**——不会"重罚"，最多是"弃错了牌"。排序键见 §3.2 |
| 5 | **`choice`**（多选项 `choose`） | 任意 | **15s** | **该 `choice` 中标记 `isDefault: true` 的 optionId** | 见 §3.3：**"最保守项"无法机械判定**，改为**内容作者显式标记** + `content-lint` 强制"每个 `choice` 恰好一个 `isDefault`"。作者约定：把"不行使 / 最小承诺"项放第一位并标 default |
| 6 | **`optionalPrompt`**（`optional` 是否行使） | P3 / 效果序列内 | **15s** | **`'decline'`**（不行使） | G1：MVP 的 `optional` 全部伴随后置伤害计算（Combustion 移除 FM 换 3×N 伤害）。自动行使 = 替玩家消耗 token。默认不消耗 |
| 7 | **`chooseDice`**（选骰，如"把 1 颗骰改为 X"） | P3 / 卡效果内 | **15s** | **`'auto'`**：按**骰子索引升序**取前 `count` 颗（先看未锁定骰，不足再取已锁定骰） | G5：改骰是增益操作，必须给确定答案否则效果悬空。索引升序可预测、可复现 |
| 8 | **`chooseStatus`**（移除"任意 N 个状态"） | P3 | **15s** | **`'auto'`**：按 `statusId` 字典序取前 `stacks` 个 | G5：确定性优先。C10 已定选择权归效果发起方，超时时按字典序 |
| 9 | **`chooseCards`**（选牌，非弃牌阶段） | 任意 | **15s** | **`'auto'`**：同 §3.2 排序键 | 同 #4 |
| 10 | **`chooseTarget`**（选目标） | — | 15s | **`'auto'`**：取第一个合法 seat（升序） | 🅡 1v1 不产生；多人模式预留 |
| 11 | **`knockdownPay`**（Knockdown：付 2 CP 还是跳过 ORP） | `offensiveRollPhaseStart` 钩子 | **15s** | **`'pay'`** 若 `cp >= 2`；否则 **`'skip'`** | **G1 与 G4 冲突时的取舍**：失去整个进攻回合（≈10–20 伤害）远比 2 CP 严重。这是全表唯一"会花玩家资源"的默认值，因为不花的代价更大。CP 不足时只能 skip |
| 12 | **`upkeepOrder`**（Upkeep 多效果排序权） | UPKEEP | **不产生 prompt** | —（引擎固定顺序） | **OVERRIDE 架构附录 B #4**。见 §3.4 |
| 13 | `defensiveAbilityChoice`（多个防御能力时选哪个） | P5 | 15s | `options[0]` | 🅡 MVP 每英雄仅 1 个防御能力（B12），不产生。保留枚举值无害 |

### 3.2 `discard` / `chooseCards` 的确定性排序键

```
弃牌优先级（升序 = 先弃）：
  key = [ kindRank, -costCP, defId ]

  kindRank:  action(mainPhase) = 0
             action(rollPhase) = 1
             action(instant)   = 2
             upgrade           = 3      ← 升级卡最后弃（长期资产）
  -costCP:   贵的先弃（贵卡在可预见 CP 曲线下最可能成为死牌）
  defId:     字典序（最终确定性 tie-break）
```

**弃牌阶段每张 +1 CP**，因此自动弃牌不可能"净亏"，只可能"弃错了牌"——这正是 G4 想要的"不重罚"。

> 这是对主规格 §2.1「自动卖最右侧 N 张」的**修正**："最右侧"依赖客户端手牌排序，不是引擎可判定的确定性规则（G5）。见 §6.2。

### 3.3 `choice` 的 `isDefault` 约定

```ts
interface ChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly effects: readonly EffectDef[];
  readonly isDefault?: boolean;        // ← 新增字段
}
```
- `content-lint` 新增一条：**每个 `choice` clause 必须恰好有一个 `isDefault: true`**（架构 §2.6 L3 自检清单第 9 条已有"所有 ChoiceOption 都有非空 autoResolve"，把它升级为这条）。
- 作者约定（写进内容规范）：**"不行使 / 最小承诺 / 不消耗资源"的选项放第一位并标 `isDefault`。**
- `optional` 编译出的二值 `choice` 自动把 `decline` 标 default。

### 3.4 `upkeepOrder` —— OVERRIDE 架构附录 B #4

**架构默认**：排序权归活跃玩家，需挂起点 `upkeepOrder`。
**我的裁定：不需要这个挂起点，Upkeep 顺序由引擎固定。**

理由：
1. 4 个 MVP 英雄的 Upkeep 效果只有两类：`damage`（Burn 2 / Poison ×N）与 `decay`（Fire Mastery −1）。两类之间**互不影响数值**（Poison 伤害 = `statusStacks(poison)`，与 FM 无关），顺序无策略意义。
2. 给玩家排序权 = **每次 Upkeep 都多一次点击**，纯交互噪声；且新手不知道该怎么排，会产生"我排错了"的挫败感。
3. 固定顺序可测、可复现、易解释。

**同时修正主规格 C6**（见 §6.2）：Upkeep 改为两段式，与 C4/C5 的"同时结算"哲学自洽：

```
UPKEEP 段 1（damage）：所有 order:'damage' 的效果 → 写入 Ledger → 一次 flush → 死亡判定
UPKEEP 段 2（decay） ：所有 order:'decay'  的效果 → 顺序执行（无死亡判定）
段内按 statusId 字典序
```
> 原 C6 说"每结算一个状态做一次死亡判定"，与 C4/C5 的"同时结算 + 治疗可救回"矛盾。改为段内合并 flush 后，Upkeep 的扣血也能被 Upkeep 的治疗救回，语义统一。

---

## §4 ③ 架构附录 B / §8-B2 六条逐条确认

| # | engineering 默认值 | 我的裁定 | 细化 |
|---|---|---|---|
| **1** | `onDamageDealt` 基准 = `net > 0`；被完全预防/闪避不触发；**多次伤害按目标每次结算触发一次**，不是合计触发一次 | **CONFIRM** | 补两条边界：<br>① **"每次结算" = 每个 flush 点 × 每个目标一次**。同一次 P6 flush 中，A 净伤 >0 → `onDamageDealt(A)` 触发 **1 次**（不是每个 DamageEntry 一次）；反伤使 B 净伤 >0 → `onDamageDealt(B)` 触发 1 次。<br>② **`onDamageDealt`（net>0）与 `hitSuccess`（命中成功）是两个不同概念**：被 `avoid` 完全闪避时 `net = 0` → `onDamageDealt` **不触发**；但 `hitSuccess = true` → `Then` / `Additionally` / `{c:'hitSuccess'}` 条件**照常触发**（C7）。Reckless 的自我反噬 4 点就依赖这条。<br>③ `damageDealtAtLeast(N)` 条件 = **本回合内对该目标累计已应用的净伤害**（引擎维护 `turnDamageDealt[seat]`），P7 之后可读 |
| **2** | 弃牌堆双方公开 | **CONFIRM** | 补充：公开的是**内容**（`CardInstance[]`），**顺序无意义**；重洗时产出 `deckReshuffled` 事件（公开）。与架构 §2.5.1 一致 |
| **3** | 玩家不能查看自己牌库顺序，只给 `deckCount` | **CONFIRM** | 无补充。与我的 B7/D9 一致 |
| **4** | Wild 面参与顺子判定时**可充当任意值** | **CONFIRM**（+ 一处数据模型修正） | 细化：判定法 = 枚举 Wild 面的取值组合（≤ 6^k，k = Wild 数；实际 k ≤ 2），任一组合使条件成立则 `matched = true`。顺子：Wild 可充当任意 1–6 的值参与连号。<br>⚠️ **MVP 4 英雄骰池无 Wild**（每面恰 1 个符号），此规则在 MVP 内容中**不触发**，但引擎必须实现。<br>⚠️ **数据模型修正**：我的 `HeroDef.dice: [Sym×6]`（每面单符号）无法表达 Wild。升级为 `dieFaces: DiceFace[]`（`{ value: 1..6, symbols: Sym[] }`），与架构 `DiceSymbolPool.faces` 对齐。MVP 每面 `symbols` 长度为 1 |
| **5** | 反伤走同一 Ledger 的反向条目，且**不可防御** | **CONFIRM（类型裁定见下；⚠️ 本条已被 DT-DES-003 §R1 修订）** | "不可防御"要拆成两件事：<br>① **不触发防御掷骰** → ✅ 同意。理由：攻击方本回合的 ORP 已结束，`defenseRollGranted` 一次性（A11），无法再给攻击方开一次防御窗口。<br>② **不受 `avoid` 影响** → ✅ **同意**（**DT-DES-003 修订**：本栏原裁定为 `collateral`「可被 avoid 闪避」，经 design-strategist-2 复核后**推翻**，改判 **`pure`**）。<br>**改判理由**：反伤来自**防御能力**，而防御能力不是 Attack ⇒ 按官方原则「非攻击来源的伤害没有伤害类型」= `pure` ⇒ 不触发防御掷骰、**不受 prevent/avoid 影响**、**不可被 Attack Modifier 增强**。原 `collateral` 判定的致命缺陷是：`collateral` 可被 `avoid` 抹除，等于让反伤重新变成「可防御」，**破坏"一次 Roll Phase 内防御掷骰恒 ≤ 1 次"的终止性**。<br>③ 由此得到一条硬不变量：**一次 Roll Phase 内防御掷骰次数恒 ≤ 1**，不存在反伤→反伤的递归。<br>**已同步修正的数据**：`pyro:moltenArmor`、`elf:moonDefense` 的反伤 `type: "attack"` → **`"pure"`**（见 §6.2-M6） |
| **6** | Ultimate 激活后**完全跳过响应窗口**（无人可干预） | **CONFIRM（改为更精确的等价表述）** | 精确表述：Ultimate 在 P2 使**对手** `actionPermission := NONE`，于是对手在 P4a/P4b/P4c 中**被从 `eligiblePlayers` 剔除**；但**窗口本身照常存在**，因为**行动方自己**可能要在窗口内花 CP 打增强卡或消耗状态。<br>为什么坚持"窗口仍存在"而不是"跳过"：① 代码路径统一，不需要 `if (isUltimate) bypassWindow()` 分支；② 行动方保留自我增强能力；③ UI 上对手看到的是灰化 + "终极能力无法响应"，信息量比"什么都没发生"更好（§1.2 / §4.4）。<br>恢复时机：**P8 CLEANUP**。<br>另：Ultimate 伤害**不能被 prevent / reduce / avoid**（A15），且**不触发防御掷骰** |

**另需补一条：架构 §8-B2 还问「`then` / 伤害成功造成的触发语义」，已在上表 #1 回答完毕。**

---

## §5 ④ DSL → IR 降级映射表

### 5.0 前提确认

- ✅ 同意「引擎只认 IR（`EffectDef`），不认 DSL」。DSL 只存在于 `packages/shared/src/dsl/compile.ts`，编译产物是 `EffectDef`。
- ✅ 同意「IR 中禁止函数 / 闭包 / class / Symbol / 正则」。我的 DSL 全部构造都是纯数据，映射后依然是纯数据。
- ✅ `describe(e, lang)` 模板函数（E6）是**UI 层**的，不进 IR。

### 5.1 需要 **新增 EffectClause kind** 的清单（8 个）

> 按你的说法"加一个 kind 就是一个纯函数 handler，成本很低，不要客气"——那就都不客气了。

| # | 新增 kind | 签名（草案） | 为什么无法用现有 kind 表达 |
|---|---|---|---|
| **N1** | **`conditional`** | `{ kind:'conditional'; cond: ConditionExpr; then: EffectDef[]; else?: EffectDef[] }` | **IR 里完全没有条件表达式**。这是最刚需的一个：Overpower 的 `diceSumAtLeast(14→10)`、Reckless 的 `hitSuccess`、Burning Soul 的 3×/4× 分支、Thick Skin II 的判定、以及 `graded` 的展开——全部依赖它。**缺它则 4 个英雄有 6 个能力无法表达** |
| **N2** | **`avoidDamage`** | `{ kind:'avoidDamage'; for: TargetRef }` | 与 `preventDamage` 语义不同，不能合并：`prevent` 是**数值减法**且只吃 defendable；`avoid` 是**清零** defendable + collateral，且 `hitSuccess` 仍为 true、后置效果照常触发（C7）。用 `preventDamage{amount:'all'}` 表达不了"清 collateral 且保留 hitSuccess" |
| **N3** | **`switchOnSymbol`** | `{ kind:'switchOnSymbol'; pool:'lastRoll'; cases: { symbol: DiceSymbolId; effects: EffectDef[] }[] }` | `rollDice{cases}[]` 的语义是「**按符号去重、每个符号至多结算一次**」（A16），即使 3 颗骰都命中同一符号也只结算一次。这不是 `choice`（不是玩家选），也不是 `sequence`（不是全执行）。你的 `rollDice` 没有 cases 字段 |
| **N4** | **`responseWindow`** | `{ kind:'responseWindow'; window: 'thenNode'; steps: EffectDef[] }` | 我的 DSL `then` = **先开窗，窗口关闭后再执行 steps**。你的 `EffectDef.then` 只是"pushFront 紧随其后"，**不开窗**。这是 P4b 的引擎入口，必须有 |
| **N5** | **`bind`** | `{ kind:'bind'; name: string; value: Expr }` | 变量绑定。写入 `EffectQueueState.bindings: Record<string, number>`（纯数据、可序列化）。配合 `Expr` 的 `var` 读。Overpower 的 `rollTotal`、Combustion 的 `burned` 都依赖它 |
| **N6** | **`grantExtraOffensiveRollPhase`** | `{ kind:'grantExtraOffensiveRollPhase' }` | Stun 抢额外回合（C3）。语义特殊：**必须先 flush 当前 Ledger + 死亡判定，再回到 P1 开一个新的 ORP**；若对手已死则不触发。不能复用 `skipPhase` |
| **N7** | **`modifyStackLimit`** | `{ kind:'modifyStackLimit'; statusId: StatusEffectId; delta: number; for: TargetRef }` | Pyromancer `burningSoul` L2 的"FM 上限 +1"。**per-player、持续整局**（官方明确），不是 `StatusModifier` 能表达的（你的 `StatusModifier` 没有 stackLimit 项，也不支持"作用于某个特定 statusId"） |
| **N8** | **`discardCards`** | `{ kind:'discardCards'; amount: number; mode:'random'\|'choice'; from: TargetRef }` | 把现有 `discardRandom` 改名/扩展。`choice` 模式产生 `chooseCards` 挂起点。若你愿意，也可给 `discardRandom` 加一个 `mode` 字段，那就不用新增——**两者都行，你选** |

### 5.2 可在 **DSL 编译期展开、无需新增 kind** 的清单

| DSL 构造 | 编译产物 | 备注 |
|---|---|---|
| `sequence{steps}` | 展平为父级 `then` 数组 | 语义等价（都是顺序执行） |
| `optional{prompt, steps}` | `choice{ player, options:[ {id:'yes', effects:steps}, {id:'no', effects:[], isDefault:true} ] }` | 二值化。**降级说明见 §5.5-E8** |
| `graded(symbol, tiers[], pick:'highest')` | `activation = {kind:'count', symbol, n: 最低档的 min}`<br>+ `effects = [ 嵌套 conditional：if count≥min_top then tier[0].effects else if count≥min_2 then tier[1].effects else tier[last].effects ]` | **回答你的问题：选"条件分支"，不选"展开为 tier 级 ability"。** 理由见 §5.3 |
| `log{text}` | 丢弃（内容保留到 `EffectDef.note`） | 日志由引擎自动产出 `GameEvent`，不需要显式 log kind |
| `min(a,b)` / `max(a,b)` | `clamp{v: a, lo: 0, hi: b}` 等 | 你的 `clamp` 足够表达（Combustion 的 `min(4, FM)` = `clamp(FM, 0, 4)`，因 FM ≥ 0 等价） |
| `handSize(target)` | **删除** | MVP 4 英雄无一处使用；等多人模式再引 |
| `repeat{times, steps}` | `repeat` ✅ 直接对应 | — |
| `transferStatus` | `transferStatus` ✅ | 需补回滚语义（C9） |
| `grantExtraRollAttempt` | `modifyRollAttempts{delta}` ✅ | — |
| `skipPhase{phase, target}` | `skipPhase{phase}` ✅（需扩字段） | — |

### 5.3 `graded` 的答案：**条件分支，不是 tier 级 ability**

你的两个选项我都评估了：

| 方案 | 评估 |
|---|---|
| A. 展开为**条件分支** | ✅ **采纳** |
| B. 展开为 **tier 级 ability**（拆成 3 个 ability，各自 matcher 不同） | ❌ 否决 |

否决 B 的三个理由：
1. **破坏 `abilityId` 稳定性**：升级卡用 `upgrade.targetAbility` 定位能力，拆成 3 个后要么引入 3 个 id（升级卡要指向哪个？），要么引入"虚拟子 id"——都是额外复杂度。
2. **UI 候选列表会炸**：能力候选区会出现"Fireball / Fireball / Fireball"三条，违反 §4.2 的"L1 焦点唯一、防认知过载"。
3. **违反"graded 的 effects 在 tier 内而非 ability 层"**：B 把 tier 提升成了 ability，正是要避免的。

**采纳 A 的关键细节**：展开后的 `conditional` **挂在原 `abilityId` 的 `effects` 上**，因此：
- 升级卡仍能按 `abilityId` 定位并**整体替换**整棵条件树（Fireball L2 把三档的 FM 从 1 改到 2，一次替换全部三档 ✅）。
- `activation`（用于能力可达性自检 + UI 骰型高亮）取**最低档的 min**（Fireball = `count(flame, 3)`）。掷出 3 颗 flame 就点亮，实际伤害由 conditional 决定档位。
- **UI 想显示"当前命中第几档"**：客户端本地算 `countSymbol(flame)` 再比 `tiers[].min` 即可（`tiers` 数据在客户端内容包里），**不需要引擎额外返回 tier**。

### 5.4 需要 **类型 / 字段扩展**（不是新 kind）的清单

| 位置 | 扩展 | 必要性 |
|---|---|---|
| `DamageType` | **从 3 值扩到 4 值**：`'defendable' \| 'undefendable' \| 'collateral' \| 'pure'`<br>（**DT-DES-003 §R2 修订**：本栏原为 5 值含 `self`，已正交化） | **必需**。四分类与 design spec §1.1 **A14（权威定义）** 一致。语义表：<br>`defendable`（= 我的 `attack`）：触发防御掷骰；受 prevent/avoid 影响；可被 Attack Modifier 增强<br>`undefendable`：不触发防御掷骰；不受 prevent/avoid 影响；可被 Attack Modifier 增强<br>`collateral`：不触发防御掷骰（无目标）；**受 avoid 影响、不受 prevent 影响**；不可被增强<br>`pure`：非攻击来源（状态/Upkeep/**反伤**）；不触发防御掷骰；**不受 prevent/avoid 影响**，不可被增强 |
| **新增 `DamageSourceKind`** | `'ability' \| 'status' \| 'ultimate' \| 'recoil'`（默认 `ability`），挂在 `dealDamage` 上与 `DamageType` **正交** | **必需**（DT-DES-003 §R2）。原设计把 `self` 塞进 `DamageType`，等于把「目标是谁 / 谁产生的」混进「防御-增强属性轴」，会让下游每个 `switch (type)` 都长特判。`ultimate` 同理不进 `DamageType`（其不可削减性由 A15 + P2 ULTIMATE GATE 保证，类型轴仍走 `undefendable`）。<br>**「造成的伤害」判定**：`target !== self` **且** `sourceKind !== 'recoil'`。反伤计入（但 `turnDamageDealt[seat]` **按 `turnIndex` 重置**，不会泄漏到防守方自己回合的条件卡判定）。 |
| `MitigationEntry.kind` | `+= 'avoidAll'` | **必需**（N2 配套） |
| **P6/R5 封口公式** | **OVERRIDE 你的 `net = prevent ? 0 : max(0, gross - reduce)`** | **必需**。你的公式会让 `preventAll` 连 `undefendable` 一起清零，与 C7/A15 冲突。改用下式：<br>`grossDef = Σ type='defendable'`<br>`grossCol = Σ type='collateral'`<br>`grossRaw = Σ type ∈ {undefendable, pure, self}`<br>`reduce  = Σ mitigation.kind='reduce'`<br>`if 有 avoidAll 或 preventAll (for this seat): grossDef = 0; grossCol = 0`<br>`netDef = max(0, grossDef - reduce)`<br>`net = netDef + grossCol + grossRaw`<br>`hpAfter = hp - net + Σ heals`<br>`hp = min(maxHealth, hpAfter)`<br>`if hpAfter <= 0 → 判负（封顶不救死亡）` |
| `Expr` | `+= { e:'var'; name }` / `{ e:'diceCountSymbol'; symbol; pool:'final'\|'lastRoll'\|'defense' }` / `{ e:'diceSum'; pool }` | **必需**。你现有的 `{e:'diceCount', matcher}` 语义含糊（`count(symbol,n)` 是布尔还是计数？），建议拆开。Overpower 需要 `diceSum` |
| `TargetRef` | `+= { r:'attacker' }` | **必需**。反伤（`pyro:moltenArmor`、`elf:moonDefense` 打 attacker）没有它就表达不了。另建议预留 `{ r:'allOpponents' }`（1v1 可编译期映射为 `opponent`） |
| **新增 `ConditionExpr` 类型** | `statusPresent / hpCompare / cpCompare / damageDealtAtLeast / diceCountAtLeast / hitSuccess / phaseIs / and / or / not` | **必需**（N1 配套）。IR 里目前完全没有条件类型。`diceSymbolRolled` 我改为更可判定的 `diceCountAtLeast{symbol, n}` |
| `EffectClause.removeStatus` | `+= bindTo?: string` | **必需**。`bindRemovedTo`：handler 必须**返回实际移除数**（受 Stack Limit、实际堆叠数、玩家选择影响），**不能预先计算**（hero-schema 备注 5）。handler 返回 `removed: number` → 写入 `bindings[bindTo]` |
| `EffectClause.rollDice` | `+= pool: 'owner' \| 'generic'` | **必需**。我的 `diceSet: 'hero' \| 'generic'`；`owner` = 效果发起方的英雄骰池 |
| `EffectClause.setDice` | `to: DiceSymbolId\|'any'` → **`toFace: 1..6`** | **必需**。我是按**面索引**设置（面 1 = flame），不是按符号。符号可能对应多个面（Wild），按面索引才精确 |
| `EffectClause.skipPhase` | `+= to: TargetRef` | **必需**（Concussion / Knockdown 作用于持有者） |
| `EffectClause.applyStatus.stacks` | `number` → `Expr \| number` | 建议（Burning Soul 等可能用到） |
| `ChoiceOption` | `+= isDefault?: boolean` | **必需**（§3.3） |
| `StatusEffectDef` | `+= spendable: boolean` / `+= spendEffect?: EffectDef[]` | **必需**。你现有 def 只有 `hooks`，没有"主动消耗"（`elf:evasive` / `ninja:smokeBomb` / `ninja:ninjutsu` 三个 MVP 状态依赖它）。你的 `consumeStatus` kind 只能表达"被别人消耗"，不能定义"持有者可主动消耗" |
| `StatusEffectDef.hooks` | 枚举从 3 个扩到 10 个：`onUpkeep / onIncomePhaseStart / onOffensiveRollPhaseStart / onTurnStart / onTurnEnd / onAttackResolved / onIncomingDamage{timing:'avoid'\|'prevent'\|'modify'} / onStatusInflicted{timing:'before'} / onAbilityActivation{timing:'before'}` | **必需**。MVP 依赖：`onOffensiveRollPhaseStart`（Knockdown、Entangle）、`onIncomePhaseStart`（Concussion）、`onStatusInflicted:before`（Thick Skin II）、`onAbilityActivation:before`（Blind）、`onIncomingDamage:modify`（Targeted） |
| `StatusEffectDef` | `+= order?: 'damage' \| 'decay'`（或直接放在 `onUpkeep` 上） | **必需**（§3.4 Upkeep 两段式） |
| `GameState` | `+= lastRoll: DiceFace[] \| null` / `+= tempDicePool: DiceState \| null` | **必需**。`rollDice` 的临时骰池（A17：判定后销毁），供 `diceSum`/`diceCountSymbol(pool:'lastRoll')` 读取与 C8 的窗口内修改 |
| `EffectQueueState` | `+= bindings: Readonly<Record<string, number>>` | **必需**（N5 配套）。纯数字 map，可序列化 |
| `PendingRequest.kind` | `+= 'chooseDice' \| 'chooseStatus' \| 'chooseCards' \| 'chooseTarget' \| 'optionalPrompt' \| 'knockdownPay'` | **必需**（§3.1 表 #6/#7/#8/#9/#11）。`upkeepOrder` **保留枚举值无害，但 MVP 不产生该 kind 的请求** |

### 5.5 降级与诚实清单（DSL 表达不了的，MVP 砍掉）

| # | 项 | 降级方式 | 何时补 |
|---|---|---|---|
| **E8** | `optional` 的 **"up to N" 的 N 选择**（如"移除至多 4 枚 FM"，理论上应选 0/1/2/3/4） | **二值化**：行使 = 移除 `min(4, 当前堆叠)` 枚；不行使 = 0。避免二级 prompt | MVP 不补。真的要做 = `choice` 嵌套，成本不高但交互很烦 |
| **E9** | 真·打断（Instant 插进效果序列中间） | 按 C12/Q9 **永远不做**。窗口模型已覆盖 95% 用途（E4） | 不做 |
| **E1** | Companion（伙伴） | 未建模 | 4 英雄无 Companion（E1） |
| **E2** | 骰面符号 override（"把对手一颗骰视为 X"） | 未建模；类型位已预留 `overrideSymbols` | Season One 剩余英雄上线前 |

### 5.6 一张对账表：我的 24 个 DSL 效果原语 → IR

| DSL `t` | → IR | 状态 |
|---|---|---|
| `dealDamage` | `dealDamage` + 5 值 DamageType | 改枚举 |
| `heal` | `heal` | ✅ |
| `preventDamage` | `preventDamage` | ✅（语义：只吃 defendable） |
| `avoidDamage` | **`avoidDamage`** | **N2 新增** |
| `gainCP` | `gainCp` | ✅ |
| `loseCP` | `loseCp` | ✅ |
| `draw` | `drawCards` | ✅ |
| `discard` | **`discardCards`** | **N8 新增/扩展** |
| `inflictStatus` | `applyStatus` | 改（`stacks: Expr`、失败语义） |
| `removeStatus` | `removeStatus` + `bindTo` | 扩字段 |
| `transferStatus` | `transferStatus` | 扩（回滚） |
| `increaseStackLimit` | **`modifyStackLimit`** | **N7 新增** |
| `rollDice` | `rollDice` + `pool` | 扩字段 |
| `rollDice.cases` | **`switchOnSymbol`** | **N3 新增** |
| `setDieFace` | `setDice` + `toFace` | 改字段 |
| `rerollDice` | `rerollDice` | ✅ |
| `grantExtraRollAttempt` | `modifyRollAttempts` | ✅ |
| `sequence` | 展平为 `then` | 编译期 |
| `then` | **`responseWindow`** | **N4 新增** |
| `if` | **`conditional`** + `ConditionExpr` | **N1 新增**（最刚需） |
| `choose` | `choice` + `isDefault` | 扩 |
| `optional` | 编译为 `choice` 二值 | 编译期 |
| `repeat` | `repeat` | ✅ |
| `bind` | **`bind`** + `Expr.var` | **N5 新增** |
| `grantExtraOffensiveRollPhase` | **`grantExtraOffensiveRollPhase`** | **N6 新增** |
| `skipPhase` | `skipPhase` + `to` | 扩字段 |
| `log` | 丢弃 | 编译期 |

---

## §6 ⑤ 起始数值一致性确认与文档修正

### 6.1 起始数值 —— **6 项全部 CONFIRM，零修正**

| # | engineering 核实值 | 我的文档 | 裁定 |
|---|---|---|---|
| 1 | 起始 HP **50** | A1（`startHp: 50`） | ✅ 一致 |
| 2 | 起始 CP **2** | A3（`startCp: 2`，上限 15） | ✅ 一致 |
| 3 | 起手 **4 张** | A5 | ✅ 一致 |
| 4 | HP 上限 = 起始 + 10 = **60** | A2（`healCap = 60`，clamp） | ✅ 一致 |
| 5 | 牌库空 → 洗弃牌堆重开 | A6（种子化 Fisher–Yates） | ✅ 一致 |
| 6 | 防守反伤同时致死 → **平局** | A19（`checkVictory()` 返回 `draw`） | ✅ 一致 |

**数值层面我的文档无需改正。** 但你核对时请把这几条也一起钉死（它们不在你的清单里，是我文档里的硬数值）：
- CP 上限 **15**（A3）；手牌上限 **6**（A7）；Roll Attempt **3**（A9）；弃牌阶段每张 **+1 CP**（A7）
- 先手玩家**跳过第一个 Income Phase**（A4）
- Knockdown 赎金 **2 CP**；`pyro:burn` Upkeep **2** 点 undefendable；`ninja:poison` 每枚 **1** 点 pure

### 6.2 本轮发现的、需要修正我自己的文档的地方（6 处）

这 6 处是我在写本对齐文档时发现的**主规格内部矛盾 / 与架构的隐性冲突**，一并修正：

| # | 位置 | 原表述 | 问题 | 修正为 |
|---|---|---|---|---|
| **M1** | §1.1 C1 + §1.2 `perActionTimeoutMs: 15000` + §2.1（DEFENSIVE_ROLL / DISCARD 15s） | 响应窗口 15s | 与 §6 R7「超时收紧到 12s」自相矛盾 | **统一为 12s**（采纳 R7）。主规格 C1 的 15s → 12s |
| **M2** | §2.1 DISCARD 行「15s → 自动卖最右侧 N 张」 | "最右侧" | 依赖客户端手牌排序，**不是引擎可判定的确定性规则**（违反 G5），且与 §4.3「按引擎评分、0 费卡最后弃」冲突 | **改为 §3.2 的确定性排序键 `[kindRank, -costCP, defId]`** |
| **M3** | §1.1 C6「每结算一个状态做一次死亡判定」 | 逐步死亡判定 | 与 C4（simultaneous）/ C5（治疗可救回）矛盾：Upkeep 的治疗救不回 Upkeep 的扣血 | **改为两段式**：damage 段全部写入 Ledger → 一次 flush → 死亡判定；再执行 decay 段（§3.4） |
| **M4** | §1.1 C12 / §0 Q9「Instant 只能在响应窗口内打出」 | 未定义"响应窗口"清单 | 无法翻译成配置 | **明确为具名清单**：`thenNode` / `preDefense` / `postDefense` / `postTrigger`(关) / `mainPhaseEnd`(关)；**不在 P1、不在 P3 执行期间**（§2.3） |
| **M5** | §1.1 C15「单防御能力 → 自动掷骰」vs §2.1「15s → 自动掷骰」 | 一处说自动、一处说有超时 | 是否需要 prompt 不明确 | **MVP 默认不产生 prompt**（C15）；保留 `defensiveRoll` 挂起点形态与开关；开关打开时超时 12s → **ROLL**（§3.1 #2） |
| **M6** | `hero-schema-draft.md` §4.2 `pyro:moltenArmor`、`§5.1 elf:moonDefense` 的反伤 `type: "attack"` | 反伤写成可防御 | 与 §4-5 的裁定（反伤不触发防御掷骰）冲突，且与 A11（防御掷骰一次性）矛盾 | **改为 `type: "pure"` + `sourceKind: "ability"`**（DT-DES-003 §R1 终裁；中间曾一度改为 `collateral`，已作废） |
| **M7** | `hero-schema-draft.md` §4.1 `barb:reckless` 两级的自我反噬 `type: "undefendable"` | `undefendable` 含「可被 Attack Modifier 增强」语义 | 反噬来自进攻能力，会被 Attack Modifier 误加成——这是个潜伏 bug | **改为 `type: "pure"` + `sourceKind: "recoil"`**（DT-DES-003 §R2，正交化的直接收益） |

**另需同步的数据模型修正（§4-4 已提）**：`HeroDef.dice: [Sym×6]` → `HeroDef.dieFaces: DiceFace[]`（每面 `{ value, symbols[] }`），以表达 Wild / 多符号面。

---

## §7 需要主理人 / 用户拍板的 3 项（本轮新增）

| # | 问题 | 影响 | 我的建议 |
|---|---|---|---|
| **Q11** | Instant 卡是否也应在 **P1（能力激活前）** 的窗口可打？ | MVP 无 Instant 卡，**现在零成本**；改 = 一个配置位 | 建议**维持现状（P1 不可打）**。骰子操作是该时机的唯一需求，已被 Roll Phase Action 卡覆盖；Instant 的定位应是"响应对手"。若未来内容需要，开配置位即可 |
| **Q12** | `abilityAnnounce` 超时是否应改为「候选恰好 1 项时自动激活该项」？ | 掉线/挂机时掷出大顺却白掷，是 G4「不重罚」的一个明显缺口 | 建议**维持 PASS**，但**做成开关** `AUTO_ACTIVATE_IF_SINGLE_CANDIDATE = false`。理由：自动激活会消耗 CP、触发自我反噬（Reckless −4）、触发 Stun 抢回合——违反 G1 且是"系统替你打了一张牌"。**但我承认这条争议最大，请用户拍板** |
| **Q13** | 响应窗口实测若拖沓，砍哪一个？ | 节奏（§4.4 预算：ORP+DRP ≤ 25s） | 建议**第一个砍 `preDefense`**（配置位 `enabled:false`）。`postDefense` 是官方"最后一次机会"，不能砍；`thenNode` 是 Combustion 的核心机制，不能砍 |

---

## §6.3 DT-DES-003 追加修订（与 design-strategist-2 对齐后）

| # | 修订 | 影响面 |
|---|---|---|
| **R1** | **反伤 `DamageType`：`collateral` → `pure`** | 推翻本文 §4-5 ② 的原裁定。`pure` ⇒ 不受 prevent/avoid 影响、不可被增强、不触发防御掷骰。由此得到硬不变量：**一次 Roll Phase 内防御掷骰恒 ≤ 1 次**（无反伤递归）。工程侧若已按 `collateral` 实现，需改 `ledger` 分组：反伤条目从 `collateral[]` 移入 `raw[]`。 |
| **R2** | **`DamageType` 5 值 → 4 值**，新增正交 `DamageSourceKind`（`ability\|status\|ultimate\|recoil`） | 推翻本文 §5.4 的 5 值方案（与 A14 四分类对齐）。`self` / `ultimate` 移出类型轴。每处 `dealDamage` 可携带 `sourceKind`；「造成的伤害」判定 = `target !== self && sourceKind !== 'recoil'`，且 `turnDamageDealt[seat]` 按 `turnIndex` 重置。 |
| **R3** | `barb:reckless` 自我反噬 `undefendable` → `pure` + `sourceKind:'recoil'` | 修掉"反噬被 Attack Modifier 误加成"的潜伏 bug。 |
| **R4** | 顺子三条硬规则：**不环绕 / 面值去重 / 大顺蕴含小顺** | 与我的 §3.2 求值算法一致（取面值集合去重排序、找最长连续段 ≥4 / ≥5），无需改动。`HeroDef.wildFaces?` + `wildPolicy?` 扩展位采纳，MVP 4 英雄无 Wild 走 fast path。 |

## §8 给 engineering 的一页接口变更清单（可直接转工单）

**必做（阻塞 A9 / A10 / C7）**

1. `ResolutionStep` 收敛为 8 步：`P1..P8`（§1.1 映射表）。`P1` 是阶段级挂起点 `abilityAnnounce`，不是阶梯步。
2. `finalCardWindow` 改为**可重入窗口栈**（§1.2），新增 `ResponseSpec` 类型（§2.4）与 5 个具名窗口配置。
3. 新增 8 个 `EffectClause` kind：`conditional` / `avoidDamage` / `switchOnSymbol` / `responseWindow` / `bind` / `grantExtraOffensiveRollPhase` / `modifyStackLimit` / `discardCards`（§5.1）。
4. 新增 `ConditionExpr` 类型（§5.4）。
5. `DamageType` 扩到 5 值；`MitigationEntry.kind += 'avoidAll'`；**P6/R5 封口公式按 §5.4 替换**。
6. `autoResolve` 默认值按 §3.1 表逐 kind 落地；`timeoutMs` 分级（20s / 15s / 12s），覆盖架构的 30s 默认。
7. `PendingRequest.kind` 扩 6 个值；`upkeepOrder` **不产生请求**。
8. `StatusEffectDef` 加 `spendable` / `spendEffect` / `hooks` 枚举扩展 / `order`。

**建议（非阻塞）**

9. `TargetRef += attacker`（必需，但可延后到做 Pyromancer 数据时）。
10. `GameState += lastRoll / tempDicePool`；`EffectQueueState += bindings`。
11. 窗口短路（R7）与窗口合并（§1.3）——建议 M1 就做，是节奏的救命优化。
12. `content-lint` 加两条：`choice` 恰好一个 `isDefault`；`conditional` 引用的 condition kind 已注册。

---

---

## §7 架构反向提问裁定（DT-DES-003）

> 任务号：**DT-DES-003**（engineering-lead 在 DT-ARCH-002 落地后反向提问的裁定轮）
> 作者：文策渊（design-strategist-3）　|　对象：engineering-lead
> **本文效力层级（重要，避免三方打架）**：
> 1. `dice-throne-design-spec.md` **§8**（更晚一轮的补遗）> 本文 §7 > 本文 §1–§6 > `hero-schema-draft.md` §1。
> 2. 凡本文 §7 与本文 §1–§6 冲突处，**以 §7 为准**（修正清单见 §7.5）。
> 3. 凡本文与 `dice-throne-design-spec.md` §8 冲突处，**以 §8 为准**——本轮涉及伤害类型的裁定已显式对齐到 §8.4，不再另立门户。
> **IP 规避声明**：本节只出现机制符号 id、类型名、数值与逻辑。零官方卡面文本、零 flavor text。

### 7.0 裁定总表（速查）

| # | engineering 的问项 | 裁定 | 一句话理由 | engineering 要做什么 |
|---|---|---|---|---|
| **①** | `DamageType` 要不要单列 `ultimate`？ | **不要。删除 `ultimate` 伪类型（连带删除 `self` 伪类型）→ `DamageType` 回到 4 类**；来源走 `DamageEntry.sourceKind`（`ability`/`status`/`ultimate`/`recoil`），打向谁走 `target` | "能否被防御 / 能否被增强"是一条语义轴，"来源是谁 / 打向谁"是另一条正交轴；混进同一枚举会让每个 `switch` 都长出例外分支（spec §8.4-e） | `BUCKET_OF` 收敛为 4 行；`DmgEntry` 加 `sourceKind`；`self` 原有的"不置 `hitSuccess`"改由 `sourceKind === 'recoil'` 判定 |
| **②** | `additionally` 是不是独立 Effect kind？ | **是。独立 kind，保留**；语义钉死为「延迟到 **P7** 执行的子队列」，与 `openWindowThen`（P3 内开窗）严格区分 | 它是第四种调度行为；做成"挂在现有 effect 上的延迟标记"会产生 `N 种 kind × 1 个 flag = N 条新语义`要测，而独立 kind 只有 1 个 handler | 保留 kind + handler + describer；新增 **P7 尾部补充 flush**；新增 lint：**`additionally` 内禁止 `damageType:'attack'`**；MVP 内容禁用（告警级） |
| **③** | 要不要 `postFlush` 窗口？ | **要，它是真实存在的窗口**；我原文档叫 `postTrigger`，**采纳架构命名 `postFlush`** | 它与"P7 的自动触发"是两件事：自动触发无输入，窗口是输入点。二者相邻极易混淆 → 我把 P7 拆成 **P7a（自动）/ P7b（窗口）** | 保留 `postFlush` 枚举；`mutableScope` 四项**全 false**；MVP `enabled:false`；P8 入口加"bucket 非空则强制 flush + 告警"断言 |
| **④** | `AbilitySlot.tiers[]` vs 扁平 `(ability, tier)` | **canonical = `AbilitySlotDef` + `AbilityTier[]`；扁平 `AbilityDef` 是编译产物，不是内容规范形式** | slot 拥有的字段（`kind` / `displayName` / `isUltimate` / `defenseDiceCount`）在扁平视图里会被复制 N 份并漂移；slot 让"一个格子 = 一个 `currentLevel`"成为**结构不变量**而非约定 | 按此重构：内容写 slot → 编译器展开 flat → 引擎运行期只消费 flat。**`AbilityId` 永远指向 slot，绝不引入 `fireball#2` 这类复合 id** |

---

### 7.1 ① `DamageType` 不需要 `ultimate` 变体

**裁定：`ultimate` 不是伤害类型。删除它，同时删除 `self` 伪类型。`DamageType` 规范形态 = 4 类。**

```ts
// ✅ 规范形态（与 dice-throne-design-spec.md §8.4-e 一致）
type DamageType = 'attack' | 'undefendable' | 'collateral' | 'pure';

interface DmgEntry {
  amount: number;
  type: DamageType;                                          // 语义轴：能否防御 / 能否被增强
  sourceKind: 'ability' | 'status' | 'ultimate' | 'recoil';   // 正交轴：来源（取代 ultimate 伪类型）
  target: TargetRef;                                          // 正交轴：打向谁（取代 self 伪类型）
  source: string;                                             // abilityId / statusId，日志归因
}
```

#### 7.1.1 逐条驳回"需要 `ultimate` 类型"的六个理由

| 诉求 | 是否需要独立类型 | 实际由什么承载 |
|---|---|---|
| 不可被 `prevent` / `reduce` 削减 | ❌ 不需要 | `type: 'undefendable'` 的完整语义 |
| 不可被 `avoid` 闪避 | ❌ 不需要（**无差异**） | `undefendable` 本就不吃 `avoid` —— C7：avoid 只清 `defendable` + `collateral` |
| 不可被响应（对手不能打牌） | ❌ 不需要 | **P2 ULTIMATE GATE** 的 `actionPermission = 'none'` 令牌（§1.1 P2 / §4-6） |
| 不可被打断 | ❌ 不需要 | C12：真打断（§8.3 控制清单 18 条）永不实现 |
| 日志 / UI 要说"终极伤害" | ❌ 不需要类型 | `sourceKind: 'ultimate'` + `source`（abilityId）—— 归因是**元数据**问题，不是**语义**问题 |
| 免疫 `increaseStackLimit` 类修正 | **不适用** | `increaseStackLimit` 修正的是**状态堆叠上限**，不是伤害；引擎中不存在"修正伤害数值"的同类机制，此问项的前提不成立 |

> **给 engineering 的最短回答**：`ultimate` 与 `self` 都是**伪类型**——它们描述的是"这条伤害从哪来 / 打向谁"，不是"这条伤害怎么结算"。把元数据塞进语义枚举，代价是 `BUCKET_OF` / `avoid` / `prevent` / Attack Modifier / 描述层 **5 个 switch 各长一个例外分支**。拆成正交字段后，这 5 处全部零特判。

#### 7.1.2 顺带钉死一条：**Ultimate 伤害可被 Attack Modifier 增强**

| 项 | 裁定 |
|---|---|
| **结论** | Ultimate 的伤害若标为 `undefendable`，则**可被 Attack Modifier 增强**（与所有 `undefendable` 一致） |
| **依据** | A15 只禁止"削减 / 防止 / 响应 / 打断"，**未禁止增强** |
| **设计理由** | "终极 + 攻击修正"是本作的高光时刻组合，是策略深度与爽点的来源；一刀切免疫会让忍术这类 token 在终局回合变成废牌，制造**死牌**（我自己的设计红线之一） |
| **逃生口** | 若主理人不同意：把该 Ultimate 的 `type` 改标为 `pure`（§8.4-d：pure 不可被增强）。**改一个数据字段，零引擎代码** |

#### 7.1.3 边缘情况（4 条）

| # | 情况 | 裁定 |
|---|---|---|
| **E1** | Ultimate 的**溅射**（`pyro:scorch` 的 2 点 `collateral`） | `type: 'collateral'` + `sourceKind: 'ultimate'`。它**仍可被 `avoid`**（collateral 语义）——这与"Ultimate 不可被响应"**不矛盾**：不可响应说的是"不能打牌介入"，而 `avoid` 是**已在面板上**的状态，不需要行动权 |
| **E2** | Ultimate 触发 `grantExtraOffensiveRollPhase` 后的**第二轮 ORP** | 该轮**不是** Ultimate：`sourceKind: 'ability'`，对手权限已在 P8 恢复。**权限令牌只覆盖产生它的那一轮结算** |
| **E3** | 反伤（现为 `pure` + `sourceKind: 'ability'`）打在正在结算 Ultimate 的玩家身上 | Ultimate 锁**不保护攻击方免受反伤**。A15 只剥夺对手的**行动权**，不免疫伤害。日志必须区分"对手无法响应"与"对手仍会受伤"这两件事 |
| **E4** | `sourceKind: 'ultimate'` 的伤害是否计入条件卡 | **计入**。`damageDealtAtLeast` 与 `onDamageDealt` 都按"是否实际造成/受到伤害"判定，与来源无关 |

---

### 7.2 ② `additionally` 是独立 Effect kind（保留）

**裁定：`additionally` 是独立的 `EffectClause` kind，不是"挂在现有 effect 上的延迟标记"。**

#### 7.2.1 为什么是 kind 而不是 flag —— 四条调度行为必须四种表示

| 构造 | 语义 | 执行时机 | 挂起 |
|---|---|---|---|
| `EffectDef.next` | 链式后续，pushFront | 紧随父效果 | ❌ |
| `sequence` | 顺序组，pushBack | 队尾按序 | ❌ |
| `openWindowThen` | **P3 内开窗**，窗口关闭后跑 `steps` | P3（**伤害尚未 flush**） | ✅ |
| `additionally` | **延迟到 P7**，主效果全部结算完再跑 | **P6 flush + 死亡判定之后** | ❌ |

否决"延迟标记"方案的三条理由：

1. **组合爆炸**：标记 `deferTo:'postThen'` 要乘到每一种 kind 上——`sequence` 被标记是否全体子项延迟？`if` 被标记是延迟整个分支还是延迟求值？`N 种 kind × 1 个 flag = N 条新语义`要写测试。独立 kind 是 **1 个 handler + 1 个 describer**。
2. **IR 快照不可读**：`dsl/compile.ts` 的产物要人工评审（R14）。包装 kind 在 diff 里是一眼可见的缩进层级；flag 是散落在叶子节点上的布尔，评审时必然漏看。
3. **与 D1 同源**：engineering 把 `EffectDef.then` 改名为 `next` 的理由是"同名必然导致内容作者配错"。把"延迟执行"做成隐式 flag 是同一类错误的重演——作者会以为它和 `next` 一样保序。

#### 7.2.2 DSL 写法示例（用真实英雄能力）

**正例 —— `barb:reckless` 的反噬（Season 1 的规范写法，MVP 暂不改数据）**

```
# barb:reckless —— 大顺，15 伤害 + 自我反噬
matcher: largeStraight
effects:
  - dealDamage { amount: 15, type: attack, target: opponent }
  - additionally:                                    # ← 主效果全部结算后（P7）才执行
      - dealDamage { amount: 4, type: undefendable, target: self }
```

IR：

```ts
[
  { clause: { kind:'dealDamage', amount:15, damageType:'attack',
              to:{ r:'opponent' } } },
  { clause: { kind:'additionally', effects: [
      { clause: { kind:'dealDamage', amount:4, damageType:'undefendable',
                  to:{ r:'self' }, sourceKind:'recoil' } } ] } },
]
```

**反例 —— `pyro:hotStreak` 的伤害绝不能放进 `additionally`**

```
# pyro:hotStreak —— 小顺，伤害 = 5 + Fire Mastery 数
matcher: smallStraight
effects:
  - inflictStatus { status: pyro:fireMastery, stacks: 2, target: self }
  - then:            # ← openWindowThen：P3 内开窗，伤害仍在 P5/P6 之前
      - dealDamage { amount: add(5, statusStacks(pyro:fireMastery, self)),
                     type: attack, target: opponent }
```

> 🔴 **硬规则（写进 `content-lint`，违反即构建失败）**：
> **`additionally` 的子树内禁止出现 `damageType: 'attack'` 的伤害。**
> 理由：P7 在 P5 之后，若可防御伤害延迟到 P7，对手将**永远失去对它的防御掷骰** —— 这不是"不可防御伤害"，这是"偷偷剥夺对手一整个阶段"，属 P0 级规则错误。
> 推论：`pyro:hotStreak` / `pyro:ignite` / `pyro:meteorite` / `pyro:combustion` 的伤害**全部必须留在 `openWindowThen`**，本轮与未来都不许迁移。

#### 7.2.3 一条必须补的引擎能力：**P7 尾部补充 flush**

现状缺口：`additionally` 若在 P7 造成伤害，当前架构**没有任何一步会 flush 这个新 bucket**（P6 已经跑过了）→ 伤害悬空或被 P8 静默丢弃。

**裁定：P7 末尾固定追加一次"补充 flush"**

```
P7 = P7a 自动触发（additionally / deferred / onDamageDealt / attackResolved）
   → [若 bucket 非空] P7c 补充 flush（flushBatch += 1）+ 死亡判定
   → P7b postFlush 窗口（MVP 关闭）
   → P8 胜负裁决
```

- 顺序理由：补充 flush 必须**早于** `postFlush` 窗口，否则窗口里读到的 `damageDealtAtLeast` 是过期值（条件卡会误判）。
- `onDamageDealt` 对补充 flush **再触发一次**（新的 `flushBatch`），与架构 §2.4.4「分批分别触发」自洽。
- 死亡判定写 `pendingDefeat`，**仍在 P8 统一裁决**（不在 P7 终局）——与 A19 平局规则一致。

#### 7.2.4 MVP 处置与边缘情况

| 项 | 裁定 |
|---|---|
| **MVP 内容是否使用** | **不使用**。4 英雄零处需求（`barb:reckless` 的反噬目前在 P3 + `if hitSuccess`，见 §7.7-Q14） |
| **lint 级别** | **告警（warn），不阻断**。理由：kind 本身合法，只是 MVP 不需要；阻断会让未来的 Season 1 内容无法入库 |
| **告警文案** | 「检测到 `additionally`。确认它不是 `openWindowThen`？若子树内有 `type:'attack'` 的伤害，这是规则错误（对手将失去防御掷骰）」 |

边缘情况：

1. **`additionally` 嵌套 `additionally`** → 内层并入同一个 `deferredToPostThen` 队列（FIFO），**禁止递归开新的 P7**；lint 断言嵌套深度 ≤ 1。
2. **`additionally` 内的 `optional` / `choice`** → 仍在 P7 产生挂起点，超时按 §8.5 表（15s，累计软上限 30s）。若选择方被剥夺行动权 → 按 §8.5-⑤c-1 **根本不开启挂起点**，直接走 `default`。
3. **P7 补充 flush 与 `grantExtraOffensiveRollPhase` 同帧** → 顺序固定为：**先补充 flush → 再开新 ORP**。C3 的"先 flush 再开新回合"原话不变，只是这个 flush 可能是补充 flush。
4. **施法者在 P6 已死** → P7 的 `additionally` **不再执行**（死亡玩家的能力效果不结算）。这正是 `additionally` 与"写在 P3"最实质的行为差异（见 §7.7-Q14）。

---

### 7.3 ③ `postFlush` 窗口真实存在（采纳架构命名）

**裁定：存在。我原文档的 `postTrigger` 作废，统一采用 `postFlush`。**

#### 7.3.1 改名理由与 P7 的两段拆分

`postTrigger` 会被读成"触发器执行之前 / 之后"，时序有歧义；`postFlush` 精确描述"在 flush 之后"。改名成本 = 我这边一个枚举值，收益 = 消除一类时序误读（与 D1 同源）。

**P7 必须拆成两段，因为它是"自动执行 + 输入点"的混合体——这是二者被混淆的根源：**

| 段 | 名称 | 内容 | 有输入点？ |
|---|---|---|---|
| **P7a** | POST / TRIGGERS | 执行 `additionally` 与延迟后置、`onDamageDealt`（`net>0`）、`attackResolved` | ❌ 纯自动 |
| **P7c** | SUPPLEMENTAL FLUSH | 若 bucket 非空 → flush（`flushBatch += 1`）+ 死亡判定 | ❌ 原子 |
| **P7b** | `postFlush` 窗口 | 条件卡（`damageDealtAtLeast`）与 `spendStatus` 的最后输入点 | ✅ |

> 一句话回答"它与 P7 的 `postTriggers` 是不是同一件事"：**不是同一件事，但同处 P7 步内**。`postTriggers` 是无输入的自动执行；`postFlush` 是这些触发**跑完之后**的输入点。

#### 7.3.2 `mutableScope` —— 四项全 false

| 窗口 | `offenseDice` | `defenseDice` | `tempDicePool` | `ledger` |
|---|---|---|---|---|
| `postFlush` (P7b) | **❌** | **❌** | **❌** | **❌** |

**"此时账本已封口、HP 已改，还能改什么？"—— 直接回答：**

| 还能改 | 不能改 |
|---|---|
| **CP**（打牌付费） | 骰子（进攻骰已锁定、防御骰已结算、临时骰池已按 A17 销毁） |
| **手牌 / 弃牌堆 / 牌库** | **本次结算的账本**（已封口，改写等于篡改已生效的结果） |
| **状态堆叠**（施加、移除、消耗 `spendable`） | **本次结算已写入的 HP**（HP 只在 P6 / P7c 写） |
| **能力等级**（Upgrade 卡） | `stackLimitBonus`（属整局常量，不该在响应窗口变） |

**若窗口内打出的卡造成新伤害** → 进**新一轮 bucket**，由 **P8 入口的兜底 flush** 处理（见下）。

#### 7.3.3 MVP 与兜底断言

| 项 | 裁定 |
|---|---|
| **MVP 是否启用** | **关闭**（`enabled:false`）。4 英雄无 `playCondition` 条件卡、无 Instant 卡，短路规则 R7 会 100% 命中 |
| **P8 兜底 flush（必做）** | P8 入口断言：**若 bucket 非空 → 强制 flush + 死亡判定 + 产 `engineGuardTripped{guardReason:'unflushedBucketAtCleanup'}` + 告警**。**绝不静默丢弃**——静默丢伤害是玩家最不能接受的一类 bug |
| **窗口开启判据** | 沿用 §2.5 的 `shouldOpenWindow`；但因 `mutableScope` 全 false，`hasPlayableWindowCard` 必须**排除任何会写 ledger / 改骰**的卡，否则窗口会为一张"实际上打不出来"的卡而开启 |

边缘情况：

1. **P7c 补充 flush 之后又开了 `postFlush`，玩家在窗口内打出伤害卡** → 该伤害进新 bucket → P8 兜底 flush。**一次结算最多三次 flush**（P6 / P7c / P8-兜底）；超过 → 记 `engineGuardTripped` 并告警。
2. **平局窗口**：P6 flush 使双方同时归零 → `pendingDefeat` 均已记录 → P7 的触发器与 `postFlush` 窗口**仍照常执行**（平局只在 P8 裁决），但任何"若对手已死"的前置检查必须走 `pendingDefeat` 而非 `hp<=0`。
3. **行动方自己能在 `postFlush` 打牌吗** → 能。`eligible: 'bothSeats'`；Ultimate 结算期间对手被剔除，但**行动方自己仍在 `eligibleSeats`**（§4-6 已裁定：窗口照常存在，只是对手被剔除）。

---

### 7.4 ④ canonical = `AbilitySlotDef` + `AbilityTier[]`

**裁定（engineering 要的那句话，原文照抄即可）：**

> **canonical = `AbilitySlotDef` + `AbilityTier[]`。扁平 `AbilityDef`（`(ability, tier)` 视图）是编译产物，不是内容规范形式。内容作者写 slot，编译器展开为 flat，引擎运行期只消费 flat；IR 快照中 slot 为源、flat 为产物，两者都入版本库。**

#### 7.4.1 是否由"matcher 挂在 tier 上"强制？—— 严格回答

**不是逻辑上强制，但工程上必须**。扁平 `(ability, tier)` 表**能**表达全部四条语义（稳定 id / tier 级 matcher / 替换不叠加 / 累计定价），所以理论上它不是必要条件。但它是**正确**的规范形式，三条理由：

1. **消除字段复制漂移**：`kind` / `displayName` / `isUltimate` / `defenseDiceCount` / `category` 是 **slot 级**属性。扁平视图下每个 tier 各存一份 → 三份 `isUltimate` 可以不一致，且 `content-lint` 要额外写一条"三者必须相等"的断言。**用结构消灭 bug，而不是用 lint 追着 bug 跑。**
2. **让不变量成为结构而非约定**："一个面板格子 = 一个 slot = 一个 `currentLevel`、升到 L2 后 L1 的效果序列永久失效"（§1.4-1/2）在 slot 模型里是**数组索引**这一天然事实；在扁平模型里只是一句作者约定。
3. **与运行期寻址解耦**：`ActivationCandidate{abilityId, tier}` 是**运行期**的寻址方式，不是**内容**的组织方式。二者不冲突——编译产物正好就是运行期要的形状。

> 因此：**§1.4-4「升级卡改变激活条件是天然支持的」这条语义不因采用扁平视图而丢失，但采用 slot+tiers 后它从"作者记得住"升级为"编译器保证"。** 这就是选它的全部理由。

#### 7.4.2 `AbilityId` 的寻址规则（必须钉死，否则数据模型会分裂）

```
AbilityId 永远指向 slot，不含 tier。
任何"某个能力的某一级"的引用，一律写成 (abilityId, tier) 二元组。
❌ 禁止引入复合 id（"pyro:fireball#2" / "pyro:fireball:L2"）。
```

| 位置 | 写法 |
|---|---|
| `CardDef.upgrade.targetAbilityId` | `AbilityId`（= slot id） |
| `PlayerState.abilityLevels` 的键 | `AbilityId` |
| `ActivationCandidate` | `{ abilityId, tier }` ✅（已是二元组，无需改） |
| 扁平 `AbilityDef[]` 的查表索引 | `AbilityDef[]` + `AbilityIndex = Record<AbilityId, { byTier: Record<1\|2\|3, AbilityDef> }>` |
| 战斗日志 | `abilityId` + `tier`（分开两个字段，不拼串） |

一旦引入复合 id，`upgrade.targetAbilityId`（要指向 slot）与 `abilityLevels` 的键（要指向 slot）就会与扁平表的键（指向 slot×tier）分裂成三套——**这是本条唯一真正危险的地方**。

#### 7.4.3 编译映射（给 `dsl/compile.ts`）

```
对每个 slot ∈ hero.abilities:
  对每个 tier ∈ slot.tiers:
    emit AbilityDef {
      id:          slot.id,              // ← 不是 slot.id + tier
      tier:        tier.level,
      heroId:      hero.id,
      kind:        slot.category,
      cpCost:      tier.upgradeCostCP,   // 累计总价（见 §7.6-a）
      name:        slot.displayName,
      activation:  tier.matcher,
      effects:     tier.effects 经 §5 的降级规则编译,
      defensiveDice: slot.defenseDiceCount,   // kind==='defensive'
      isUltimate:  slot.isUltimate ?? false,
    }
assert: 每个 slot 的 tiers 必须 level 1..N 连续、无缺级、无重复
```

边缘情况：

1. **只有 1 个 tier 的能力**（`barb:anger` / `pyro:scorch` 等终极）→ `tiers.length === 1`。**不得**为它生成"空 L2/L3"；`content-lint` 第 3 条（"tier 1/2/3 都存在"）**必须改为"tiers 连续且 ≥1"**——否则 4 个终极能力会被误判为内容缺失。
2. **跳级购买** → `cost = tiers[target-1].upgradeCostCP - tiers[current-1].upgradeCostCP`（§1.4-2）。编译期不预计算，运行期按 `abilityLevels` 求值。
3. **升级卡 `costCP` 与 tier 定价不一致** → `content-lint` 新增断言：`upgradeCard.costCP === tiers[targetLevel-1].upgradeCostCP - tiers[0].upgradeCostCP`。4 英雄现有数据已全部通过（见 §7.6-a）。
4. **`defenseDiceCount` 只在 `kind==='defensive'` 有意义** → 编译期对非防御能力**丢弃**该字段（不复制到 flat），避免 UI 误读。

---

### 7.5 本轮对**我自己此前文档**的修正清单（4 处）

| # | 位置 | 原表述 | 修正为 | 触发 |
|---|---|---|---|---|
| **N1** | §1.1 P7 行 / §1.3 `postTrigger` / §2.4 `WINDOW_SPECS.postTrigger` | 窗口 id = `postTrigger` | **改为 `postFlush`**（采纳架构命名）；并把 P7 拆为 P7a / P7c / P7b 三段 | ③ |
| **N2** | §1.1 P7 | "执行 Additionally 段与延迟型后置效果" | 补一句：**`additionally` 是独立 `EffectClause` kind，延迟到 P7；其子树禁止 `damageType:'attack'`；P7 末尾需补充 flush** | ② |
| **N3** | §4-5（反伤类型）与 §6.2-**M6**（"反伤 `attack` → `collateral`"） | 反伤 = `collateral`（不触发防御掷骰，但可被 `avoid`） | **撤回。反伤 = `pure`**（spec §8.4-④：不可防御、不可被 avoid、不可被增强、不计 `hitSuccess`）。M6 的修改指令改为 **`type:"attack"` → `type:"pure"`** | §7.6-b |
| **N4** | §5.4 `DamageType` | "从 3 值扩到 **5 值**：`'attack'\|'undefendable'\|'collateral'\|'pure'\|'self'`" | **撤回。规范形态 = 4 值**（删 `self`），来源走 `sourceKind`、打向谁走 `target`。见 §7.1 | ① / spec §8.4-e |

> 注：§5.4 表格里 `self` 一行的**语义描述本身是对的**（"不计入造成的伤害、不受 prevent/avoid 影响"），只是**承载位置**错了——改为 `type:'pure'` + `target:{r:'self'}` + `sourceKind:'recoil'` 后，三条语义全部自动成立，无需在 flush 里写特判。

---

### 7.6 顺带裁定（不在本次 4 条内，但同属 design 待确认 / 跨文档冲突，一并钉死）

| # | 问项 | 裁定 | 影响 |
|---|---|---|---|
| **a** | 架构附录 B 第 8 条：`AbilityTier.upgradeCostCP` 是"差价"还是"累计总价"？ | **累计总价**（`tiers[1].upgradeCostCP` 恒为 0）。`cost(从 Lc 升到 Lt) = tiers[t-1].upgradeCostCP − tiers[c-1].upgradeCostCP` | ✅ 与架构 T4 断言一致，**附录 B-8 可关闭**。<br>⚠️ **`hero-schema-draft.md` §1.7 的注释"从【上一级】升到本级的差价"是错的**，本轮已改正。4 英雄现有数据全部自洽（`slam L2=2` / `fireball L2=1` / `reckless L2=2` / `thickSkin L2=3` / `hotStreak L2=2`，且各自升级卡 `costCP` 与之相等） |
| **b** | 反伤的 `DamageType`（跨文档冲突） | **`pure`**。依据 `dice-throne-design-spec.md` §8.4-④（三轴正交 + **防御链一步收敛**的终止性证明）。本文 §4-5 / §6.2-M6 的 `collateral` 结论**撤回**（见 §7.5-N3）<br>连带数据：`pyro:moltenArmor`、`elf:moonDefense` 的反伤 `type: "attack"` → **`"pure"`** | 本轮已改 `hero-schema-draft.md` 这两处。<br>⚠️ 两个**连带问号**（按 §8.4-a②③ 也应改 `pure`，但归 §8.7 的改动清单，我不单方面改数据）：`pyro:burn` Upkeep 的 `undefendable`、`barb:reckless` 反噬的 `undefendable` → 应为 `pure` + `sourceKind:'status'/'recoil'` |
| **c** | 响应窗口超时：本文 §6.2-M1 的 **12s** vs spec §8.6 `TIMEOUT_TABLE` 的 **T-F 15s** | **以 spec §8.6 为单一事实来源 → 15s**。撤回本文 §6.2-M1 | 本文 §2.4 `perActionTimeoutMs` / §3.1 表 #3 的 12s 一并改为 15s。<br>**但保留观察项**：playtest 若仍拖沓，**第一个要调的旋钮就是 T-F 15→12**（单常量，不改代码），其次才是砍 `preDefense`（Q13） |

---

### 7.7 本轮新增待拍板项

| # | 问题 | 影响 | 我的建议 |
|---|---|---|---|
| **Q14** | `barb:reckless` 的反噬是否要从「P3 + `if hitSuccess`」改为「`additionally`」？ | 一处数据、一个边缘结果 | **MVP 维持现状**，Season 1 随 `additionally` 一并改。<br>两种写法在"未被完全闪避"的绝大多数情形下结果**完全一致**；真正的差异只出现在两个边缘：<br>① P6 flush 中 Barbarian 因对手反伤而**已死** → `additionally` 写法下反噬**不再结算**（死亡玩家不结算效果）；<br>② P3 写法下反噬与对手反伤**并入同一次 flush**（可被同源治疗救回），`additionally` 写法下是**第二次 flush**。<br>① 是规则正确性的提升，② 是"治疗能否救回反噬"的判断差异——**需要 rules-lawyering pass 确认官方口径**，故不在此轮定稿 |

---

*文档结束（§7 为最新裁定，与 §1–§6 冲突处以 §7 为准；与 `dice-throne-design-spec.md` §8 冲突处以 §8 为准） · 变更需同步 `docs/CHANGELOG-engine.md`*
