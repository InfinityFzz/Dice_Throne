# 骰铸对决（Dice Throne 电子化）— 游戏设计与系统规格

> 任务号：DT-DES-001　|　作者：文策渊（design-strategist）
> 范围：网页端 1v1 线上对战 MVP，4 英雄，数据驱动
> 配套文件：`D:\workbuddy\design\hero-schema-draft.md`（DSL 完整类型定义 + 英雄实例化）

---

## 用户拍板决议（DT-001）

> **本节效力高于文档其余部分。** 凡与本节冲突的旧描述（尤其 §2.1 的超时列、C13、C14、§7 开放问题表），一律以本节为准。

| # | 问题 | 用户决议 | 对设计的影响 |
|---|---|---|---|
| **Q1** | IP 路径 | **自用学习** | 不公开部署、不做公开匹配。数据层「零 flavor text」的隔离继续保留 |
| **Q2/Q3** | 治疗时序 / 能否救回 | **以官方规则为准** | 维持 C4 `HEAL_TIMING = "simultaneous"` 与 C5「治疗可救回」——这两条本就是对官方 errata 冲突所作的裁决，现确认以官方规则文本为准 |
| **Q5** | 断线 / 超时处置 | **回合制，不做实时惩罚** | **取代 C14**：断线不判负，对局状态保留、随时可重连 |
| **Q12** | 操作限时 | **回合制，不加入限时** | **取代 C13 与 §2.1 的「超时处理」列**：取消一切倒计时 |
| **Q6** | MVP 后第一优先级 | **优先加英雄** | 内容管线优先级高于回放 / AI / 天梯 |
| **Q13** | 反伤不可减伤 | **以官方规则为准** | 「非攻击来源的伤害没有伤害类型」⇒ 反伤 `pure` 的裁决即官方规则，维持 |

**取消限时的设计后果**

- §2.1 表中所有「超时处理」列作废，改为「等待玩家操作，无倒计时」
- **C13**（玩家超时不操作）→ 改为「玩家长时间不操作」：系统**不自动结算**；对手可在对方离线且 ≥5 分钟无操作后**手动发起「缺席判负」**，或自己投降退出
- **C14**（断线）→ 改为：不判负、不断局；对局持久化保留，重连后补发完整快照与缺失日志
- 各挂起点的「保守默认」**全部保留**，但语义由「超时默认」变为**异常兜底**（进程重启恢复、缺席判负、投降时才用）
- 新增：**持久化优先级提升**，对局需能落盘并在重启后恢复

## 0. IP 声明与文档约定

### 0.1 IP 声明（必读）

本文档是对**桌上游戏《Dice Throne》（Roxley Games / Dice Throne Inc.）游戏机制**的电子化设计分析。

- **本文档不复制任何官方规则书原文、卡面文本、美术资产或商标。** 所有英雄、卡牌、状态效果均以**机制化、功能性描述**呈现（效果逻辑而非 flavor text），用于验证系统抽象的表达力。
- 游戏规则本身在多数法域不受著作权保护，但**美术、卡面文字、英雄名称、商标**受保护。官方数字版预计 2027 上线。
- **MVP 建议定位**：自用 / 学习 / 原型验证，**不做公开分发**（详见 §6 R1）。
- **若要公开发布**：必须走"重皮主题化"路径——替换全部美术、英雄名、卡名、世界观文本，仅保留机制骨架。本文档的数据层设计（§3）天然支持这一点：数据文件里只有 `flame` / `meteor` 这类**机制符号 id** 和数值，没有一句 flavor text。
- 本文档中出现的能力名（Fireball / Reckless 等）**仅作为内部调试用的 `AbilityId` 占位**，重皮时可整体替换。

### 0.2 数值可信度标注

| 标记 | 含义 |
|---|---|
| ✅ | 已与公开规则源交叉验证，可直接进入实现 |
| 🔶 | 机制结构可信、具体数值需对照实体组件做一次 **rules-lawyering 校准 pass**（见 §7 Q8） |
| 🆕 | 数字版本新增，桌游无对应物 |

### 0.3 术语表（全团队强制一致）

| 术语 | 含义 |
|---|---|
| HP | 生命值，1v1 起始 50，归零判负，治疗上限 `起始HP + 10` |
| CP | Combat Point，战斗点数，起始 2，上限 15 |
| Roll Attempt | 进攻掷骰阶段的单次投掷，上限 3 次 |
| Final Dice Result | 3 次 Roll Attempt（含骰子操作卡）结束后的最终骰面 |
| Phase | 回合八阶段之一 |
| Offensive / Defensive / Passive / Ultimate | 四类能力 |
| Status Effect | 状态效果，token 形式 |
| Stack Limit | 单个状态在某玩家面板上的最大堆叠数 |
| Upgrade Card / Main Phase Action Card / Roll Phase Action Card / Instant Action Card | 四类卡牌 |
| Attack | 对指定对手造成 ≥1 可防御伤害的进攻能力 |
| Attack Modifier | 增强 Attack 伤害或附加效果的状态/卡牌 |
| Undefendable / Collateral / Pure | 三种不可防御伤害类型 |
| Then | 效果序列中的响应窗口节点 |
| Additionally | 主效果全部结算后再执行的追加段落 |
| Bucket | 🆕 数字版的伤害累积器（见 §2.3） |

---

## 1. 规则可移植性分析

### 1.1 三分类总表

#### A类：可直接映射（数字版只需把物理状态换成数据结构）

| # | 规则 | 数字版映射 |
|---|---|---|
| A1 | 1v1 起始 50 HP，归零判负 | `player.hp: number` |
| A2 | 治疗不得超过 `起始HP + 10`（=60） | `healCap = 60`，clamp |
| A3 | CP 起始 2 / 上限 15 / 收入阶段 +1 | 服务端 clamp |
| A4 | 先手玩家跳过第一个 Income Phase | `turnIndex === 0 && isStartPlayer` 时跳过 |
| A5 | 起始手牌 4 张，收入阶段抽 1 | 服务端发牌，客户端只渲染己方 |
| A6 | 牌库空则重洗弃牌堆 | 服务端 shuffle（种子随机） |
| A7 | 弃牌阶段弃到 ≤6，每张换 1 CP | 自动计算 + 玩家选择 |
| A8 | 八阶段严格顺序 | 状态机（§2.1） |
| A9 | 3 次 Roll Attempt，任意锁定/解锁 | 骰子状态机（§2.2） |
| A10 | 一个 Offensive Roll Phase 只能激活 1 个能力 | 服务端校验，客户端 UI 强制单选 |
| A11 | 防御掷骰单次、不可重掷 | `defenseRollGranted = false` 标志 |
| A12 | Upgrade Card 只能主阶段打；可跳级；升级已升级槽位只补差价 | `AbilitySlot.level` + `costDelta` |
| A13 | Stack Limit | `StatusDef.stackLimit` + per-player 覆盖表 |
| A14 | 伤害类型四分类（attack / undefendable / collateral / pure） | `DamageType` 枚举 |
| A15 | Ultimate 不可被削减/防止/响应/打断，仅能在激活前改骰子 | `ultimateLock` 权限令牌 |
| A16 | "On [symbol]" 只结算一次（即使多颗命中） | matcher `>= 1` 语义 |
| A17 | "Roll [#]" 的骰子独立，不能用之前的骰子 | 临时骰池，判定后销毁 |
| A18 | 多人局 Targeting（1v1 跳过） | 扩展点，MVP 直接 skip |
| A19 | 同时归零判平局 | `checkVictory()` 返回 `draw` |
| A20 | "Or" 语句二选一 | `Effect.choose` |

#### B类：需数字化重设计（桌游的物理/社交承载必须转成系统）

| # | 桌游形态 | 数字化重设计 |
|---|---|---|
| B1 | 伤害/减伤/治疗"同时结算"靠玩家口头核对 | **Bucket 累积器** + 统一 flush（§2.3），日志输出明细行 |
| B2 | "最后一次打牌机会"靠口头协商 | **显式响应窗口（Response Window）**：状态机的一个子状态，有明确开启/关闭条件与超时（§1.2） |
| B3 | 一次掷骰满足多个能力，玩家口头宣布 | **候选集合计算 + UI 高亮 + 强制单选**（§1.3） |
| B4 | 升级卡物理覆盖面板 | **槽位替换**：`AbilitySlot.activeTier = 2`，旧 tier 效果永久失效（§1.4） |
| B5 | 状态 token 物理堆叠在面板中央 | 状态槽 UI + ×N 计数 badge + 悬停查看规则 |
| B6 | HP/CP 转盘 | 数字 + 进度条 + 变化动画（客户端纯渲染，权威值在服务端） |
| B7 | 手牌对对手隐藏 | **服务端信息隐藏**：对手只收到 `handCount`，不收到卡面 |
| B8 | 骰子物理投掷 | 服务端 RNG 出结果，客户端播动画（防作弊 + 可复现） |
| B9 | 玩家自觉遵守"终极不可响应" | **权限令牌 `actionPermission`**：服务端在 Ultimate 激活后对对手返回 `DENIED` |
| B10 | 玩家记得"这回合我还能不能再掷" | 骰盘常驻 `Roll Attempt 2/3` 指示 |
| B11 | 洗牌、抽牌 | 种子化 Fisher-Yates，可复现 |
| B12 | 物理意义的"防御能力二选一" | MVP 每英雄仅 1 个防御能力，但**保留多选分支**（`DefensiveAbility[]`），避免以后改引擎 |
| B13 | 骰面符号是图形 | 符号 id + 图标资源 key（`symbolIcons: Record<Sym, AssetKey>`），重皮时只换图不改数据 |

#### C类：需明确裁决的模糊点（附我的建议裁决）

> 这些是引擎最容易出 bug、也最容易引起玩家争议的地方。**每一条都必须硬编码为一条规则常量**，写在 `rules.config.ts` 里，并在规则查询页向玩家公开。

| # | 模糊点 | 建议裁决（需主理人/用户确认） |
|---|---|---|
| C1 | 响应窗口何时关闭？"最后一次机会"的终点在哪？ | **双方交替响应，任一方连续两次 pass 即关闭**。硬上限：单窗口最多 4 次响应动作，之后强制关闭。单人超时 **12s**（原 15s，已按 R7 收紧并与 DT-DES-002 §6.2-M1 统一）视为 pass。 |
| C2 | Stun 与伤害的先后？ | **Stun 先于伤害施加**（与官方 FAQ 一致）：Stun 在效果序列中立即生效，对手从该刻起丧失行动权；已写入 Bucket 的伤害照常结算。 |
| C3 | Stun 触发"额外一次 Offensive Roll Phase"时，当前 Roll Phase 的伤害是否已结算？ | **先完整 flush 当前 Bucket（含死亡判定），再开启新的 Offensive Roll Phase**。若对手已被打死，不再触发额外回合。 |
| C4 | 治疗是"立即生效"还是"与伤害同时净额"？官方存在 errata 冲突 | **默认 `HEAL_TIMING = "simultaneous"`**（与"所有伤害/减伤/治疗在 Roll Phase 结束时同时结算"一致）。提供开关，MVP 不开。⚠️ 需用户拍板（Q2） |
| C5 | 净额结算下，治疗能否把人从死亡线上救回？（HP=5，受伤 10，治疗 8） | **能救回**：`HP_new = HP - netDamage + netHeal`，只有 `HP_new <= 0` 才判负。理由：与"同时结算"语义一致，且对防守方更友好，减少挫败感。⚠️ 需拍板（Q3） |
| C6 | Upkeep 阶段多个状态同时触发的顺序 | **两段式（DT-DES-002 §3.4 修正）**：**段 1（damage）** 全部扣血类效果写入 Bucket → **一次 flush → 一次死亡判定**；**段 2（decay）** 资源衰减类顺序执行，无死亡判定。段内按 `statusId` 字典序。原表述"每结算一个状态做一次死亡判定"与 C4/C5 的同时结算语义冲突（Upkeep 的治疗救不回 Upkeep 的扣血），已作废。 |
| C7 | Evasive / Shadows 类"完全闪避"能否躲掉 undefendable 伤害？ | **不能**。avoid 只作用于 `defendable` 与 `collateral`；`undefendable` / `pure` / Ultimate 不受影响。攻击仍标记为"命中成功"，后置效果（Then / Additionally）照常触发。 |
| C8 | "Roll N" 产生的骰子能否被后续的骰子操作卡修改？ | **只能在其自身的 On[symbol] 判定窗口内被修改**（Roll Phase Action Card 可进入该窗口），判定完成即销毁骰池。 |
| C9 | 状态**转移**（transfer）超出目标 Stack Limit 怎么办？ | **先移除后施加；超额部分留在原持有者身上，不销毁。**（避免 token 凭空消失） |
| C10 | "移除任意 N 个状态"的选择权归谁？ | **归效果的发起方**（施加者选择）；若效果属于自己（如自救），则由自己选择。 |
| C11 | 施加已满 Stack Limit 的状态 | **施加失败**，不消耗任何代价、不触发任何后置效果，但**计入日志**（便于玩家理解为什么没生效）。 |
| C12 | Instant Action Card 能否打断任意效果？ | **MVP 不支持真打断**。Instant 卡只能在**具名响应窗口**内打出，窗口清单（DT-DES-002 §2.3 标死）：`thenNode` ✅ / `preDefense` ✅ / `postDefense` ✅ / `postTrigger` ✅（MVP 关闭）/ `mainPhaseEnd` ✅（MVP 关闭）；**P1 激活前** ❌、**P3 效果序列执行期间** ❌（这就是"不真打断"）。理由：真打断需要效果序列的可中断点模型，是引擎复杂度炸弹；桌游里 Instant 的绝大多数用途都能被"响应窗口"覆盖。⚠️ 需拍板（Q9 / Q11） |
| C13 | 玩家超时不操作 | **保守默认**（见 §2.1 表）：不锁定任何骰 / 直接确认当前结果 / 弃牌阶段自动卖牌到 6 张。 |
| C14 | 断线 | 60s 重连窗口，浮层倒计时；重连后补发完整 state snapshot + 缺失日志；超时判负（休闲）或暂停计时（排位）。⚠️ 需拍板（Q5） |
| C15 | 只有一个防御能力时，是否仍需玩家"确认"才掷防御骰？ | **自动掷骰 + 0.8s 动画**，不打断节奏；但**保留"是否使用某 spendable 状态"的响应窗口**（如 Evasive）。 |
| C16 | 攻击方主动放弃激活任何能力（Final Dice Result 无满足项或自愿放弃） | 允许 **PASS**；不进入防御掷骰，直接进入 Main Phase 2。 |

