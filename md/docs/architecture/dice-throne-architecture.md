# 《王权骰铸》网页对战版 — 主架构文档

> 项目代号 **DT-Web** · 桌游《王权骰铸》（Dice Throne, Roxley Games）电子化
> 版本 **v0.2**（对齐修订轮 DT-ARCH-002） · 作者：程基岩（engineering-lead）
> 状态：**PASS**（技术架构无阻塞项，可进入 M0）—— 见 §8 判定
> 　　└ 唯一遗留 BLOCKER = **B3 IP 路径**（非技术，需用户拍板；只阻塞「公开发布」，不阻塞「M0 原型 / 自用」）
> 　　└ v0.1 的两条技术阻塞 **B1 / B2 已 RESOLVED**；另有 **B5–B8** 四项需在 M1 前处置（非阻塞架构）
>
> **v0.2 变更摘要（主理人裁决 DT-ARCH-002）**
> 1. 结算阶梯由 R0–R8 重构为 **P1–P8**（1:1 对齐 design §2.3）；`finalCardWindow` 从枚举移除，改为**可重入的 `WindowStack`**。
> 2. `DamageLedger` 重构为 **`DamageBucket`**，flush 公式改为 `net = max(0, defendable − prevention) + undefendable + collateral`；`hpAfter = hp − net + healing`（上限 `startHp + 10`）。
> 3. `onDamageDealt` 触发基准钉为 **`net > 0`，按目标、每次结算触发一次**。
> 4. `EffectClause` / `Expr` / `Condition` / `DicePatternMatcher` 扩展以覆盖 design DSL（`graded` / `if` / `bind`+`var` / `rollDicePool` / `bindRemovedTo` / `avoidDamage` / `optional` / `grantExtra*`）；内容包新增 `describe(e, lang)` 强制要求。
> 5. `EffectDef.then` 更名 `EffectDef.next`（链式后续），避免与 design 的「Then = 响应窗口节点」撞名。

---

## 用户拍板决议（DT-001）

> **本节效力高于文档其余部分。** 凡与本节冲突的旧描述（尤其是散落各章的限时数值），一律以本节为准。旧数值保留在文中仅作历史演进记录。

| # | 问题 | 用户决议 | 对架构的影响 |
|---|---|---|---|
| Q1 | IP 路径 | **自用学习** | 不公开部署、不做公开匹配。数据层「零 flavor text」的隔离**继续保留**（成本已付，为将来留余地） |
| Q2/Q3 | 治疗时序 / 能否救回 | **以官方规则为准** | 维持 `simultaneous` 同时结算 + `hpAfter = hp − net + healing`（治疗可救回）。现有实现即官方规则，无需改动 |
| Q5 | 断线 / 超时处置 | **回合制，不做实时惩罚** | **取消断线判负**，对局状态保留、随时可重连。见 §2.4.5 |
| Q6 | MVP 后第一优先级 | **优先加英雄** | 内容管线（DSL→IR 编译 + content-lint）的优先级高于回放 / AI / 天梯 |
| Q12 | 操作限时 | **回合制，不加入限时** | **取消一切玩家操作倒计时**。见 §2.4.5 |
| Q13 | 反伤不可减伤 | **以官方规则为准** | 维持 `pure`：不可防御、不可被 Attack Modifier 增强、不触发新增防御掷骰。现有实现即官方规则，无需改动 |

**Q5 + Q12 的连带影响（重要）**

取消限时与断线判负后，对局可能长时间挂起，因此：

1. **持久化从 P2 提升为 P1** —— 对局必须能落盘，并在重连或进程重启后完整恢复。
2. **`autoResolve` 语义变更** —— 从「超时默认」变为「**异常兜底**」（服务重启恢复、玩家缺席判负、投降时引擎推进所需）。字段仍 zod 强制必填。
3. **挂机防护改为手动** —— 不自动判负，改由对手发起「缺席判负」或自己投降。

## 版本与术语对齐表

本文件与 `design-strategist` 产出的「能力/卡牌 DSL + 回合状态机」为**配套文档**。为避免术语漂移，先钉定下表；任何一侧改名需同步本表。

| 术语 | 英文 | 本文含义 |
|---|---|---|
| 战斗点数 | CP (Combat Points) | 资源，**起始 2，上限 15**（design 已确认） |
| 生命值 | HP / Health | **1v1 起始 50，上限 = 起始 + 10 = 60**，归零判负（design 已确认） |
| 起手牌 | Starting Hand | **4 张**；手牌上限 6，弃牌阶段卖到 ≤6（design 已确认） |
| 掷骰尝试 | Roll Attempt | 进攻掷骰阶段最多 3 次（可被状态效果修改） |
| 锁定 | Lock / Set Aside | 重掷时保留的骰子 |
| 骰型 | Dice Pattern | 5 颗骰的最终结果形态（顺子 / 同类计数 / 组合） |
| 能力 | Ability | 四类：Offensive / Defensive / Passive / Ultimate |
| 升级层级 | Tier | 能力可升级的 1 / 2 / 3 级（可跳级，已升级只补差价） |
| 状态效果 | Status Effect | 带堆叠上限（Stack Limit）的 token，可施加/转移/移除/消耗；另有 `spendable`（可主动消耗） |
| 结算阶梯 | Resolution Ladder | 一次结算内部的**固定子阶段序列 P1–P8**（见 §2.4.2） |
| 响应窗口 | Response Window | **可重入的窗口栈**（不是阶梯上的固定步骤），见 §2.4.3 |
| Then 节点 | Then Node | design 术语：效果序列中**打开一次响应窗口**的节点；IR 中 = `{ kind:'openWindowThen' }`，**不是**链式后续 |
| 伤害桶 | Damage Bucket | 伤害/减伤/治疗/闪避先累加、在 P6 一次性 flush 的中间结构（v0.1 称 Damage Ledger） |
| 行动权限令牌 | Action Permission | per-player 令牌 `'all' \| 'none'`；Ultimate / Stun 会剥夺对手行动权 |
| 挂起点 | Pending Request | 引擎需要某玩家输入时的暂停态 |
| 视图投影 | Projection | 由全量 GameState 生成的「某玩家可见状态」 |

**与 design 侧已对齐的数值常量（design §0.3 / §1.1，本轮确认）**：起始 HP **50** · 起始 CP **2** · 起手 **4** 张 · HP 上限 **60** · CP 上限 15 · Roll Attempt 3 次 · 手牌上限 6 · 牌库空则洗弃牌堆重开 · **平局可能**（同时归零）。这些必须是 `rules.constants.ts` 里的具名常量，禁止散落硬编码。

**关键约定：本文 §3 的类型定义是 design-strategist DSL 的「编译产物 / IR」。** DSL 可以提供更糖衣的作者友好语法（例如 `deal 8 undefendable then apply Wither 2`），但必须能**无损降级**到本文的 `EffectDef` IR。引擎只认 IR，不认 DSL。这条约定把「作者友好」与「引擎可序列化/无闭包」两个诉求解耦，是本文最重要的跨角色接口约束。

---

## §1 系统全景

### 1.1 分层架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│  L5  客户端渲染层  packages/web  (React + Vite, 浏览器)                    │
│      ├─ views/     对局桌面、英雄面板、骰盘、手牌、日志                    │
│      ├─ anim/      事件驱动动画队列（消费 GameEvent，不改状态）            │
│      └─ store/     只持有 PlayerView + legalActions（无游戏规则）          │
│      依赖：@dt/shared 仅用于「类型 + 投影消费 + 本地推演（离线/AI）」      │
└───────────────┬──────────────────────────────────────────────────────────┘
                │  WebSocket (Socket.IO v4)  —— 只传意图上行 / 投影下行
┌───────────────┴──────────────────────────────────────────────────────────┐
│  L4  实时通信层  packages/server/src/net                                   │
│      ├─ 连接鉴权（JWT） · 房间路由 · 心跳 · 断线重连与托管                 │
│      ├─ 上行：ClientIntent → 校验信封 → 投递到房间 Actor                   │
│      └─ 下行：per-seat 投影广播 · 事件流 · 重连补帧（snapshot + delta）     │
└───────────────┬──────────────────────────────────────────────────────────┘
┌───────────────┴──────────────────────────────────────────────────────────┐
│  L3  房间与匹配  packages/server/src/rooms, /matchmaking                   │
│      ├─ Room（lobby → heroSelect → playing → finished）                    │
│      ├─ Seat 绑定 · 英雄选择 · 先手决定 · 超时仲裁                         │
│      └─ MatchActor：单房间串行事件循环（一房间一队列，天然无并发写）        │
└───────────────┬──────────────────────────────────────────────────────────┘
┌───────────────┴──────────────────────────────────────────────────────────┐
│  L2  权威规则引擎  packages/shared/src/engine   ★ 唯一真相源 ★             │
│      ├─ reducer: (GameState, Action) → Result<GameState, GameEvent[]>     │
│      ├─ FSM: 八阶段驱动 + 结算阶梯 + 挂起/恢复                             │
│      ├─ EffectQueue / DamageBucket / WindowStack / DicePattern / Projection│
│      └─ 纯函数、零 IO、零 Math.random、零 Date.now                         │
└───────────────┬──────────────────────────────────────────────────────────┘
┌───────────────┴──────────────────────────────────────────────────────────┐
│  L1  数据层  packages/server/src/persistence + packages/shared/src/content│
│      ├─ 内容配置（英雄 / 卡牌 / 状态效果）— 编译期常量，随代码发布          │
│      ├─ 账号与身份（PostgreSQL 或 SQLite；MVP 可先内存）                    │
│      ├─ 对局记录：seed + schemaVersion + actionLog + 终局快照              │
│      └─ Redis（可选）：Socket.IO Adapter / 房间锁 / 匹配队列               │
└──────────────────────────────────────────────────────────────────────────┘
```

### 1.2 前后端职责边界（硬性）

**客户端【可以】做**

- 渲染 `PlayerView`（服务端下发的投影）与 `legalActions`（服务端算好的当前合法动作集）。
- 根据 `legalActions` **启用/禁用**按钮；本地做「显然无需往返」的 UI 预测（例如点击锁定骰子立刻在本地反色）。
- 用 `GameEvent` 流驱动动画与战斗日志。
- 用 `@dt/shared` 在**本地进程**跑一份引擎做「离线推演 / AI 搜索 / 回放播放器」——此时它是**客户端私有沙盒**，结果不得回传影响对局。

**客户端【绝对不可以】做**

| 禁止项 | 原因 |
|---|---|
| 计算伤害、血量、CP、胜负 | 唯一真相源在服务端 |
| 决定骰子点数 / 牌库顺序 | 随机源只在服务端推进 |
| 自行判断动作合法性并绕过 | 服务端 `apply` 独立返回 `RuleError`，客户端判断仅为体验 |
| 缓存/猜测对手手牌内容 | 投影中根本不存在该字段 |
| 直接写 `GameState` | 客户端没有 `GameState` 类型实例，只有 `PlayerView` |

> 控制清单：**`packages/web` 的 `import` 白名单中，`@dt/shared/engine` 只允许被 `web/src/sandbox/*`（推演/回放）引入，禁止被 `web/src/views/*` 引入**。用 ESLint `no-restricted-imports` 强制。

### 1.3 部署形态

**MVP（M0–M2）：单进程单体。**

- 一个 Node 进程同时托管静态资源（或由 CDN 分发前端产物）+ Socket.IO 服务 + 房间状态在内存。
- 房间状态在内存 → 进程重启丢局。**因取消限时与断线判负（用户拍板 Q5/Q12），对局可能长时间挂起，持久化已由 P2 提升为 P1**：JSONL 落盘必须覆盖完整 `GameState`（含 `rng.counters` / `queue.bindings`），支持进程重启后完整恢复。
- 无需 Redis、无需多实例。

**水平扩展时机（触发条件，任一满足即引入）：**

| 触发条件 | 动作 |
|---|---|
| 需要 >1 个 Node 实例（CPU 或可用区冗余） | 引入 `@socket.io/redis-adapter`，房间仍由一致性哈希固定到单实例（房间 Actor 模型不变） |
| 需要进程重启不丢局 | 引入 Redis 作为房间状态热存储（写穿），或 Postgres `match` 表 + action log |
| 匹配排队 > 单实例承载 | 匹配队列移到 Redis（ZSET by rating） |
| 需要跨区/灰度 | 引入网关层 + 房间路由表 |

**关键设计前提：房间 Actor 串行化。** 每个房间在任何时刻只由一个逻辑线程推进（`MatchActor` 内部一个 Promise 串行的命令队列）。这让「多实例」退化为「房间归属」问题，而不是分布式一致性问题。这个前提必须在 M1 就落地，否则后期无法无痛扩展。

---

## §2 规则引擎设计（核心）

### 2.1 执行范式选型

**候选方案**

| 方案 | 确定性 | 可回放 | 可测试 | 表达力 | 复杂度成本 |
|---|---|---|---|---|---|
| A. 纯 reducer + FSM（状态即真相） | ★★★ | ★★（需额外录日志） | ★★★ | ★★ | 低 |
| B. 命令模式 + 事件溯源（事件即真相） | ★★★ | ★★★ | ★★ | ★★★ | 高 |
| C. ECS | ★★ | ★ | ★★ | ★★ | 高（收益为零） |
| **D. 混合（选定）** | ★★★ | ★★★ | ★★★ | ★★★ | 中 |

**决策：D —「纯函数 Reducer（状态推进）+ FSM（阶段门控）+ 事件流（副产品/广播协议）+ EffectQueue（效果结算）」。**

具体形态：

```
GameState  ──(Action)──▶  reduce(state, action)  ──▶  { state', events[] }
                              │
                              ├─ FSM 门控：当前 phase/step 是否接受该 action
                              ├─ 合法性：同一套规则，非法 → Err(RuleError)，state 不变
                              └─ 结算：EffectQueue 驱动，可能产生 PendingRequest 挂起
```

**为什么不是纯 ECS（C）**：ECS 的价值在「大量同类实体 + 数据局部性 + 系统并行」。本作一局只有 2 个玩家、~20 张手牌、~10 个 token、5 颗骰子，实体数量级为 10¹，且回合制无帧预算压力。ECS 的全部收益为零，而「链式 then 效果」「同时结算」「需要玩家输入的中间步骤」恰恰是 ECS 最不擅长的（需要命令缓冲 + 多帧延迟 + 隐式顺序）。**排除。**

**为什么不是纯事件溯源（B）**：ES 的真相源是事件日志，状态是 `fold(events)`。它会带来三个本阶段不想要的负担：① 快照与日志压缩策略；② 投影（read model）版本迁移；③ 每个查询都要重放。而我们真正需要 ES 的是**「可回放 + 可审计 + 天然广播协议」**这三件事——这三件事用「reducer 顺带产出事件流」就能拿到，代价几乎为零。

**为什么不是纯 FSM（A）**：FSM 只能表达「阶段」，无法表达「一张卡让你重掷两颗骰然后若造成伤害则施加 2 层状态」这种效果程序。所以 FSM 只负责 **phase / step 门控**与**挂起/恢复**，效果执行交给 EffectQueue。

**这套设计保证三大性质**

1. **确定性**：`reduce` 是纯函数。禁用的东西写进控制清单：`Math.random`、`Date.now`、`new Date()`、`crypto.randomUUID`（引擎内）、任何 IO、`Object.keys` 遍历顺序依赖、浮点累加（金额/伤害一律整数）。随机性来自 `state.rng`，是 state 的一部分。
2. **可回放**：一份 `ReplayBundle = { schemaVersion, engineVersion, contentVersion, seed, setup, actions[] }` 可完整重建终局。回放不需要存事件流（事件流能从 action 重算出来）。
3. **可测试**：脚本化对局 = `runScript(seed, actions) → { events, finalState }`，直接快照测试。事件序列用语义化快照（而非 JSON 深比较），见 §7。

### 2.2 状态表示与视图投影

#### 2.2.1 全量状态 `GameState`

只存在于服务端进程内与持久化层。结构见 §3。要点：

- 所有隐藏信息（手牌内容、牌库顺序、未掷出的骰子）**物理上就在 state 里**，靠投影拦住——而不是靠「不存」。因为 reducer 必须能读到它们。
- **服务端绝不预先掷骰**。骰值在 `rollDice` action 执行的那一刻从 `state.rng` 派生并写入。这天然满足「未掷骰结果对对手隐藏」，也天然满足「不能靠改本地内存预知未来」。
- `pending` 与 `queue` 是 state 的一部分（序列化友好），这样「挂起中的对局」可以被持久化、被重连恢复、被回放。

#### 2.2.2 投影机制 `projectState(state, viewer) → PlayerView`

**决策：结构化白名单（构建独立 `PlayerView` 类型），而非黑名单 redact。**

理由：黑名单（把 state 深拷贝后 `delete obj.opponent.hand`）是 **fail-open** 的——新增一个敏感字段，忘了加进黑名单，就直接泄密，且测试不一定能抓到。白名单是 **fail-safe** 的——新增字段不会自动出现在 `PlayerView` 里，最坏结果是 UI 少显示一个信息（会被测试/E2E 立刻发现），最坏后果是「显示缺失」而不是「作弊漏洞」。**在防作弊是硬需求的场景，必须选 fail-safe。**

```ts
// 投影是显式 mapper，每个字段手工搬运；编译期保证不会带出敏感字段
export function projectState(s: GameState, viewer: Seat): PlayerView;
```

投影规则表（MVP）：

| 数据 | 自己 | 对手 | 备注 |
|---|---|---|---|
| 手牌内容 `CardInstance[]` | ✅ 全可见 | ❌ | 只见 `handCount: number` |
| 牌库顺序 | ❌ | ❌ | 只见 `deckCount: number`（自己也不该见，防止 Deck Stack 类效果被滥用）。**聚合计数例外**：自己可见 `remainingDeckCounts[{cardId,count}]` + `unknownInDeck`（design DT-DES-002 B-2 确认），由 mapper 从 `hero.deck` 常量现场算出，**不从 `state.deck` 变形** |
| 弃牌堆 | ✅ | ✅ | 桌游中公开；**需 design 确认**（见 §8 冲突项 4） |
| 当前骰值（进攻掷骰，已掷出） | ✅ | ✅ | 公开信息 |
| 未掷出的骰值 | — | — | 不存在（服务端不预掷） |
| 防守掷骰结果 | ✅ | ✅ | 公开 |
| CP / HP / 状态 token / 已升级层级 | ✅ | ✅ | 公开 |
| `pending`（需要我响应） | ✅ | 精简 | 对手只看到「对手正在决策中」；**回合制下不显示倒计时数字**（消除催促感） |
| 事件流 | 按 `visibility` 过滤 | 同 | 见 §2.3 |

**投影泄漏的自动化防线（必做，M1 前落地）**：见 §7 测试 T14——对任意 state 与 viewer，断言 `JSON.stringify(view)` 中不出现任何对手手牌 uid / 牌库 uid。这是一条**属性测试（property-based）**，比人工 review 可靠得多。

#### 2.2.3 `legalActions` 由服务端下发

`PlayerView.legalActions: Action[]` —— 服务端用引擎枚举当前玩家可执行的全部动作。

- 前端不再需要「自己算能不能打这张牌」，从而**不可能出现前端诱导出的非法操作**。
- 前端按钮禁用逻辑 = 一次 `Set` 查找。
- 天然满足「UI 不持有游戏状态」。
- 代价：每次状态变更都要重算（成本极低，动作空间 < 50）。可接受。

### 2.3 动作管线（Action Pipeline）

```
[客户端]                                                    [服务端]
 用户点击
   │
   ├─ 本地 optimistic 高亮（仅 UI，不改动任何模型）
   ▼
 emit('game:intent', { matchId, clientSeq, action })
   │
   └────────────────────────────────────────────────────────▶ ① 传输层
                                                                │ JWT 鉴权
                                                                │ zod 解析 ClientIntent
                                                                │ 丢弃 client 声明的 seat，
                                                                │   用 socket→seat 绑定覆盖
                                                                ▼
                                                              ② MatchActor 串行队列
                                                                │ 幂等：clientSeq 去重
                                                                │ 时序：seq 必须连续
                                                                ▼
                                                              ③ 授权 Authorization
                                                                │ pending?.seat === seat
                                                                │ 或 phase 的合法行动者
                                                                ▼
                                                              ④ 合法性 Legality（引擎纯函数）
                                                                │ reduce(state, action)
                                                                │   → Err(RuleError) 则 state 不变
                                                                ▼
                                                              ⑤ 推进 + 产出 events
                                                                │ 若产生 pending → 挂起 + 起定时器
                                                                │ 若 phase 自动可推进 → 自动补
                                                                │   SystemAction（内部 action，不入
                                                                │   客户端日志，但入 actionLog）
                                                                ▼
                                                              ⑥ 持久化
                                                                │ append actionLog；每 N 步写快照
                                                                ▼
                                                              ⑦ 广播
                                                                for seat of [0,1]:
                                                                  emit('game:patch', {
                                                                    view: project(state, seat),
                                                                    events: events.filter(visible(seat))
                                                                  })
```

**关键工程决策：`canDispatch` 与 `apply` 合并为单次 `reduce`，返回 `Result`。** 不要维护「一份校验逻辑 + 一份执行逻辑」——那是规则引擎最常见的 bug 温床（两者漂移）。做法：

```ts
type ReduceResult =
  | { ok: true;  state: GameState; events: GameEvent[] }
  | { ok: false; error: RuleError; events: [] };   // state 保证未被修改

export function reduce(s: GameState, a: ActionEnvelope): ReduceResult;
```

`legalActions` 枚举也复用它：对候选动作逐个克隆 state 试跑，能成功即合法。因为 state 是不可变结构 + 结构共享，试跑成本很低。**一份规则实现，三个用途（校验 / 执行 / 枚举）。**

**SystemAction**：阶段自动推进、超时托管、伤害结算触发等由引擎内部产生的动作，类型与玩家 Action 同构，标记 `{ t: 'system', ... }`。它们进入 `actionLog`（回放必需），但不广播给客户端作为「可点击动作」。

### 2.4 结算管线（Resolution Pipeline）

这是全系统最容易出 bug 的地方，必须给一个**单一、显式、可测**的落地方式。

> **本小节为 v0.2 重写。依据：主理人裁决 DT-ARCH-002 第 1 / 2 / 3 条 + design `dice-throne-design-spec.md` §2.3。** 原 R0–R8 阶梯与 10 步 `ResolutionStep` 枚举作废。

#### 2.4.1 核心结构：EffectQueue + DamageBucket + WindowStack

```ts
interface EffectQueueState {
  readonly frames: readonly EffectFrame[];   // 待执行帧（FIFO，支持 pushFront）
  readonly depth: number;                    // 递归深度，用于防死循环
  readonly framesExecuted: number;
  readonly ctx: EffectContext;               // 来源、目标、当前阶梯步骤
  readonly bindings: Readonly<Record<string, number>>;  // bind / bindRemovedTo 的变量作用域
}
interface EffectFrame { readonly def: EffectDef; readonly ctx: EffectContext }

/** design 侧称 Bucket；本文 v0.1 的 DamageLedger 的重构版（GameState.ledger → GameState.bucket） */
interface DamageBucket {
  readonly resolutionId: string;             // 本次结算 ID —— onDamageDealt 的触发单位之一
  readonly flushBatch: number;               // 第几次 flush（单次 Roll Phase 结算恒为 1）
  readonly entries: readonly BucketEntry[];  // 伤害 / 减伤条目，按 bucketKind 分桶、来源可追溯
  readonly heals: readonly HealEntry[];
  readonly avoid: readonly AvoidEntry[];     // Evasive / Shadows：清空 defendable + collateral
  readonly closed: boolean;
}
```

**铁律：伤害类 effect 不直接改 HP，只写 `DamageBucket`。HP 只在 P6（SIMULTANEOUS）被写一次。**

#### 2.4.2 结算阶梯（Resolution Ladder）— P1–P8，与 design §2.3 逐条对齐

| 步骤 | `LadderStep` | 引擎动作 | 可挂起 | 开响应窗口 |
|---|---|---|---|---|
| **P1** | `activate` | 确定 Final Dice Result → 服务端算 `ActivationCandidate[]` → 玩家单选或 **PASS** | ✅ 选能力 | ❌ |
| | | PASS → 直接跳 **P8**（不进 P5，不开窗） | | |
| **P2** | `ultimateGate` | Ultimate：push 一枚 `reason:'ultimate', releaseAt:'cleanup'` 的权限令牌到对手 `permissionTokens`（`effectivePermission() === 'none'`，其动作返回 `DENIED` + UI 灰化）；Blind 生效 → 激活失败，跳 P8 | ❌ | ❌ |
| **P3** | `effectWalk` | 按能力效果序列顺序执行：**非伤害类立即生效**；伤害 / 治疗 / 减伤**写入 bucket（不改 HP）**；**Stun 立即施加（早于伤害）**；遇 `openWindowThen` 节点 → 开窗 | ✅ `choice` / `optional` / `promptNumber` | ✅ `trigger:'then'` |
| **P4** | `responseWindow` | **窗口栈非空时引擎所处的停留态**（不是固定步骤，可重入） | ✅ | — |
| **P5** | `defensiveRoll` | 若 bucket 中存在 **defendable** 伤害 → 防守方选防御能力 → **单次、不可重掷**的掷骰 → 减伤 / 反伤 / 治疗写 bucket；**之后必再开一次窗口**（`trigger:'postDefense'`） | ✅ | ✅ `trigger:'postDefense'` |
| | | 若无 defendable 伤害（`undefendable` / `pure` / `collateral`，含 `sourceKind:'ultimate'`）→ **skip**，且 skip 时不因本步开窗 | | |
| **P6** | `simultaneous` | **flush bucket**：按 §2.4.4 公式改 HP → 死亡判定（记 pendingDefeat，不在本步终局） | ❌ | ❌ |
| **P7** | `postThen` | 执行 `additionally` 段落与延迟后置效果；触发 `onDamageDealt` / `attackResolved`；条件卡（`damageDealtAtLeast`）可打；`grantExtraOffensiveRollPhase` → **先完成本轮 P8 再回到 P1** | ✅ | ✅ `trigger:'postFlush'`（design DT-DES-002 已确认**需要**；**只在确有可打的条件卡时才开**） |
| **P8** | `cleanup` | 胜负检查（**含同时归零 → draw**）、写结构化战斗日志、销毁临时骰池、**只释放 `releaseAt==='cleanup'` 的权限令牌**（Stun 的 `turnEnd` 令牌保留）、清 `pendingAttack`、升 tier、推进阶段机 | ❌ | ❌ |

```
P1 ACTIVATE ──▶ P2 ULTIMATE GATE ──▶ P3 EFFECT WALK ──┬──▶ P4 RESPONSE WINDOW（可重入）
                                        （Then 节点）  ◀──────────┘
                                          │
                                          ▼
                                    P5 DEFENSIVE ROLL ──▶ 再开一次 P4（postDefense）
                                          │
                                          ▼
                                    P6 SIMULTANEOUS（flush bucket）
                                          │
                                          ▼
                                    P7 POST / THEN ──▶ P8 CLEANUP ──▶（Stun 额外回合：回到 P1）
