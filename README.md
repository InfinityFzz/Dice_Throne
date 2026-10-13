# 王权骰铸（Dice Throne）· 网页对战版

> ⚠️ **IP 声明**：本项目定位为**自用学习**，不公开部署、不分发、不商用。
> 所有英雄/卡牌数据均为**机制自洽的自制数值**，不含官方卡面文本（flavor text）与美术资产。
> 符号 id 使用机制名而非官方专名，便于将来重皮主题化。

## 当前进度：M0 已通过 ✅

M0 的验收标准是「规则引擎跑通单局脚本对战」——从固定种子喂动作序列，跑完整局到分出胜负，且事件序列稳定。

```
✅ 18 个引擎单测全通过
✅ 脚本对战跑完整局（约 15 回合 / 110 步）
✅ 同 seed 两次运行输出逐字节一致（确定性）
✅ 6 个不同种子均正常结束，无卡死
✅ TypeScript strict 类型检查零错误
✅ 联机服务端可启动（Socket.IO，端口 3001）
```

## 快速开始

```bash
npm install

npm run match          # 跑一局脚本对战（M0 验收）
npm test               # 引擎单测
npm run dev:server     # 启动联机服务端 :3001
npm run dev:web        # 启动前端 :5173
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
    project.ts            per-seat 视图投影（信息隐藏）
  src/content/            状态库 / 卡牌库 / 英雄定义 / 注册表与校验
packages/server/          Socket.IO 服务端（服务端权威）
packages/web/             React 前端
scripts/                  M0 脚本对战
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

## 尚未实现（后续里程碑）

进度、缺口与计划的完整清单见 **[docs/PROGRESS.md](docs/PROGRESS.md)**，要点：

**P0（阻塞「能玩起来」）**
- 前端出牌闭环缺失：引擎已支持 `playCard / buyUpgrade / sellCard / chooseOption`，但 UI 无入口 —— 33 张牌库一张打不出、CP 无处消费
- `legalActions` 未由服务端下发，前端靠 `pendingKind` 猜按钮
- T14 投影泄漏属性测试（架构 §2.2.2 明列 M1 前必做）未落地

**P1（阻塞「联机可靠」）**
- `MatchActor` 串行命令队列；持久化当前只写摘要行、不可恢复；断线重连无 `rejoin` 校验；房间无选人界面

**P2（阻塞「内容完整」）**
- `describe(e, lang)` 描述层与 lint 守门
- 引擎条件补全：4-of-a-kind（Smack 不可防御）、3-of-a-kind（Fortitude 移除状态）、防御重掷窗口（Better D!）
- 双英雄 L1 / Ultimate 官方数值仍为占位
- M3 其余 5 英雄（Gunslinger / ShadowThief / MoonElf / Ninja / Raveness）

## 官方数值校准现状

已完成 Barbarian / Pyromancer 双英雄的骰面、能力、升级卡、行动卡、专属卡校准（逐张读官方
TTS 图包卡面，见 `docs/content-audit-report.md`）。真图命中率 66/89（card 类 48/48 全命中）。
默认不入库任何官方美术资产与卡面文本。
