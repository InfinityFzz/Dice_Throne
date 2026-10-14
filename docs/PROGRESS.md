# 项目进度与计划

> 更新时间：2026-10-14（**阶段 B 完成，M2 联调通过，P0/P1 清零**）
> 定位：**自用学习**，不公开部署、不分发、不商用；规则以官方为准；回合制不限时。
> 设计/架构原始文档在 `md/`（架构文档 `md/docs/architecture/`，设计文档 `md/design/`）；
> 官方数值校对记录在 `docs/content-audit-report.md`。

---

## 一、当前进度总览

| 里程碑 | 定义 | 状态 |
|---|---|---|
| **M0** | 规则引擎跑通单局脚本对战（确定性、可复现） | ✅ **完成**（且超额：两英雄已官方校准） |
| **M1** | 本地可对战，UI 走完整回合流程 | ✅ **完成**（本地热座 + 出牌闭环，见 §阶段 A） |
| **M2** | 联机完整联调（权威校验、重连、持久化恢复） | ✅ **完成**（`npm run e2e` 全绿，见 §阶段 B） |
| **M3** | 4+ 英雄完整内容 | 🔵 **2/2 已校准，图已备好其余 5 英雄** |

提交历史（8 次）：

```
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
| Barbarian 狂战士 | 50 | 5 | 10 | 33（升级 10 + 专属 5 + 通用 18） | 官方校准 |
| Pyromancer 焰术士 | 50 | 5 | 9 | 33（升级 10 + 专属 5 + 通用 18） | 官方校准 |

- 卡牌 **48 张**（通用 18 + Barbarian 15 + Pyromancer 15），全部读官方卡图机制化，无官方 flavor text。
- 状态库 **7 个**：burn / poison / evasive / fireMastery / stun / concussion / knockdown。
- 已知偏差（记录在审计报告 §10）：双英雄 **L1 与 Ultimate 数值为占位**；Smack 的 4-of-a-kind 不可防御、Fortitude 的 3-of-a-kind 移除状态缺引擎条件；Better D! 空效果（待防御重掷窗口）。

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

### 6. 验收指标（当前）

```
3 包 tsc --noEmit       零错误
npm test                41 / 41（引擎 37 + MatchActor 4）
npm run test:assets     10 / 10
npm run assets:check    89 条目录项，无孤立/遗漏
npm run match           完整局（25 回合），同种子 md5 一致
npm run e2e             M2 端到端联调全绿（见 §四 阶段 B）
vite build              通过（257 webp / 9.7M），真图未入库
```

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
| 下一步方向 | 阶段 B（M2 联机）完成 | 用户选择：M3 加英雄 / 补引擎条件与 Ultimate / 加 `describe()` 描述层 |

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