```

**保留位 `targeting`**：1v1 恒为 no-op（仍产生 `phaseEntered('targeting')` 事件，便于动画与回放对齐）。`ResolutionStep` 保留该枚举位供 2v2 / 多人扩展，**现在不为它写任何逻辑（YAGNI）**。

**为什么用「阶梯」而不是「数值优先级栈」**（如万智牌 stack + priority）：

- 数值优先级（"这个效果优先级 3"）需要为每个效果分配魔法数字，新增效果时要重新排号，且「同优先级怎么办」总是要补规则。
- 本作的结算顺序**天然是阶段性的**，用阶段表达直接映射 design 的规则文本，规则改动时改的是阶梯定义而非一堆数字。
- 阶梯把「玩家何时能打牌」变成数据（`LADDER[i].opensWindow?: WindowSpec`）而不是散落各处的 if；而「窗口怎么轮转」则**下沉到 `WindowStack`**（§2.4.3），两者职责分离：阶梯管**顺序**，窗口栈管**交互**。

**`next` 链 vs `openWindowThen`（v0.2 关键区分）**

| 构造 | 语义 | 是否挂起 | 队列行为 |
|---|---|---|---|
| `EffectDef.next`（**v0.1 的 `then` 字段已更名**） | **链式后续**：紧接着父效果执行 | ❌ | pushFront |
| `{ kind:'openWindowThen' }` | design 的 **Then 节点**：先开窗，窗口关闭后执行 `steps` | ✅ | push 窗口帧 → 关闭后 pushFront(steps) |
| `{ kind:'additionally' }` | design 的 **Additionally**：主效果全部结算后（P7）执行 | ❌ | push 到 `deferredToPostThen` 队列 |

> **更名理由**：design 术语中 "Then" 专指「响应窗口节点」，与「链式后续」不是一回事。两者共用一个词必然导致内容作者配错（把该开窗的配成不开窗）。改名成本 = 一次全仓库重命名，收益 = 消除一类高频率规则 bug。

**执行器**：

```ts
function execFrame(q: EffectQueueState, frame: EffectFrame): void {
  const out = execClause(q.state, frame.def.clause, frame.ctx);   // 纯函数，返回状态变更 + 可选新 effect
  if (frame.def.next?.length) q.pushFront(frame.def.next.map(def => ({ def, ctx: frame.ctx })));
}
```

**递归防护**：`MAX_RESOLVE_DEPTH = 64`、`MAX_FRAMES_PER_RESOLUTION = 512`。超限 → 记 `engineGuardTripped` 事件 + 服务端告警 + 走安全兜底（应用已入账的伤害，忽略剩余）。**绝不静默吞掉。**

#### 2.4.3 响应窗口栈（WindowStack）—— 可重入

窗口**不在** `LadderStep` 里占独立位置；`P4 responseWindow` 只是「窗口栈非空时引擎所处的停留态」。

```ts
export type WindowTrigger =
  | 'then'          // P3 的 Then 节点
  | 'preDefense'    // P5 之前（MVP 不开，保留枚举位）
  | 'postDefense'   // P5 之后（若 P5 未 skip，必开一次）
  | 'preFlush'      // P6 之前（MVP 不开，保留枚举位）
  | 'rollPool'      // rollDicePool 的 On[symbol] 判定窗口（design C8 / A17）
  | 'postFlush';    // ✅ P7 条件卡窗口（design DT-DES-002 R13 已确认需要：
                    //    玩家要看到伤害结果才能判断条件卡值不值得打）
                    //    规则复用 postDefense（15s / passStreakToClose=2 / maxActions=4），
                    //    但**只在确有可打的条件卡时才开**（无牌可打且无 spendable → 跳过，同 §2.4.3 性能规则）

export interface ResponseWindow {
  readonly id: string;                      // 形如 'w-0007'
  readonly trigger: WindowTrigger;
  readonly openedAtStep: LadderStep;
  readonly openedAtSeq: number;             // 开启时的 state.seq
  readonly eligibleSeats: readonly Seat[];  // 受 effectivePermission() 约束：Ultimate / Stun 会被剔除
  readonly allowedActions: readonly WindowActionKind[];
  readonly order: readonly Seat[];          // 固定轮转序列：非行动方先、行动方后
  readonly cursor: number;                  // 当前响应权在 order 中的下标
  readonly passStreak: number;              // 连续 pass 计数，≥ 2 关闭
  readonly actionCount: number;             // 本窗口已打出的动作数，硬上限 4
  readonly timeoutMs: number | null;        // 回合制恒为 null（不限时）；竞技模式才启用 15000
  readonly deadlineAt: number | null;       // 回合制恒为 null；null = 未计时
}

export interface WindowStack {
  readonly stack: readonly ResponseWindow[];   // 可重入：栈顶 = 当前窗口
  readonly nextSeq: number;                    // 单调自增，用于生成 id
  readonly totalActionsThisResolution: number; // 本次结算累计窗口动作数（守卫观测用）
}

export type WindowActionKind = 'rollPhaseCard' | 'instantCard' | 'spendStatus';
```

**窗口规则（design §1.2 + 主理人裁决 1，硬编码为常量，内容不可覆盖）**

| 规则 | 值 | 说明 |
|---|---|---|
| 轮转顺序 | `[非行动方, 行动方]`（1v1 即「防守方先、进攻方后」） | **固定顺序**（不是交替计数）：响应权 = `order[cursor]`，每次响应 / pass 后 `cursor = (cursor + 1) % order.length` |
| 关闭条件 A | `passStreak >= 2` | 连续 2 次 pass 即关闭。design 定 2 而非 1 的理由：给行动方对自己刚看到的响应做反制的机会 |
| 关闭条件 B | `actionCount >= 4` | 硬上限，防无限循环。**达到上限 → 产出 `engineGuardTripped` 事件（`guardReason:'windowActionLimit'`）+ 告警 + 强制关闭；不抛异常、不判负、已完成动作保持有效** |
| 关闭条件 C | `eligibleSeats.length === 0` | 无人有资格 → **根本不开窗**（见性能规则） |
| 单次超时 | **回合制：不限时** | 等待玩家操作。仅竞技模式启用 15s → 自动 pass，`passStreak += 1`，产出 `pendingTimedOut` |
| `autoResolve` | 恒为 `passOptionId` | 窗口的超时默认永远是 pass，**不允许内容覆盖**（Ultimate 例外：对手 `eligibleSeats` 为空，行动方自己仍可在窗口内花 CP 增强） |
| 可重入 | 栈顶语义 | 窗口内打出的卡若自身含 Then 节点 → 再 push 一层；内层关闭后回到外层，**外层 `passStreak` 不重置**（防止用嵌套卡刷新 pass 计数） |

> **口径确认**：裁决原文「超出硬上限报 R3 类错误」在本架构中落地为 §8.2 **R3（规则引擎边界情况爆炸）的引擎守卫**机制 —— `engineGuardTripped` 事件 + `RuleErrorCode 'engineGuardTripped'`，附 `guardReason`。若主理人指的是别的错误类别，回话即可，改一个常量。

**性能规则（design R7 强制项）**

```ts
function shouldOpenWindow(s: GameState, spec: WindowSpec): boolean {
  const seats = spec.order.filter(seat =>
    effectivePermission(s.players[seat]) === 'all' &&
    (hasPlayableWindowCard(s, seat, spec.allowedActions) || hasSpendableStatus(s, seat))
  );
  return seats.length > 0;   // 全部无牌可打且无 spendable 状态 → 跳过窗口，不产生挂起点
}
```

- 「无牌可打」= 手牌为空 **或** 手牌中无任何一张在当前窗口合法（`timings` 匹配 + `playCondition` 满足 + CP 足够 + 有合法目标）。
- 只有一方能行动时，窗口只对该方开放，另一方视为已 pass（`passStreak` 按实际轮转累加）。
- 这条是**体验优化而非正确性要求**，但被 design 列为强制项 → 写进控制清单第 16 条，由 **T17** 断言。

#### 2.4.4 Bucket flush 公式（P6）—— 全引擎唯一允许写 HP 的地方

> **依据：主理人裁决 DT-ARCH-002 第 2 条 + design §2.3「P6 flush 公式」。**

分桶映射（编译期常量 `BUCKET_OF: Record<DamageType, BucketKind>`）。**`DamageType` 恒 4 类**（design §8.4-④-e）：

| `DamageType` | 桶 | 受 `prevention` | 受 `avoid` | 触发 P5 防御掷骰 | 可被 Attack Modifier 增强 | 算 Attack（`hitSuccess` / `damageDealtAtLeast`） |
|---|---|---|---|---|---|---|
| `attack` | `defendable` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `collateral` | `collateral` | ❌ | ✅ | ❌ | ❌ | ❌ |
| `undefendable` | `undefendable` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `pure` | `undefendable` | ❌ | ❌ | ❌ | ❌ | ❌ |

`sourceKind`（`'ability' \| 'status' \| 'ultimate' \| 'recoil'`）与 `to: TargetRef` 是**正交轴**，不参与分桶，只用于日志、UI 归因与「反伤/反噬」语义。

```ts
// 逐目标独立求值（每个 seat 各算一遍）
const defendable   = sum(entries, e => e.bucketKind === 'defendable');
const undefendable = sum(entries, e => e.bucketKind === 'undefendable');
const collateral   = sum(entries, e => e.bucketKind === 'collateral');
const prevention   = sum(entries, e => e.bucketKind === 'prevention');
const healing      = sum(heals);

const avoided = avoid.length > 0;                          // C7：只吃 defendable + collateral
const d = avoided ? 0 : defendable;
const c = avoided ? 0 : collateral;

const net    = Math.max(0, d - prevention) + undefendable + c;   // ★ 裁决公式
const hpRaw  = player.hp - net + healing;                        // 治疗可把本次致死救回来（C5）
const hpAfter = hpRaw <= 0 ? hpRaw : Math.min(player.startHp + 10, hpRaw);  // 封顶不救死亡（A2）
player.hp = hpAfter;
if (hpRaw <= 0) → 记 pendingDefeat(seat)，P8 统一裁决（可能 → draw）
```

**四条必须写进单测的边界**（design 列了三条，我补第 4 条）：

1. `avoid` + `undefendable` 同时存在 → undefendable 照常生效（C7）。
2. `healing` 让 `hpRaw > 0` 但 `hp − net <= 0` → **活**（C5）。
3. `healing` 把 HP 推过 60 → clamp 到 60，**不报错**（A2）。
4. **反伤 = `type:'pure'`**（design §8.4-④，**本轮改口径**：v0.2 一度写作 `undefendable`）。走**同一 bucket 的反向条目**（`fromSeat` = 防守方），四条子裁定：

   | 子裁定 | 内容 | 工程落地 |
   |---|---|---|
   | ④-a 分类范围 | 任何**非「当前激活的 Offensive Ability」**产生的伤害 → `pure`：① 防御反伤 ② Upkeep 扣血（Poison/Burn）③ Recoil 自我反噬 | 内容侧标 `type:'pure'`；`sourceKind` 分别为 `'ability'` / `'status'` / `'recoil'` |
   | ④-b 可防御性 | **不可防御**：不被 `preventDamage` 削减、不被 `avoidDamage` 抹除、不触发新的防御掷骰 | `BUCKET_OF.pure = 'undefendable'`，无需任何特判 |
   | ④-c 不可增强 | 双方任一 Attack Modifier 都不得作用于 `pure` | Attack Modifier 只对 `type:'attack'` 生效（`COUNTS_AS_ATTACK`） |
   | ④-d 不参与攻击语义 | **不置** `hitSuccess`、**不触发** `attackResolved`、**不可被 Attack Modifier 增强**；`onDamageDealt` 照常计入（对目标而言确实受伤，来源无关） | `COUNTS_AS_ATTACK.pure === false` |
   | ④-e `damageDealtAtLeast` 按来源细分 | **防御反伤（`sourceKind:'ability'`，`target`=攻击者）计入**；**自我反噬（`sourceKind:'recoil'`，`target`=self）不计入** | 见下方 `countsAsDamageDealt()` |

   **⑤ 为什么必须是 `pure` 而不是 `collateral` —— 引擎收敛性（硬理由）**：若反伤可被防御，就会存在 `攻击 → 防御 → 反伤 → 对方再防御 → 再反伤 → …` 的链条。`pure` 落入 `undefendable` 桶 ⇒ **一次 Roll Phase 结算内防御掷骰恒 ≤ 1 次**，防御链**一步收敛**。这不是平衡取舍，是**终止性证明**。而 `collateral` 会被 `avoidDamage` 抹除 —— 那等于给反伤发了「可防御」资格，破坏该证明。

   双方同时归零 → `winner === 'draw'`。

**「造成的伤害」判定规则**（`damageDealtAtLeast` 条件卡与 `turnDamageDealt` 统计的依据）

由**正交轴**决定，与 `DamageType` 无关：

```ts
function countsAsDamageDealt(e: BucketEntry): boolean {
  return e.toSeat !== e.fromSeat          // target !== self
      && e.sourceKind !== 'recoil';        // 自我反噬不算「造成」
}
```

- `turnDamageDealt[seat]` **按 `turnIndex` 重置** —— 防止防守方在**对手回合**造成的反伤，泄漏到他自己回合的条件卡判定。
- 由此：**防御反伤计入** `damageDealtAtLeast`（`target` = 攻击者 ≠ self，`sourceKind` = `'ability'`）；**自我反噬不计入**（`barb:reckless`）。

**`onDamageDealt` 触发基准（主理人裁决 3 + design DT-DES-002 §8 B2 三子裁定）**

- **判定基准 = `net > 0`**，其中 `net = netDefendable + undefendable + collateral`（已扣 avoid / prevent）。**不扣治疗** —— `damageDealt` 是「造成的伤害」，不是「HP 变化量」。
- prevent 与 avoid 都算「没造成」；但**同一次结算里若仍有 undefendable / pure 存活导致 `net > 0`，则仍触发一次**。
- **触发单位 =（目标 seat × flush）合计触发一次**，**不按词条分别触发** —— 否则 Combustion 的 `attack` + `undefendable` 双词条会重复触发钩子。这是「同时结算」语义的必然推论（与我的 `resolutionId`+seat+`flushBatch` 三元组模型一致）。
- `pure` 伤害**正常计入** `onDamageDealt`（④-d：对目标而言确实受伤，来源无关），但**不计入** `hitSuccess` / `damageDealtAtLeast`。
- **钩子产生的伤害进入「下一次」flush，不得回填当前 flush** ← 这条是本轮新增的收敛约束。配合 `MAX_RESOLVE_DEPTH=64` / `MAX_FRAMES_PER_RESOLUTION=512`，递归彻底有界。
- 实现：P6 flush 时按目标产出 `DamageAppliedPayload { targetSeat, net, gross, prevented, avoided, hpAfter, sourceKind, resolutionId, flushBatch }`；P7 遍历已注册的 `onDamageDealt` 触发器，按 `net > 0` 过滤后入队，**入队的伤害写入一个新的 `flushBatch`**。

#### 2.4.5 挂起与恢复（需要玩家输入时）

触发场景：**响应窗口**（§2.4.3）、Then 节点后的窗口、防御掷骰（自动掷但保留 spendable 状态的选择窗口）、多选项效果（"选择一张牌" / "支付 3 CP 吗"）、`optional` / `promptNumber`（"移除至多 4 枚"）、弃牌阶段选牌、Upkeep 多效果排序。

```
reduce 执行中遇到需要输入的 effect
   │
   ├─ 序列化当前 EffectQueueState 到 state.queue
   ├─ 构造 PendingRequest {
   │     id, seat, kind, options: ChoiceOption[],
   │     deadlineAt (服务端绝对时间),
   │     autoResolve: ChoiceOptionId   // 超时的默认选择，必须显式指定，不允许 null
   │     legalActions: Action[]
   │   }
   ├─ state.phaseStep = 'awaitInput'
   └─ return { state, events: [PendingRequested] }
```

恢复：`reduce(state, { t:'chooseOption', optionId })` → 从 `state.queue` 还原队列、注入选择、继续 `runQueue()`。

**硬性约束（这是 EffectQueue 可序列化的前提，也是「数据驱动」的前提）**：

> `EffectDef` 中**禁止出现函数、闭包、正则对象、class 实例、Symbol**。所有可变量必须是 `TargetRef` / `Expr` / 纯数据。内容包若违反，启动期 `validateContent()` 直接失败。
> 引擎内所有「规则函数」通过**注册表**查找：`EFFECT_HANDLERS: Record<ClauseKind, Handler>`。数据只存 `kind`，执行时查表。

**超时与自动结算策略**

**单一来源：design §8.6 的 `TIMEOUT_TABLE`（T-A ~ T-H）。** 落成一个常量对象，禁止散落硬编码：

> **⚠️ 本节已按用户拍板 Q5 / Q12 重写（回合制，取消玩家操作限时）。** 文中的旧限时数值仅作演进记录，以本节为准。

```ts
/**
 * 回合制模式（用户拍板 Q12）：玩家操作一律不限时。
 * 下列常量仅用于「异常兜底」与挂机处置，不驱动任何自动结算。
 */
export const TURN_BASED = true as const;

export const GRACE = {
  /** 对手发起「缺席判负」的最短等待：对方离线且 5 分钟无任何操作 */
  G_A_ABSENT_CLAIM:   300_000,
  /** 断线重连：无宽限、不判负。对局状态持久化保留，随时可重连 */
  G_B_RECONNECT:      null,
  /** 7 天无任何操作 → 对局归档（记未完成，不判负） */
  G_C_IDLE_ARCHIVE:   7 * 86_400_000,
} as const;