### 1.2 深挖一：判定窗口硬化（"最后一次打牌机会"）

桌游里这句话靠玩家口头协商，数字版必须变成硬规则。

**模型：响应窗口 = 一个带栈的子状态。**

```
ResponseWindow {
  id: string
  trigger: "then" | "preDefense" | "postDefense" | "preFlush" | "rollPool"
  eligiblePlayers: PlayerId[]        // 受 actionPermission 约束（Stun/Ultimate 会被剔除）
  allowedActions: ("rollPhaseCard" | "instantCard" | "spendStatus")[]
  // 轮转规则
  order: "nonActiveFirst"            // 非行动方先响应
  passStreakToClose: 2               // 任一玩家连续 2 次 pass 即关闭
  maxActions: 4                      // 硬上限（防刷）
  perActionTimeoutMs: 12000          // 单人单次决策超时 → 自动 pass（R7 收紧，DT-DES-002 §6.2-M1）
  onTimeout: "autoPass"
}
```

**关键裁决**：`passStreakToClose = 2` 而不是 1。因为"非行动方先"，若非行动方 pass、行动方也 pass，说明双方都不再介入——两次连续 pass 足以表达。若只有 1 次，行动方可能来不及对自己刚看到的响应做反制。

**Ultimate 例外**：Ultimate 激活后，对手的 `actionPermission = NONE`，`eligiblePlayers = [activePlayer]`，窗口仍然存在（行动方自己可能要花 CP 增强），但对手的所有动作返回 `DENIED` 并在 UI 上灰化 + 提示"终极能力无法响应"。

### 1.3 深挖二：骰型冲突（一次掷骰满足多个能力）

Final Dice Result 可能同时满足多个能力的 Activation Requirement，**玩家只能选一个**。

**UI 呈现（服务端给候选集合，客户端只渲染）**：

```ts
interface ActivationCandidates {
  dice: FinalDiceResult;
  candidates: {
    abilityId: AbilityId;
    slotLevel: 1 | 2 | 3;
    matchedBy: MatcherTrace;     // 用于 UI 上高亮"是哪几颗骰满足了它"
    preview: EffectPreview;      // 预期伤害区间 / 状态效果摘要
    isUltimate: boolean;
    ev: number;                  // 🆕 可选：期望价值（新手引导用）
  }[];
  mustChooseOne: boolean;        // true
}
```

- **服务端**计算 `candidates`，**客户端**渲染为扇形候选条，按 `isUltimate > 伤害 EV > 顺序` 排序。
- 玩家点击某个候选 → `CHOOSE_ABILITY` 指令 → 服务端校验 `abilityId ∈ candidates` 后才执行。
- **同时高亮骰子**：选中候选时，骰盘上满足 matcher 的那几颗骰描边发光（`MatcherTrace.matchedDiceIndices`）。这是新手理解"为什么能激活"的关键。
- **不强制要求玩家在掷骰前声明目标**：随时可切换选择，直到点「确认激活」。

**MatcherTrace** 是 DSL 求值器的副产品——每个 matcher 求值时记录 `matchedDiceIndices`，几乎零成本，但 UX 收益极大。这是"数据结构顺手带出 UX"的典型例子。

### 1.4 深挖三：升级卡覆盖面板的替换语义

桌游是物理卡片盖住面板格子。数字版的语义：

```
AbilitySlot {
  id: "pyro:fireball"
  category: "offensive"
  tiers: [Tier1, Tier2, Tier3]     // 每级自带 upgradeCostCP（从上一级升到本级的差价）
  currentLevel: 1                  // 运行时状态
}
```

**裁决**：
1. **替换而非叠加**。升到 L2 后，L1 的效果序列**永久失效**，只有 `tiers[currentLevel-1].effects` 生效。绝不做"L1+L2 合并"。
2. **已升级槽位再升级只补差价**。`cost = tiers[target-1].upgradeCostCP - tiers[current-1].upgradeCostCP`。L1→L3 直接付 `tiers[2].upgradeCostCP`（跳级，等于全价）。
3. **升级只发生在 Main Phase**，因此不可能出现"伤害已写入 Bucket 后能力被换掉"的竞态。这也是把伤害写入 Bucket 而非直接改 HP 的又一好处。
4. **升级卡的 matcher 可能变化**（例：Overpower L2 把阈值从 14 降到 10）。matcher 属于 tier，不属于 slot，天然支持。
5. **升级卡打出后不可再卖**（不是手牌），从 hand 移到 `board.upgrades`。
6. **UI**：面板格子上叠加升级卡缩略图 + 角标 `II` / `III`，hover 显示完整效果文本对比（灰显旧版）。

### 1.5 深挖四：状态效果的堆叠 / 转移 / 移除 / 消耗优先级

**统一优先级链（同一时点多个状态/效果竞速时，自上而下）**：

| 优先级 | 类别 | 例子 | 作用时点 |
|---|---|---|---|
| P0 | 终极锁 | Ultimate | 激活瞬间，剥夺对手一切行动权 |
| P1 | 施加阻止 | Thick Skin II（阻止重复负面状态） | 状态**写入前** |
| P2 | 攻击失败 | Blind（使进攻能力失效） | 能力**激活时**，早于伤害计算 |
| P3 | 完全闪避 | Evasive / Shadows | 伤害**计算前**，作用于 defendable + collateral |
| P4 | 伤害修正 | Attack Modifier（增加伤害） | 伤害**写入 Bucket 时** |
| P5 | 减伤 | `preventDamage N` | **flush 时**，只减 defendable |
| P6 | 治疗 | heal | **flush 时**，与伤害净额 |
| P7 | 后置触发 | Then / Additionally / onDamageDealt | **flush 后** |
| P8 | 维持结算 | Poison / Burn / Fire Mastery 冷却 | Upkeep 阶段（P8a 扣血 → P8b 资源衰减） |

**状态操作四条原子规则**：

1. **施加（inflict）**：
   ```
   effectiveLimit = baseStackLimit + player.stackLimitBonus[statusId]
   if current >= effectiveLimit → 施加失败（记日志，不消耗代价，不触发后置）
   else current += n，clamp 到 effectiveLimit
   ```
2. **移除（remove）**：指定 statusId 优先于 "any"；`any` 的选择权归发起方（C10）。移除不做死亡判定（移除不是伤害）。
3. **转移（transfer）**：`remove(from, 1)` → 若成功则 `inflict(to, 1)`；若 `to` 已满 → **回滚**，token 留在 `from`（C9）。
4. **消耗（spend）**：立即生效、**不可打断**（官方：spent status 的效果不能被 Instant 打断）。消耗可以在**任意阶段、任意玩家的回合**发起——这是少数需要在所有状态机节点都开放的动作，务必在 UX 上给它一个常驻入口（状态槽上的"消耗"按钮）。

**Stack Limit 提升**：`increaseStackLimit` 只作用于**单个玩家**，持续整局（官方明确）。因此 `player.stackLimitBonus` 是 per-player 运行时状态，不是全局常量。

---

## 2. 核心循环与状态机设计

### 2.1 回合级状态机（Turn Phase Machine）

八个阶段严格顺序，不可跳过（除 1v1 的 Targeting）。

| 状态 | 进入动作（服务端） | 允许的动作（玩家） | 转移条件 | 超时处理 |
|---|---|---|---|---|
| `UPKEEP` | 按 P8 顺序结算 Upkeep 钩子（扣血类 → 资源衰减类），每步死亡判定 | 消耗 spendable 状态、打 Instant（响应窗口内） | 钩子队列空 | 无需玩家输入，自动过 |
| `INCOME` | 若非（先手 && 首回合）：CP+1、抽 1 张 | 无（纯自动） | 立即 | 自动 |
| `MAIN_1` | 计算可打出的 upgrade / mainPhase 卡 | 打 Upgrade、打 Main Phase Action、卖牌（弃 1 换 1 CP） | 玩家点「结束阶段」 | 60s → 自动结束 |
| `OFFENSIVE_ROLL` | 初始化骰池，`rollAttemptsLeft = 3` | 掷骰、锁定/解锁、打 Roll Phase Action、消耗状态 | 见 §2.2 子状态机 | 每步 20s → 见保守默认 |
| `TARGETING` | **1v1：立即 skip** | — | 立即 | — |
| `DEFENSIVE_ROLL` | 若 Bucket 中存在 defendable Attack 伤害 → 进入；否则 skip | 防守方：选择防御能力（若多个）、消耗 spendable 状态；双方：打 Roll Phase Action | 防御骰结算完毕 | **MVP 默认不产生 prompt，自动掷骰**（C15）；开关打开时 12s → **自动掷骰**（不是"不掷"——防御掷骰是弱占优动作，DT-DES-002 §3.1 #2） |
| `MAIN_2` | 同 `MAIN_1` | 同 `MAIN_1` | 玩家点「结束回合」 | 60s → 自动结束 |
| `DISCARD` | 计算 `overflow = max(0, handCount - 6)` | 选择要卖的牌 | `handCount <= 6` | 15s → **确定性自动弃牌**，排序键（升序 = 先弃）`[kindRank, -costCP, defId]`，`kindRank`：mainPhase 行动卡 0 / rollPhase 行动卡 1 / instant 2 / **upgrade 3（最后弃）**。原"最右侧 N 张"依赖客户端排序、不可判定且自相矛盾，已作废（DT-DES-002 §3.2 / §6.2-M2） |
| → 切换 ActivePlayer，`turnIndex++` | | | | |

**跨阶段常驻动作**（任何状态都允许）：消耗 spendable 状态、查看规则、查看日志、投降。

**关键约束**：`MAIN_1` 之后必须走 `OFFENSIVE_ROLL`，即使玩家什么都不想做——不允许"跳过整个掷骰阶段"（那是 C16 的 PASS，发生在 OFFENSIVE_ROLL 内部）。

### 2.2 掷骰子状态机（Offensive Roll Sub-Machine）

