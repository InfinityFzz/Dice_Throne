# 王权骰铸（Dice Throne）· 网页对战版

> ⚠️ **IP 声明**：本项目定位为**自用学习**，不公开部署、不分发、不商用。
> 所有英雄/卡牌数据均为**机制自洽的自制数值**，不含官方卡面文本（flavor text）与美术资产。
> 符号 id 使用机制名而非官方专名，便于将来重皮主题化。

## 当前进度：M2 已通过 ✅

M0 规则引擎 → M1 本地可玩闭环 → **M2 联机完整联调**（权威校验 / 幂等 / 断线重连 / kill 重启恢复 / 观战）。

```
✅ 41 个单测全通过（引擎 37 + MatchActor 4）
✅ npm run e2e：真起服务端 + 两个客户端打完整局
   · 每步只用服务端下发的 legalActions，全程零「合法动作被拒」
   · 同一 clientSeq 重发 → duplicate，状态不动
   · 座位 0 掉线 → 新连接凭令牌重连，视图逐字节一致
   · kill 服务端 → 重启 → 从 JSONL 恢复，视图与死前逐字节一致
   · 第三个连接进观战位，SpectatorView 无任一方手牌
✅ TypeScript strict 三包零错误 · vite build 通过
✅ 同 seed 两次运行输出逐字节一致（确定性）
```

## 快速开始

```bash
npm install

npm run dev:server     # 联机服务端 :3001（JSONL 持久化到 ./.matches）
npm run dev:web        # 前端 :5173（默认本地热座，切「联机」页签进房间）

npm run e2e            # M2 端到端联调（起真实服务端 + 两个客户端 + 故障注入）
npm run match          # 脚本对战（M0 验收）
npm test               # 引擎 + MatchActor 单测
```

## 目录结构

```
packages/shared/          规则引擎 + 类型 + 内容数据（前后端同构复用）
  src/types/              core / content / state / action / view
  src/engine/
    rng.ts                sfc32 种子化 PRNG，命名流独立计数
    matcher.ts            骰型匹配器（顺子/同类/分档/组合）
    bucket.ts             伤害分桶与 flush（P6）
    effects.ts            EFFECT_HANDLERS 注册表 + 效果执行队列
    engine.ts             阶段状态机 + 结算阶梯 P1–P8 + reduce
    legal.ts              合法动作集（与 reduce 同守卫）+ toAction
    persistence.ts        纯 append-only 日志（meta/room/snapshot/act）+ 回放重建
    project.ts            per-seat 视图投影 + 观战投影 + 事件可见性过滤
  src/content/            状态库 / 卡牌库 / 英雄定义 / 注册表与校验
  src/types/net.ts        联机协议（双方共用同一份契约类型）
packages/server/          Socket.IO 服务端（服务端权威）
  src/matchActor.ts       一个房间唯一写入者：串行队列 + clientSeq 幂等
  src/matchLog.ts         对局日志的文件后端（append-only）
  src/roomManager.ts      大厅选人 / 准备 / 重连令牌 / 观战 / 启动恢复
packages/web/             React 前端
  src/local.ts            本地热座（浏览器内跑引擎）
  src/online.ts           联机 hook（令牌持久化 / 自动重连 / clientSeq）
scripts/                  脚本对战、资产管线、M2 端到端联调
```

## 关键设计

| 设计 | 说明 |
|---|---|
| **服务端权威** | 全量 `GameState` 只在服务端；客户端只拿 `PlayerView`（白名单构造，字段层面不存在 rng / 牌库顺序） |
| **伤害分桶** | 伤害类 effect 不直接改 HP，只写 bucket；HP 只在 P6 flush 时被写一次 |
| **三轴正交** | `DamageType`（4 值，能否防御）+ `DamageSourceKind`（谁产生）+ `TargetRef`（打谁） |
| **反伤 = `pure`** | 反伤来自防御能力、不是 Attack；若可防御会形成「防御→反伤→再防御」递归 |
| **可序列化** | `EffectDef` 禁止闭包，行为通过注册表查找 —— 这是挂起/持久化/回放的前提 |
| **数据驱动** | 新增英雄 = 新增一个 `HeroDef`，引擎零改动 |
| **回合制不限时** | 用户拍板：取消一切操作倒计时，断线不判负，持久化因此升至 P1 |
| **每个房间一个 MatchActor** | 所有状态推进排队串行执行，写盘发生在队内，顺序与推进顺序严格一致 |
| **clientSeq 幂等** | 同一 (座位, 序号) 重发只结算一次；序号倒退判为过期，客户端重连补发不会重复结算 |
| **append-only 持久化** | JSONL = meta / room 元信息 / 周期快照 / 动作；从不覆盖写，半行自动丢弃，重启可回放重建 |
| **观战投影** | `SpectatorView` 两侧都只见手牌张数、无 legalActions —— 信息在字段层面就不生成 |

## 尚未实现（后续里程碑）

进度、缺口与计划的完整清单见 **[docs/PROGRESS.md](docs/PROGRESS.md)**，要点：

**P2（阻塞「内容完整」）**
- `describe(e, lang)` 描述层与 lint 守门
- 引擎条件补全：4-of-a-kind（Smack 不可防御）、3-of-a-kind（Fortitude 移除状态）、防御重掷窗口（Better D!）
- 双英雄 L1 / Ultimate 官方数值仍为占位
- M3 其余 5 英雄（Gunslinger / ShadowThief / MoonElf / Ninja / Raveness）

联机已可用的部分（M2）：房间大厅选人 / 准备开局、断线保留座位并凭令牌重连、
进程重启自动恢复、观战位、每步动作由服务端 `legalActions` 驱动。

## 官方数值校准现状

已完成 Barbarian / Pyromancer 双英雄的骰面、能力、升级卡、行动卡、专属卡校准（逐张读官方
TTS 图包卡面，见 `docs/content-audit-report.md`）。真图命中率 66/89（card 类 48/48 全命中）。
默认不入库任何官方美术资产与卡面文本。