/** 竞技模式（未来可选）：仅当 TURN_BASED === false 时启用，结构已预留 */
export const COMPETITIVE_TIMERS = {
  T_A_MAIN_PHASE:      60_000,
  T_B_RESPONSE_WINDOW: 15_000,
  T_C_EFFECT_PROMPT:   15_000,
  T_D_DEFENSIVE_ROLL:  15_000,
  T_E_DISCARD:         15_000,
  T_F_ROLL_DECISION:   20_000,
  T_G_FINAL_LOCKED:    15_000,
} as const;
```

| 场景 | 行为 |
|---|---|
| 玩家决策（任何 `PendingRequest`） | **无倒计时**。等待玩家操作；UI 显示「对手思考中」，**不显示倒计时数字**（消除催促感） |
| 断线 | **不判负**。对局状态持久化保留；重连后补发完整快照 + 缺失日志，继续对局 |
| 挂机 / 长时间无响应 | 对手可在对方**离线且 ≥5 分钟无操作**后**手动发起「缺席判负」**；或自己**投降**退出。**均非自动触发** |
| 全局对局 | 无强制结算。7 天无操作 → 归档（记未完成，非判负） |
| `autoResolve` | **异常兜底默认值**：仅在进程重启恢复、缺席判负、投降等异常路径上被使用。**仍 zod 强制必填** |

**为什么取消限时后仍保留 `autoResolve`**：引擎在异常路径（服务重启恢复对局、玩家被判缺席、投降）上仍可能需要在无人输入时推进状态机。保留该字段并把「忘了定义兜底」变成启动期错误，成本极低，收益是消除一类死锁。

**各挂起点的 `default`（design DT-DES-002 §8 裁定）**

| clause | 默认 | 契约 |
|---|---|---|
| `choose` | `default ?? 0` | **作者契约：期望收益最低项必须写在 `options[0]`**。直接对接 `PendingRequest.autoResolve` |
| `optional` | **一律不行使（skip）** | 例外需显式 `defaultExercise: true`，且 **content-lint 禁止该段落含任何代价类 effect**（否则超时会白嫖玩家资源） |
| `promptNumber` | `0` | 「移除至多 N」→ 默认一个都不移除 |
| `promptTarget` | `legal[0]` | |

**挂起点开启的前置条件**：选择方被 Ultimate 锁（`effectivePermission() === 'none'`）或处于 Stun 时，**挂起点根本不开启**，直接走 `default` —— 不弹 UI、不启动计时器。

**架构要求：PendingRequest 的 schema 强制 `autoResolve` 必填（zod `.nonoptional()`），把「忘了定义超时行为」从运行期 bug 变成编译期/启动期错误。**

### 2.5 骰子与随机性

#### 2.5.1 掷骰子状态机（Offensive Roll Sub-Machine）

> **依据：design §2.2 + 主理人裁决 DT-ARCH-002「还需补充」第 1 条。** v0.1 本节只写了随机源，缺状态机；此处补全。

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

| 元素 | 规则 | 落点 |
|---|---|---|
| `rollAttemptsLeft` | **初始 3**，每次 `ROLL` −1；为 0 时不能再掷（但**仍可打骰子操作卡**） | `PlayerState.rollAttemptsLeft`（v0.2 收敛为单一字段，废弃 `DiceState.attemptsUsed/attemptsMax` 双字段） |
| 锁定 / 解锁 | **任意时刻**可切换任意骰子；`ROLL` **只重掷未锁定的骰** | `DiceState.locked` |
| **全锁** | **允许**（等价提前结束掷骰）；UI 提示「全部锁定 = 确定结果」 | 不额外置状态，直接可 `CONFIRM` |
| **骰子操作卡不消耗 Roll Attempt** | `setDieFace` / `rerollDice` 改的是当前骰池，**不递减 `rollAttemptsLeft`**；改完后若 `rollAttemptsLeft > 0` 仍可正常掷 | handler 内**显式不触碰**该计数器 —— 写进控制清单第 17 条 |
| 临时骰池（`rollDicePool`） | "Roll N" 产生的骰子**独立**（A17），判定后**销毁**；只能在自身的 `trigger:'rollPool'` 窗口内被 Roll Phase Action 卡修改（C8） | `GameState.tempPools` |
| 防御掷骰 | **独立一次性**：`defenseRollGranted` 单次布尔；掷 N 颗（N 由防御能力定）；**不可重掷**（UI 隐藏「重掷」）；**但可被 Roll Phase Action 卡修改结果**（官方允许） | `PlayerState.defenseRollGranted` |
| 超时 | `AWAIT_DECISION` **20s** → **保持当前骰面**进 `FINAL_LOCKED`；`FINAL_LOCKED` **15s** → **自动 PASS** | 见 §2.4.5 表 |

> **保守默认刻意选「不掷了」而不是「自动再掷一次」**（design §2.2 原注）：自动再掷会改变玩家的期望收益，属于服务端替玩家做不可逆的随机决策，争议最大。**架构侧不做任何「智能补掷」。**

**Roll Phase Action Card 的四个可打时机（主理人裁决 3 → 落成常量 `ROLL_PHASE_CARD_TIMINGS`）**

| # | 时机 | 触发点 | `PlayTiming` 值 | 是否开窗 |
|---|---|---|---|---|
| ① | 每次 `ROLL` 之前的 `AWAIT_DECISION` | 骰盘决策态 | `'preRoll'` | ❌ 直接打（不挂起、不产生 PendingRequest） |
| ② | `FINAL_LOCKED` 之后、**确认激活之前** | 候选能力区 | `'postFinalLocked'` | ❌ 直接打 |
| ③ | 能力效果序列中的 **Then 节点** | P3 遇到 `openWindowThen` | `'responseWindow'`（trigger `'then'`） | ✅ |
| ④ | **防御掷骰前后** | P5 前 / P5 后 | `'responseWindow'`（trigger `'preDefense'` / `'postDefense'`） | ✅（**MVP 只开 `postDefense`**；`preDefense` 保留枚举位不实现） |

> **Instant Action Card MVP 不支持真打断**（design C12 / Q9，主理人已采纳该裁决）：Instant 卡**只能在响应窗口内打出**，与 Roll Phase Action **同窗口**。`CardDef.actionTiming:'instant'` 仅作为扩展保留字段，**MVP 的合法性门控一律走 `timings` 中的 `'responseWindow'`**。
> 真打断（design E4 的 `Effect.interruptibleAt` 断点标记）**永不实现** —— 复杂度/收益比极差，且 design 自己也不建议。**写进控制清单，防止后期有人提议。**

#### 2.5.2 随机源

```ts
export interface RngState {
  readonly seed: string;                              // 服务端生成，hex/base36
  readonly counters: Readonly<Record<string, number>>; // 命名流各自独立计数
}
```

**命名流（named streams）**：`setup`、`shuffle:0`、`shuffle:1`、`dice:0`、`dice:1`、`misc`。

为什么分流而不是一个全局流：① 回放时若某条流被多消耗一次（例如新增了一次洗牌），只有该流错位，其他流结果仍可比对，便于定位回归；② 防止「掷骰消耗」影响「牌库顺序」这类隐式耦合；③ 便于写「只固定骰子、牌库随机」的测试。

**算法：sfc32**（4×32bit 状态，纯 32 位整数运算，无 BigInt，质量足够，跨端/跨引擎结果一致）。

```ts
function nextU32(stream: string, s: RngState): [value: number, next: RngState]
```
实现要点：流状态由 `hash(seed, stream, counter)` 派生（用 splitmix32 做 seed 扩散），每次调用 counter+1。**不缓存 PRNG 对象**（不可序列化），每调用重新派生。5 颗骰 × 3 次 × 100 回合 = 1500 次调用，派生开销可忽略。

> 不引入 npm PRNG 包：前后端与未来（可能的）Go/Python 重放服务必须逐位一致，自带 30 行实现最稳。写进控制清单。

**防预知**：种子只在服务端生成并写入 state；**任何下发给客户端的结构中不得出现 `rng`（`PlayerView` 白名单天然排除）**。客户端的「AI 推演/概率提示」必须使用自己的本地 PRNG，与服务端无关。

**洗牌**：Fisher–Yates，从后往前，用 `shuffle:<seat>` 流。牌库抽空 → 弃牌堆重新洗入（消耗同一流的下一批数），并产出 `DeckReshuffled` 事件（公开，因为弃牌堆公开）。公平性：不引入「真随机」以避免破坏可回放。

#### 2.5.3 骰型匹配器求值

```ts
export function matchPattern(p: DicePatternMatcher, dice: readonly DiceFace[]): boolean;
```

实现：递归下降 + 一次预处理。预处理阶段把 5 颗骰算成 `Tally { bySymbol: Record, byValue: Record, values: number[] }`，然后每个 matcher 在 Tally 上 O(1)~O(6) 求值。**返回值是 `MatchResult { matched, matchedDiceIndices, tier? }`** —— `matchedDiceIndices` 直接驱动 UI 高亮（design §1.3），`tier` 是 `graded` 命中的档位索引。

- `countSymbol(symbol, n)`：Wild 面需要展开。策略：**先做「非 Wild 精确匹配」，再对 Wild 做组合补全**。因为 Wild 面可能同时是多种符号，纯计数会漏解。实现为「枚举 Wild 的符号取值组合（≤ 6^wildCount，实际 wildCount ≤ 2，成本可忽略）」，任一组合满足即 true。
- `countFace(face, n)`：按**点数**而非符号（官方 3-of-a-kind 定义是同点数）。这是 v0.2 补的，v0.1 缺失 → 会直接导致 Pyromancer Ultimate（`countFace(6,5)`）无法表达。
- `atLeast(of)`：向上兼容（3+ 表示 3/4/5 都满足）。实现为 `matchPattern(of)` 的一次「阈值下沉」求值，等价于把内部 matcher 的 `count` 依次降为 `n+1..5`。
- `graded(symbol, tiers, pick:'highest')`：**分档匹配器**（Fireball / Patience）。按 `tiers[].min` 降序找第一个满足的档，返回 `tier` 索引；**由 P1 ACTIVATE 用 `tier` 取出 `tiers[tier].effects` 入队**。详见 §3.3 的「graded 与 sequence / choice 的关系」。
- `smallStraight` / `largeStraight`：**三条现在就该硬编码**（design DT-DES-002 §8 B-3，与 Wild 无关）：
  1. **顺子不环绕**：`6-1-2-3-4` **不算**顺子。
  2. **面值先去重**，再取最长连续段（`[1,2,3,4,4]` → 去重 `{1,2,3,4}` → 命中 4 连）。
  3. **大顺蕴含小顺**：`[1,2,3,4,5]` 同时满足 `largeStraight` 与 `smallStraight`，两者**都进 `ActivationCandidate[]`**，靠强制单选收敛，**不必做互斥特判**。
- **Wild：MVP 4 英雄确认无 Wild 面** → 走 fast path，`matchPattern` 现在**不实现** Wild 枚举。但按 design 预留数据结构（见 §3.5 `HeroDef`）：`dieFaces: readonly [DieFace,...]`（每面 `{ value, symbols[] }`，`symbols.length > 1` 即 Wild）+ `wildFaces?` + `wildPolicy?`。将来实现时 `MatchResult.wildAssigned` 记录每颗 Wild 的取值并复用 MatcherTrace 通路喂 UI —— **现在只留字段，不写逻辑（YAGNI）**。
- `const(true/false)`：恒真 / 恒假，用于被动、防御能力与无骰型条件的卡牌。

**启动期内容自检（非常重要）**：对每个英雄，用蒙特卡洛（固定种子，采样 200k 次 5 骰结果）验证：

1. 每个 ability tier 的 `activation` **可达**（命中率 > 0）。配错符号 = 永远触发不了，人工 review 极难发现。
2. 每个 ability 的命中率落在合理区间（记录到 `content-report.json`，作为平衡性参考，超阈值告警而非报错）。
3. 同一英雄内不存在两个 ability tier 的激活条件完全等价（那是设计冗余）。
4. 🆕 `graded` 的**每一档都可独立命中**（否则该档是死配置）；`tiers` 的 `min` 必须严格递增，`pick:'highest'` 必须存在。
5. 🆕 `rollDicePool.cases` 中同一 `on` 符号不得重复（design A16：每个 case 只结算一次）。

### 2.6 数据驱动：内容配置加载与校验

**内容即代码**：`packages/shared/src/content/**` 是 TypeScript 模块（不是 JSON），好处是：① 类型检查；② 可用常量与辅助函数复用；③ tree-shaking。缺点是改内容要重新构建——MVP 完全可接受（内容变更频率远低于代码）。

**三层校验**

| 层 | 时机 | 内容 |
|---|---|---|
| L1 类型检查 | `tsc` | 结构合法（Tier 是 1/2/3、cost 是 number） |
| L2 Schema 校验 | `zod` parse，模块加载时 | 引用完整性、枚举合法 |
| L3 语义自检 | `validateContent()`，CI + 服务启动 + 单测 | 见下 |

**L3 语义自检清单（`tools/content-lint.ts`）**

1. 每个英雄骰池恰好 6 个面 × 5 颗骰（每颗骰同一套面）。
2. 每个 `AbilityDef.activation` 在该英雄骰池下**可达**（蒙特卡洛，见 §2.5.2）。
3. 升级树：同一 `abilityId` 的 tier 1/2/3 都存在；`cpCost` 严格单调递增（保证「补差价」非负）。
4. `CardDef.defId` 引用存在；`upgrade` 卡的 `targetAbilityId` 属于同一英雄。
5. 所有引用的 `StatusEffectId` 已在 `statuses.ts` 注册。
6. 所有 `EffectClause.kind` 都在 `EFFECT_HANDLERS` 注册表中（**防止配了引擎不认识的效果**）。
7. 卡池构成：每英雄卡组张数、升级卡/行动卡比例符合配置期望（数值由 design 提供）。
8. `EffectDef` 深遍历不含函数/闭包（可序列化断言）。
9. 所有 `ChoiceOption` 都有非空 `autoResolve` 指向已声明的 option。
10. 文案字段（name/description）不得为空，且长度上限（防 UI 溢出）。
11. 🆕 **每个 `EffectClause.kind` 都在 `DESCRIBERS` 注册表中**（见下方 §2.6.1）。缺少 describer = 玩家看到 JSON。
12. 🆕 **每个 `CardDef` / `StatusDef` / `AbilityTier` 都能生成非空描述文本**：`describe(e,'zh')` 对所有 effect 递归求值后，拼接结果非空、不含 `undefined`/`[object Object]`。
13. 🆕 **所有 `Expr` 引用的 `var` 名字都能被某个 `bind` / `bindRemovedTo` / `promptNumber` 覆盖**（悬空变量 → 启动期失败，而不是运行期变 `NaN`）。
14. 🆕 **`rollDicePool.cases` 的 `on` 符号去重**（重复 → 报错，不允许引擎运行期静默去重）。
15. 🆕 **`DamageType` 只允许 4 类**：出现 `'self'` / `'ultimate'` 等伪类型 → 报错（改 `sourceKind` / `target`）。防伪类型回潮导致每个 switch 长特判。
16. 🆕 **牌库守恒断言**：`Σ(remainingDeckCounts[].count) + unknownInDeck === deckCount`，且 `deckCount + hand.length + discard.length + upgrades.length === 初始卡组数`。属性测试 + 每帧断言。
17. 🆕 **`optional` 的 `defaultExercise: true` 时，该段落内禁止出现任何代价类 effect**（`loseCp` / `discard` / `spendStatus` / `removeStatus`）→ 否则超时默认会白嫖玩家资源。
18. 🆕 **`choose` 的 `options[0]` 必须是期望收益最低项**（作者契约，无法机械校验 → 进 code review checklist；`describe` 输出中标注 `[default]` 便于人工核对）。
19. 🆕 **`type:'pure'` 的条目不得出现在 `hitSuccess` / `attackResolved` 的判定链上**（静态可达性检查）。**注意 `damageDealtAtLeast` 不在此列** —— 它由 `sourceKind` 而非 `DamageType` 决定（防御反伤计入、自我反噬不计入），见 §2.4.4。
20. 🆕 **`sourceKind === 'recoil'` 时 `target` 必须是 `self`**，否则告警。背景：`barb:reckless` 的自我反噬曾写作 `type:'undefendable'`，而 `undefendable` 语义含「可被 Attack Modifier 增强」，导致反噬被误加成（L1 反噬 4 变 6）。正确写法为 `type:'pure', sourceKind:'recoil', target:{kind:'self'}`。

CI 中 `content-lint` 为 **required check**；服务端启动时若 `NODE_ENV !== 'test'` 也跑一次，失败则拒绝启动（fail-fast，避免带着坏内容上线）。

#### 2.6.1 `describe(e, lang)` —— 内容包的强制描述层（design E6 / 附录 A 第 7 条）

**工程要求（design 侧强制）**：内容包必须提供模板化描述函数，否则玩家看到的是结构化数据而不是句子，战斗日志与 UI 都依赖它。

```ts
// packages/shared/src/content/describe.ts
export type Lang = 'zh' | 'en';
export type Describer = (clause: EffectClause, lang: Lang, ctx: DescribeCtx) => string;
export const DESCRIBERS: Record<ClauseKind, Describer>;

export function describeEffect(e: EffectDef, lang: Lang, ctx?: DescribeCtx): string;  // 递归，含 next / steps
export function describeCondition(c: Condition, lang: Lang): string;
export function describeMatcher(m: DicePatternMatcher, lang: Lang): string;
```

**关键约束：函数住在注册表里，不住在 `EffectDef` 里。** `EffectDef` 仍然只能是纯数据（控制清单第 2 条不可破）；`describe` 通过 `kind` 查 `DESCRIBERS` 表，与 `EFFECT_HANDLERS` 完全同构。**新增一个 clause kind = 加一个 handler + 加一个 describer**，缺任一 → `content-lint` 第 6 / 第 11 项失败。

- 兜底：`CardDef.ruleText` / `StatusDef.ruleText`（design 提供）优先于自动生成；自动生成用于 `describe` 的**递归子片段**与「为什么我不能激活」解释。
- 描述必须**可本地化**：`DESCRIBERS` 按 `lang` 分支，文案表独立于数据文件，便于「重皮主题化」时整体替换。
- 战斗日志走同一套：`GameEvent` 的 `log` 字段由 `describe` + 事件载荷生成（见 §3.8 `logText`）。

### 2.7 DSL → IR 的一次性编译（降级规则）

> 本节被 §9 裁决 ⑤、B6、R14、T35 引用。**DSL 是作者层（design `hero-schema-draft.md` §1），IR 是引擎层（本文 §3.3）；引擎只认 IR。**

**编译时机：加载期**。随 `ContentRegistry` 初始化一次性编译并缓存（成本 < 10ms/英雄），失败 → **启动期拒绝启动**，而不是对局中途崩。产物进 `__ir_snapshots__/` 并由 CI 快照测试守护（T35）。

**两条硬约束**

1. **DSL 的 `then` 只能编译到 `{kind:'openWindowThen'}`，禁止编译到 `EffectDef.next`。** lint 断言；违反即构建失败。
2. **降级必须保语义且可 diff。** 禁止编译期静默改变语义（例如把「取最高档」悄悄展开成 if 链）。IR 产物入版本库，任何编译器改动在 PR 里暴露为 diff，design + 工程双方评审。

**降级规则表**

| DSL 构造（design §1.6 / §1.2） | IR 表达 | 语义保全要点 |
|---|---|---|
| `dealDamage{amount,type,target}` | `{kind:'dealDamage', amount, damageType, to, sourceKind?}` | `type` → `DamageType`（**恒 4 类**）；`pure` 由 `BUCKET_OF` 映射进 `undefendable` 桶。**DSL 若出现 `type:"self"` / `"ultimate"` → 编译报错**（lint 15），改为 `sourceKind:'recoil'`/`'ultimate'` + `target:{kind:"self"}` |
| `heal` | `{kind:'heal', to}` | 走 `bucket.heals`，P6 与伤害净额（C4/C5） |
| `preventDamage` | `{kind:'preventDamage'}` | 只吃 `defendable` |
| `avoidDamage` | `{kind:'avoidDamage'}` | 清 `defendable` + `collateral`；**不清 `undefendable`（C7）**、**不清 `hitSuccess`** |
| `gainCP` / `loseCP` / `draw` / `discard` | 同名 kind | `discard.mode:'random'\|'choice'` |
| `inflictStatus` | 同名 | 已满 → `statusApplied(ok:false)`；**不消耗代价、不触发后置，但计入日志**（C11） |
| `removeStatus{status:'any'}` | `{kind:'removeStatus', statusId:'any'}` | 选择权归**发起方**（C10） |
| `removeStatus.bindRemovedTo` | → `queue.bindings[name]` | **必须写入实际移除数**（受 stackLimit / 玩家选择影响）。Combustion 的伤害依赖它 |
| `removeStatus.stacks:{choose 0..4}` | **拆成两条**：`promptNumber{bindTo:'n'}` → `removeStatus{stacks:{e:'var',name:'n'}}` | 挂起点，`autoResolve` 必填（默认 0） |
| `transferStatus` | 同名 | 目标满 → **回滚**，token 留在原持有者（C9） |
| `increaseStackLimit` | 同名 → `player.stackLimitBonus` | per-player，持续整局 |
| `rollDice{count,diceSet,cases}` | `{kind:'rollDicePool', count, diceSet, cases, bindSumTo?}` | **cases 按 `on` 去重**（content-lint 14）；每个 case 只结算一次（A16）；骰池进 `state.rollPool`，开 `trigger:'rollPool'` 窗口，判定后销毁（C8/A17） |
| `setDieFace` / `rerollDice` | 同名 | **不消耗 Roll Attempt** |
| `grantExtraRollAttempt` | 同名 | `player.rollAttemptsLeft += n` |
| `grantExtraOffensiveRollPhase` | 同名 | **C3：先完整 flush 当前 bucket（含死亡判定），再开新一轮 P1**；对手已被打死则不触发 |
| `sequence` | `{kind:'sequence'}` | pushBack |
| **`then`** | **`{kind:'openWindowThen'}`** | **硬约束①**；开窗 + 挂起，关闭后跑 `steps` |
| `additionally` | `{kind:'additionally'}` | 延迟到 P7 |
| `if{cond,then,else}` | `{kind:'if', cond, then, else}` | `Condition` 逐条 IR 化 |
| `choose{who,options}` | `{kind:'choice', who, options}` | 挂起点 |
| `optional{prompt,steps}` | `{kind:'optional'}` | 挂起点，`autoResolve` = **不执行** |
| `repeat{times}` | `{kind:'repeat'}` | `times` 为 `Expr` |
| `bind{name,value}` | `{kind:'bind'}` → `queue.bindings[name]` | 悬空 `var` → lint 第 13 项失败 |
| `skipPhase` / `log` | 同名 | |
| **`graded(symbol,tiers,pick:'highest')`** | **matcher 层** `{kind:'graded'}`，**不进 EffectClause** | P1 求值产出 `tier`，引擎取 `tiers[tier].effects` 入队。理由见 §3.3.1 |
| `atLeast(of)` / `countFace(face,n)` | matcher 同名 | `countFace` 按**点数**不是符号 |
| `allOf` / `anyOf` / `not` / `const` | matcher 同名 | |
| `NumExpr v:'var'` | `Expr {e:'var', name}` | 悬空 → lint 失败 |
| `NumExpr v:'statusStacks'｜'countSymbol'｜'sumFaces'｜'cp'｜'hp'｜'handSize'` | 同名 `Expr` | `dice:'final'｜'lastRoll'` → `DiceScope` |
| `NumExpr add/sub/mul/min/max` | 同名 `Expr` | 全整数 |
| `Condition c: 各项` | 同名 `Condition` | `hitSuccess` 保留「命中即置位」语义，与 `onDamageDealt` 分离 |
| `StatusHook on:'incomingDamage'` | `StatusHook` 同名 | `timing:'avoid'｜'prevent'｜'modify'` 分别写 `bucket.avoid` / `prevention` / `defendable` |
| `CardDef.actionTiming:'instant'` | `CardKind:'instantAction'` | **MVP 只在响应窗口内可打，不支持真打断**（C12/Q9） |

---

## §3 数据模型（TypeScript 类型草案）

> 约定：全部 `readonly`；不可变更新；联合类型以 `t` 或 `kind` 作判别式；无 `any`、无非空断言。
> 编译配置：`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`。

### 3.1 基础与随机

```ts
// packages/shared/src/types/base.ts
export type Seat = 0 | 1;
export type EntityId = string;                 // 局内实例 ID（卡实例、token 实例）
export type HeroId = string;                   // 'barbarian' | 'moon-elf' | 'ninja' | 'pyromancer'
export type AbilityId = string;
export type CardDefId = string;
export type StatusEffectId = string;

export interface RngState {
  readonly seed: string;
  readonly counters: Readonly<Record<string, number>>;
}
```

### 3.2 骰子与骰型

```ts
export interface DiceFace {
  readonly value: 1 | 2 | 3 | 4 | 5 | 6;       // 顺子判定用
  readonly symbols: readonly DiceSymbolId[];   // 通常 1 个；Wild 面可声明多个
}
export type DiceSymbolId = string;             // 机制化命名，如 'axe' 'heart'（非官方卡面文本）

export interface DiceSymbolPool {
  readonly faces: readonly [DiceFace, DiceFace, DiceFace, DiceFace, DiceFace, DiceFace];
}

/** 🔄 v0.2：`attemptsUsed` / `attemptsMax` 收敛到 `PlayerState.rollAttemptsLeft`（单一真相源） */
export interface DiceState {
  readonly values: readonly DiceValue[];   // 每颗骰当前面；长度 = 5
  readonly locked: readonly boolean[];     // 与 values 等长；**任意时刻可切换**
  readonly ownerSeat: Seat;
  /** 🆕 掷骰子状态机当前态（§2.5.1）—— 服务端权威，客户端只是渲染 */
  readonly subState: 'idle' | 'rolling' | 'awaitDecision' | 'finalLocked' | 'abilityChosen';
}