```
                    ┌──────────────────────────────────────┐
                    │  IDLE（未掷 / 已掷待决策）            │
                    └──┬───────────────┬───────────────────┘
           [ROLL]      │               │   [CONFIRM_ABILITY]
                       ▼               ▼
              ┌────────────────┐  ┌──────────────────┐
              │ ROLLING        │  │ ABILITY_CHOSEN   │
              │ (动画 ~600ms)  │  │ → 进入 P3~P8 结算 │
              └───────┬────────┘  └──────────────────┘
                      │ 服务端出结果
                      ▼
              ┌────────────────┐
              │ AWAIT_DECISION │  rollAttemptsLeft--
              │ 锁定/解锁/打牌  │  计算 candidates
              └───────┬────────┘
         rollAttemptsLeft == 0 ?
                      │ yes
                      ▼
              ┌────────────────┐
              │ FINAL_LOCKED   │  只能从 candidates 中选 1 个 或 PASS
              └────────────────┘
```

| 元素 | 规则 |
|---|---|
| `rollAttemptsLeft` | 初始 3，每次 `ROLL` −1；为 0 时不能再掷（但**仍可打骰子操作卡**——骰子操作卡不消耗 Roll Attempt） |
| 锁定/解锁 | 任意时刻可切换任意骰子的 locked；`ROLL` 只重掷未锁定的骰 |
| 全锁 | 允许（等价于提前结束掷骰）；UI 提示"全部锁定 = 确定结果" |
| Roll Phase Action Card 介入时机 | ① 每次 `ROLL` 之前的 `AWAIT_DECISION`；② `FINAL_LOCKED` 之后、**确认激活之前**；③ 能力效果序列中的 `Then` 节点；④ 防御掷骰前后 |
| 骰子操作卡（改面/重掷） | 修改的是当前骰池，**不消耗 Roll Attempt**；但改完后如果 `rollAttemptsLeft > 0` 仍可正常掷 |
| 防御掷骰 | **独立的一次性掷骰**：`defenseRollGranted` 单次布尔；掷 N 颗（N 由防御能力决定）；**不可重掷**（UI 上隐藏「重掷」按钮）；但**可以被 Roll Phase Action Card 修改结果**（官方允许） |
| 超时 | `AWAIT_DECISION` 20s → 保守默认：**保持当前骰面，进入 FINAL_LOCKED**；`FINAL_LOCKED` 15s → **自动 PASS**（不激活任何能力） |

> ⚠️ 保守默认刻意选"不掷了"而不是"自动再掷一次"——自动再掷会改变玩家的期望收益，属于服务端替玩家做了不可逆的随机决策，争议最大。

### 2.3 结算管线（Resolution Pipeline）—— 引擎最容易出错的地方

> **核心原则**：整个 Roll Phase（ORP + Targeting + DRP）内，任何伤害/治疗/减伤都**不直接改 HP**，而是写进一个累积器 **Bucket**；在防御掷骰结束、所有响应窗口关闭后，**一次性 flush**。
> 这条原则把"同时结算"从口头约定变成了不变量。

#### 管线分层

```
P1  ACTIVATE          确定 Final Dice Result → 服务端算 candidates → 玩家单选/PASS
                      PASS → 跳到 P8（不进 DRP）
                      ↓
P2  ULTIMATE GATE     若是 Ultimate：对手 actionPermission := NONE（直到 P8 结束）
                      若 Blind 生效：能力激活失败 → 跳到 P8
                      ↓
P3  EFFECT WALK       按 ability.effects 顺序执行：
                        ├ 非伤害 effect（获得/移除 token、CP、抽牌、改骰、Stack Limit）→ 立即生效
                        ├ 伤害/治疗/减伤 effect → 写入 Bucket（不改 HP）
                        ├ Stun → 立即施加（C2：早于伤害）
                        └ "Then" 节点 → 打开 RESPONSE WINDOW（P4），窗口关闭后继续
                      ↓
P4  RESPONSE WINDOW   非行动方先，交替；连续 2 次 pass 关闭；硬上限 4 动作；15s/次超时
                      可打：Roll Phase Action Card、Instant（MVP 内同窗口）、消耗 spendable 状态
                      ↓
P5  DEFENSIVE ROLL    若 Bucket 中存在 defendable Attack 伤害：
                        防守方选防御能力（若多个）→ 单次掷骰 → 结果写入 Bucket
                        （防御产生的反伤/治疗/减伤同样写 Bucket）
                      → 再开一次 RESPONSE WINDOW（P4）
                      若无 defendable 伤害（undefendable / collateral / pure / Ultimate）→ skip
                      ↓
P6  SIMULTANEOUS      flush Bucket（见下方公式）→ 改 HP → 死亡判定
                      ↓
P7  POST / THEN       执行 "Additionally" 段落与延迟型后置效果
                      触发 onDamageDealt / onAttackResolved 钩子
                      （例：Stun 已生效 → 攻击者获得额外一次 Offensive Roll Phase → 回到 P1，C3）
                      条件卡（如"若本回合造成 ≥8 伤害"）在此窗口可打
                      ↓
P8  CLEANUP           胜负检查（含平局）、写结构化战斗日志、清理临时骰池、
                      恢复 actionPermission、推进阶段机
```

#### P6 flush 公式

```ts
// Bucket 结构
interface DamageBucket {
  defendable:    DmgEntry[];   // type: "attack"
  undefendable:  DmgEntry[];   // type: "undefendable" | "pure" | "ultimate"
  collateral:    DmgEntry[];   // type: "collateral"（无目标，不算 Attack）
  healing:       HealEntry[];
  prevention:    PreventEntry[];
  avoidFlags:    AvoidEntry[]; // Evasive / Shadows 等
}

// flush
let incomingDefendable = sum(defendable);
let incomingRaw        = sum(undefendable);
let incomingCollateral = sum(collateral);
let prevention         = sum(prevention);
let healing            = sum(healing);

if (avoidFlags.length > 0) {          // C7：只吃 defendable + collateral
  incomingDefendable  = 0;
  incomingCollateral  = 0;
  // 攻击仍标记 hitSuccess = true → 后置效果照常触发
}

const netDefendable = Math.max(0, incomingDefendable - prevention);
//    ↑ 减伤只吃可防御部分；且不会溢出的部分不会转成治疗

const netDamage = netDefendable + incomingRaw + incomingCollateral;   // 不可防御部分不受减伤影响

const hpAfter = player.hp - netDamage + healing;                      // C5：净额，治疗可救回
player.hp = Math.min(player.startHp + 10, hpAfter);                   // A2：治疗上限封顶

if (hpAfter <= 0) → 判负（封顶不救死亡）
```

**三个必须写进单元测试的边界**：
1. `avoid` + `undefendable` 同时存在 → undefendable 照常生效（C7）
2. `healing` 让 `hpAfter > 0` 但 `player.hp - netDamage <= 0` → **活**（C5）
3. `healing` 把 HP 推过 60 → clamp 到 60，**不报错**（A2）

#### 为什么 Bucket 是对的

- 官方"所有伤害/减伤/治疗在 Roll Phase 结束时同时结算"——Bucket 就是这个句子的直接编码。
- 升级卡不会和伤害竞态（升级只在 Main Phase）。
- 治疗能否救回变成一个可配置的单行公式（C5），改裁决不改引擎。
- 日志可以输出完整明细行（`15 attack + 3 undefendable − 4 prevented − 2 healed = 12`），新手能看懂自己为什么掉这么多血。

---

## 3. 能力 / 卡牌 / 状态效果的抽象模型（DSL）

> 完整 TypeScript 类型定义 + 4 英雄实例化见 **`D:\workbuddy\design\hero-schema-draft.md`**。
> 本节给出设计原则、骰型匹配器、效果原语与表达边界。**engineering-lead 直接消费这一节做数据模型。**

### 3.1 设计原则

| 原则 | 说明 |
|---|---|
| **数据即内容** | 新增英雄 = 新增一个 `HeroDef` JSON，**零引擎代码改动**。这是硬性验收标准。 |
| **声明式，不含控制流代码** | 效果是有序的 effect 列表，不是回调函数。服务端解释执行 → 可序列化、可复现、可回放、可被工具校验。 |
| **纯函数求值** | effect 序列的执行 = `(GameState, Effect[]) → (GameState', PendingPrompt[], LogEvent[])`。无副作用，便于快照与测试。 |
| **信息隐藏内建** | 每个 effect 求值后产出 **per-player 视图**（`redact(state, playerId)`），服务端只下发该玩家可见部分。 |
| **matcher 可求值可追溯** | matcher 求值返回 `{ matched: boolean, matchedDiceIndices: number[] }`，直接驱动 UI 高亮（§1.3）。 |
| **UUID 化 id** | `AbilityId` / `StatusId` / `CardId` 用 `hero:xxx` 命名空间，重皮时整体替换不撞车。 |

### 3.2 骰型匹配器（Dice Matcher）

```ts
type Sym = string;   // 英雄作用域内的机制符号 id，如 "flame" | "meteor" | "strength"

type DiceMatcher =
  | { kind: "countSymbol";  symbol: Sym;      count: number }   // N 个同类符号
  | { kind: "countFace";    face: FaceIndex;  count: number }   // N 个同点数（2/3/4/5-of-a-kind）
  | { kind: "atLeast";      of: DiceMatcher }                   // 向上兼容：3+ → 3/4/5 都算
  | { kind: "smallStraight" }                                   // 4 连号
  | { kind: "largeStraight" }                                   // 5 连号
  | { kind: "graded";       symbol: Sym;                        // 分档：3个→X / 4个→Y / 5个→Z
                            tiers: { min: number; effects: Effect[] }[];
                            pick: "highest" }                   // 取满足的最高档（Fireball 专用）
  | { kind: "allOf";        of: DiceMatcher[] }                 // 组合（Combustion：四种符号各一）
  | { kind: "anyOf";        of: DiceMatcher[] }
  | { kind: "not";          of: DiceMatcher }
  | { kind: "const";        value: boolean };                   // 恒真（被动/防御/部分卡牌）
```

**求值**：
```ts
interface DiceView { faces: FaceIndex[]; symbols: Sym[]; locked: boolean[] }
interface MatchResult { matched: boolean; matchedDiceIndices: number[]; tier?: number }

function evaluate(m: DiceMatcher, d: DiceView): MatchResult
```
- `countSymbol`：统计 `symbols` 中等于 `symbol` 的个数 ≥ `count`，返回所有匹配骰的下标（用于 UI 高亮）。
- `countFace`：同上，但按**点数**而非符号（"3-of-a-kind" 官方定义为同点数，不是同符号）。
- `smallStraight` / `largeStraight`：取面值集合去重排序，找最长连续段长度 ≥ 4 / ≥ 5，返回该段骰下标。
- `graded`：按 `min` 降序找第一个满足的档，返回该档 `tier` 索引；效果序列取 `tiers[tier].effects`。
- `allOf`：子 matcher 的 `matchedDiceIndices` **取并集**，任一子不满足则整体不满足。

**能力槽与匹配器的关系**：matcher 挂在 **tier** 上而不是 slot 上（`AbilityTier.matcher`），因此升级卡改变激活条件是天然支持的（§1.4-4）。

### 3.3 效果原语（Effect Primitives）

```ts
type Effect =
  // ── 伤害 / 治疗 ──────────────────────────────
  | { t: "dealDamage";     amount: NumExpr; type: DamageType;  target: TargetRef }
  | { t: "heal";           amount: NumExpr;                    target: TargetRef }
  | { t: "preventDamage";  amount: NumExpr;                    target: TargetRef }
  | { t: "avoidDamage";                                        target: TargetRef }

  // ── 资源 ────────────────────────────────────
  | { t: "gainCP"; amount: NumExpr; target: TargetRef }
  | { t: "loseCP"; amount: NumExpr; target: TargetRef }
  | { t: "draw";   amount: NumExpr; target: TargetRef }
  | { t: "discard"; amount: NumExpr; mode: "random" | "choice"; target: TargetRef }

  // ── 状态 ────────────────────────────────────
  | { t: "inflictStatus";  status: StatusId; stacks: NumExpr; target: TargetRef }
  | { t: "removeStatus";   status: StatusId | "any"; stacks: NumExpr; target: TargetRef;
                           bindRemovedTo?: string }                    // Combustion 需要
  | { t: "transferStatus"; status: StatusId; from: TargetRef; to: TargetRef }
  | { t: "increaseStackLimit"; status: StatusId; by: number; target: TargetRef }

  // ── 骰子 ────────────────────────────────────
  | { t: "rollDice"; count: NumExpr; diceSet: "hero" | "generic";
                     cases: { on: Sym; effects: Effect[] }[] }         // "Roll N: On [sym]..."
  | { t: "setDieFace"; face: FaceIndex; scope: "chosen" | "random"; owner: TargetRef; count: NumExpr }
  | { t: "rerollDice"; count: NumExpr; scope: "chosen" | "random"; owner: TargetRef }
  | { t: "grantExtraRollAttempt"; amount: number }

  // ── 流程控制 ────────────────────────────────
  | { t: "sequence";  steps: Effect[] }            // 顺序（默认语义，显式化便于工具）
  | { t: "then";      steps: Effect[] }            // 🆕 打开响应窗口再执行（P4）
  | { t: "if";        cond: Condition; then: Effect[]; else?: Effect[] }
  | { t: "choose";    options: { label: string; effects: Effect[] }[]; who: "owner" | "target" }
  | { t: "optional";  steps: Effect[]; prompt: string }   // "up to N"
  | { t: "repeat";    times: NumExpr; steps: Effect[] }
  | { t: "bind";      name: string; value: NumExpr }      // 绑定临时变量
  | { t: "grantExtraOffensiveRollPhase" }                 // Stun 后续（C3）
  | { t: "skipPhase"; phase: PhaseId; target: TargetRef } // Concussion / Knockdown
  | { t: "log";       text: string };
```