/** design 侧 DiceMatcher 的 IR 化（1:1 对齐 design `hero-schema-draft.md` §1.2） */
export type DicePatternMatcher =
  | { kind: 'countSymbol'; symbol: DiceSymbolId; count: number }           // N 个同类【符号】
  | { kind: 'countFace';   face: DiceValue; count: number }                // 🆕 N 个同【点数】（官方 3/4/5-of-a-kind 按点数）
  | { kind: 'atLeast';     of: DicePatternMatcher }                        // 🆕 向上兼容（3+ → 3/4/5 都算）
  | { kind: 'smallStraight' }                                              // 4 连号
  | { kind: 'largeStraight' }                                              // 5 连号
  | { kind: 'graded';      symbol: DiceSymbolId;                           // 🆕 分档：3个→X / 4个→Y / 5个→Z
                           tiers: readonly { min: number; effects: readonly EffectDef[] }[];
                           pick: 'highest' }                               //    取满足的最高档（Fireball / Patience）
  | { kind: 'allOf';       of: readonly DicePatternMatcher[] }             // 组合（Combustion：四符号各一）
  | { kind: 'anyOf';       of: readonly DicePatternMatcher[] }
  | { kind: 'not';         of: DicePatternMatcher }
  | { kind: 'allSame';     symbol?: DiceSymbolId }                         // 保留（v0.1 遗留糖衣）
  | { kind: 'sum';         op: '>=' | '<=' | '='; n: number }              // 保留（非 design 原生，供卡牌条件）
  | { kind: 'const';       value: boolean };                               // 🆕 恒真（被动 / 防御 / 无骰型条件的卡）

export type DiceValue = 1 | 2 | 3 | 4 | 5 | 6;

/** matcher 求值结果 —— 副产品 matchedDiceIndices 直接驱动 UI 高亮（design §1.3） */
export interface MatchResult {
  readonly matched: boolean;
  readonly matchedDiceIndices: readonly number[];
  readonly tier?: number;                    // graded 命中的档位索引
  readonly wildAssigned?: Readonly<Record<number, DiceSymbolId | DiceValue>>;  // 🆕 Wild 展开结果
}                                            //    MVP 恒为空；将来实现时复用 MatcherTrace 通路喂 UI
export function matchPattern(m: DicePatternMatcher, d: DiceView): MatchResult;

/** 求值输入视图（纯数据，由 DiceState + HeroDef.dice 派生） */
export interface DiceView {
  readonly faces: readonly DiceValue[];      // 长度 5
  readonly symbols: readonly DiceSymbolId[]; // 长度 5（由 faces 经 hero.dice 映射）
  readonly locked: readonly boolean[];       // 长度 5
  readonly overrideSymbols?: Readonly<Record<number, DiceSymbolId>>;  // 扩展点 E2，MVP 不用
}
```

> **v0.1 → v0.2 matcher 变更**：`count` → `countSymbol`；`and`/`or` → `allOf`/`anyOf`；新增 `countFace` / `atLeast` / `graded` / `const`；移除 `countAny` / `countDistinct` / `set`（design DSL 无对应物，若确有需要由 DSL 编译期展开为 `anyOf` 组合，**不新增 matcher kind**）。`countFace` 的缺失在 v0.1 会直接导致 Pyromancer Ultimate（`countFace(6,5)`）无法表达，本轮补齐。

### 3.3 效果 IR（引擎可执行的最小闭包）

```ts
> **v0.2 本小节为设计侧 DSL 的 IR 落地。** 标记：🆕 = 本轮新增；🔄 = 重命名 / 改语义；无标记 = v0.1 已有。

```ts
// ── 目标引用：全部为纯数据，可序列化 ────────────────────────────
export type TargetRef =
  | { r: 'self' } | { r: 'active' } | { r: 'defender' } | { r: 'attacker' }  // 🆕 attacker
  | { r: 'opponent' }                                    // 1v1 唯一对手；多人下非法
  | { r: 'seat'; seat: Seat }
  | { r: 'targetOf'; abilityId: AbilityId }
  | { r: 'chosen'; tag: string }                          // 由挂起点选择结果填充
  | { r: 'promptTarget'; prompt: string; legal: readonly TargetRef[] }  // 🆕 本身即挂起点
  | { r: 'allOpponents' }                                 // 多人扩展保留（MVP 不出现）
  | { r: 'companion'; owner: TargetRef };                 // 扩展点 E1（MVP 不出现）

// ── 动态数值表达式（避免把计算写进闭包）────────────────────────
export type DiceScope = 'final' | 'lastRoll';              // 🆕 design NumExpr 的 dice 参数
export type Expr =
  | { e: 'const'; v: number }
  | { e: 'var'; name: string }                             // 🆕 配合 bind / bindRemovedTo / promptNumber
  | { e: 'statusStacks'; statusId: StatusEffectId; of: TargetRef }
  | { e: 'countSymbol'; symbol: DiceSymbolId; dice: DiceScope }   // 🆕
  | { e: 'sumFaces'; dice: DiceScope }                     // 🆕 "Roll 3：伤害 = 总点数"
  | { e: 'diceCount'; matcher: DicePatternMatcher }        // 命中某骰型的骰子数
  | { e: 'cp'; of: TargetRef }
  | { e: 'hp'; of: TargetRef }
  | { e: 'handSize'; of: TargetRef }                       // 🆕
  | { e: 'add'; l: Expr; r2: Expr }
  | { e: 'sub'; l: Expr; r2: Expr }
  | { e: 'mul'; l: Expr; r2: Expr }
  | { e: 'min'; l: Expr; r2: Expr }                        // 🆕
  | { e: 'max'; l: Expr; r2: Expr }                        // 🆕
  | { e: 'clamp'; v: Expr; lo: number; hi: number };

// ── 条件表达式（design Condition 的 IR 化）───────────────────── 🆕
export type CmpOp = '<' | '<=' | '>' | '>=' | '==' | '!=';
export type Condition =
  | { c: 'statusPresent'; of: TargetRef; statusId: StatusEffectId; minStacks?: Expr }
  | { c: 'hpCompare'; of: TargetRef; op: CmpOp; value: Expr }
  | { c: 'cpCompare'; of: TargetRef; op: CmpOp; value: Expr }
  | { c: 'damageDealtAtLeast'; value: Expr }               // 条件卡「本回合造成 ≥8」
  | { c: 'diceSymbolRolled'; symbol: DiceSymbolId; min: number }
  | { c: 'diceSumAtLeast'; value: Expr }                   // Overpower 阈值（与 bucket 累计伤害区分）
  | { c: 'hitSuccess' }                                    // 攻击命中（即使被 avoid 也置位，C7）
  | { c: 'phaseIs'; phase: Phase }
  | { c: 'and'; of: readonly Condition[] }
  | { c: 'or';  of: readonly Condition[] }
  | { c: 'not'; of: Condition };

// ── 伤害的三条正交轴（design §8.4-④-e 裁定）──────────────────────
//
// 轴① 语义轴（能否防御 / 能否被 Attack Modifier 增强）→ DamageType，恒 4 类
// 轴② 来源轴（谁造成的）                             → DamageSourceKind
// 轴③ 目标轴（打向谁）                               → TargetRef
//
// 三条轴正交，不可合并进一个枚举：合并后每个 switch 都会长出例外分支。
// 本轮据此**删除**了 v0.2 中途引入的 'ultimate' / 'self' 两个伪类型。

export type DamageType =
  | 'attack'        // 可防御；防御掷骰（P5）的唯一触发条件；可被 Attack Modifier 增强
  | 'undefendable'  // 不可防御：不受 prevent / avoid 影响
  | 'collateral'    // 无目标、不算 Attack、不可增强；**可被 avoid**（C7）
  | 'pure';         // 无伤害类型：不可防御、不可被 Attack Modifier 增强
                    //   含三类来源（④-a）：防御反伤 / Upkeep 扣血（Poison·Burn）/ 自我反噬 Recoil

/** 正交轴②：来源（取代原 'ultimate' 伪类型） */
export type DamageSourceKind = 'ability' | 'status' | 'ultimate' | 'recoil';

export type BucketKind = 'defendable' | 'undefendable' | 'collateral' | 'prevention';
export const BUCKET_OF: Readonly<Record<DamageType, BucketKind>>;   // 见 §2.4.4 映射表

/** 只有 'attack' 算 Attack → 置 hitSuccess、计入 damageDealtAtLeast、触发 attackResolved */
export const COUNTS_AS_ATTACK: Readonly<Record<DamageType, boolean>> = {
  attack: true, undefendable: false, collateral: false, pure: false,
};

// ── 效果原语 ────────────────────────────────────────────────────
export type EffectClause =
  /* 伤害 / 治疗 / 防御 */
  | { kind: 'dealDamage';    amount: Expr | number; damageType: DamageType; to: TargetRef;
                             sourceKind?: DamageSourceKind }   // 🆕 正交轴②，缺省由 ctx.source 推导
  | { kind: 'heal';          amount: Expr | number; to: TargetRef }
  | { kind: 'preventDamage'; amount: Expr | number; to: TargetRef }              // 🔄 只吃可防御部分（P5）
  | { kind: 'avoidDamage';   to: TargetRef }                                      // 🆕 完全闪避：清空 defendable + collateral
  | { kind: 'reduceDamage';  amount: Expr | number; scope: 'next' | 'thisResolution' }  // 保留糖衣
  /* 资源 */
  | { kind: 'gainCp';    amount: Expr | number; to: TargetRef }
  | { kind: 'loseCp';    amount: Expr | number; from: TargetRef }
  | { kind: 'stealCp';   amount: Expr | number; from: TargetRef; to: TargetRef }
  | { kind: 'drawCards'; amount: Expr | number; to: TargetRef }
  | { kind: 'discard';   amount: Expr | number; mode: 'random' | 'choice'; from: TargetRef }  // 🔄 原 discardRandom
  /* 状态 */
  | { kind: 'inflictStatus'; statusId: StatusEffectId; stacks: Expr | number; to: TargetRef }  // 🔄 原 applyStatus
  | { kind: 'removeStatus';  statusId: StatusEffectId | 'any'; stacks: Expr | number | 'all';
                              from: TargetRef; bindRemovedTo?: string }   // 🆕 必须返回实际移除数
  | { kind: 'transferStatus'; statusId: StatusEffectId; stacks: Expr | number | 'all';
                              from: TargetRef; to: TargetRef }            // 超额回滚（C9）
  | { kind: 'spendStatus';   statusId: StatusEffectId; stacks: Expr | number; from: TargetRef }  // 🔄 原 consumeStatus
  | { kind: 'increaseStackLimit'; statusId: StatusEffectId; by: number; to: TargetRef }  // 🆕 per-player，持续整局
  /* 骰子 */
  | { kind: 'rollDicePool'; count: Expr | number; diceSet: 'hero' | 'generic';
                            cases: readonly RollCase[]; bindSumTo?: string }      // 🆕 design 的 rollDice
  | { kind: 'setDieFace';  face: DiceValue; count: Expr | number;
                           scope: 'chosen' | 'random'; owner: TargetRef }          // 🔄 原 setDice
  | { kind: 'rerollDice';  count: Expr | number; scope: 'chosen' | 'random'; owner: TargetRef }  // 🔄
  | { kind: 'performRollAttempt'; for: 'offense' | 'defense' }                     // 🔄 原 rollDice（阶段掷骰）
  | { kind: 'modifyRollAttempts'; delta: number }
  | { kind: 'grantExtraRollAttempt'; amount: number; to: TargetRef }               // 🆕
  /* 流程控制 */
  | { kind: 'if'; cond: Condition; then: readonly EffectDef[]; else?: readonly EffectDef[] }  // 🆕
  | { kind: 'openWindowThen'; steps: readonly EffectDef[] }        // 🆕 design 的 Then 节点 → 挂起开窗
  | { kind: 'additionally';  effects: readonly EffectDef[] }       // 🆕 延迟到 P7（design 术语；见 §8.2 R13）
  | { kind: 'sequence';      effects: readonly EffectDef[] }
  | { kind: 'choice';        who: 'owner' | 'target'; prompt: string;
                             options: readonly ChoiceOption[];
                             default?: number }                   // 🔄 挂起点；default 缺省 0
                                                                  //   契约：期望收益最低项必须在 options[0]
  | { kind: 'optional';      prompt: string; steps: readonly EffectDef[];
                             defaultExercise?: boolean }          // 🆕 "up to N" → 挂起点
                                                                  //   默认**不行使**；defaultExercise:true
                                                                  //   时 lint 禁止段落内含代价类 effect
  | { kind: 'promptNumber';  prompt: string; min: number; max: number;
                             bindTo: string; autoResolve: number }                 // 🆕 数值区间选择 → 挂起点（默认 0）
  | { kind: 'bind';          name: string; value: Expr }           // 🆕 写入 queue.bindings
  | { kind: 'repeat';        times: Expr | number; effects: readonly EffectDef[] }
  | { kind: 'grantExtraOffensiveRollPhase'; to: TargetRef }        // 🆕 C3：先 flush 当前 bucket 再开新 ORP
  | { kind: 'skipPhase';     phase: Phase; to: TargetRef }
  /* 触发器 */
  | { kind: 'onDamageDealt'; effects: readonly EffectDef[] }       // net > 0 才触发（裁决 3）
  | { kind: 'onUpkeep';      effects: readonly EffectDef[] }
  | { kind: 'log';           text: string }                        // 🆕
  | { kind: 'noop' };

/** design "Roll N：On [sym] → ..."。cases 按 on 去重、每个 case 只结算一次（A16） */
export interface RollCase { readonly on: DiceSymbolId; readonly effects: readonly EffectDef[] }

export interface ChoiceOption {
  readonly id: string;
  readonly label: string;                 // 机制化短描述（由 describe 生成，不手写）
  readonly effects: readonly EffectDef[];
}

/** 可序列化、无闭包、递归的效果定义 —— DSL 的编译产物 */
export interface EffectDef {
  readonly clause: EffectClause;
  readonly next?: readonly EffectDef[];   // 🔄 原 `then`：链式后续，pushFront，**不开窗口**
  readonly note?: string;                 // 作者备注，引擎忽略
}
```

**`removeStatus` 的返回值语义（本轮硬性要求）**：handler 必须返回**实际移除数**（受 Stack Limit、目标 `stackLimitBonus`、玩家选择影响），并写入 `queue.bindings[bindRemovedTo]`。

```ts
// Combustion 的 IR 落地示例
{ kind:'optional', prompt:'移除至多 4 枚 Fire Mastery', steps: [
    { kind:'promptNumber', prompt:'移除数量', min:0, max:4, bindTo:'n', autoResolve:0 },
    { kind:'removeStatus', statusId:'pyro:fireMastery', stacks:{ e:'var', name:'n' },
                           from:{ r:'self' }, bindRemovedTo:'burned' },
    { kind:'dealDamage', amount:{ e:'mul', l:{ e:'const', v:3 }, r2:{ e:'var', name:'burned' } },
                         damageType:'undefendable', to:{ r:'opponent' } },
]}
```

**`avoidDamage` 与 `preventDamage` 必须可区分** —— 两者是**不同的 clause kind、不同的 handler、不同的 bucket 字段**：

| | 写入 | 作用范围 | 是否产生数值 | 事件 |
|---|---|---|---|---|
| `preventDamage(amount)` | `bucket.entries` 的 `prevention` 桶 | 仅 `defendable`，且 `max(0, d − prevention)` | ✅ 有数值 | `mitigationAccumulated` |
| `avoidDamage` | `bucket.avoid`（标志数组） | `defendable` + `collateral` 清零；`undefendable` / `pure`（含 `sourceKind:'ultimate'`）**不受影响** | ❌ 无数值 | `damageAvoided` |

### 3.3.1 `graded` 与 `sequence` / `choice` 的关系（主理人裁决问项）

| 构造 | 所在层 | 何时决定 | 是否挂起 | 引擎成本 |
|---|---|---|---|---|
| **`graded`** | `DicePatternMatcher`（激活层） | **P1 ACTIVATE**，由骰面唯一决定 | ❌ | 一次 matcher 求值 → 返回 `tier` |
| `sequence` | `EffectClause` | 编译期已知 | ❌ | pushBack 顺序执行 |
| `choice` / `optional` / `promptNumber` | `EffectClause` | 运行期由玩家决定 | ✅ | 挂起点 |

**结论：`graded` 不新增 `EffectClause` kind。** 它在 P1 由 matcher 求值产出 `tier`，引擎取 `tiers[tier].effects` 入队 —— 对 IR 而言就是「一次求值 + 一次数组索引」，零额外调度成本。三者正交、无冲突：`graded` = 数据决定档位，`sequence` = 无条件定序，`choice` = 玩家决定分支。

**为什么不走「DSL 编译期展开为 `if` 链」**（备用方案，已评估，不采用）：展开成

```
sequence [ if(countSymbol(sym,5) → tiers[2].effects), if(countSymbol(sym,4) → tiers[1].effects), … ]
```

会把「取最高档」复制成 N 个条件，内容作者改 `min` 时容易漏改一处；且会丢失 `MatchResult.tier` 这个副产品——UI 需要它来显示「你命中了第几档」（design §1.3）。**保留 `graded` 为一等 matcher kind。**


### 3.4 能力 / 卡牌 / 状态效果

```ts
export type AbilityKind = 'offensive' | 'defensive' | 'passive' | 'ultimate';
export type AbilityTag = 'undefendable' | 'unpreventable' | 'requiresTarget' | 'noDamage' | 'selfHarm';

/**
 * design 侧的 `AbilityTier`：matcher 挂在 tier 上（不是 slot 上），
 * 因此「升级卡改变激活条件」是天然支持的（design §1.4-4）。
 */
export interface AbilityTier {
  readonly level: 1 | 2 | 3;
  readonly upgradeCostCP: number;          // 从【上一级】升到本级的差价（跳级购买 = 付本值）
  readonly activation: DicePatternMatcher;
  readonly effects: readonly EffectDef[];
}

/**
 * design 侧的 `AbilitySlot`（内容作者视角）。
 * 注意 `AbilitySlot` 这个标识符在本文件中被占用为「槽位 ID 字符串」（见 §3.6），
 * 故此处命名为 `AbilitySlotDef`。二者编译期互转，见 §2.6.2。
 */
export interface AbilitySlotDef {
  readonly id: AbilityId;
  readonly kind: AbilityKind;
  readonly displayName: string;
  readonly tiers: readonly AbilityTier[];
  readonly defenseDiceCount?: number;      // kind==='defensive'
  readonly isUltimate?: boolean;           // 激活后剥夺对手行动权（P2）
}

/** 引擎运行时视角：一个「槽位 × 等级」的可执行能力（由 AbilitySlot 编译而来） */
export interface AbilityDef {
  readonly id: AbilityId;
  readonly heroId: HeroId;
  readonly kind: AbilityKind;
  readonly tier: 1 | 2 | 3;
  readonly cpCost: number;                 // 该 tier 的累计总价（差价由引擎算）
  readonly name: string;                   // 机制化命名，不复制官方卡面文本
  readonly activation: DicePatternMatcher;
  readonly effects: readonly EffectDef[];
  readonly defensiveDice?: number;         // kind==='defensive' 时：一次性掷骰数量
  readonly tags?: readonly AbilityTag[];
  readonly isUltimate?: boolean;
}

export type CardKind = 'upgrade' | 'mainAction' | 'rollPhaseAction' | 'instantAction';   // 🆕 instantAction

/**
 * 🔄 v0.2 重定义：与 design §2.2「Roll Phase Action 四个可打时机」1:1（详见 §2.5.1）。
 * v0.1 的 `'offensiveRoll' | 'targeting' | 'defensiveRoll' | 'anyResponseWindow'` 过于模糊——
 * 它无法区分「掷骰前」与「锁定后」，也无法表达「开窗 vs 不开窗」，本轮作废。
 */
export type PlayTiming =
  | 'mainPhase'          // MAIN_1 / MAIN_2：Upgrade 卡 + Main Phase Action 卡
  | 'preRoll'            // ① 每次 ROLL 之前的 AWAIT_DECISION —— **不开窗、不挂起**，直接打
  | 'postFinalLocked'    // ② FINAL_LOCKED 之后、确认激活之前 —— **不开窗、不挂起**，直接打
  | 'responseWindow';    // ③④ 所有响应窗口（then / postDefense / rollPool …）—— 走窗口栈

/** design 的 `actionTiming`。⚠️ MVP 的 `instant` **等价**于 `rollPhase`（C12：不支持真打断，只在响应窗口内） */
export type ActionTiming = 'instant' | 'mainPhase' | 'rollPhase';

/** 🆕 design `ActivationCandidates`（§1.3）—— 服务端算候选集合，客户端只渲染（B3） */
export interface ActivationCandidate {
  readonly abilityId: AbilityId;
  readonly tier: 1 | 2 | 3;
  readonly matchedBy: MatchResult;   // 含 matchedDiceIndices → 驱动骰盘描边高亮（design §1.3）
  readonly isUltimate: boolean;
  readonly preview: { readonly minDamage: number; readonly maxDamage: number; readonly statusSummary: readonly string[] };
}

export interface CardDef {
  readonly id: CardDefId;
  readonly displayName: string;            // 🆕 机制化命名
  readonly kind: CardKind;
  readonly cpCost: number;                 // 打出成本（upgrade 为该 tier 总价）
  readonly timings: readonly PlayTiming[]; // rollPhaseAction 通常 ≥1 个掷骰相关时机
  readonly effects: readonly EffectDef[];
  readonly targetAbilityId?: AbilityId;    // upgrade 专用
  readonly tier?: 1 | 2 | 3;               // upgrade 专用
  readonly requiresTarget?: boolean;
  readonly playCondition?: Condition;      // 🆕 条件卡（design `playCondition`，如「造成 ≥8 伤害后」）
  readonly ruleText: string;               // 🆕 describe 的兜底文案（design 要求）
}

export interface CardInstance { readonly uid: EntityId; readonly defId: CardDefId }

export type StatusKind = 'timed' | 'persistent' | 'instant';

/** 🆕 design `StatusHook` 的 IR 化（design `hero-schema-draft.md` §1.8） */
export type StatusHook =
  | { on: 'offensiveRollPhaseStart'; effect: EffectDef }   // Knockdown：付 2 CP 否则跳过
  | { on: 'incomePhaseStart';        effect: EffectDef }   // Concussion：跳过抽牌与 CP
  | { on: 'incomingDamage'; timing: 'avoid' | 'prevent' | 'modify'; effect: EffectDef; auto?: boolean }
  | { on: 'statusInflicted'; statusId: StatusEffectId; timing: 'before'; effect: EffectDef }  // Thick Skin II
  | { on: 'abilityActivation'; timing: 'before'; effect: EffectDef }                          // Blind
  | { on: 'turnStart';      effect: EffectDef }
  | { on: 'turnEnd';        effect: EffectDef }
  | { on: 'attackResolved'; effect: EffectDef };

export interface StatusEffectDef {
  readonly id: StatusEffectId;
  readonly name: string;
  readonly displayName: string;               // 🆕
  readonly stackLimit: number;                // 基础堆叠上限（可被 increaseStackLimit per-player 提升）
  readonly kind: StatusKind;
  readonly persistent: boolean;               // 持久型：仅显式移除
  readonly polarity: 'buff' | 'debuff';
  readonly spendable: boolean;                // 🆕 可主动消耗（任意阶段、任意回合；消耗不可打断）
  readonly spendEffect?: readonly EffectDef[];// 🆕
  readonly upkeep?: { readonly order: 'damage' | 'decay'; readonly effects: readonly EffectDef[] };  // 🆕 C6
  readonly hooks?: readonly StatusHook[];     // 🆕
  readonly modifiers?: readonly StatusModifier[];
  readonly ruleText: string;                  // 🆕 describe 的兜底文案
}

export type StatusModifier =
  | { m: 'rollAttemptsMax'; delta: number }
  | { m: 'handLimit'; delta: number }
  | { m: 'skipUpkeep' }
  | { m: 'skipIncome' }
  | { m: 'damageTaken'; delta: number }
  | { m: 'cannotPlayCards'; timing?: PlayTiming }
  | { m: 'requireCpToAct'; amount: number };

export interface StatusEffectInstance {
  readonly uid: EntityId;
  readonly defId: StatusEffectId;
  readonly stacks: number;                   // 1..stackLimit
  readonly ownerSeat: Seat;
  readonly appliedBySeat: Seat;
  readonly appliedTurn: number;
  readonly expiresAtTurn?: number;           // kind==='timed'
}
```

> ⚠️ **升级定价口径冲突（需 design 一句话确认，登记为附录 B 第 8 条）**：
> `AbilityTier.upgradeCostCP` 的注释写「从【上一级】升到本级的**差价**」，但 design §1.4-2 又写「L1→L3 直接付 `tiers[2].upgradeCostCP`（跳级，等于**全价**）」。这两句**互斥**——若它是差价，L1→L3 应付 `tiers[1]+tiers[2]`。
> 引擎侧按 **T4**（`未升级买 tier3 扣 C3；已 tier2 再买 tier3 仅扣 C3−C2`）实现，即 **`upgradeCostCP` 语义 = 到本级的累计总价**，与 v0.1 的 `AbilityDef.cpCost` 一致。
> **若 design 的真实意图是「差价」，T4 断言与全部英雄的升级卡数值都要改。** 这是一处 30 秒能确认、但漏掉会导致整棵升级树定价错误的地方。

### 3.5 英雄

```ts
export interface DeckEntry { readonly defId: CardDefId; readonly count: number }

/** 🆕 design `DieFace`：value = 顺子判定用的点数；symbols.length > 1 即 Wild 面 */
export interface DieFace {
  readonly value: DiceValue;
  readonly symbols: readonly DiceSymbolId[];
}

export interface HeroDef {
  readonly id: HeroId;
  readonly name: string;
  readonly startingHealth: number;      // 1v1 = 50
  readonly maxHealth: number;           // startingHealth + 10（治疗上限）
  readonly startingCp: number;          // 2
  readonly startingHand: number;        // 4
  readonly handLimit: number;           // 6
  readonly dicePool: DiceSymbolPool;
  /** 🆕 Wild 预留（design DT-DES-002 §8 B-3）：MVP 4 英雄每面 symbols.length === 1 */
  readonly dieFaces?: readonly [DieFace, DieFace, DieFace, DieFace, DieFace, DieFace];
  readonly wildFaces?: readonly DiceValue[];        // 哪些面是 Wild（MVP 恒空）
  readonly wildPolicy?: 'anySymbol' | 'anyValue' | 'anySymbolOrValue';  // MVP 不设置
  readonly abilities: readonly AbilityDef[];
  readonly deck: readonly DeckEntry[];
  readonly availableStatuses: readonly StatusEffectId[];
  readonly contentVersion: string;
}
```

### 3.6 玩家与对局状态

```ts
export type AbilitySlot = string;            // 英雄面板上的能力槽位 ID

export interface AbilityState {
  readonly slot: AbilitySlot;
  readonly currentTier: 0 | 1 | 2 | 3;       // 0 = 未升级（基础能力）
  readonly usedThisTurn?: boolean;
}

/**
 * 🆕 design 附录 A 要求的四个一等公民类型之一：行动权限令牌（P0）
 * 用**令牌栈**而非单值字段 —— Ultimate 与 Stun 可能叠加，单值无法正确「恢复」：
 * P8 释放 Ultimate 令牌时若 Stun 仍在，不能误恢复为 'all'（见 §8.2 R13 / T19）。
 */
export type PermissionLevel = 'all' | 'none';

export interface ActionPermissionToken {
  readonly id: EntityId;
  readonly seat: Seat;
  readonly reason: 'ultimate' | 'stun' | 'system';
  readonly releaseAt: 'cleanup' | 'turnEnd' | 'manual';   // P8 只释放 'cleanup'
  readonly openedAtSeq: number;
  readonly srcRef: EffectContext['source'];
}

/** 栈中任一令牌即 'none'；空栈 = 'all' */
export function effectivePermission(p: PlayerState): PermissionLevel;

export interface PlayerState {
  readonly seat: Seat;
  readonly userId: string;
  readonly heroId: HeroId;
  readonly health: number;
  readonly cp: number;                        // 0..15
  readonly startHp: number;                   // 50 —— 治疗上限 = startHp + 10
  readonly deck: readonly CardInstance[];     // 索引 0 = 牌库顶
  readonly hand: readonly CardInstance[];
  readonly discard: readonly CardInstance[];  // 公开
  readonly abilities: Readonly<Record<AbilitySlot, AbilityState>>;
  readonly statuses: readonly StatusEffectInstance[];
  readonly stackLimitBonus: Readonly<Record<StatusEffectId, number>>;  // 🆕 increaseStackLimit，持续整局
  readonly dice: DiceState;
  readonly rollAttemptsLeft: number;            // 🆕 初始 3；**骰子操作卡不递减**（§2.5.1 / T20）
  readonly permissionTokens: readonly ActionPermissionToken[];  // 🆕 令牌栈，见 effectivePermission()
  readonly defenseRollGranted: boolean;         // 🆕 防御掷骰单次布尔（不可重掷，但结果可被卡牌修改）
  readonly connected: boolean;
  readonly autoMode: boolean;                 // 连续超时后进入
  readonly timeoutsUsed: number;
}

export type Phase =
  | 'setup' | 'upkeep' | 'income' | 'main1'
  | 'offensiveRoll' | 'targeting' | 'defensiveRoll' | 'main2' | 'discard'
  | 'gameOver';

export type PhaseStep = 'enter' | 'resolve' | 'awaitInput' | 'exit' | 'auto';

/** 🆕 P1–P8：与 design §2.3 结算管线 1:1（v0.2 取代原 R0–R8 十步枚举） */
export type LadderStep =
  | 'activate'          // P1 确定骰型 / 选能力 / PASS
  | 'ultimateGate'      // P2 Ultimate 权限门 / Blind 失效判定
  | 'effectWalk'        // P3 效果序列执行（伤害入桶，Then 节点开窗）
  | 'responseWindow'    // P4 窗口栈非空时的停留态（可重入）
  | 'defensiveRoll'     // P5 一次性防御掷骰
  | 'simultaneous'      // P6 flush bucket → 改 HP → 死亡判定
  | 'postThen'          // P7 Additionally / onDamageDealt / 条件卡
  | 'cleanup';          // P8 胜负 / 日志 / 清理 / 推进

/** 保留位：1v1 恒为 no-op，为 2v2 / 多人预留（现在不写逻辑） */
export type ReservedStep = 'targeting';

export type ResolutionStep = LadderStep | ReservedStep;

/** 阶梯定义写成数据常量，便于 diff review 与 design 对齐 */
export interface LadderStepSpec {
  readonly step: LadderStep;
  readonly opensWindow?: { readonly trigger: WindowTrigger };
}
export const LADDER: readonly LadderStepSpec[];

export interface EffectContext {
  readonly sourceSeat: Seat;
  readonly source: { k: 'ability'; id: AbilityId } | { k: 'card'; uid: EntityId } | { k: 'status'; uid: EntityId } | { k: 'system' };
  readonly targetSeat?: Seat;
  readonly resolutionStep: ResolutionStep;
  readonly resolutionId: string;              // 🆕 onDamageDealt 的触发单位之一
}

export interface EffectFrame { readonly def: EffectDef; readonly ctx: EffectContext }

export interface EffectQueueState {
  readonly frames: readonly EffectFrame[];
  readonly ctx: EffectContext;
  readonly depth: number;
  readonly framesExecuted: number;
  readonly bindings: Readonly<Record<string, number>>;   // 🆕 bind / bindRemovedTo / promptNumber 作用域
}

/** 🆕 响应窗口栈 —— design 附录 A 要求的一等公民类型（详见 §2.4.3） */
export interface WindowStack {
  readonly stack: readonly ResponseWindow[];
  readonly nextSeq: number;
  readonly totalActionsThisResolution: number;
}

/** 🆕 design 的 DamageBucket（v0.1 的 DamageLedger 重构版） */
export interface BucketEntry {
  readonly id: EntityId;
  readonly bucketKind: BucketKind;            // defendable | undefendable | collateral | prevention
  readonly fromSeat: Seat;
  readonly toSeat: Seat;
  readonly amount: number;
  readonly damageType?: DamageType;           // prevention 条目为空
  readonly srcRef: EffectContext['source'];
}
export interface HealEntry  { readonly id: EntityId; readonly toSeat: Seat; readonly amount: number; readonly srcRef: EffectContext['source'] }
export interface AvoidEntry { readonly id: EntityId; readonly forSeat: Seat; readonly srcRef: EffectContext['source'] }

export interface DamageBucket {
  readonly resolutionId: string;
  readonly flushBatch: number;
  readonly entries: readonly BucketEntry[];
  readonly heals: readonly HealEntry[];
  readonly avoid: readonly AvoidEntry[];
  readonly closed: boolean;
}

export interface PendingAttack {
  readonly attackerSeat: Seat;
  readonly defenderSeat: Seat;
  readonly abilityId: AbilityId | null;
  readonly defendable: boolean;               // bucket 中是否存在 defendable 伤害
  readonly step: ResolutionStep;
  readonly isUltimate: boolean;               // 🆕
  readonly hitSuccess: boolean;               // 🆕 C7：即使被 avoid 也置位，供后置效果判定
}

/** 🆕 rollDicePool 的临时骰池快照（公开，判定后销毁：design C8 / A17） */
export interface RollPoolSnapshot {
  readonly id: EntityId;
  readonly ownerSeat: Seat;
  readonly diceSet: 'hero' | 'generic';
  readonly faces: readonly DiceValue[];
  readonly symbols: readonly DiceSymbolId[];
}

export type PendingKind =
  | 'chooseAbility' | 'responseWindow' | 'defensiveRoll'   // 🆕 responseWindow 独立成类（15s）
  | 'choice' | 'optional' | 'promptNumber' | 'promptTarget' | 'discard';
  // ⚠️ v0.2 **移除 `'upkeepOrder'`**：design C6 已裁决 Upkeep 排序为固定顺序（扣血 → 衰减），
  //    无需玩家输入、不产生挂起点。保留该枚举位会让实现者误以为需要挂起。

export interface PendingRequest {
  readonly id: string;
  readonly seat: Seat;
  readonly kind: PendingKind;
  readonly options: readonly ChoiceOption[];
  readonly autoResolve: string;               // 必填：异常兜底 optionId（zod 强制）；回合制下不用于超时
  readonly timeoutMs: number | null;          // 回合制恒为 null（不限时）；竞技模式才启用
  readonly deadlineAt: number | null;         // 回合制恒为 null；null = 未计时
  readonly legalActions: readonly Action[];
  readonly windowId?: string;                 // 🆕 kind==='responseWindow' 时关联 ResponseWindow.id
}

export interface GameState {
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly contentVersion: string;
  readonly matchId: string;
  readonly rng: RngState;
  readonly turn: number;                      // 从 1 起
  readonly phase: Phase;
  readonly phaseStep: PhaseStep;
  readonly activeSeat: Seat;
  readonly startSeat: Seat;
  readonly players: readonly [PlayerState, PlayerState];
  readonly pending: PendingRequest | null;
  readonly queue: EffectQueueState;
  readonly bucket: DamageBucket;              // 🔄 原 `ledger`
  readonly windows: WindowStack;              // 🆕
  readonly pendingAttack: PendingAttack | null;
  readonly rollPool: RollPoolSnapshot | null; // 🆕 临时骰池（判定后销毁）
  readonly lastRollSum: number;               // 🆕 供 diceSumAtLeast / sumFaces(lastRoll)
  readonly seq: number;                       // 已应用 action 数
  readonly winner: Seat | 'draw' | null;
  readonly flags: Readonly<Record<string, number | boolean>>;
}
```

> **字段更名**：`state.ledger` → `state.bucket`（类型 `DamageLedger` → `DamageBucket`）。这是与 design `GameState.bucket` 对齐所必需的；`PlayerView` 白名单中本就不含该字段，因此**无投影侧改动**。

### 3.7 动作（Action）

```ts
export type Action =
  /* 准备 */
  | { t: 'declareReady' }
  | { t: 'selectHero'; heroId: HeroId }
  /* 主要阶段 */
  | { t: 'playCard'; cardUid: EntityId; targets?: readonly TargetRef[] }
  | { t: 'buyUpgrade'; abilityId: AbilityId; tier: 1 | 2 | 3 }
  | { t: 'sellCard'; cardUid: EntityId }
  | { t: 'endMainPhase' }
  /* 进攻掷骰 */
  | { t: 'rollDice' }
  | { t: 'toggleLock'; index: number }
  | { t: 'announceAbility'; abilityId: AbilityId | null }
  /* 选靶 / 防御 */
  | { t: 'confirmTarget'; defenderSeat: Seat }      // 1v1：无决策，仅系统动作
  | { t: 'defensiveRoll' }                           // 防守方（自动掷但保留 action 形态）
  /* 通用 */
  | { t: 'chooseOption'; optionId: string }
  | { t: 'discardCards'; cardUids: readonly EntityId[] }
  | { t: 'passWindow' }                              // 放弃打牌窗口
  | { t: 'concede' }
  /* 系统 / 内部（不暴露为 legalActions） */
  | { t: 'sys:enterPhase'; phase: Phase }
  | { t: 'sys:advanceResolution'; step: ResolutionStep }
  | { t: 'sys:timeout'; pendingId: string }
  | { t: 'sys:disconnect'; seat: Seat }
  | { t: 'sys:reconnect'; seat: Seat };

export interface ActionEnvelope<A extends Action = Action> {
  readonly matchId: string;
  readonly seat: Seat;                 // 由服务端 socket 绑定覆盖，不信客户端
  readonly clientSeq: number;          // 客户端单调递增，用于幂等与乱序检测
  readonly action: A;
  readonly receivedAt: number;         // 服务端时间戳（引擎内不使用，仅日志/超时）
}

export type RuleErrorCode =
  | 'notYourTurn' | 'wrongPhase' | 'illegalAction' | 'insufficientCp'
  | 'cardNotInHand' | 'patternNotMatched' | 'alreadyRolledMax' | 'noPendingRequest'
  | 'unknownEntity' | 'stackLimitReached' | 'matchFinished' | 'engineGuardTripped';
export interface RuleError { readonly code: RuleErrorCode; readonly detail?: string }

export type ReduceResult =
  | { ok: true;  state: GameState; events: readonly GameEvent[] }
  | { ok: false; error: RuleError; events: readonly [] };
```

### 3.8 事件（GameEvent）

```ts
export type EventVisibility =
  | { v: 'public' }
  | { v: 'seat'; seat: Seat }
  | { v: 'server' };                    // 仅落日志/回放，不下发

export type GameEventType =
  | 'matchStarted' | 'phaseEntered' | 'phaseExited'
  | 'cpChanged' | 'healthChanged' | 'cardsDrawn' | 'cardPlayed' | 'cardSold' | 'cardDiscarded'
  | 'deckReshuffled'
  | 'diceRolled' | 'diceLocked' | 'diceUnlocked' | 'diceModified'
  | 'abilityAnnounced' | 'abilityResolved' | 'abilityUpgraded'
  | 'statusApplied' | 'statusRemoved' | 'statusTransferred' | 'statusConsumed' | 'statusStackCapped'
  | 'damageAccumulated' | 'mitigationAccumulated' | 'damageApplied' | 'healApplied'
  | 'pendingRequested' | 'pendingResolved' | 'pendingTimedOut'
  | 'turnEnded' | 'matchEnded' | 'engineGuardTripped'
  /* 🆕 v0.2：design 附录 A 第 2 条「结构化战斗日志」要求的四件一等公民相关事件 */
  | 'windowOpened' | 'windowClosed' | 'windowActionPlayed'   // 响应窗口栈
  | 'permissionChanged' | 'permissionReleased'               // 权限令牌
  | 'damageAvoided'                                          // avoidDamage（区别于 mitigation）
  | 'bucketFlushed'                                          // P6 flush，带完整明细行
  | 'rollPoolCreated' | 'rollPoolDisposed'                   // 临时骰池（A17 / C8）
  | 'abilityActivationFailed'                                // P2 Blind 生效 → 激活失败
  | 'statusInflictFailed'                                    // C11：已满 stackLimit，施加失败但仍记日志
  | 'defeatPending';                                         // P6 记 pendingDefeat，P8 统一裁决

export interface GameEvent<P = unknown> {
  readonly id: number;                  // 单调递增，等于 state.seq 语义
  readonly type: GameEventType;
  readonly visibility: EventVisibility;
  readonly turn: number;
  readonly phase: Phase;
  readonly resolutionStep: ResolutionStep | null;   // 🆕 P1–P8（非结算期为 null）
  readonly seq: number;                             // 🆕 与 state.seq 对齐
  readonly payload: P;
  /** 🆕 由 `describe()` 生成的语义化日志行；`null` = 该事件不入战斗日志 */
  readonly logText: string | null;
}

// ── 关键载荷（本轮新增/修订）────────────────────────────────────
export type DamageAppliedPayload = {
  readonly targetSeat: Seat; readonly net: number;
  readonly gross: number; readonly prevented: number;
  readonly avoided: boolean;                          // 🆕 与 prevented 区分
  readonly hpAfter: number; readonly damageType: DamageType;
  readonly resolutionId: string; readonly flushBatch: number;  // 🆕 onDamageDealt 触发单位
};

/** 🆕 P6 flush 的完整明细行：design §2.3「日志输出明细行」的直接编码 */
export type FlushDetail = {
  readonly seat: Seat;
  readonly incomingDefendable: number;
  readonly incomingUndefendable: number;
  readonly incomingCollateral: number;
  readonly prevention: number;
  readonly healing: number;
  readonly avoided: boolean;
  readonly netDefendable: number;
  readonly netDamage: number;
  readonly hpBefore: number;
  readonly hpAfterRaw: number;      // 未 clamp —— 死亡判定用它，不是用 clamp 后的值
  readonly hpAfter: number;         // clamp 后
  readonly dead: boolean;
};
export type BucketFlushedPayload = {
  readonly resolutionId: string; readonly flushBatch: number;
  readonly details: readonly FlushDetail[];   // 逐目标
};

export type WindowPayload = {
  readonly windowId: string; readonly trigger: WindowTrigger;
  readonly eligibleSeats: readonly Seat[]; readonly cursorSeat: Seat | null;
  readonly passStreak: number; readonly actionCount: number;
};
export type PermissionPayload = {
  readonly seat: Seat; readonly permission: PermissionLevel;
  readonly reason: 'ultimate' | 'stun' | 'blind' | 'released' | 'system';
  readonly tokenId: EntityId | null;   // 释放事件为被释放的令牌 id
};
export type DiceRolledPayload = {
  readonly seat: Seat; readonly values: readonly number[];
  readonly attempt: number; readonly reason: 'offense' | 'defense' | 'pool';
  readonly rollAttemptsLeft: number;   // 🆕 骰子操作卡不递减它（T20 断言）
};
export type EngineGuardPayload = {
  readonly reason: 'resolveDepth' | 'frameLimit' | 'windowActionLimit' | 'repeatLimit';
  readonly detail?: string;
};
```

> **design 附录 A 第 2 条把 `GameEvent` 列为一等公民类型** —— 它在 v0.1 已存在，本轮补的是「**结构化**」：新增 `resolutionStep` / `seq` / `logText` 三个字段与 `bucketFlushed` 明细载荷，使日志能直接产出 design §2.3 想要的明细行（`15⚔ + 3🔥 − 4🛡 + 2💚 = 12`），并支撑复盘、客服举证与回放（D4/D10）。

### 3.9 投影（PlayerView）

```ts
/** ⚠️ 刻意 Omit `permissionTokens`：视图只暴露**求值后**的权限等级，不暴露令牌栈内部 */
export interface SelfPlayerView extends Omit<PlayerState, 'deck' | 'permissionTokens'> {
  readonly hand: readonly CardInstance[];        // 自己全可见
  readonly deckCount: number;                    // 自己也不给顺序（防 Deck Stack 类效果被滥用）
  /**
   * 🆕 牌库剩余成分的**聚合计数**（design DT-DES-002 §8 B-2）。
   * 只给自己。由 mapper 从 `hero.deck` **常量**减去 hand / discard / upgrades 现场算出，
   * **必须写在白名单 mapper 里显式搬运** —— 禁止从 `state.deck` 变形导出，那等于绕开 fail-safe。
   */
  readonly remainingDeckCounts: readonly { readonly cardId: CardDefId; readonly count: number }[];
  readonly unknownInDeck: number;                // MVP 恒 0（无「塞牌进牌库」类效果时必为 0）
  readonly actionPermission: PermissionLevel;    // = effectivePermission(self)
  readonly legalActions: readonly Action[];
}
export interface OpponentPlayerView {
  readonly seat: Seat; readonly userId: string; readonly heroId: HeroId;
  readonly health: number; readonly cp: number;
  readonly startHp: number;                      // 🆕 治疗上限 = startHp + 10（UI 画血条上限）
  readonly handCount: number;
  readonly deckCount: number;
  readonly discard: readonly CardInstance[];     // 公开（附录 B 第 1 条）
  readonly abilities: Readonly<Record<AbilitySlot, AbilityState>>;
  readonly statuses: readonly StatusEffectInstance[];
  readonly dice: DiceState;
  readonly actionPermission: PermissionLevel;    // 🆕 UI 灰化依据（"终极能力无法响应"）
  readonly rollAttemptsLeft: number;             // 🆕 常驻指示（design B10）
  readonly connected: boolean; readonly autoMode: boolean;
}
export interface SharedView {
  readonly turn: number; readonly phase: Phase; readonly phaseStep: PhaseStep;
  readonly activeSeat: Seat; readonly startSeat: Seat;
  readonly pendingAttack: PendingAttack | null;
  readonly resolutionStep: ResolutionStep | null;
  /** 🆕 当前窗口（若有）：让对手侧能看到「正在响应中 + 倒计时」，但不泄露可打什么牌 */
  readonly activeWindow: { id: string; trigger: WindowTrigger; cursorSeat: Seat | null; deadlineAt: number | null } | null;
  readonly rollPool: RollPoolSnapshot | null;    // 🆕 临时骰池公开
  readonly log: readonly { id: number; text: string }[];   // 已过滤的语义化战斗日志（由 describe 生成）
}
export interface PlayerView {
  readonly schemaVersion: number;
  readonly matchId: string;
  readonly you: Seat;
  readonly self: SelfPlayerView;
  readonly opponent: OpponentPlayerView;
  readonly shared: SharedView;
  readonly pending: Pick<PendingRequest, 'id' | 'kind' | 'options' | 'deadlineAt' | 'timeoutMs' | 'legalActions'> | null;
  readonly opponentPending: { kind: PendingRequest['kind']; deadlineAt: number } | null;
  readonly winner: Seat | 'draw' | null;
}
```