**数值表达式**（伤害量经常依赖运行时状态，这是 DSL 必须有的能力）：
```ts
type NumExpr =
  | number
  | { v: "statusStacks";     status: StatusId; target: TargetRef }   // "每枚 Fire Mastery +2"
  | { v: "countSymbol";      symbol: Sym;      dice: "final" | "lastRoll" }
  | { v: "sumFaces";         dice: "lastRoll" }                       // "Roll 3: 伤害 = 总点数"
  | { v: "cp";  target: TargetRef }
  | { v: "hp";  target: TargetRef }
  | { v: "var"; name: string }                                        // 配合 bind / bindRemovedTo
  | { v: "add" | "sub" | "mul"; a: NumExpr; b: NumExpr };
```

**条件表达式**：
```ts
type Condition =
  | { c: "statusPresent";  target: TargetRef; status: StatusId; minStacks?: NumExpr }
  | { c: "hpCompare";      target: TargetRef; op: CmpOp; value: NumExpr }
  | { c: "cpCompare";      target: TargetRef; op: CmpOp; value: NumExpr }
  | { c: "damageDealtAtLeast"; value: NumExpr }        // "若本回合成功造成 ≥8 伤害"
  | { c: "diceSymbolRolled"; symbol: Sym; min: number }
  | { c: "diceSumAtLeast"; value: NumExpr }            // 最近一次 rollDice 点数和（Overpower 阈值）
  | { c: "hitSuccess" }                                // 攻击命中（即使被 avoid）
  | { c: "and" | "or"; of: Condition[] } | { c: "not"; of: Condition };
```

### 3.4 状态效果 / 卡牌 / 英雄定义

```ts
interface StatusDef {
  id: StatusId;                       // "pyro:burn"
  polarity: "positive" | "negative";
  stackLimit: number;                 // 基础 Stack Limit
  persistent: boolean;
  spendable: boolean;
  spendEffect?: Effect[];             // 主动消耗的效果
  upkeep?: Effect[];                  // Upkeep 阶段触发（Poison 扣血 / FM 冷却）
  hooks?: StatusHook[];               // 被动钩子（见下）
}
type StatusHook =
  | { on: "offensiveRollPhaseStart"; effect: Effect }   // Knockdown：付 2CP 否则跳过
  | { on: "incomePhaseStart";        effect: Effect }   // Concussion：跳过抽牌与 CP
  | { on: "incomingDamage"; timing: "avoid" | "prevent" | "modify"; effect: Effect; auto?: boolean }
  | { on: "statusInflicted"; status: StatusId; timing: "before"; effect: Effect }  // Thick Skin II
  | { on: "turnStart" | "turnEnd" | "attackResolved"; effect: Effect };

interface CardDef {
  id: CardId;
  kind: "upgrade" | "action";
  actionTiming?: "instant" | "mainPhase" | "rollPhase";
  upgrade?: { targetAbility: AbilityId; targetLevel: 2 | 3 };
  costCP: number;
  playCondition?: Condition;          // 条件卡（"伤害结算后若造成 ≥8"）
  effects: Effect[];
}

interface HeroDef {
  id: HeroId; name: string; complexity: 1|2|3|4|5|6;
  // DT-DES-002 §4-4：升级为 dieFaces（每面可声明多符号，支持 Wild）
  dieFaces: [DieFace, DieFace, DieFace, DieFace, DieFace, DieFace];
  startHp: 50; startCp: 2;
  abilities: AbilitySlot[];
  statuses: StatusDef[];
  deck: CardDef[];
}
```

### 3.5 实例化（验证 DSL 表达力）

完整数据见 `hero-schema-draft.md`。这里给覆盖率矩阵：

| 英雄 | 骰面符号池（面1→面6）🔶 | 实例化程度 | 验证的 DSL 特性 |
|---|---|---|---|
| **Barbarian** 狂战士 | `[strength, strength, strength, vitality, vitality, healing]` | **完整**：5 进攻 + 1 防御 + 1 终极，3 张升级卡，2 张行动卡 | `countSymbol` / `largeStraight` / `graded` / `rollDice`+`cases` / `if` / 自我伤害 |
| **Pyromancer** 火术士 | `[flame, flame, flame, blaze, fierySoul, meteor]` | **完整**：6 进攻 + 1 防御 + 1 终极，3 张升级卡，2 张行动卡 | `graded` / `atLeast` / `allOf`(4 符号) / `then` / `bindRemovedTo` / `countFace`(5-of-a-kind) / `increaseStackLimit` / `statusStacks` 依赖伤害 |
| **Moon Elf** 月弓手 | `[arrow, arrow, arrow, moon, moon, foot]` | **骨架**：2 进攻 + 1 防御 + 1 终极 + 3 状态定义 | `choose`（Targeted） / `spendable` 状态 / `avoidDamage` |
| **Ninja** 影行者 | `[shuriken, shuriken, shuriken, smoke, smoke, mask]` | **骨架**：2 进攻 + 1 防御 + 1 终极 + 3 状态定义 | `upkeep` 持续伤害 / `turnEnd` 钩子 / `preventDamage` 上限 |

**Barbarian 关键示例（展示 DSL 质感）**：

```
# reckless — 大顺，高风险高回报 + 反噬
matcher: largeStraight
effects:
  - dealDamage { amount: 15, type: attack, target: opponent }
  - if { cond: hitSuccess, then: [ dealDamage { amount: 4, type: undefendable, target: self } ] }
# upgrade L2: 20 / 5

# overpower — 3×力量，然后 Roll 3 决定伤害，达标追加状态
matcher: countSymbol(strength, 3)
effects:
  - rollDice { count: 3, diceSet: generic,
               cases: [] }
  - dealDamage { amount: var("rollTotal"), type: attack, target: opponent }
  - if { cond: diceSumAtLeast(14), then: [ inflictStatus(concussion, 1, opponent) ] }
# upgrade L2: 阈值降为 10 —— matcher 不变，effect 内的常量变了（tier 级替换的自然结果）
```

**Pyromancer 关键示例（DSL 表达力压力测试）**：

```
# combustion — 四符号各一，Then 语义 + 消耗 token 换不可防御伤害
matcher: allOf [ countSymbol(flame,1), countSymbol(blaze,1), countSymbol(fierySoul,1), countSymbol(meteor,1) ]
effects:
  - inflictStatus { status: pyro:fireMastery, stacks: 1, target: self }
  - then:
      - optional { prompt: "移除至多 4 枚 Fire Mastery", steps: [
          removeStatus { status: pyro:fireMastery, stacks: { choose 0..4 }, target: self,
                         bindRemovedTo: "burned" } ] }
      - dealDamage { amount: mul(3, var("burned")), type: undefendable, target: opponent }

# hotStreak — 小顺，伤害依赖运行时 token 数
matcher: smallStraight
effects:
  - inflictStatus { status: pyro:fireMastery, stacks: 2, target: self }
  - then:
      - dealDamage { amount: add(5, statusStacks(pyro:fireMastery, self)), type: attack, target: opponent }

# scorchTheEarth (Ultimate) — 5 个同点数（面 6 = meteor）
matcher: countFace(6, 5)
isUltimate: true
effects:
  - inflictStatus { status: pyro:fireMastery, stacks: 3, target: self }
  - inflictStatus { status: pyro:knockdown, stacks: 1, target: opponent }
  - inflictStatus { status: pyro:burn,      stacks: 1, target: opponent }
  - dealDamage { amount: 12, type: undefendable, target: opponent }
```

### 3.6 DSL 当前的表达边界（诚实清单）

| # | 表达不了 / 表达得别扭的东西 | 现状 | 扩展方案（何时做） |
|---|---|---|---|
| E1 | **Companion（伙伴）**：Treant 的 Seedlings、Huntress 的 Nyra、Artificer 的 Bot——有独立 HP/形态/成长，不是 Status Effect，免疫所有状态操作 | 未建模 | 新增 `CompanionDef`（`hp`, `formTiers`, `hooks`）+ `TargetRef.kind: "companion"`。**MVP 不需要**（4 英雄均无 Companion），但 `TargetRef` 现在是可扩展联合类型，加分支不改既有数据 |
| E2 | **骰面动态改写**（Shadow Thief 类"把对手一颗骰视为 X"） | `setDieFace` 能覆盖"改面"，但"改变某颗骰被 matcher 解读的方式"需要一层间接 | 加 `DiceView` 的 `overrideSymbols: Map<dieIndex, Sym>`，matcher 求值前先套 override。**Season 1 其余 4 英雄上线前做** |
| E3 | **"若你本回合已激活过 X 能力"**这类跨效果的历史查询 | `Condition` 里没有 | 加 `{ c: "historyCount"; event: string; min: number }`，引擎侧维护 `turnEventLog`。**低优先级** |
| E4 | **真·打断（Instant Action 打断效果序列中间）** | 按 C12 裁决，MVP 只支持响应窗口 | 若未来要做：给 `Effect` 加 `interruptibleAt?: string[]` 断点标记。**建议永远不做**（复杂度/收益比极差） |
| E5 | **多人 Targeting 的"攻击领先者额外抽牌"** | 未建模 | 加 `TargetRef.kind: "leader"` + `Phase.TARGETING` 的骰子选择。**多人模式时做** |
| E6 | **卡面文本的自动生成本地化** | effect 是结构化数据，但渲染成中文句子需要模板 | 每类 effect 配一个 `describe(e, lang)` 模板函数。**MVP 必做**（否则玩家看到的是 JSON） |
| E7 | **概率提示的精确计算** | DSL 不含概率信息 | 独立模块：对 matcher 做蒙特卡洛或枚举（5 骰 6 面 = 7776 种，可**精确枚举**）。见 §5 |

> **结论**：DSL 覆盖了 MVP 四个英雄的 100% 已知效果，以及 Season One 剩余四英雄中约 85%。剩余部分（Companion、骰面 override）在类型设计上已预留扩展位，不需要重构。

---

## 4. UX 规格（网页端对局界面）

### 4.1 对局主界面布局分区

```
┌───────────────────────────────────────────────────────────────┐
│ ① 顶栏  回合 7 · 你的回合 · [阶段进度条 ①─⑧] · ⏱ 18s · ⚙ 投降  │
├───────────────────────────────────────────────────────────────┤
│ ② 对手区                                                       │
│    [头像] 火术士  HP ████████░░ 34/50   CP 5   🂠 4            │
│    状态: 🔥Burn×1 💫Knockdown×1   升级: II II —                 │
├───────────────────────────────────────────────────────────────┤
│                                                                │
│ ③ 战斗日志(左抽屉)  │  ④ 骰盘（中央焦点）  │ ⑤ 能力候选区       │
│   • 你激活 Hot Streak│   ⚀ ⚁ ⚂ ⚃ ⚄        │  ┌─可激活────────┐ │
│   • 12 伤害 → 对手  │   [🔒][ ][🔒][ ][ ]  │  │ ★ Ignite  18🔥│ │
│   • 对手 Molten     │   Roll Attempt 2/3  │  │ ★ HotStrk 12🔥│ │
│     Armor → 3 反伤  │   [ 掷骰 ] [ 确认 ] │  │ ★ Fireball 6🔥│ │
│                     │   🎲 概率: Ignite 31%│  └───────────────┘ │
├───────────────────────────────────────────────────────────────┤
│ ⑥ 我方英雄面板                                                 │
│  [Slam][Overpower][Reckless][Patience][ThickSkin D][Anger! U]  │
│      Ⅱ                                              (终极)     │
├───────────────────────────────────────────────────────────────┤
│ ⑦ 手牌区（弧形，可打出的卡发光）        ⑧ 资源: CP 7/15  🂠 5/6│
└───────────────────────────────────────────────────────────────┘
```