> **注意（v0.2 更新）**：`PlayerView` 中没有 `rng`、`queue`（内部结算队列）、**`bucket`**（未 flush 的桶）、**`windows`**（窗口栈内部计数）、`players[*].stackLimitBonus` 之外的隐藏态——白名单天然排除。客户端**在类型层面**就拿不到这些。
> `activeWindow` 是**刻意的精简投影**：只暴露「有窗口 + 谁在响应 + 何时截止」，**不暴露** `eligibleSeats` 的完整合法性判断与 `actionCount`（否则等于告诉对手自己还剩几次响应机会）。

### 3.10 房间与持久化

```ts
export type RoomKind = 'quick' | 'private' | 'bot' | 'replay';
export type RoomStatus = 'lobby' | 'heroSelect' | 'playing' | 'finished' | 'abandoned';

export interface RoomSeat {
  readonly userId: string | null;
  readonly heroId: HeroId | null;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly joinedAt: number | null;
}
export interface RoomSettings {
  readonly turnTimeoutMs: number;        // 默认 30000
  readonly disconnectGraceMs: number;    // 默认 60000
  readonly matchTimeoutMs: number;       // 默认 1800000
  readonly firstPlayer: 'random' | 'seat0' | 'seat1';
  readonly ranked: boolean;
}
export interface Room {
  readonly id: string;
  readonly kind: RoomKind;
  readonly status: RoomStatus;
  readonly seats: readonly [RoomSeat, RoomSeat];
  readonly settings: RoomSettings;
  readonly matchId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface MatchRecord {
  readonly matchId: string;
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly contentVersion: string;
  readonly seed: string;
  readonly setup: { seat0: HeroId; seat1: HeroId; startSeat: Seat };
  readonly actions: readonly ActionEnvelope[];   // 含 sys: 动作 —— 回放真相源
  readonly finalState: GameState;
  readonly winner: Seat | 'draw' | null;
  readonly startedAt: number; readonly endedAt: number;
}
```

---

## §4 ADR 索引

| ADR | 标题 | 一句话决策 |
|---|---|---|
| [ADR-001](./adr/adr-001-realtime-transport.md) | 实时通信方案 | 采用 Socket.IO v4（WebSocket 优先、自动降级、内置重连与房间语义），MVP 单实例，扩展时加 Redis Adapter |
| [ADR-002](./adr/adr-002-authority-and-sync.md) | 权威与同步模型 | 服务端权威 + 全量状态在服务端 + per-seat 结构化白名单投影 + 服务端下发 `legalActions`；拒绝状态全量同步与客户端仲裁 |
| [ADR-003](./adr/adr-003-engine-paradigm.md) | 规则引擎实现范式 | 纯函数 reducer + FSM 阶段门控 + EffectQueue 结算 + 事件流副产品；拒绝 ECS 与纯事件溯源 |
| [ADR-004](./adr/adr-004-randomness-and-replay.md) | 随机性与可复现 | 服务端种子化 sfc32 + 命名流计数器存于 state；种子绝不下发；回放 = seed + actionLog |
| [ADR-005](./adr/adr-005-persistence-and-replay.md) | 持久化与回放 | MVP 内存 + JSON 落盘；回放以 `MatchRecord.actions` 为真相源重放，不存事件流 |
| [ADR-006](./adr/adr-006-monolith-vs-services.md) | 单体 vs 服务拆分时机 | MVP 单进程模块化单体；以「房间 Actor 串行化」为前提，按触发条件渐进拆分 |

---

## §5 工程结构

### 5.1 Monorepo 布局

```
dice-throne/
├─ package.json                      # pnpm workspace root, "type": "module"
├─ pnpm-workspace.yaml               # packages/*
├─ tsconfig.base.json                # strict / noUncheckedIndexedAccess / exactOptionalPropertyTypes
├─ turbo.json                        # 可选；lean 阶段可用 pnpm -r 代替
├─ .github/workflows/ci.yml
├─ packages/
│  ├─ shared/                        # @dt/shared —— 零 IO，可在浏览器与 Node 同时运行
│  │  ├─ src/
│  │  │  ├─ types/                   # §3 全部类型，纯 type，无运行时
│  │  │  ├─ engine/
│  │  │  │  ├─ reduce.ts             # 唯一入口 reduce(state, env) -> ReduceResult
│  │  │  │  ├─ legality.ts           # enumerateLegalActions(state, seat)
│  │  │  │  ├─ projection.ts         # projectState / projectEvents
│  │  │  │  ├─ rng.ts                # sfc32 + 命名流
│  │  │  │  ├─ dice.ts               # 掷骰、锁定、DicePatternMatcher 求值
│  │  │  │  ├─ bucket.ts             # DamageBucket 分桶累加与 flush（P6 唯一写 HP 处）
│  │  │  │  ├─ windowStack.ts        # 响应窗口栈：轮转 / passStreak / 4 动作上限 / 15s
│  │  │  │  ├─ permission.ts         # ActionPermissionToken 栈 + effectivePermission() + P8 释放
│  │  │  │  ├─ effects/
│  │  │  │  │  ├─ registry.ts        # EFFECT_HANDLERS: Record<ClauseKind, Handler>
│  │  │  │  │  ├─ queue.ts           # EffectQueue 执行循环 + 深度防护
│  │  │  │  │  └─ handlers/*.ts      # 每个 kind 一个纯函数 handler
│  │  │  │  ├─ phases/               # 八阶段 + 结算阶梯定义（数据 + 门控）
│  │  │  │  ├─ status/               # token 施加/转移/移除/消耗 + stackLimit
│  │  │  │  ├─ setup.ts              # 起始状态构造（seed、洗牌、起手）
│  │  │  │  └─ errors.ts
│  │  │  ├─ content/
│  │  │  │  ├─ heroes/{barbarian,moon-elf,ninja,pyromancer}.ts
│  │  │  │  ├─ cards/*.ts
│  │  │  │  ├─ statuses.ts
│  │  │  │  ├─ index.ts              # 内容注册表（ContentRegistry）
│  │  │  │  └─ validate.ts           # L2 zod + L3 语义自检
│  │  │  ├─ dsl/
│  │  │  │  ├─ compile.ts            # design DSL -> EffectDef IR（§2.7 降级规则）
│  │  │  │  └─ __ir_snapshots__/     # 编译产物快照（入版本库；改动 = PR diff，T35）
│  │  │  ├─ content/describe.ts      # DESCRIBERS 注册表 + describe(e, lang)（§2.6.1）
│  │  │  └─ testing/{scriptedMatch.ts,snapshot.ts,generators.ts}
│  │  └─ package.json                # 无 dependencies（除 zod）
│  ├─ server/                        # @dt/server
│  │  └─ src/
│  │     ├─ net/socketio.ts          # 传输、鉴权、心跳、重连补帧
│  │     ├─ rooms/{RoomRegistry.ts,MatchActor.ts,timeouts.ts}
│  │     ├─ matchmaking/queue.ts
│  │     ├─ persistence/{repo.ts,migrations/}
│  │     ├─ auth/jwt.ts
│  │     ├─ observability/{logger.ts,metrics.ts}
│  │     └─ index.ts
│  └─ web/                           # @dt/web
│     └─ src/
│        ├─ net/socket.ts            # 只收 PlayerView + GameEvent
│        ├─ store/                   # zustand：view / events / optimistic UI 高亮
│        ├─ views/{Table,HeroBoard,DiceTray,HandArea,LogPanel}/
│        ├─ anim/                    # 事件 → 动画时间线
│        └─ sandbox/                 # 唯一允许 import engine 的地方（推演/AI/回放）
├─ tools/
│  ├─ content-lint.ts                # CI + 启动期内容自检，产出 content-report.json
│  ├─ replay.ts                      # CLI 回放器
│  └─ balance-sim.ts                 # 4 英雄对局蒙特卡洛（后期）
└─ tests/
   ├─ unit/                          # 引擎纯函数
   ├─ property/                      # 投影泄漏、确定性
   ├─ integration/                   # 端到端脚本化对局
   └─ __snapshots__/
```

**包职责硬边界**

| 包 | 可依赖 | 禁止 |
|---|---|---|
| `@dt/shared` | 仅 `zod`（+ 自带 rng 实现） | 任何 IO、网络、DOM、`node:*` |
| `@dt/server` | `@dt/shared`, express/socket.io, db driver | 渲染逻辑 |
| `@dt/web` | `@dt/shared`（types + sandbox） | `@dt/server` 内部模块；`views/` 禁引 `engine` |

### 5.2 构建与工具链

| 项 | 选型 | 理由 |
|---|---|---|
| 包管理 | **pnpm** | 严格 node_modules（防幽灵依赖）、workspace 快、磁盘省 |
| 语言 | TypeScript 5.x，**strict 全开** | `noUncheckedIndexedAccess` 对数组型状态（骰子、手牌）防越界极关键 |
| 前端构建 | Vite | 快、TS 原生、HMR |
| 测试 | **Vitest** | 与 Vite 共享配置；内置 `expect`/快照/coverage；比 Jest 快 |
| 属性测试 | **fast-check** | 投影泄漏、确定性、不变量测试 |
| Schema | **zod** | 前后端共用校验（网络信封 + 内容配置） |
| 网络 | **socket.io v4 / socket.io-client v4** | ADR-001 |
| 前端状态 | zustand（轻量） | 只存 view，无需 Redux 样板 |
| Lint | ESLint + @typescript-eslint + `no-restricted-imports` + `ban-types` | 强制包边界与禁用 API |
| 格式化 | Prettier | 消除风格争论 |
| Git 工作流 | trunk-based + short-lived branch，Conventional Commits | lean；`main` 始终可部署 |

**引擎禁用 API 的自动化拦截（控制清单第 1 条）**：ESLint `no-restricted-globals: ['Math.random','Date']`、`no-restricted-syntax` 拦截 `new Date()`；`packages/shared` 的 `tsconfig` 不包含 `"lib": ["DOM"]`，从类型层面禁掉 `window`/`document`；一条单测断言 `shared` 包源码中 grep 不到 `Math.random|Date.now|require\(`。

**CI 要点**（`.github/workflows/ci.yml`）

1. `pnpm install --frozen-lockfile`
2. `pnpm -r typecheck`（`tsc --noEmit`）
3. `pnpm lint` + **包边界检查**（`eslint-plugin-boundaries` 或自写 `no-restricted-imports`）
4. `pnpm test:unit --coverage`（阈值：`packages/shared` 行覆盖 ≥ 85%，分支 ≥ 75%）
5. `pnpm test:property`（投影泄漏 + 确定性，必过）
6. `pnpm content:lint`（**required**）
7. `pnpm build`
8. `pnpm test:integration`（真实起 server + 2 socket 客户端，脚本化打完一局）

### 5.3 关键依赖清单

| 依赖 | 版本 | 用途 | 备选与不选理由 |
|---|---|---|---|
| typescript | ^5.6 | — | — |
| pnpm | ^9 | 包管理 | npm/yarn：workspace 与严格性弱 |
| vitest | ^2 | 单测/快照/属性 | Jest：Vite 集成差、慢 |
| fast-check | ^3 | 属性测试 | 手写随机：不可复现 |
| zod | ^3 | 信封 + 内容校验 | io-ts：API 重；class-validator：装饰器侵入 |
| socket.io / socket.io-client | ^4 | 实时通信 | 见 ADR-001 |
| zustand | ^5 | 前端状态 | Redux Toolkit：样板过多 |
| react / vite | ^18 / ^5 | UI | — |
| @socket.io/redis-adapter | 按需 | 扩展 | MVP 不引 |
| drizzle-orm + better-sqlite3（MVP）/ postgres | 按需 | 持久化 | Prisma：MVP 过重 |

---

## §6 交付拆分（Epic / Story）

### Epic A — 规则引擎内核（P0）

| ID | Story | P | 验收 |
|---|---|---|---|
| A1 | 类型骨架 + `tsconfig` strict + 包边界 lint | P0 | `tsc` 通过；`shared` 无 DOM lib |
| A2 | `rng.ts`：sfc32 + 命名流 + 确定性单测 | P0 | 同 seed 同序列；跨 Node/浏览器一致 |
| A3 | `setup.ts`：起始状态（HP50/CP2/起手4/洗牌） | P0 | 快照测试 |
| A4 | 八阶段 FSM + `enter/exit/auto` 步进 | P0 | 阶段顺序不可乱；首回合跳过 Income |
| A5 | `reduce()` + `Result` 错误模型 | P0 | 非法动作 state 不变（结构相等） |
| A6 | `legality.ts`：`enumerateLegalActions` | P0 | 与 A5 结果一致（属性测试） |
| A7 | 骰子：掷骰 / 锁定 / **掷骰子状态机（§2.5.1）** / pattern matcher（`countFace` / `atLeast` / `graded`） | P0 | 大小写/顺子/Wild 单测齐全；**T20**（状态机 + 骰子操作卡不消耗 Roll Attempt + 全锁 + 超时默认） |
| A8 | EffectQueue + registry + 深度防护 | P0 | 递归用例不爆栈，产生 `engineGuardTripped` |
| A9 | **DamageBucket + 结算阶梯 P1–P8 + WindowStack**（v0.2 重写） | P0 | 顺序快照测试；见 §7 T5–T9 / **T17–T23**（窗口轮转、2-pass 关闭、4 动作上限、空窗跳过、flush 三边界、`onDamageDealt` net>0、令牌不泄漏） |
| A10 | PendingRequest 挂起/恢复/超时（autoResolve 必填） | P0 | 超时自动推进；恢复后队列正确继续 |
| A11 | Status Effect：施加/转移/移除/消耗 + stackLimit | P0 | §7 T10–T11 |
| A12 | `projectState` + 事件 visibility 过滤 | P0 | §7 T14 属性测试通过 |
| A13 | 胜负判定（含同时归零平局） | P0 | §7 T8 / T21b |
| **A14** 🆕 | **`permission.ts`：权限令牌栈 + `effectivePermission()` + P8 释放** | P0 | T19：Ultimate 剥夺对手、P8 只释放 `releaseAt==='cleanup'`、`turnEnd` 释放 Stun、**属性断言结算后双方必为 `'all'`** |
| **A15** 🆕 | **`dsl/compile.ts`：DSL → IR 编译器（§2.7 降级规则）** | P0 | T35：Barbarian + Pyromancer 端到端编译；IR 产物快照入库；**DSL 的 `then` 无一编译成 `next`**；悬空 `var` → lint 失败 |
| **A16** 🆕 | **`content/describe.ts`：`DESCRIBERS` 注册表 + `describe(e, lang)`** | P0 | T36：每个 clause kind 的中英输出非空、不含 `undefined`/`[object Object]`；缺 describer → `content-lint` 失败 |
| **A17** 🆕 | **Upkeep 固定顺序执行（C6：扣血 → 衰减，逐状态死亡判定）** | P0 | T26：顺序断言；**无挂起点**（`PendingKind` 中无 `upkeepOrder`） |

### Epic B — 内容数据（4 英雄）（P0，与 A 并行）

| ID | Story | P | 验收 |
|---|---|---|---|
| B1 | 内容 schema（zod）+ `ContentRegistry` 加载 | P0 | 加载失败即报错 |
| B2 | `content-lint` 工具（**14 项**自检，§2.6：含 `describe` 完备性、DSL→IR 一致性、窗口常量不可覆盖） | P0 | CI required；ability 可达性报告 |
| **B9** 🆕 | **`describe` 中英文案模板**（每 clause kind / matcher kind 各一条） | P0 | 与 A16 配套；**文案由 design 提供**，缺一则内容无法上线（B7） |
| **B10** 🆕 | **rules-lawyering 数值校准 pass**（design Q8 / R8，全部 🔶 数值对齐实体组件） | P1 | 只改数据不改代码；产出校准报告 |
| B3 | 通用状态效果库（堆叠上限/持久/定时/修饰符） | P0 | 引用完整性 |
| B4 | Barbarian 数据（骰池/能力树/卡组） | P0 | lint 通过 + 脚本化对局可跑通 |
| B5 | Moon Elf 数据 | P0 | 同上 |
| B6 | Ninja 数据 | P0 | 同上 |
| B7 | Pyromancer 数据 | P0 | 同上 |
| B8 | 4 英雄交叉对局蒙特卡洛（每对 1000 局，无崩溃） | P1 | 无异常终止；胜率写入报告供 design 参考 |

### Epic C — 联机房间与匹配（P0/P1）

| ID | Story | P | 验收 |
|---|---|---|---|
| C1 | Socket.IO 服务 + JWT 鉴权 + 连接生命周期 | P0 | 未鉴权连接被拒 |
| C2 | Room：创建/加入/座位绑定/英雄选择/开始 | P0 | 2 人进入 playing |
| C3 | MatchActor：房间串行命令队列 | P0 | 并发 100 意图不产生状态撕裂 |
| C4 | 意图管线：zod 解析 + seat 覆盖 + clientSeq 幂等 | P0 | 重放同一 seq 不重复执行 |
| C5 | 广播：per-seat 投影 + 事件 visibility | P0 | 对手客户端收不到己方手牌（断言） |
| C6 | 断线重连：**不判负** + 状态持久化 + 重连补发快照 | **P0** | 断线任意时长后重连可继续；进程重启后可恢复 |
| C7 | 挂机处置：缺席判负（手动）/ 投降 / 7 天归档 | P1 | **非自动触发**；`autoResolve` 仅作异常兜底 |
| C8 | 快速匹配队列（MVP：内存 FIFO） | P1 | 两人匹配成功 |
| C9 | 机器人对手（auto-pass 策略，用于单人体验） | P2 | 可打完一局 |

### Epic D — 对局 UI（P1）

| ID | Story | P | 验收 |
|---|---|---|---|
| D1 | 投影渲染骨架：桌面/双方面板/HP/CP/手牌数 | P1 | 与 view 一致 |
| D2 | 骰盘：掷骰/锁定/重掷次数显示 | P1 | 点击受 legalActions 门控 |
| D3 | 手牌区：打出/购买升级/卖牌 | P1 | 只渲染 legalActions |
| D4 | 英雄面板：能力树 + 升级状态 + 骰型高亮 | P1 | 命中骰型实时高亮（本地计算，仅 UI） |
| D5 | 状态 token 区 + 堆叠数 | P1 | — |
| D6 | 战斗日志（语义化事件 → 中文短句） | P1 | — |
| D7 | 对手思考中 / 倒计时 / 断线提示 | P1 | — |
| D8 | 结算反馈：伤害数字、同时结算明细行（`15⚔ + 3🔥 − 4🛡 + 2💚 = 12`） | P2 | 与 **P6** 语义一致；明细行由 `bucketFlushed` 载荷驱动 |

### Epic E — 账号与持久化 / 回放（P2）

| ID | Story | P | 验收 |
|---|---|---|---|
| E1 | 账号（邮箱/游客）+ JWT 刷新 | P2 | — |
| E2 | `MatchRecord` 落库（seed + actionLog + 终局） | P2 | 可查询 |
| E3 | 回放器：从 MatchRecord 重放并渲染 | P2 | 终局状态一致（哈希比对） |
| E4 | 对局历史列表 | P2 | — |
| E5 | 进程重启恢复（快照 + 日志重放） | P2 | 重启后对局继续 |

### 里程碑

| 里程碑 | 定义 | 完成判据 |
|---|---|---|
| **M0** 引擎可跑通单局脚本对战 | 无网络、无 UI | 从 seed 出发喂一串 action，跑完整局到分出胜负；事件序列快照稳定；**A1–A17 + B1–B4 完成**（A14/A15/A16 是 P1–P8、DSL→IR、`describe` 的落地，缺一不可） |
| **M1** 本地双人对战（热座/同屏） | 单页面两个投影视图，同一浏览器 | 两人轮流操作完成一局；投影正确（切换视角验证隐藏） |
| **M2** 联机 1v1 可用 | 两台设备真实对局 | 断线重连可用；超时托管可用；C1–C7 + D1–D6 完成 |
| **M3** 4 英雄完整 + 体验打磨 | — | B4–B8 全部；动画/日志/平衡报告；E1–E4 可选 |

> **M0 是生死线**：只要 M0 的测试基线不稳（事件快照频繁变动、出现非确定性），后续一切都是沙上建塔。M0 必须先把 §7 的 **T1–T9 + T17–T24 + T35–T36** 跑绿（即：P1–P8 阶梯、窗口栈、flush 三边界、权限令牌、DSL→IR、`describe`）。
> **B6（端到端编译验证）是 M0 的出口条件**——Barbarian + Pyromancer 编译产物必须经 design 评审通过，否则内容层的正确性没有背书。

---

## §7 测试策略要点

### 7.1 分层

| 层 | 工具 | 目标 |
|---|---|---|
| 单元 | Vitest | 每个 handler / matcher / 阶段转移一个用例组 |
| 快照（语义化） | Vitest `toMatchSnapshot` on 结构化摘要 | 事件序列回归基线 |
| 属性 | fast-check | 不变量：确定性、投影无泄漏、HP/CP 边界、无异常 |
| 集成 | Vitest + 真实 server + 2 client | 端到端管线 |
| 内容自检 | `tools/content-lint.ts` | 启动期 + CI |

### 7.2 纯函数单测设计

**确定性种子**：所有测试用 `makeTestState({ seed: 'test-42' })` 工厂；禁止测试中使用 `Math.random`。提供 `runScript(seed, actions[])` 帮助函数：

```ts
const r = runScript('seed-1', [ {t:'rollDice'}, {t:'announceAbility', ...}, ... ]);
expect(summarize(r.events)).toMatchSnapshot();   // 语义化摘要，非全 JSON
expect(hashState(r.finalState)).toMatchSnapshot();
```

**为什么用语义化摘要而非 JSON 深比较**：JSON 深比较对任何字段改名/内部表示调整都报错，产生大量「假阳性」维护成本。摘要只保留 `[seq] type(key fields)`，例如：

```
[ 1] matchStarted(hero0=barbarian hero1=ninja start=0)
[ 4] phaseEntered(turn=1 phase=upkeep)
[ 7] diceRolled(seat=0 attempt=1 values=[3,1,5,2,5])
[12] damageApplied(target=1 net=6 gross=9 prevented=3 hpAfter=44)
[13] matchEnded(winner=0)
```

**确定性双跑**：同一 script 跑两次，断言 `hashState` 相同 + 事件序列相同（含对象键顺序无关）。

### 7.3 骰型匹配器测试

- 每个 matcher kind 至少 3 例：命中 / 边界 / 不命中。
- `smallStraight`：`[1,2,3,4,4]` 命中（有 1-4）；`[1,2,3,5,6]` 不命中；`[2,3,4,5,5]` 命中。
- `largeStraight`：`[1,2,3,4,5]` 命中；`[2,3,4,5,6]` 命中；`[1,2,3,4,6]` 不命中。
- Wild 展开：含 1 个 Wild 的组合，断言 `count(symbol, n)` 能借 Wild 达成。
- 属性：`matchPattern` 对任意 5 面输入不抛异常、不产生副作用。

### 7.4 关键测试用例清单（T1–T36）

| # | 用例 | 断言 |
|---|---|---|
| **T1** | CP 上限 15 | 连续 20 回合 Income/卖牌，CP 停于 15；Income 步骤被跳过且事件记录 |
| **T2** | CP 下限 0 | 试图透支购买 → `Err('insufficientCp')`，state 结构未变 |
| **T3** | 治疗上限 = 起始 + 10 | 起始 50，治疗至 65 → HP = 60；再治疗无变化且产生 heaApplied(amount=0) |
| **T4** | 跳级升级补差价 | 未升级直接买 tier3（cost 记为 C3）扣 C3；已 tier2 再买 tier3 仅扣 `C3-C2`；断言两次总支出相等 |
| **T5** | 防御掷骰不可重掷（**P5**） | 防守阶段收到 `{t:'rollDice'}` → `Err('wrongPhase')`；`defenseRollGranted` 单次布尔，掷后即 false；事件只有一次 `diceRolled(reason:'defense')`；**但可被 Roll Phase Action 卡修改结果**（design §2.2） |
| **T6** | 不可防御伤害（**跳过 P5**） | bucket 中只有 `undefendable` / `pure` / `collateral`（`ultimate` 是 `sourceKind` 不是 `DamageType`）→ **P5 被 skip**，不为该步开窗；防守方无 `defensiveRoll` 类 PendingRequest；直接进 P6 |
| **T7** | 伤害与减伤同时累加（**P6**） | 攻击 9 + 卡牌追加 3，防守减伤 4 → `damageApplied(net=8, gross=12, prevented=4)`；**HP 一次性变化**（不是先 -9 再 -3 再 +4）——断言 `healthChanged` 事件只有 1 条 |
| **T8** | 同时归零判平局 | 防御反伤（bucket 反向条目，**`damageType:'pure'`，`sourceKind:'ability'`，`target`=攻击者**）使双方 `hpRaw <= 0` → `winner === 'draw'`；不产生两个 `matchEnded`。附加断言：反伤**不**触发 `hitSuccess`、**计入** `damageDealtAtLeast`（按 §2.4.4 `countsAsDamageDealt`，且 `turnDamageDealt` 按 `turnIndex` 重置）、**不**被 `preventDamage`/`avoidDamage` 影响，且**一次 Roll Phase 内防御掷骰 ≤ 1 次**（收敛性） |
| **T9** | 响应窗口可打牌与关闭 | P5 后 `postDefense` 窗口内仍可打 rollPhaseAction；**窗口关闭后**再打 → `Err('wrongPhase')`；窗口超时（15s）→ 自动 pass，**不是 30s** |
| **T10** | 状态堆叠上限 | 施加超过 stackLimit → 实际 stacks = stackLimit，事件 `statusStackCapped` |
| **T11** | 状态转移/消耗 | 转移后原持有者 stacks 归零、目标 ≤ stackLimit；消耗 N 层后剩余正确；消耗超过持有量 → Err |
| **T12** | 掷骰次数上限 | 第 4 次 `{t:'rollDice'}` → `Err('alreadyRolledMax')`；状态效果把 `rollAttemptsLeft` 上限改为 2 时第 3 次即 Err |
| **T13** | 先手首回合跳过 Income | `turn===1 && activeSeat===startSeat` 时 `phaseEntered('income')` 不出现；second seat 首回合有 income |
| **T14** | 投影无泄漏（属性测试） | 对 500 组随机 state × viewer：`JSON.stringify(view)` 不含对手/自己的任何 `deck` uid 与对手 `hand` uid；不含 `rng.seed`；不含 `queue` / **`bucket`** / **`windowStack`** / **`tempPools`** / `players[*].stackLimitBonus` 之外的隐藏态 |
| **T15** | 确定性回放 | 随机生成 200 条合法 action 序列跑两遍 → 终局 `hashState` 相同；再从 MatchRecord 重放 → 一致 |
| **T16** | 牌库耗尽重洗 | 抽到最后一张后继续抽 → `deckReshuffled` 事件；牌总数守恒（deck+hand+discard 恒等于初始卡组数，属性断言） |

#### 7.4.1 T17–T36：本轮新增（覆盖 design C1–C16 与新增机制）

| # | 用例 | 断言 |
|---|---|---|
| **T17** | **空响应窗口跳过**（design R7 / 控制清单 16） | 对手 `actionPermission==='none'`（Ultimate）或手牌为空且无 spendable 状态 → `shouldOpenWindow() === false`：**不产生 `pendingRequested` 事件、不产生 `windowOpen` 事件、不起定时器**。只有一方能行动时窗口只对该方开放 |
| **T18** | **窗口栈轮转与关闭**（C1） | ① 顺序恒为 `[非行动方, 行动方]`，`cursor` 推进；② 连续 2 次 pass → 关闭（不是 1 次）；③ 第 4 个动作后强制关闭 + `engineGuardTripped{guardReason:'windowActionLimit'}`，**不判负、已完成动作保持有效**；④ 单次 15s 超时 → pass（`pendingTimedOut`），**不是 30s**；⑤ **可重入**：内层窗口关闭后回到外层，且**外层 `passStreak` 不重置**（防嵌套卡刷新计数）。属性测试：随机深度嵌套窗口不爆栈、不死循环 |
| **T19** | **权限令牌栈**（P2 ULTIMATE GATE / R13 / 控制清单 20） | ① Ultimate 激活 → 对手 `effectivePermission()==='none'`，其动作返回 `DENIED`（UI 灰化）；② 对手在窗口 `eligibleSeats` 中被剔除，但**行动方自己仍可在窗口内花 CP 增强**；③ **P8 释放 `releaseAt==='cleanup'` 的令牌**；④ Stun 令牌 `releaseAt==='turnEnd'`，P8 **不**释放；⑤ **属性断言：任意一次结算结束后，若无 Stun 类持续状态，双方 `effectivePermission()` 必为 `'all'`** |
| **T20** | **骰子状态机**（§2.5.1 / 控制清单 17） | ① `rollAttemptsLeft` 初始 3，每次 `ROLL` −1，第 4 次 → `Err('alreadyRolledMax')`；② **骰子操作卡不消耗 Roll Attempt**：打 `rerollDice`/`setDieFace` 后 `rollAttemptsLeft` **不变**；③ **全锁允许**，且全锁后可直接 `CONFIRM`（等价提前结束）；④ `AWAIT_DECISION` 20s 超时 → **保持当前骰面**进 `FINAL_LOCKED`（不是自动再掷）；⑤ `FINAL_LOCKED` 15s 超时 → **自动 PASS**（无 `abilityAnnounced`）；⑥ 临时骰池 `tempPools` 判定后销毁 |
| **T21** | **flush 三边界**（design §2.3 必测，C5 / C7 / A2） | **21a**：`avoid` + `undefendable` 同时存在 → `net` 中 `undefendable` 照常生效（avoid 只清 defendable + collateral）<br>**21b**：`hp=5, net=10, healing=8` → `hpRaw=3 > 0` → **存活**（治疗能救回死亡；`hp − net <= 0` 本身不判负）<br>**21c**：`healing` 把 HP 推过 60 → clamp 到 60，**不报错、不抛异常**，产出 `healApplied(applied < requested)`<br>附加断言：`hpRaw <= 0` 时**不做 clamp**——封顶不救死亡 |
| **T22** | **Stun 先于伤害**（C2） | Stun 在 P3 立即施加，**早于**任何伤害写入生效；断言事件顺序 `statusApplied(stun)` 先于 `damageAccumulated`；已写入 bucket 的伤害**照常结算**（Stun 不取消伤害） |
| **T23** | **Stun 额外 Offensive Roll Phase**（C3） | ① **先完整 flush 当前 bucket（含死亡判定）**，再开新一轮 P1；② 若对手已被打死 → **不再触发**额外回合；③ 断言两轮 P1–P8 各自完整、事件序列可分界 |
| **T24** | **治疗时序可配置**（C4） | `HEAL_TIMING` 常量默认 `'simultaneous'`：治疗与伤害净额；切到 `'immediate'` 时治疗立即生效。**两种模式下 T21b 的结果不同，用例需参数化跑两遍**，快照分别存 |
| **T25** | **avoid 不清 hitSuccess**（C7） | 攻击被完全闪避 → `net === 0`，但 `resolution.hitSuccess === true`；**后置效果（Then / Additionally）与条件卡照常触发**；`onDamageDealt` **不触发**（`net` 不 `> 0`）。这条断言把两个钩子的分离钉死 |
| **T26** | **Upkeep 排序**（C6） | ① **先扣血类（Poison / Burn），再资源衰减类**；② **每结算一个状态做一次死亡判定**（不是全部结算完才判）；③ **无玩家输入、不产生挂起点** —— 断言 `PendingRequest.kind` 中不再出现 `upkeepOrder` |
| **T27** | **rollDicePool 的修改窗口**（C8 / A17） | "Roll N" 产生的骰子**只能在其自身 `trigger:'rollPool'` 窗口内**被 Roll Phase Action 卡修改；窗口关闭 / 判定完成 → 骰池销毁，之后再打改骰卡 → `Err('unknownEntity')` 或不生效；同一 `on` 符号的 case **只结算一次**（A16） |
| **T28** | **转移超额回滚**（C9） | `transferStatus` 目标已满 `stackLimit` → **回滚**，token **留在原持有者身上、不销毁**；断言双方 stacks 总数守恒 |
| **T29** | **移除 "any" 的选择权**（C10） | 归属**效果的发起方**（施加者选择）；若效果属于自己（自救）→ 由自己选择。断言挂起点的 `seat` 正确 |
| **T30** | **施加已满 stackLimit 的状态**（C11） | **施加失败**：`statusApplied(ok:false)`；**不消耗任何代价**（CP 不变、手牌不进弃牌堆）、**不触发任何后置效果**；**但计入日志**（玩家要能看到"为什么没生效"） |
| **T31** | **Instant 不支持真打断**（C12） | 效果序列执行中途，对手打出 Instant 卡 → `Err('wrongPhase')`（不在响应窗口内）；在响应窗口内 → 合法。`interruptibleAt` 类机制不存在 |
| **T32** | **超时保守默认矩阵**（C13 + design §2.1） | 逐条断言默认值表：MAIN 60s→自动结束；`AWAIT_DECISION` 20s→保持骰面进 FINAL_LOCKED；`FINAL_LOCKED` 15s→自动 PASS；防御掷骰 15s→**自动掷骰**；弃牌 15s→**自动卖最右侧 N 张且不卖 0 费卡**；响应窗口 15s→pass。**逐条一条用例** |
| **T33** | **单防御能力自动掷骰**（C15） | 只有 1 个防御能力 → **自动掷骰**（无 `chooseDefensiveAbility` 挂起点）；但**保留「是否消耗 Evasive 类 spendable 状态」的独立窗口**。若有多个防御能力 → 先选择再掷 |
| **T34** | **PASS 不进防御掷骰**（C16） | P1 选择 PASS → **直跳 P8**：断言无 `defensiveRoll` 事件、无 `pendingRequested(kind:'defensiveRoll')`、无窗口；玩家可自愿放弃（即使有可用候选） |
| **T35** | **DSL→IR 编译快照**（§2.7 / B6） | 对 Barbarian + Pyromancer 全量内容跑 `compileHero()` → 断言产物与 `__ir_snapshots__/` 一致；断言 DSL 中所有 `then` 节点都编译为 `openWindowThen`（**无一个编译成 `next`**）；悬空 `var` → lint 失败 |
| **T36** | **`describe` 输出校验**（§2.6.1 / R15） | 对每个 clause kind 的每个实例调 `describe(e,'zh')` / `describe(e,'en')`：断言非空、不含 `undefined` / `NaN` / `[object Object]`、长度 ≤ UI 上限；缺失 describer → `content-lint` 失败 |

#### 7.5 design 裁决 C1–C16 → 测试用例映射表（主理人验收用）

| design 裁决 | 一句话 | 覆盖用例 | 覆盖位置 |
|---|---|---|---|
| **C1** | 响应窗口：交替响应、连续 2 次 pass 关闭、硬上限 4、15s 超时 | **T18** | §2.4.3 |
| **C2** | Stun 先于伤害；已入桶伤害照常结算 | **T22** | §2.4.2 P3 |
| **C3** | Stun 触发额外 ORP：先 flush 完再开；对手已死不触发 | **T23** | §2.4.2 P7→P8→P1 |
| **C4** | 治疗时序默认 `simultaneous`，可配置 | **T24** | §2.4.4 / 常量 `HEAL_TIMING` |
| **C5** | 治疗可把人从死亡线救回 | **T21b** | §2.4.4 |
| **C6** | Upkeep：先扣血类 → 再资源衰减；逐状态死亡判定；无挂起点 | **T26** | Phase `'upkeep'` |
| **C7** | avoid 只吃 defendable + collateral；`hitSuccess` 仍置位，后置照常触发 | **T21a / T25** | §2.4.4 |
| **C8** | "Roll N" 骰子只可在自身判定窗口内被改，判定后销毁 | **T27** | §2.5.1 / §2.7 |
| **C9** | 转移超额回滚，token 留在原持有者 | **T28** | §3.3 `transferStatus` |
| **C10** | "移除任意 N 个" 选择权归发起方 | **T29** | §3.3 `removeStatus(statusId:'any')` |
| **C11** | 施加已满 stackLimit → 失败、不消耗代价、不触发后置、记日志 | **T30** | §3.4 / status 模块 |
| **C12** | Instant MVP 不支持真打断，只在响应窗口内打出 | **T31** | §2.5.1 / 控制清单 18 |
| **C13** | 超时走保守默认 | **T32** | §2.4.5 默认值表 |
| **C14** | 断线 60s 宽限 + 重连补发快照 | **I2**（集成） | §1.3 / ADR-002 |
| **C15** | 单防御能力自动掷骰，但保留 spendable 状态窗口 | **T33** | §2.4.2 P5 |
| **C16** | 攻击方可 PASS，不进防御掷骰 | **T34** | §2.4.2 P1 |

> **覆盖结论：C1–C16 十六条裁决 100% 有用例覆盖**（14 条单测 + 1 条集成 + C5 合并进 T21b）。每条裁决都同时钉在「架构章节」与「用例编号」两处，任一处改动都会在 PR 里暴露。

**补充集成用例**

- **I1**：两客户端连接，任一方的 socket 帧中 `JSON.parse` 后不含对手手牌（在传输层断言，不只引擎层）。
- **I2**：中途断线 30s 重连 → 收到完整快照，可继续操作，state hash 与断线前一致。
- **I3**：并发 50 个意图同时到达 → 全部串行应用，`seq` 严格递增，无丢失无重复。
- **I4**：回放器重放 M0 脚本 → 终局 hash 一致。

### 7.6 回归基线

- `tests/__snapshots__/` 全部入版本库，变更必须显式 `vitest -u` 并在 PR 中说明**为什么**事件序列变了。
- 建立 `tests/regression/scripts/*.ts`：「黄金对局脚本库」，每个英雄对局至少 3 条（快攻/控制/长局），CI 每次跑。
- 引擎 `engineVersion` 语义化：任何**改变事件序列**的改动必须 bump minor，并在 `docs/CHANGELOG-engine.md` 记录；回放按 `engineVersion` 路由到对应 reducer（MVP 可只支持最新版，超版本拒绝回放）。

---

## §8 架构评审

### 判定：**PASS**（技术架构无阻塞项，可进入 M0）

**v0.1 的 CONCERNS 两条技术阻塞（B1 / B2）已由 DT-ARCH-002 的五项裁决全部解除**，本轮交叉核对未发现任何新的技术不可行项。因此判定升级为 **PASS**。

但 PASS 是有条件的，主理人需同时记录这两句话：

> **① 唯一遗留 BLOCKER = B3（IP 路径），它是非技术问题，需用户拍板。它只阻塞「公开发布」，不阻塞「M0 原型 / 自用」。**
> **② 另有 B5–B8 四项「M1 前必须处置」项（非阻塞架构、但会拖慢 M1），见 8.1。**

### 8.1 阻塞项（Blockers）

| # | 阻塞项 | 状态 | 影响 | 建议处置 | 责任方 |
|---|---|---|---|---|---|
| ~~**B1**~~ | ~~结算阶梯（R0–R8）与 design 状态机未对齐~~ | ✅ **RESOLVED**（裁决 1） | — | 已改用 design 的 **P1–P8**；`ResolutionStep` 枚举与 design §2.3 逐条锁死（§2.4.2）。**双方不得再单方改名** | 已闭环 |
| ~~**B2**~~ | ~~`then` / `onDamageDealt` 触发语义未钉死~~ | ✅ **RESOLVED**（裁决 4） | — | 已分离 `hitSuccess`（命中即置位）与 `onDamageDealt`（`net > 0`，按 `resolutionId`+目标+`flushBatch` 触发）。见 §2.4.4 | 已闭环 |
| **B3** | **IP 版权风险未处置** | 🔴 **保留（唯一 BLOCKER）** | 《王权骰铸》官方数字版预计 2027 上线；直接复刻规则 + 卡面文本 + 4 个官方英雄名有侵权风险 | 三条路径择一：① 仅限自用/学习，不公开部署；② **重皮主题化**（自创世界观/英雄名/美术，保留 dice-draft 机制——机制本身通常不受版权保护）；③ 联系 Roxley 授权。**MVP 建议先按 ① 做，公开前必须走 ②。这不是技术问题，需主理人/用户拍板** | 主理人 / 用户 |
| **B4** | **4 英雄完整内容数据的准确性来源** | 🟠 **保留（排期）** | 4 英雄 × (6 骰面 + ~9 能力 + ~20 卡) 逐条录入；任何一个符号配错都会造成「能力永远无法触发」或「过强」 | 以官方英雄小册子为核对源建立 checklist；靠 `content-lint` 可达性自检兜底。**工作量约为引擎内核的 1.5 倍，排期不能低估** | 主理人（排期）+ 我（工具） |
| **B5** 🆕 | **`collateral` 伤害在 1v1 的归属未定** | 🟡 低（M1 前） | 影响 flush 的三桶统一处理与「是否算 Attack」判定 | 我按默认实现：写入 bucket 时即解析 `toSeat` = 非来源方，`countsAsAttack = false`。**需 design 一句话确认**（附录 B 第 7 条） | design |
| **B6** 🆕 | **DSL ↔ IR 编译契约需一次端到端验证** | 🟠 中（M0 末） | 降级规则（§2.7）是我单方给出的，若某条保不住语义（尤其 `graded` / `rollDice.cases` / `bindRemovedTo`），内容作者会写出「能编译但行为不对」的数据 | **M0 结束前用 Barbarian + Pyromancer 做一次端到端编译验证**（这两个英雄覆盖 `graded` / `rollDicePool` / `bindRemovedTo` / `then` / `countFace` 全部高风险构造），产出 IR 快照由 design + 我共同评审 | 我 + design |
| **B7** 🆕 | **`describe(e, lang)` 的文案模板由谁交付** | 🟠 中（M1 前） | 缺模板 → lint 失败 → 内容无法上线；而文案不是我能凭空写的（要符合 design 的术语） | **分工：我提供 `DESCRIBERS` 函数骨架与注册表机制（§2.6.1），design 提供每个 kind 的中英文案模板。** 需主理人把文案交付排进 B Epic | 主理人（排期）+ design（文案）+ 我（骨架） |
| **B8** 🆕 | **数值校准（design Q8 / R8）未排期** | 🟡 低（M1 前） | 部分英雄数值为 🔶 待校准；配错不影响引擎正确性但影响平衡 | 安排一次 rules-lawyering pass（0.5–1 人日，只改数据不改代码）。DSL 让这件事成本很低 | 主理人（排期） |

### 8.2 已知风险与缓解

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| **R1** | **Socket.IO 长连接在移动网络下频繁断断续续** | 高 | ① 房间 Actor 串行 + `actionLog` 幂等，重连补发**全量快照**（MVP 状态小，< 50KB，可接受）；② 60s 宽限 + 托管；③ 客户端心跳 + 指数退避重连；④ 断线期间用「对手思考中」而非「掉线」表达，避免被恶意利用 |
| **R2** | **信息隐藏做错 → 作弊**（最严重的正确性风险） | 高 | ① 结构化白名单投影（fail-safe 而非 fail-open）；② T14 属性测试在 CI required；③ I1 在**传输层**断言；④ 服务端不下发 `rng` / `deck` / `queue` / **`bucket`（未 flush 的桶）** / **`windowStack`** / **`tempPools`**；⑤ 不预掷骰（物理上不存在未来骰值）；⑥ 🆕 `bucket` 未 flush 时**绝不可下发**——它包含尚未生效的伤害与闪避标志，泄露等于让对手预知结果 |
| **R3** | **规则引擎边界情况爆炸，维护成本失控** | 高 | ① 所有效果走 `EFFECT_HANDLERS` 注册表，新增效果 = 加一个纯函数 + 一个 kind，不改调度器；② 引擎守卫（深度/帧数上限）防死循环；③ 黄金对局脚本库做回归基线；④ 每个 bug 必须补一条脚本化用例才能关闭（写进 DoD） |
| **R4** | **内容数据量大且易错** | 中 | `content-lint` 10 项自检 + 可达性蒙特卡洛 + 平衡性报告；内容变更走 PR 且必须附报告 diff |
| **R5** | **前后端引擎同构带来的「客户端以为自己能算」的诱惑** | 中 | ESLint 强制 `views/` 禁引 `engine`；`PlayerView` 类型层面不含 `rng`/`state`；code review checklist |
| **R6** | **非确定性悄悄混入**（`Object.keys` 顺序、浮点、Set/Map 迭代顺序、并行 Promise） | 中 | ① 控制清单禁用 API + grep 单测；② T15 双跑 + 重放一致性；③ 数值全整数，不用浮点；④ 状态内集合一律用**数组**而非 Set/Map（保证序列化与顺序稳定） |
| **R7** | **MVP 房间状态在内存 → 进程崩溃丢局** | 中 | MVP 接受；E5（快照 + 日志重放）在 M2 后补。短期缓解：开局前不承诺、崩溃后自动判为无效局并退还 |
| **R8** | **IP 版权**（同 B3，但作为持续风险） | 高 | 见 B3； additionally：内容包中不存储官方卡面文本/图像，只用机制化 `name` + `description`；仓库 README 明确声明用途 |
| **R9** | **1v1 先行 vs 后续 2-6 人扩展的结构性返工** | 中 | 已在类型层预留：`players` 为元组但 `Seat` 可扩、`TargetRef` 有 `opponent`/`seat`、`confirmTarget` action 已存在、`confirmSeat` 抽象。M2 后扩展玩家数时主要改 `players` 结构与 targeting 规则，引擎核心不动。**但不要现在就为多人做抽象**——YAGNI |
| **R10** | **引擎版本演进导致旧回放失效** | 低 | `engineVersion` 记录 + 回放时校验；MVP 直接拒绝跨版本回放 |
| **R11** 🆕 | **响应窗口栈的交互体感**：等对手响应 15s 很难受（design R7） | 中 | ① **服务端跳过空窗口**（`shouldOpenWindow`，§2.4.3）——对手无牌可打且无 spendable 状态 → **根本不开窗**；② 乐观 UI + 服务端回滚（锁定骰子即时反馈）；③ 窗口只在真正有多种可能时才弹。**这条被 design 列为强制项 → 控制清单第 16 条 + T17 断言** |
| **R12** 🆕 | **窗口栈可重入导致的状态爆炸 / 无限循环** | 中 | ① 单窗口硬上限 4 动作（`engineGuardTripped` + 强制关闭，不判负）；② 连续 2 pass 关闭，且**内层关闭不重置外层 `passStreak`**（防嵌套卡刷新计数）；③ 全局 `MAX_RESOLVE_DEPTH=64` / `MAX_FRAMES_PER_RESOLUTION=512` 兜底；④ 属性测试：随机深度嵌套窗口不爆栈、不死循环（T18） |
| **R13** 🆕 | **`ActionPermission` 令牌栈泄漏**（P8 没正确释放 → 玩家永久卡死不能行动） | **高** | ① 令牌带 `releaseAt: 'cleanup' \| 'turnEnd' \| 'manual'` 与 `openedAtSeq`，P8 只释放 `releaseAt==='cleanup'` 的；② **单测断言：任何一次结算结束后，若无 Stun 类持续状态，双方 `effectivePermission()` 必须为 `'all'`**（T19）；③ 对局结束/阶段切换时做一次「令牌泄漏巡检」断言（属性测试） |
| **R14** 🆕 | **DSL → IR 降级不保语义**（编译通过但行为不对） | 中 | ① IR 产物进版本库快照，编译逻辑改动 → PR 里暴露为 diff，双方评审；② Barbarian + Pyromancer 端到端编译验证（B6）；③ **禁止编译期静默改语义**（§2.7 硬约束 2）；④ DSL 的 `then` 只允许编译到 `openWindowThen`（lint 断言） |
| **R15** 🆕 | **`describe` 缺失导致玩家看到 `/[object Object]/`** | 低 | ① `content-lint` 第 11–12 项强制每个 kind 有 describer 且输出非空、不含 `undefined`/`[object Object]`；② 战斗日志与 UI **只消费 `describe` 输出**，不允许前端自己拼串 |