### 4.2 信息层级与视觉优先级

| 层级 | 元素 | 视觉权重 | 理由 |
|---|---|---|---|
| **L1 焦点**（每时每刻唯一） | ④ 骰盘（掷骰阶段）/ ⑤ 能力候选（选能力时）/ 防御响应面板（对手回合） | 最大尺寸、居中、动效最强 | 当前唯一的决策点，认知负荷集中在此 |
| **L2 常驻关键** | 双方 HP、己方 CP、己方手牌、Roll Attempt 计数 | 高对比、始终可见、变化时有动效 | 玩家需要持续追踪的资源 |
| **L3 参考** | ⑥ 能力面板、状态槽、② 对手区细节 | 中等、可 hover 展开 | 决策时查阅，不必常驻视线中心 |
| **L4 背景** | ③ 战斗日志、设置、规则查询 | 低、抽屉/折叠 | 复盘与查询用，不占主视线 |

**硬性约束**：L1 区域在同一时刻**只应有 1 个**。掷骰时不弹能力候选，选能力时不诱导打牌。这是防认知过载的核心手段。

### 4.3 关键交互流程

| 流程 | 交互设计 |
|---|---|
| **掷骰** | 主按钮「掷骰」（也支持空格键）。骰子翻滚 600ms 后定格。 |
| **锁定** | 单击骰子切换锁定（🔒 图标 + 下沉 4px + 边框描金）。桌面端支持框选/拖选批量锁定；移动端点击单颗。**锁定状态立刻同步服务端**（乐观 UI）。 |
| **能力可选高亮** | 每次骰面变化后，⑤ 候选区实时刷新；同时 ⑥ 面板上对应的能力格描边呼吸发光。选中某个候选时，**骰盘上满足 matcher 的那几颗骰同步描边**（`MatcherTrace`），这是新手理解机制的关键。 |
| **防御掷骰响应** | 被动方收到全屏半透明浮层：「对手激活 Ignite，18 点伤害」。若只有 1 个防御能力 → **自动掷骰**（0.8s 动画），无需点击；但**保留"是否消耗 Evasive 类状态"的独立按钮**。若有多个防御能力 → 先选择再掷（B12）。 |
| **打牌确认** | 点击手牌 → 卡片放大到屏幕中央 + 目标高亮（若需选目标）→ 「确认 / 取消」。**0 费卡仍需确认**（防误触），但确认按钮做成一次点击。打牌后卡飞入弃牌堆（300ms）。 |
| **弃牌阶段** | 顶部提示「弃 2 张（每张 +1 CP）」。手牌进入多选态，点击即弃。**提供「自动弃最弱」按钮**（默认按引擎评分：0 费卡最后弃）。超时自动执行同样的策略（C13）。 |
| **PASS** | 「不激活」按钮常驻（灰化直到合法），避免玩家在无候选时困惑。 |

### 4.4 反馈设计（节奏优先）

| 事件 | 反馈 | 时长 |
|---|---|---|
| 伤害数字 | 从受击方头像上方飘出 `-15`（红）+ 缩放弹跳，同时 HP 条补间 | 250ms 数字 + 400ms 血条 |
| 同时结算明细 | flush 时先展开一行明细 `15⚔ + 3🔥 − 4🛡 + 2💚 = 12`，再跳到净额数字 | 明细停 700ms |
| 状态 token | 从施加者方向滑入受者状态槽（200ms），堆叠显示 `×N`，达到 Stack Limit 时描红边 | 200ms |
| 治疗 | 绿色 `+5` 上飘，HP 条填充音 | 250ms |
| Ultimate 触发 | 全屏 1 次闪光 + 0.5s 慢镜 + 对手区灰化（表达"你无法响应"） | 800ms（唯一的"慢"，值得） |
| 骰子定格 | 600ms 翻滚，逐颗错峰 60ms 落定 | 600ms |
| **节奏预算** | 单次 Roll Attempt ≤ 2.5s；ORP+DRP 全流程目标 ≤ 25s；单回合约 60–90s；整局 15–25 分钟 | — |

**反冗长设计**：
- 无敌方回合"等待动画"：对手思考时只显示脉冲环 + 计时，不播无意义动画。
- 所有可并行的动画并行（骰子逐颗错峰而非串行）。
- 玩家可开启「极速模式」：动画时长 ×0.4，MVP 后排期（建议 MVP 就做，成本极低）。

### 4.5 新手引导：3 分钟上手

桌游的复杂度在数字版是**留存杀手**。方案分三层：

**第 0 层 · 首局教程（强制，约 3 分钟，可跳过）**
1. 固定使用 **Barbarian vs AI**，AI 第一回合不还手。
2. 分步高亮引导：Upkeep（"这里结算状态"）→ Income（"+1 CP，抽 1 张"）→ Main1（"花 CP 升级"）→ **Offensive Roll**（"掷骰，锁定想要的，最多 3 次"）→ **能力激活**（"点亮的格子就是你能用的"）→ Defensive（"对手会防御"）→ Discard（"超过 6 张要卖掉"）。
3. 每一步只教一件事，其余 UI 全部遮罩。
4. 教程结束给一个"你已经学会了 80% 的规则"的成就卡。

**第 1 层 · 局内常驻辅助（可关）**
- **骰型提示**：hover 任意能力 → 显示激活条件的可视图示 + **"你还差 2 颗 Flame"**。
- **能力可选高亮**：永远自动（这是数字版相对桌游的最大优势，不该做成选项）。
- **概率提示**：骰盘下方显示"当前锁定下，各能力达成概率"（精确枚举 7776 种，见 §5）。新手默认开，专家可关。
- **阶段引导条**：顶栏 8 段进度条，当前段高亮 + 一句话说明。
- **术语 tooltip**：CP / Roll Attempt / Undefendable / Stack Limit 等全部可点。
- **"为什么我不能激活？"**：点击灰化的能力 → 弹出 DSL 自动生成的解释文本（E6 的 `describe()`）。

**第 2 层 · 随时可查**
- 规则查询页（Esc 唤出）：按阶段 / 按术语 / 按状态效果三路检索。
- 状态槽 hover 显示完整规则文本 + Stack Limit + 是否 persistent。

### 4.6 线上特有体验

| 体验 | MVP | 设计要点 |
|---|---|---|
| **对手思考中的等待反馈** | ✅ | 对手头像脉冲环 + 环形计时（前 8s 不显示数字，避免催促感；超过 8s 显示倒计时）。**不做"催促"按钮**（负向社交）。超时自动走保守默认。 |
| **断线重连** | ✅ | 60s 浮层倒计时 + 「重连中…」。重连后服务端下发完整 state snapshot + 缺失日志段，客户端补播动画。 |
| **投降** | ✅ | 设置菜单 → 二次确认 → 记入战绩。 |
| **观战** | ❌ 扩展 | 依赖日志流 + 信息隐藏的"观众视图"（双方手牌都隐藏）。 |
| **对局回放** | ❌ 扩展 | 依赖结构化日志 + 种子（§5）。 |
| **预设短语 / 表情** | ❌ 扩展 | 低优先级；若要则只做 6 条预设，禁自由输入（防骚扰）。 |
| **AI 陪练** | ❌ 扩展 | 教程局的 AI 是"脚本 AI"，真陪练见 §5。 |

---

## 5. 数字化增强点（桌游没有、线上必须有）

| # | 增强点 | 收益 | 代价 | MVP? |
|---|---|---|---|---|
| D1 | **判定顺序硬编码**（§1.1 C 类 16 条裁决 + §2.3 管线） | 消除全部口头协商争议；裁决可配置化；引擎可测试 | 需要一份公开的裁决文档；某些裁决与实体桌游会有细微偏差 | ✅ **必做** |
| D2 | **操作超时与自动结算** | 防拖延、防挂机；节奏可控 | 需设计"保守默认"策略，且必须让玩家在设置里看到 | ✅ **必做** |
| D3 | **服务端权威随机 + 种子** | 防作弊；对局可复现；回放只需存种子 + 指令流 | 客户端不能本地随机；需实现种子化 RNG（xorshift/mulberry32）与洗牌 | ✅ **必做** |
| D4 | **结构化战斗日志** | 复盘、客服举证、AI 训练、回放的数据源 | 事件 schema 设计成本；存储 | ✅ **必做**（回放的前提） |
| D5 | **骰子概率提示** | **最大幅度降低门槛**：玩家不用心算 7776 种组合；把"运气游戏"变成"概率决策游戏" | 削弱高手的心算优势；可能让对局变慢（玩家会纠结）→ 缓解：默认开，可关，且只在 `AWAIT_DECISION` 显示 | ✅ **必做**（核心卖点） |
| D6 | **自动跳过空阶段 / 自动弃牌** | 减少点击噪声 | 需要"可覆盖"逃生舱（玩家可取消自动） | ✅ 必做 |
| D7 | **投降** | 避免垃圾时间 | 无 | ✅ 必做 |
| D8 | **能力候选自动计算 + 高亮** | 桌游最常见的失误是"忘了自己还能激活另一个能力" | 无 | ✅ 必做 |
| D9 | **信息隐藏（对手只见手牌数）** | 线上必须有 | 需要 per-player state redaction | ✅ 必做 |
| D10 | **对局回放** | 学习、分享、争议仲裁 | 依赖 D3+D4；约 1–2 周额外工作量 | ❌ 扩展（架构上预留） |
| D11 | **AI 陪练** | 无网络也能玩；新手练手不挨骂 | AI 需要评估函数；启发式 AI 对 Dice Throne 够用（候选能力按 EV 排序 + 简单 CP 管理） | ❌ 扩展（教程局脚本 AI 在 MVP） |
| D12 | **天梯 / 匹配** | 长期留存 | 需要账号、ELO、匹配服务；MVP 建议用**房间码直连** | ❌ 扩展 |
| D13 | **观战** | 社区 | 依赖日志流 | ❌ 扩展 |
| D14 | **赛后统计（骰运报告）** | 缓解"我被运气坑了"的挫败感：显示"你本局实际骰运 vs 期望" | 需要统计模块 | 🟡 **建议 MVP 做**（成本极低，直接对冲 §6 R2） |
| D15 | **低随机 / 竞技模式**（关闭概率提示、首掷保底、或用确定性骰序） | 吸引硬核玩家 | 分裂玩家群；规则不再是"标准" | ❌ 扩展（且需用户拍板，见 Q4） |

**给 engineering-lead 的说明**：D3/D4/D9 三条对架构有硬约束，必须在架构文档里体现（服务端权威 + 种子 RNG + 事件日志 + per-player redaction）。

---

## 6. 已知风险与缓解