### 8.3 一页控制清单（Control Manifest，程序员可立即执行）

1. **`packages/shared` 内禁止**：`Math.random`、`Date.now`、`new Date()`、`crypto.randomUUID`、任何 IO、`node:*` 导入、DOM 全局。ESLint + 单测 grep 双重拦截。
2. **`EffectDef` 内禁止函数/闭包/class/Symbol/正则**。所有行为通过 `kind` + 注册表查找。
3. **状态内集合用数组，不用 Set/Map**（保证序列化与顺序确定）。
4. **数值一律整数**，禁用浮点累加。
5. **`reduce` 是唯一入口**；禁止在引擎外直接 mutate `GameState`（全部 `readonly`，编译期保证）。
6. **校验与执行不分离**：不要写 `canDo()` + `doIt()` 两份逻辑；用 `reduce` 返回 `Result`。
7. **三种链式构造不可混用**（v0.2 修订）：`EffectDef.next` = 链式后续，**pushFront、不开窗**；`openWindowThen` = design 的 Then 节点，**先 pushFront 保序 → 再开窗 → 关闭后续跑**；`additionally` = 延迟到 **P7**。`sequence` 用 pushBack。
8. **`PendingRequest.autoResolve` 必填**，zod `.nonoptional()` 强制。**响应窗口的 `autoResolve` 恒为 `pass`，不允许内容或房间设置覆盖。**
9. **伤害只写 `DamageBucket`，HP 只在 P6 写一次**（全引擎唯一允许写 HP 的地方）。`hpRaw <= 0` 判负，`min(startHp+10, hpRaw)` 封顶**不救死亡**。
10. **投影用独立 `PlayerView` 类型 + 显式 mapper**，禁止 `delete` 式黑名单脱敏。
11. **`web/src/views/**` 禁止 import `@dt/shared/engine`**；只允许 `web/src/sandbox/**`。
12. 随机数实现自带（sfc32），**不引第三方 PRNG 包**。
13. 每个 bug fix 必须附一条脚本化对局用例（DoD）。
14. 事件序列快照变更必须在 PR 描述中说明原因。
15. 内容数据只用机制化描述，**不录入官方卡面文本或图像**。
16. **服务端跳过空响应窗口**（`shouldOpenWindow`，design R7 强制）：对手 `actionPermission='none'` 或「无牌可打且无 spendable 状态」→ **根本不开窗**，不产生挂起点、不产生倒计时。由 **T17** 断言。
17. **骰子操作卡（`setDieFace` / `rerollDice`）不得递减 `rollAttemptsLeft`** —— handler 内禁止触碰该计数器（design §2.2）。由 **T20** 断言。
18. **Instant Action Card MVP 不支持真打断**：只能在响应窗口内打出，与 Roll Phase Action 同窗口（design C12/Q9）。`Effect.interruptibleAt` 类机制**永不实现**——任何相关提议必须走 ADR 修订，不得直接加代码。
19. **窗口与权限常量不可被内容覆盖**：`passStreakToClose=2`、`maxActions=4`、`windowTimeoutMs=15000`、`actionPermission` 全部是引擎常量。内容中出现相关字段 → `content-lint` 第 13 项失败。
20. **P8 必须释放 `releaseAt==='cleanup'` 的权限令牌**，且结算后双方 `effectivePermission()` 必须为 `'all'`（除非有 Stun 类持续状态）。令牌泄漏 = 玩家永久卡死，**属 P0 级 bug**（R13 / T19）。

---

## 附录 A：与设计侧的术语/接口契约（供主理人对齐）

| 接口 | 我方提供 | 需 design 侧提供 |
|---|---|---|
| 能力激活 | `DicePatternMatcher`（可组合的声明式结构） | 每个能力的骰型定义（用该结构或可编译到它的 DSL） |
| 能力效果 | `EffectDef` IR + `EFFECT_HANDLERS` 支持列表 + `DESCRIBERS` 描述表 | 每个能力的效果（DSL 或直写 IR）；**若需要新的 clause kind，提前告知我**（新增 kind = handler + describer 缺一不可） |
| 结算顺序 | `ResolutionStep` 枚举 **P1–P8**（✅ 已与 design §2.3 锁死，B1 RESOLVED） | ~~1:1 映射确认~~ → **已完成**。此后任一侧改名必须同步本表 |
| 响应窗口 | `WindowStack` + `ResponseWindow` + `WindowActionKind`（✅ 已按 design §1.2 实现：固定顺序 / 2 pass 关闭 / 4 动作上限 / 15s 超时） | ~~每个窗口「谁能打什么牌」的规则~~ → **已完成**（`'rollPhaseCard' \| 'instantCard' \| 'spendStatus'`）。待确认：`preDefense` / `preFlush` 窗口 MVP 是否真的不需要（见 §8.2 R13） |
| 超时默认 | `PendingRequest.autoResolve` | ✅ design §2.1 已给出默认值表（见 §2.4.5）；**除响应窗口恒为 pass 外**，其余每类挂起点的默认选择若有新增需补 |
| 状态效果 | `StatusEffectDef`（stackLimit / persistent / **spendable** / hooks / modifiers / **stackLimitBonus**） | 每个 token 的具体数值与生命周期 |
| 卡牌 | `CardDef`（kind / **actionTiming** / timings / cpCost / effects / **playCondition**） | ✅ 时机矩阵已确认并落成 4 个常量（§2.5.1）：`preRoll` / `postFinalLocked` / `responseWindow(then)` / `responseWindow(preDefense\|postDefense)` |
| 描述文案 | `DESCRIBERS` 注册表机制 + `describe(e, lang)` 函数骨架 | 🆕 **每个 clause kind / matcher kind 的中英文案模板**（B7）。缺文案 = lint 失败 = 内容无法上线 |
| 权限令牌 | `ActionPermissionToken` 栈 + `effectivePermission()`（✅ P2 ULTIMATE GATE 已落地） | 确认 Stun 的释放时机（`turnEnd`）与 Ultimate 的释放时机（`cleanup`）是否与桌面规则一致 |

## 附录 B：待确认规则细节 —— v0.2 状态更新

> v0.1 列的 6 条里，**第 4 / 5 / 6 条已由 design C6 / C2·C5 / P2 裁决**，不再待确认；仍待复核的降为 3 条，并新增 1 条。

| # | 问题 | v0.2 状态 | 落地 |
|---|---|---|---|
| 1 | 弃牌堆是否对双方公开？ | ✅ **design DT-DES-002 确认：公开**（桌游中公开）。UI 默认折叠为「数量 + 聚合摘要」，卡面点击才展开 | `OpponentPlayerView.discard` |
| 2 | 玩家自己能否查看自己的牌库顺序？ | ✅ **design DT-DES-002 确认：不能**（只给 `deckCount`）。**但自己可见聚合计数**：`SelfPlayerView.remainingDeckCounts` + `unknownInDeck`（MVP 恒 0），由 **mapper 从 `hero.deck` 常量现场算出**，不从 `state.deck` 变形 | 投影白名单 + 守恒断言（lint 第 16 项） |
| 3 | 顺子判定时 Wild / 可变面如何参与？ | **保留默认：可充当任意值参与连号**。design §1.3 的 `smallStraight` 描述未覆盖 Wild → **仍需 design 一句话确认**（低风险，改一个常量即可） | `matchPattern` 常量 `WILD_PARTICIPATES_IN_STRAIGHT` |
| 4 | ~~Upkeep 多效果排序权归谁？~~ | ✅ **已裁决（design C6）**：**先扣血类（Poison / Burn），再资源衰减类**；**每结算一个状态做一次死亡判定**；**无玩家输入、不产生挂起点** | `Phase='upkeep'` 的执行顺序常量；`PendingRequest.kind` **移除 `upkeepOrder`** |
| 5 | ~~反伤是否走同一账本、是否可防御？~~ | ✅ **已裁决**（design §8.4-④）：走**同一 bucket 的反向条目**（`fromSeat` = 防守方），`damageType` = **`pure`**（不是 `undefendable`、更不是 `collateral`）；**防御反伤** `sourceKind:'ability'`（`target`=攻击者）、**自我反噬** `sourceKind:'recoil'`（`target`=self）。不可防御、不可增强、不计入 `hitSuccess`；`damageDealtAtLeast` **按 `sourceKind` 细分**（防御反伤计入、自我反噬不计入，`turnDamageDealt` 按 `turnIndex` 重置）；`onDamageDealt` 照常计入 | §2.4.4 边界第 4–5 条 + T8 |
| 6 | ~~Ultimate 是否完全跳过响应窗口？~~ | ✅ **已裁决：是**（P2 ULTIMATE GATE 置对手 `actionPermission='none'` 直至 P8）。**但行动方自己仍可在窗口内花 CP 增强**（design §1.2） | §2.4.2 P2 + §2.4.3 |
| 7 | 🆕 **`collateral` 伤害在 1v1 归属谁？** | **默认：写入 bucket 时即解析 `toSeat` = 非来源方**，但 `countsAsAttack = false`（不触发 P5 防御掷骰、不算 Attack、不可被攻击修正增强）。**需 design 确认** | `BucketEntry.toSeat` |
| 8 | 🆕 **`AbilityTier.upgradeCostCP` 是「差价」还是「累计总价」？** | **默认：累计总价**（与 T4 断言自洽）。design §1.4-2 的两句描述互斥，**需 design 一句话确认**——漏掉会导致整棵升级树定价错误 | §3.4 注释 / `AbilityDef.cpCost` |

---

## §9 对齐修订记录（DT-ARCH-002）

> 主理人裁决 DT-ARCH-002 共 5 项 + 1 组「还需补充」。下表逐条给出**落地章节**与**改了什么**，供主理人验收。
> 依据：`design/dice-throne-design-spec.md` §1（C1–C16）、§2（状态机与 P1–P8）、§3（DSL）、附录 A（硬约束）；`design/hero-schema-draft.md` §1。
> 裁决原则：**design 侧是玩法权威，冲突处以 design 为准。**

### 9.1 五项裁决的落地位置

| 裁决 | 落地章节 | 具体改动 |
|---|---|---|
| **① 结算阶梯改用 P1–P8** | **§2.4.2**（重写）<br>**§3.6**（`ResolutionStep` 枚举）<br>**§3.6**（`ResolutionContext`）<br>**§7**（T5/T6/T7/T9 改名）<br>**§8.3** 控制清单 7/9 条 | · `ResolutionStep` 由 10 步 R0–R8 改为 **8 步 P1–P8**：`activate` / `ultimateGate` / `effectWalk` / `responseWindow` / `defensiveRoll` / `simultaneous` / `postThen` / `cleanup`<br>· v0.1 的 `R0 EFFECT-EMIT` **并入 P3**；`R1+R2 → P3`；`R4 → P5`；`R5+R6 → P6`；`R7 → P7`；`R8 → P8`<br>· **新增 P1 ACTIVATE**：服务端用 matcher 算 `ActivationCandidate[]`，玩家单选 1 个或 **PASS**；**PASS → 直跳 P8，不进 P5、不开窗**（C16）<br>· **新增 P2 ULTIMATE GATE**（v0.1 完全缺失的功能缺口）：Ultimate → 对手 `actionPermission := 'none'` 保持到 P8 结束；Blind 生效 → 激活失败跳 P8<br>· `targeting` 保留枚举位但 1v1 恒为 no-op（不写逻辑，YAGNI） |
| **② 响应窗口改为可重入窗口栈** | **§2.4.3**（新增）<br>**§3.6**（`ResponseWindow` / `WindowStack`）<br>**ADR-003 S2 / S4** | · 窗口**不再**是挂在阶梯上的固定 W1/W2/W3，改为 **`WindowStack`**；`P4 responseWindow` 只是「栈非空时引擎的停留态」<br>· `finalCardWindow` 从 `ResolutionStep` **移除**<br>· 轮转：**固定顺序 `[非行动方, 行动方]`**（不是交替计数），`cursor` 游标推进<br>· **连续 2 次 pass → 关闭**（`passStreakToClose = 2`）<br>· **单窗口硬上限 4 个响应动作**；超限 → `engineGuardTripped{guradReason:'windowActionLimit'}` + 告警 + **强制关闭**（不抛异常、不判负、已完成动作保持有效）<br>· **15s / 次超时视为 pass**（v0.1 的 30s 作废；MAIN 阶段保持 60s）<br>· **可重入**：窗口内打出的卡若含 Then 节点 → 再 push 一层；内层关闭回外层，**外层 `passStreak` 不重置**（防嵌套卡刷新计数）<br>· `then` 的语义修正为「**先 pushFront 保序，再开窗，窗口关闭后继续跑 steps**」—— 见 §9.2<br>· `LADDER[i].opensWindow?: WindowSpec` 仍有效，且能表达「由 effect 动态开窗」（`openWindowThen` / `rollDicePool` 的 `rollPool` 窗口） |
| **③ Roll Phase Action 卡的时机矩阵** | **§2.5.1**（新增「四个可打时机」表）<br>**§3.4**（`PlayTiming` 重定义）<br>**§2.6** 控制清单 | · 四时机落成常量 `ROLL_PHASE_CARD_TIMINGS`：① `preRoll`（每次 ROLL 前的 `AWAIT_DECISION`）② `postFinalLocked` ③ `responseWindow` + trigger `'then'` ④ `responseWindow` + trigger `'preDefense'`/`'postDefense'`<br>· `PlayTiming` 由 `'mainPhase'\|'offensiveRoll'\|'targeting'\|'defensiveRoll'\|'anyResponseWindow'` 改为 **`'mainPhase' \| 'preRoll' \| 'postFinalLocked' \| 'responseWindow'`**<br>· ①② **不开窗、不挂起**（直接打）；③④ 走窗口栈<br>· MVP 只实现 `postDefense`，`preDefense` 保留枚举位<br>· **Instant 类卡 MVP 不支持真打断**，只在响应窗口内打出（design C12/Q9，主理人已采纳）——写入 §2.5.1 与控制清单第 18 条；真打断（`interruptibleAt`）**永不实现** |
| **④ 伤害桶分桶 + flush 公式** | **§2.4.4**（重写）<br>**§3.3**（`DamageType` / `BucketKind` / `BUCKET_OF`）<br>**§3.6**（`DamageBucket` / `BucketEntry` / `HealEntry` / `AvoidEntry`）<br>**§3.8**（`bucketFlushed` + `FlushDetail` 载荷）<br>**§7**（T21a/b/c） | · `DamageLedger` → **`DamageBucket`**，六桶：`defendable` / `undefendable` / `collateral` / `healing` / `prevention` / `avoidFlags`<br>· `GameState.ledger` → **`GameState.bucket`**；`ledger.ts` → **`bucket.ts`**<br>· flush 公式改用 design 版：`net = max(0, defendable − prevention) + undefendable + collateral`；`hpRaw = hp − net + healing`；`hp = min(startHp+10, hpRaw)`；**`hpRaw <= 0` 判负，封顶不救死亡**<br>· `avoid` 只清 `defendable` + `collateral`，**不清 `undefendable`**（C7），且**不清 `hitSuccess`**<br>· **治疗可以救回死亡**（C5）：HP=5 受伤 10 治疗 8 → `hpRaw = 3`，**存活**<br>· **区分两个钩子**：`hitSuccess`（命中成功，即使被 avoid / 减到 0 也置位 → 驱动 Then / Additionally / 条件卡）vs `onDamageDealt`（**需 `net > 0`**，按「`resolutionId` + 目标 seat + `flushBatch`」三元组各触发一次）<br>· `DamageType` **四分类**：`attack` / `undefendable` / `collateral` / `pure`，另加 `ultimate`（来源标记）与 `self`（反噬，不置 `hitSuccess`） |
| **⑤ DSL / IR 分层与降级规则** | **§2.6.1**（`describe` 契约）<br>**§2.7**（新增：降级规则表）<br>**§3.2 / §3.3**（matcher 与 IR 扩展）<br>**§5.1**（`dsl/compile.ts`、`content/describe.ts`）<br>**§6**（新增 Story） | · 明确**两层**：DSL 是作者层（design `hero-schema-draft.md` §1），IR 是引擎层（本文 §3.3）；**DSL → IR 一次编译/降级**，编译期完成、运行期零开销<br>· 编译时机决策：**加载期编译 + 缓存**（`ContentRegistry` 初始化），CI 跑**产物快照测试**（T32）<br>· 降级规则逐条给出：`graded` / `atLeast` / `countFace` / `rollDice.cases` / `bindRemovedTo` / `optional` / `then` / `if` / `repeat` / `avoidDamage` 等<br>· 两条硬约束：① **DSL 的 `then` 只能编译到 `openWindowThen`，禁止编译到 `next`**；② **降级必须保语义且可 diff**（IR 产物进版本库）<br>· 校验器覆盖 DSL 层（zod），与启动期 `validateContent()` 合并（§2.6 L3 第 11–14 项）<br>· **内容包必须提供 `describe(e, lang)`**（design 附录 A 第 7 条 / E6），否则玩家看到 JSON；`DESCRIBERS` 注册表与 `EFFECT_HANDLERS` 同构，缺任一 → lint 失败 |

### 9.2 `then` 语义的精确保留（裁决 2 要求「说清先后」）

design 的 `then` 节点 = **「打开一个响应窗口，窗口关闭后再继续执行后续 steps」**。它与「链式保序」是**两件事**，本架构把两者都保留，先后固定为三步：

```
① 编译/入队期：把 steps 以 pushFront 插到紧随其后   ← 「保序」：steps 不会被全局队尾的其他帧插队
② 执行期：openWindowThen 帧执行 → push 窗口栈 → 引擎挂起等待响应
③ 窗口关闭（连续 2 pass / 4 动作上限 / 全部超时）→ 恢复执行，队首即 steps，按序继续
```

- **先后明确**：**先保序（①，入队时），再开窗（②，执行时），关闭后续跑（③，恢复时）。**
- 因此 `EffectDef` 需要**两个**不同字段，不能合并：
  - `EffectDef.next` —— 链式后续，**pushFront**，**不开窗**（v0.1 的 `then` 更名而来，见 §9.3）
  - `{ kind:'openWindowThen', steps }` —— design 的 Then 节点，**开窗 + 挂起**
  - `{ kind:'additionally', effects }` —— design 的 Additionally，**延迟到 P7**

### 9.3 本轮的自主工程决策（非 design 裁决，需主理人知悉）

| # | 决策 | 理由 |
|---|---|---|
| D1 | `EffectDef.then` **更名**为 `EffectDef.next` | design 术语中 "Then" 专指「响应窗口节点」。与「链式后续」共用一个词必然导致内容作者配错（把该开窗的配成不开窗）。改名成本 = 一次全仓库重命名；收益 = 消除一类高频规则 bug |
| D2 | `DamageLedger` → `DamageBucket`，`GameState.ledger` → `GameState.bucket` | 与 design 术语同构，减少跨文档心智转换；分桶后「扁平账本」这个名字已经不准确 |
| D3 | 权限令牌做成**栈**（`ActionPermissionToken[]`）而非 design 草案的单值 `'all'\|'none'` | Ultimate 与 Stun 可能叠加；单值无法正确「恢复」——P8 释放 Ultimate 令牌时若 Stun 仍在，不能误恢复为 `'all'`。栈 + `effectivePermission()` 求值可正确处理嵌套 |
| D4 | `WindowStack.order` 用**固定序列 + cursor**，而非「交替计数」 | 固定序列可被序列化、可被回放、可确定性重放；「交替计数」依赖于历史计数，一旦中途有人被剥夺资格就会错位 |
| D5 | DSL 编译放在**加载期**而非构建期 | 内容即代码（§2.6），编译成本 < 10ms/英雄；编译失败在启动期暴露而非对局中途崩 |
| D6 | `collateral` 在 1v1 写入 bucket 时即解析 `toSeat` | 让 flush 对三个桶统一处理，避免「无目标伤害」特判；`countsAsAttack = false` 保证它不触发 P5。**待 design 确认（附录 B 第 7 条）** |

### 9.4 「还需补充」两项的落地

| 补充项 | 落地 | 内容 |
|---|---|---|
| **骰子状态机** | **§2.5.1**（新增） | `IDLE / ROLLING / AWAIT_DECISION / FINAL_LOCKED / ABILITY_CHOSEN` 五态图；`rollAttemptsLeft` **初始 3**（字段由 `DiceState.attemptsUsed/attemptsMax` 收敛到 `PlayerState.rollAttemptsLeft`）；**锁定/解锁任意时刻**可切换；**骰子操作卡不消耗 Roll Attempt**（写进控制清单第 17 条）；**允许全锁**（等价提前结束）；**防御掷骰单次不可重掷但可被卡牌修改结果**（`PlayerState.defenseRollGranted`）；临时骰池（`GameState.rollPool: RollPoolSnapshot | null`，判定后销毁，A17/C8） |
| **测试用例** | **§7.4.1**（T17–T36）、**§7.5**（C1–C16 映射表） | design §2.3 的三个必测边界 → **T21a/b/c**；design **C1–C16 十六条裁决逐条映射到用例**（T17–T34，C14 走集成用例 I2），见 §7.5 映射表；另补 **T35**（DSL→IR 编译快照）与 **T36**（`describe` 输出校验） |

### 9.5 v0.1 → v0.2 已解决的阻塞项

| 阻塞项 | 状态 | 说明 |
|---|---|---|
| **B1** 结算阶梯与 design 状态机未对齐 | ✅ **RESOLVED** | 裁决 1：改用 design 的 P1–P8，`ResolutionStep` 枚举锁死 |
| **B2** `then` / `onDamageDealt` 触发语义未钉死 | ✅ **RESOLVED** | 裁决 4：`hitSuccess` vs `onDamageDealt` 分离；后者基准 `net > 0`，按「`resolutionId` + 目标 + `flushBatch`」触发 |
| **B3** IP 版权 | ⏸ **保留**（非技术） | 需用户拍板路径；仅阻塞「公开发布」，不阻塞 M0 |
| **B4** 4 英雄内容数据准确性 | ⏸ **保留**（排期） | 新增 B8（rules-lawyering 校准 pass） |
| 附录 B 第 4 / 5 / 6 条 | ✅ **RESOLVED** | 由 design C6 / C2·C5 / P2 裁决，见附录 B |

---

*文档结束 · 变更需同步 `docs/CHANGELOG-engine.md` 与 ADR 索引*