| # | 风险 | 严重度 | 缓解 |
|---|---|---|---|
| **R1** | **IP 版权**：官方数字版 2027 上线；美术/文本/商标受保护 | 🔴 高 | ① MVP 定位为**自用 / 学习 / 原型验证，不公开分发**；② 数据层只写机制逻辑，零 flavor text（§0.1），重皮成本≈换一套美术+改名；③ 若要公开 → 走"重皮主题化"（换英雄名、卡名、世界观、全部美术自绘）；④ **需用户拍板路径**（Q1）。 |
| **R2** | **随机性带来的挫败感**：3 次 Roll Attempt 全空是很糟的体验 | 🟠 中高 | ① 概率提示（D5）让玩家"主动承担风险"而非"被动挨运气"；② 赛后骰运报告（D14）把挫败感外部化为数据；③ 3 次 Roll Attempt + 锁定机制本身提供了大量策略空间，设计上强调"你的选择 > 你的运气"；④ 首局教程用 Barbarian（最直接的英雄）。 |
| **R3** | **英雄平衡**：4 英雄样本小，且 Pyromancer（玻璃大炮）vs Barbarian（直球）是天然的 matchup 剪刀 | 🟠 中 | ① 结构化日志自动统计**按 matchup 的胜率矩阵**，数据说话；② 数据驱动 = 平衡补丁可以热更数值，不改代码；③ MVP 只做 1v1，变量少；④ 4 个英雄选的是官方复杂度 1–3 的四位，本身是官方平衡过的组合（Barbarian 1 / Moon Elf 2 / Pyromancer 3 / Ninja 3）。 |
| **R4** | **规则理解门槛**：八阶段 + 4 类能力 + 4 类卡牌 + 状态系统，"Harder to teach"（BGG 教学性 2.3/5） | 🟠 中 | 见 §4.5 三层引导。核心抓手：**能力候选高亮**（把"我记得我能用什么"变成"系统告诉我能用什么"）+ **概率提示** + **"为什么不能激活"解释**。这三条能把学习曲线从 3 局压到 1 局。 |
| **R5** | **4 英雄的内容深度**：4 英雄 → 10 个 matchup（含镜像），20–25 分钟/局，新鲜感约 15–20 局 | 🟡 中低 | ① 这正是数据驱动的回报：Season One 剩余 4 英雄（Monk/Paladin/Shadow Thief/Treant）只需加数据；② AI 陪练（D11）补单人场景；③ 建议 MVP 后第一优先级就是"再上 2–4 个英雄"而不是做观战/天梯。 |
| **R6** | **引擎实现复杂度**：三个雷区——Ultimate 的"不可响应"、Stun 的"额外回合"、`Then` 的响应窗口 | 🟠 中 | ① §2.3 的管线把它们统一为**权限令牌** + **窗口栈**两个机制；② 每个雷区至少 3 条单元测试（见 §2.3 边界清单）；③ 建议 engineering-lead 把 `actionPermission` 与 `ResponseWindow` 做成一等公民类型。 |
| **R7** | **网络延迟下的响应窗口体验**：等对手响应 15s 很难受 | 🟡 中 | ① 乐观 UI + 服务端回滚（锁定骰子即时反馈）；② 超时收紧到 12s（比 15s 更紧）；③ 响应窗口只在真正有多种可能时才弹（若对手无牌可打且无 spendable 状态 → **服务端直接跳过窗口**，这是重要的优化）。 |
| **R8** | **数值校准风险**：本档部分英雄数值为 🔶 待校准 | 🟡 中 | §7 Q8：上线前安排一次 rules-lawyering pass；DSL 让这个 pass 只改数据不改代码。 |

---

## 7. 待主理人 / 用户确认的开放问题

| # | 问题 | 影响 | 我的建议 |
|---|---|---|---|
| **Q1** | **IP 路径**：自用学习 / 重皮主题化公开 / 其他？ | 决定美术方向、命名、是否可做公开匹配 | 先按"自用 + 数据层重皮就绪"推进；公开发布前再拍板 |
| **Q2** | **治疗时序**：`simultaneous`（与伤害净额）还是 `immediate`（立即生效）？官方有 errata 冲突 | C4/C5，影响死亡判定与 Thick Skin 手感 | 选 `simultaneous`，并做成可配置项 |
| **Q3** | **净额结算下治疗能否救回死亡**？ | C5，直接影响防守方体验 | 选"能救回"（更友好、与 simultaneous 自洽） |
| **Q4** | 是否要**低随机 / 竞技模式**（关闭概率提示）？ | D15，影响 UI 与模式分裂 | MVP 不做；概率提示做成可关的选项即可 |
| **Q5** | **断线/超时的处置**：超时判负 vs 暂停计时？ | C14 | 休闲：60s 后判负；排位：暂停计时（MVP 用休闲规则） |
| **Q6** | **MVP 后第一个扩展**是"加英雄"还是"做回放/AI/天梯"？ | 排期 | 建议：加 2–4 英雄（数据驱动边际成本最低）→ AI 陪练 → 回放 → 天梯 |
| **Q7** | **是否需要 4 人 / 2v2**？ | 需要 Targeting 阶段 + 共享 HP + 团队手牌可见，工作量大 | MVP 明确不做；架构上 `TargetRef` / `eligiblePlayers` 已预留 |
| **Q8** | 是否安排一次 **rules-lawyering 校准 pass**（对照实体组件核对全部 🔶 数值）？ | R8 | 建议做，约 0.5–1 人日，只改数据 |
| **Q9** | **Instant Action Card 是否支持真打断**？ | C12，引擎复杂度 | 建议 MVP 不支持（只在响应窗口内可打） |
| **Q10** | **先手如何决定**？官方是各掷 1 骰比大小 | 开局流程 | 建议：服务端直接随机指定并显示"掷骰决定先手"的动画，省一次交互 |

---

## 附录 A：本文档对架构的硬约束（给 engineering-lead）

1. **服务端权威 + 客户端纯渲染**：所有 matcher 求值、candidates 计算、Bucket flush、RNG 都在服务端。客户端只发意图指令。
2. **需要 4 个一等公民类型**：`ResponseWindow`（窗口栈）、`ActionPermission`（权限令牌）、`DamageBucket`（累积器）、`GameEvent`（结构化日志）。
3. **per-player state redaction**：同一个 `GameState` 必须能产出两个视图（`redact(state, p0)` / `redact(state, p1)`），手牌/牌库顺序对对手不可见。
4. **种子化 RNG**：一个 seeded PRNG 实例贯穿全局，所有随机（骰子、洗牌、先手）都从它取，便于复现与回放。
5. **纯函数式结算**：`(GameState, Effect[]) → (GameState', PendingPrompt[], GameEvent[])`，无副作用 —— 便于快照、回滚、测试、AI 搜索。
6. **数据校验**：`HeroDef` / `CardDef` 需要 schema 校验（zod 或 JSON Schema），加载时校验而非运行时崩。
7. **卡牌文本渲染**：每类 effect 需要一个 `describe(e, lang)` 模板函数（E6），否则玩家看到 JSON。

---

## §8 对齐裁决补遗（DT-DES-002）

> 任务号：DT-DES-002（对齐补漏轮）　|　作者：文策渊（design-strategist）
> 触发：`docs/architecture/dice-throne-architecture.md` 附录 B「我按默认值实现、需 design 复核」的 6 条，其中 4 条（①②③④）本轮裁定；另补 engineering 硬依赖 1 条（⑤）。
> 定位：**追加一节，不重写已有章节**。与 §1–§7 冲突时，以本节为准并在下方 §8.7 列出需回改的位置。
> 状态：P1，M1 前定稿。带 ⚠️ 标记的需主理人 / 用户拍板。

### 8.0 裁决总表（速查）

| # | 问题 | 裁定 | 一句话理由 | 影响位置 |
|---|---|---|---|---|
| ① | 弃牌堆是否对双方公开？ | **公开（投影保留 `discard: CardInstance[]`），UI 默认只给"数量 + 聚合摘要"，卡面收进按需查看器** | 桌游弃牌堆 face-up 公开，降为"只见数量"等于凭空剥夺双方本该有的信息；认知负担用"按需展示"解决，不用"删信息"解决 | 架构无需改（确认其默认值即可）；补 §4.1 / §4.6 UI |
| ② | 玩家能否看自己牌库顺序？ | **顺序永不发给任何人（含自己）；改为下发派生聚合字段 `remainingDeckCounts`** | 桌游里玩家能从"总牌表 − 手牌 − 弃牌 − 已打出"精确推出自己剩余牌的**多重集**，只有顺序未知 → 剩余构成零泄露；顺序一旦下发即成为作弊面 | 新增 `SelfPlayerView.remainingDeckCounts`；补 §4.1 / §4.6 UI |
| ③ | Wild 面是否参与顺子判定？ | **MVP 4 英雄均无 Wild 面，本规则不触发**；保留 `HeroDef.wildFaces?` + `wildPolicy?` 扩展位与枚举求值算法 | 顺子判定缺的三条硬规则（不环绕 / 去重 / 大顺蕴含小顺）与 Wild 无关但必须现在补 | 补 §3.2；`HeroDef` 改 `dieFaces`（见 §8.7-6） |
| ④ | 防御产生的反伤分类与可防御性？ | **`type: "pure"`（无伤害类型）→ 不可防御、不可被 Attack Modifier 增强、不触发新增防御掷骰** | 官方原则："非攻击来源的伤害没有伤害类型，不能被攻击修正类卡牌增强，也不能对其使用防御能力"；且不可防御**保证防御链一定收敛**（防无限递归） | **改数据**：`hero-schema-draft.md:1094-1096` 的 `type:"attack"` → `"pure"` |
| ⑤ | `choose` / `optional` 超时默认？ | **`choose` → `default` 声明项（缺省 index 0，作者契约：最保守项排第一）；`optional` → 不行使；均 15s** | 引擎不推导"保守"（DSL 无 EV 模型），改由数据作者显式声明 + 位置契约；`optional` 一律 skip → 服务端绝不替玩家支付代价 | 补 §2.1 超时体系；`PendingRequest.autoResolve` 直接对接 `default` |

---

### 8.1 ① 弃牌堆的公开性

**裁定：公开。信息等价桌游，但呈现分两层。**

服务端投影保留 `OpponentPlayerView.discard: readonly CardInstance[]`（**确认 engineering 的默认值是对的**），客户端默认只渲染数量，卡面收进「弃牌堆查看器」抽屉，点击才展开。

**为什么不用「只给数量」**：
- 桌游里弃牌堆是 face-up 的，双方都有权利随时翻查。把它降为"只见数量"不是降低认知负担，而是**改变了游戏**——玩家失去追踪对手牌库循环的能力，牌差策略（"他这张关键牌已经弃了，我可以放开打"）直接消失。这是净损失策略深度的改动，而收益仅仅是少一次点击。
- 真正的痛点是**记忆负担**，解法应该是"让信息可查阅而非占用视线"，而不是删掉信息。这是《炉石》《万智牌 Arena》早已验证的做法。

**UI 三条硬约束**（补 §4.1 / §4.6）：

1. **查看器内容**：逆序排列（最新在上）+ 每张标注「第 N 回合弃出」+ **上次重洗分割线**。只读快照，打开不暂停任何计时。
2. **默认展位只给聚合摘要**：`7 张 · 王牌 3 · 行动 4`（按 `CardDef.kind` 聚合）。玩家一眼知道"还剩几张三费"，无需逐张记忆。
3. **重洗必须可见**：复用 engineering 已有的公开事件 `DeckReshuffled` → UI toast「对手牌库重洗（7 张）」，并把分割线写进查看器。

**边缘情况**：
- MVP 无"从对手弃牌堆取牌 / 回收"的效果 → 本裁定不产生新的数据依赖；未来若加，裁定天然支持（信息本来就在投影里）。
- **观战视图（D13）**：观战时双方弃牌堆都可见（与"双方手牌都隐藏"不冲突，弃牌堆本就公开）。MVP 不做，记录此约束。

**需改动的位置**：`docs/architecture/dice-throne-architecture.md:179` 与 `:885` 删除「需 design 确认」标记 → 改为「已确认：公开（DT-DES-002 ①）」。本 spec §4.1 对手区加「弃牌堆 N 📜」入口，§4.6 表加一行。

---

### 8.2 ② 玩家自己能否看牌库

**裁定：顺序永不下发（含所有人）；新增派生聚合字段 `remainingDeckCounts` 只给自己。**

```ts
interface SelfPlayerView {
  // ...既有字段
  readonly deckCount: number;                                              // 已有，保留
  readonly remainingDeckCounts: ReadonlyArray<{ cardId: CardId; count: number }>;  // ✅新增
  readonly unknownInDeck: number;                                          // ✅新增，MVP 恒 0
}
// OpponentPlayerView 不含以上两个新字段（对手的剩余构成 MVP 不提供）
```

**关键论证（桌游等价性）**：桌游中玩家**本来就能**精确推出自己剩余牌的多重集——英雄牌表是公开常量，手牌、弃牌堆、已打出的升级卡自己全看得见，`剩余 = 总表 − 已知`。唯一未知的是**顺序**。因此"剩余构成"是**零信息增益**的纯 UX 收益；而"顺序"一旦下发，等于把未来 N 次抽牌送给了客户端，即使不渲染也是作弊面（改过的客户端能读）。这与 architecture §2.2.2 的 fail-safe 立场完全一致——**我确认其默认值"牌库顺序：❌/❌"是对的**。

**实现要点**：`remainingDeckCounts` 由服务端 mapper 从 `hero.deck` 常量表减去 hand / discard / 已打出 upgrade 现场计算，必须在**白名单 mapper 里显式搬运**（不得直接把 `state.deck` 变形后塞进去，那等于绕开 fail-safe）。

**UI**：己方区「牌库 12 张」→ 点击展开《剩余构成》面板（只显示 `count > 0` 的卡，按 CP 费用降序）。这是回答 §2 中那个"体验问题"（"我的牌库还剩几张关键牌"）的正解。

**边缘情况**：
1. **守恒断言**：`Σ(remainingDeckCounts) + unknownInDeck === deckCount`。写成自动化断言交给 `content-lint` 跑，防止漏算 exiled / 已打出升级卡。
2. ⚠️ **与 D15 冲突**：若未来做"确定性牌序 / 低随机模式"，该面板会**立即变成作弊器**——必须列入 D15 的模式禁用清单（硬约束，随 D15 一并评审）。
3. **未知来源的卡**：未来若有"对手往我牌库插入某卡"的效果，该卡计入 `unknownInDeck` 且不显名（`cardId` 不上投影），避免泄露对手的操作内容。
4. **对手的剩余构成**：MVP **不提供**。理由是新手认知负担 > 战术收益，且 MVP 无"侦察对手牌库"类效果。规则查询页本来就有全英雄牌表，硬核玩家可以自己心算。**保持不对称（自己可见、对手不可见）**。

**需改动的位置**：`docs/architecture/dice-throne-architecture.md:178` 第 2 行备注改为「只给 `deckCount` + `remainingDeckCounts`（聚合），不给顺序」。本 spec §4.1 / §4.6 补 UI。

---

### 8.3 ③ Wild 面与顺子判定

**裁定：MVP 4 英雄均无 Wild 面 → 本规则暂不触发，matcher 走 fast path。**

逐一核对四个英雄的骰面池（`HeroDef` 符号数组，面 1→面 6）：

| 英雄 | 骰面池 | Wild 面 |
|---|---|---|
| Barbarian | `[strength, strength, strength, vitality, vitality, healing]` | 无 |
| Moon Elf | `[arrow, arrow, arrow, moon, moon, foot]` | 无 |
| Ninja | `[shuriken, shuriken, shuriken, smoke, smoke, mask]` | 无 |
| Pyromancer | `[flame, flame, flame, blaze, fierySoul, meteor]` | 无 |

**"伪 Wild"辨析**：MVP 存在一种容易被误认的机制——"点燃！"这类卡用 `setDieFace` 把某颗骰改成指定面。这是**面的实改**（改完之后字面就是那个符号），不是多态解读，语义已确定，走既有 `Effect` 原语，**不进 `wildFaces`**。请勿混淆：两者的区别是"改的是骰子的真实状态" vs "骰子状态不变、只改变 matcher 的解读方式"。

#### 8.3.1 顺子判定的三条硬规则（现在就要写进 `rules.config.ts`）

这三条与 Wild **无关**，但是 §3.2 缺失的边界，必须补：

| # | 规则 | 例 |
|---|---|---|
| S1 | **不环绕**：6-1-2-3-4 **不算** 4 连;`smallStraight` / `largeStraight` 均为线性连续段 | ⚅⚀⚁⚂⚃ → 不构成 smallStraight |
| S2 | **面值去重后再找最长连续段**：两颗同点数只占一个位置，不能"复用"补位 | ⚃⚃⚂⚁⚀ → 去重后 {1,2,3,4}，长度 4 ✅ smallStraight；不是 5 |
| S3 | **大顺蕴含小顺**：5 连必然包含 4 连；若某英雄同时有 `smallStraight` 与 `largeStraight` 两个能力，两者**同时进入 candidates**，按 §1.3 强制单选即可，无需特判互斥 | Reckless + 另一个小顺能力同时点亮是正常的 |

#### 8.3.2 未来引入 Wild 时的扩展方式

`hero-schema-draft.md` 已有 `DieFace { value; symbols: Sym[] }`（`symbols.length > 1` 即多符号面）——**采纳它作为规范形态**（见 §8.7-6），并在此基础上加：

```ts
interface HeroDef {
  // ...
  dieFaces: [DieFace, DieFace, DieFace, DieFace, DieFace, DieFace];   // 取代 dice: [Sym×6]
  wildFaces?: FaceIndex[];      // 🆕 可当任意值使用的面（MVP 恒省略 → 走 fast path）
  wildPolicy?: WildPolicy;      // 🆕 默认 "substituteAny"
}

type WildPolicy =
  | "substituteAny"   // 默认：可充当任意面值 / 任意符号（= 枚举全部赋值组合）
  | "gapFillOnly"     // 只能补顺子的缺口，不能替代已有面、不参与 countFace
  | "excluded";       // 完全不参与 matcher 判定，只按字面符号算
```

**求值算法**（与 engineering 已计划的策略一致，此处补 design 侧要求）：

1. `DiceView.isWild[i] = hero.wildFaces?.includes(faces[i])`。
2. 对每个 matcher，枚举 Wild 骰的全部取值组合（`≤ 6^wildCount`；**约定 `wildCount ≤ 2`**，最差 36 次，可忽略），**任一组合满足即 matched**。
3. `MatchResult` 增加 `wildAssigned?: Record<dieIndex, FaceIndex>`——记录本次判定中每颗 Wild 骰被当成了什么。UI 上给 Wild 骰加 `?` 角标 + 显示"本次当作 ⚃"，复用 §1.3 的 `MatcherTrace` 高亮通路。
4. `countFace` 同理适用（Wild 可补足 5-of-a-kind）。

⚠️ **平衡红线**：Wild 参与 `countFace(6,5)`（Scorch the Earth 等 Ultimate）会把 Ultimate 触发概率抬高一个量级。引入含 Wild 英雄时，`content-lint` 必须对所有 `isUltimate` 能力跑一次**概率 diff**，并把"含 Wild 时触发概率"列为必看指标。

**文档位置**：§3.2 末追加"Wild 扩展槽"；§3.4 `HeroDef` 标 🆕。**注意与 E2（骰面 override）的协同**：E2 是骰面外的动态改写、Wild 是骰面自身多态，二者应共用同一个 `wildAssigned` / `overrideSymbols` 记录结构，建议一并实现，避免两次改 matcher 签名。

---

### 8.4 ④ 防御产生的反伤：分类与可防御性

> 这是本轮 5 条里唯一会**改数据**的一条，也是最容易被实现成 bug 的一条。

**裁定：反伤 = `type: "pure"`（无伤害类型）→ 不可防御。**

依据 team-lead 引用的官方原则——"**非攻击来源的伤害没有伤害类型，不能被攻击修正类卡牌增强，也不能对其使用防御能力**"——拆成四条子裁定：

| # | 子裁定 | 内容 |
|---|---|---|
| **④-a** | **分类范围** | 任何**非"当前激活的 Offensive Ability"**产生的伤害 → `type: "pure"`。含三类：① 防御能力的反伤（Molten Armor）；② 状态 Upkeep 伤害（Poison / Burn）；③ 效果序列中的自我反噬 Recoil 词条（见下方 ④-e）。 |
| **④-b** | **可防御性** | **不可防御**。`pure` 落入 `undefendable` 桶：不被 `preventDamage`（Thick Skin 等）削减、不被 `avoidDamage`（Evasive / Shadows）抹除、不触发任何新的防御掷骰。 |
| **④-c** | **不可被增强** | 双方任一的 Attack Modifier 都不得作用于 `pure`。"你的攻击 +N 伤害"只对 `type:"attack"` 生效。 |
| **④-d** | **不参与攻击语义** | 不计为 Attack → 对任何一方都不产生 `hitSuccess`、不计入任一方的 `damageDealtAtLeast` 条件、不触发 `attackResolved` 类钩子。但它**正常计入 `onDamageDealt`（受伤）类钩子**（对目标而言"我确实受到了伤害"，来源是谁无关）。 |

**为什么必须是"不可防御"——两条理由，第二条是工程硬理由**：

1. **规则正确性**：正如原则所述，"不能被防御"是"没有伤害类型"的直接推论。允许它被减伤等于给它发了伤害类型。
2. ⚠️ **引擎收敛性（这条最要紧）**：如果反伤可被防御，就会存在 `攻击 → 防御 → 反伤 → 对方再防御 → 再反伤 → …` 的链条。反伤**不可防御**，才能在数学上**保证防御链一步收敛**：一次 Roll Phase 结算内防御掷骰恒 ≤ 1 次。这不是平衡取舍，是终止性证明。

**④-e 顺带解决一个跨文档冲突（我主动发现的）**：`hero-schema-draft.md:138-143` 定义了 **5 个**伤害类型（多了 `self`），而本 spec §1.1 A14 写的是**四类**。这是 **fail-open 型不一致**——多出来的枚举会让 flush 公式长特判。**裁定：`DamageType` 回到 4 类**（`attack` / `undefendable` / `collateral` / `pure`），理由是**"能否被防御/能否被增强"是一条语义轴，"来源是谁 / 打向谁"是另一条正交轴，混进同一个枚举就会让每个 switch 都长出例外分支**。

```ts
type DamageType = "attack" | "undefendable" | "collateral" | "pure";   // ✅ 4 类，规范形态

interface DamageEntry {
  amount: number;
  type: DamageType;                                  // 语义轴：能否防御 / 能否被增强
  sourceKind: "ability" | "status" | "ultimate" | "recoil";  // 正交轴：来源（取代 'ultimate' 伪类型）
  target: TargetRef;                                 // 正交轴：打向谁（self-recoil 用 target:{kind:"self"}）
  source: string;
}
```
- `self` **不是伤害类型**，是 `target: { kind: "self" }`，伤害类型仍是 `pure`，落入**该玩家自己的** `undefendable` 桶。
- `ultimate` 同理不是伤害类型，改记为 `sourceKind: "ultimate"`，类型仍按能力作者标的类型走（多数为 `undefendable`）。

**需改动的位置（按优先级）**：
1. 🔴 `hero-schema-draft.md:1094-1096` **Molten Armor 的反伤 `type:"attack"` → `type:"pure"`**。这是数据 bug：现在的实现会让反伤触发对方再次防御、被对方的 Thick Skin 削减、被对方的 Attack Modifier 加成——三条全违反官方原则，且与 ④-b 的工程收敛性冲突。改完后这套过滤全部自动消失。
2. 🟠 `hero-schema-draft.md:138-143` 删 `self` 与 `ultimate` 两个伪类型 → 改 `sourceKind`。
3. 🟠 `docs/architecture/dice-throne-architecture.md:809` 的 `'ultimate'` 伪类型备注 → 按上方 `sourceKind` 处理。
4. 🟡 本 spec §1.1 A14 补一句"类型 × 来源 × 目标三轴正交"。

⚠️ **平衡提示（留给 R3）**：改完后 Pyromancer 的 Molten Armor 变成"必吃反伤"，对高频低伤的英雄相对更硬。这是**规则正确性导致**的强度变化，**不应通过改回 `attack` 来修正**——只会引入 bug。若胜率矩阵显示失衡，请**改数值**（反伤系数、或加每回合反伤上限），不要动类型。这条需要用户理解并接受。

---

### 8.5 ⑤ `choose` 与 `optional` 挂起时的超时默认

> §2.1 的超时表覆盖了 MAIN / AWAIT_DECISION / FINAL_LOCKED / DEFENSIVE_ROLL / DISCARD 五个**阶段级**挂起点，确实漏了**效果序列内部**的三个挂起点（`choose` / `optional` / `promptNumber`）。补齐如下——**本表追加到 §2.1 超时体系，与 §2.1 表等价效力**（未改动 §2.1 原表）。

**§2.1 补：效果层挂起点超时表**

| 挂起点 | 超时 | 超时处理（`autoResolve`） | 理由 |
|---|---|---|---|
| `choose`（多选项） | **15s** | **取 `default` 字段声明的 option；缺省 = `options[0]`（第一个）** | 见下方 ⑤-a |
| `optional`（可执行可不执行） | **15s** | **不行使（skip 该段落）** | 见下方 ⑤-b |
| `promptNumber`（0..N 选数字） | **15s** | **0**（即不花任何代价、不取任何额外效果） | 与 `optional` 同源：不替玩家支付代价 |

#### ⑤-a `choose` 超时取哪一项

**裁定：由数据显式声明，引擎不推导。**

```ts
// §3.3 choose 原语的修订（新增 default）
type ChooseEffect = {
  t: "choose";
  options: { label: string; effects: Effect[] }[];
  who: "owner" | "target";
  default?: number;      // 🆕 超时默认 option 索引；缺省 0
};

// §3.3 optional 原语的修订（新增 defaultExercise）
type OptionalEffect = {
  t: "optional";
  steps: Effect[];
  prompt: string;
  defaultExercise?: boolean;   // 🆕 默认 false = 超时不行使
};
```

- **为什么不是"引擎自动选对己方最保守项"**：保守性需要 EV 模型，而 DSL 是纯声明式的（§3.1：数据不含控制流）。任何自动推导都会变成不可验证的启发式，且无法在 `describe()` 里向玩家解释——**宁可把责任交给内容作者**。
- **作者契约（写进 content-lint 检查项）**：`options[0]` 必须是**对做出选择的一方期望收益最低**的那一项。这样"缺省 0"和"显式声明"在一个语义上收敛：**超时方不得因超时而获益**（与 C13 的保守默认哲学一致）。
- 交接点：这个值直接就是 engineering 的 `PendingRequest.autoResolve`（其 zod `.nonoptional()` 正好把"作者忘了写"变成启动期错误，非常赞成）。

#### ⑤-b `optional` 超时是否行使

**裁定：默认不行使（skip）。**

- 红线理由：**服务端绝不替玩家支付代价**。`optional` 段落里通常含 `removeStatus`（烧掉 token）/ `loseCP` / `discard` / `dealDamage(target:self)`，超时自动行使等于替玩家花掉了资源或扣了他的血——这是所有"保守默认"里最不能被自动化的一种决策。
- 例外（需显式声明）：**纯收益且零代价**的 `optional` 段落，作者可标注 `defaultExercise: true` → 超时行使。**默认 `false`**；`content-lint` 校验：声明 `true` 的段落不得含任何代价类 effect。

#### ⑤-c 三条配套规则

1. **不挂起的情形**：若约定的选择方**被剥夺行动权**（Ultimate 锁——A15/P2；或 Stun——C2），则该挂起点**根本不开启**，直接用 `default` 静默推进。理由：Ultimate 期间对手不得介入任何决策，挂起二十秒再自动选择只是让 Ultimate 看起来"可被拖延"。
2. **累计软上限**：同一次 resolution 内所有效果层 prompt 的累计等待 ≤ **30s**，超出后剩余 prompt 立即按 `default` 放行（0 等待）。理由：防止"一个能力套三个 prompt"把 §4.4 的节奏预算（ORP+DRP ≤ 25s）拖爆。
3. **UX 强制要求**（补 §4.3）：pending 面板必须把超时默认项**预先点亮**并加角标「超时将选择此项」+ 环形倒计时。**不能让玩家事后抱怨"系统替我选了个最差的"**——事先讲清楚，这条争议就消失了。这也是我把默认值定义为"最保守"的原因：透明度 + 不获益，两者缺一都会被骂。

---

### 8.6 统一超时档位表（消解本 spec 与架构文档的差异）

这轮发现本 spec（MAIN 60s）与 architecture（单次 PendingRequest 30s）存在口径差异。为避免各自漂移，给出**单一事实来源**，请 engineering 落成 `TIMEOUT_TABLE` 常量对象：

| 档 | 适用挂起点 | 时长 | 超时处理 |
|---|---|---|---|
| **T-A** | `MAIN_1` / `MAIN_2` 阶段决策 | **60s** | 自动结束阶段 |
| **T-B** | `OFFENSIVE_ROLL` 每步 `AWAIT_DECISION` | 20s | 保持当前骰面 → 进 `FINAL_LOCKED` |
| **T-C** | `FINAL_LOCKED` | 15s | 自动 **PASS**（不激活任何能力） |
| **T-D** | `DEFENSIVE_ROLL` | 15s | 自动掷骰（C15） |
| **T-E** | `DISCARD` | 15s | 自动卖最右 N 张（不卖 0 费卡） |
| **T-F** | 响应窗口内单次决策（P4） | 15s | 自动 pass（`passStreak += 1`） |
| **T-G** | **效果层挂起**（`choose` / `optional` / `promptNumber`） | **15s**（同 resolution 累计软上限 30s） | 走 `autoResolve`（§8.5） |
| **T-H** | **兜底**：任何未列入的新挂起点 | 30s | 必须显式 `autoResolve` |
| — | 连续超时 3 次 | — | 进入 auto 模式（architecture 已定义，采纳） |
| — | 断线 | 60s | 托管 / 判负（C14 / Q5） |

两点说明：
1. **T-G 为什么是 15s 而不是 architecture 默认的 30s**：效果层挂起点发生在**一次结算的中途**，此时对手全程干等且与 T-F 同性质（都是"打断结算的决策"）。按 §4.4 节奏预算，30s 会直接撑爆预算。**建议 engineering 把 T-G 归入"15s 档"，T-H 保留 30s 兜底**——这样既不破坏其双层结构，又满足节奏（若实现成本敏感，接受先按 30s 落，`TIMEOUT_TABLE` 一处可调）。
2. ⚠️ **T-A 为什么坚持 60s**：本作的学习门槛是主要风险（R4，官方 BGG 教学性 2.3/5），Main Phase 是唯一的"planning 时刻"——要算升级差价、要看 CP、要决定卖牌。30s 对新手不够。**请主理人/用户在首轮 playtest 后确认**（Q12）。

---

### 8.7 主动补：直接解除 architecture §8.1 的两条 design 侧阻塞

> team-lead 只派了 5 条，但我在核对时发现 architecture §8.1 把 **B1 / B2 两项阻塞的责任方写给了 design**，且都是我能当场给出答案的。一并交付，省一轮往返。

#### B1「结算阶梯未对齐」→ **本条可当场关闭，不需开会**

逐条比对：本 spec §2.3 的 **P1–P8** 与 architecture §2.4.2 的阶梯**同名、同序、同为 8 步**（activate / ultimateGate / effectWalk / responseWindow / defensiveRoll / simultaneous / postThen / cleanup）。唯一分歧是 P4 的性质——**我采纳 architecture 的表述**：P4 是"窗口栈非空时引擎所处的**停留态**"，**不是**固定的第八步。这个表述更准确，且与本 spec §1.2「响应窗口 = 一个带栈的子状态」是同一个意思，只是 engineering 说得更严谨。
→ **建议主理人直接把 B1 标 completed**，无需 30 分钟对齐会。

#### B2「`onDamageDealt` 语义未钉死」→ 三个裁定

engineering 的默认是 `net > 0` + "按目标每次结算触发一次"——**方向正确**，但要拆得比这更细。本作有两套不同的东西被口语统称"造成伤害"，必须分开：

| 概念 | 定义 | 判定基准 | 谁在用 |
|---|---|---|---|
| **`hitSuccess`**（攻击命中） | 攻击流程成立并发生过 | **不受减伤/闪避影响**——哪怕被 Evasive 完全躲掉也仍为真（C7 已裁定：后置效果照常触发） | `Then` / `Additionally` 段落、`if { cond: hitSuccess }` |
| **`damageDealt`**（造成伤害） | HP 实际被这个结算扣掉了 | **`net > 0`**：= `netDefendable + undefendable + collateral`（扣 avoid、扣 prevent 后，**不扣治疗**） | `onDamageDealt` 钩子、`damageDealtAtLeast` 条件卡 |

**裁定 B2-1：判定基准 = `net > 0`（对目标），不扣治疗。**
- 采纳 engineering 的默认 `net > 0`。理由：玩家的心智模型是"我打掉了他多少血"，用 gross 会出现"日志显示 15 点但条件没触发"的认知冲突。
- **治疗不抵扣**：`damageDealt` 是"造成的伤害"，**不是"HP 变化量"**。C5 里治疗能把人从死亡线救回，但若把它算进 `damageDealt`，会出现"我明明打了 10 点却计数为 2"的荒谬结果。治疗是独立词条。

**裁定 B2-2：预防与回避都算"伤害没造成"。**
- 被 `preventDamage` 削减到 0 的部分、被 `avoidDamage` 抹除的部分，**均不计入** `damageDealt`。两者都是"这刀没真正落到身上"。
- 但若同一结算里还有活着的 `undefendable` 成分（`netDamage > 0`），则该目标**仍然触发一次**——按合计额触发，不按剩余成分单独触发。

**裁定 B2-3：按「目标 × flush」合计触发一次，不按词条分别触发。**
- 官方说"所有伤害/减伤/治疗在 Roll Phase 结束时**同时**结算"（也是 Bucket 模型的立论依据，§2.3）。既然同时，它们在语义上就是**一个事件**而非 N 个事件 → **一次 flush、每个受伤害目标触发一次**。
- 若按词条分别触发，Pyromancer 的 Combustion（`attack` + `undefendable` 两条词条）会重复触发同一个接收方钩子，Combo 直接失控。
- **金额**：`damageDealt(target) = 本次 flush 对该目标的合计 netDamage`。
- **例外（走另一条通道）**：`modify` 类钩子（`{ on:"incomingDamage"; timing:"modify" }`，即 Attack Modifier）不受"合计触发一次"约束——它作用于写入 Bucket 时对单条词条的数值修正，属于 P4 的职责，不是 P7 的触发器。

**递归防护（必须写进引擎）**：钩子触发的效果所产生的伤害，**进入下一次 flush，不得回填当前 flush**。这是防止 self-damage 触发自身钩子导致的无限递增；配合 engineering 已有的 `MAX_RESOLVE_DEPTH=64` / `MAX_FRAMES=512` 守卫即可彻底收敛。

#### R13（`postFlush` 窗口是否需要）→ **确认需要**

本 spec §2.3 P7 描述的"条件卡（如'若本回合造成 ≥8 伤害'）在此窗口可打" **确实需要** `trigger: 'postFlush'` 窗口：玩家必须**看到本次伤害结果后**才能决定这张卡值不值得打。
- 规则复用 `postDefense`：15s、双方交替、`passStreakToClose = 2`、`maxActions = 4`。
- **只在确有可打的条件卡时才开**（沿用 R7 优化：若无牌可打且无 spendable 状态 → 服务端直接跳过窗口）。这条很重要，否则每个回合末尾都会多一次无意义的等待。

---

### 8.8 本轮发现的跨文档不一致清单（按优先级处理）

| # | 冲突位置 | 现状 | 修复方向 | 严重度 |
|---|---|---|---|---|
| 1 | `hero-schema-draft.md:1094-1096` Molten Armor 反伤 | `type: "attack"` | → `type: "pure"`（§8.4） | 🔴 会导致重复触发防御掷骰 / 可被减伤 / 可被 Attack Modifier 加成三重 bug |
| 2 | `hero-schema-draft.md:138-143` vs 本 spec §1.1 A14 | schema 有 5 个伤害类型（多 `self`），spec 说 4 类 | 统一为 4 类 + `sourceKind` 正交轴（§8.4-e） | 🟠 fail-open 型不一致，会让每个 switch 长出链式特判 |
| 3 | `hero-schema-draft.md:318` vs 本 spec §3.4 | schema 已改为 `dieFaces: [DieFace×6]`，spec 仍是 `dice: [Sym×6]` | **采纳 schema 的 `DieFace` 形态**（更 expressive，天然表达多符号/Wild 面）；spec §3.4 / §3.5 标注引用更新 | 🟠 顺子/Wild 判定依赖它 |
| 4 | 本 spec §2.1 vs architecture §2.4.4 | MAIN 60s vs PendingRequest 30s | 采纳 §8.6 的 `TIMEOUT_TABLE` 作为单一来源 | 🟡 两处口径不一致，Q12 待拍板 |
| 5 | architecture `:178` / `:179` / `:885` 三处标记 | 牌库/弃牌堆标着"待 design 确认" | 见 §8.2 / §8.1，标记可删除 | 🟡 文档同步 |

### 8.9 本轮新增的待拍板项（供 §7 开放问题合并）

| # | 问题 | 影响 | 我的建议 |
|---|---|---|---|
| **Q11** | `self` / `ultimate` 两个伪伤害类型是否按期并入「4 类 + `sourceKind`」？ | 改 1 处类型定义 + 若干数据引用 | 建议合并（保持语义轴正交，防特判扩散） |
| **Q12** | `MAIN_1/MAIN_2` 超时 **60s**（本 spec）还是 **30s**（architecture 默认）？ | 新手友好 vs 节奏 | 建议 60s，首轮 playtest 后用数据复核；一处常量，试错成本极低 |
| **Q13** | 是否接受「反伤不可减伤」带来的 **Molten Armor 强度上升**？ | Pyromancer matchup 平衡（R3） | 建议接受（这是规则正确性必然结果）；若失衡，**改数值不改类型** |

---

*本节结束 · DT-DES-002 交付 · 待主理人 / 用户拍板项见 §8.9*
