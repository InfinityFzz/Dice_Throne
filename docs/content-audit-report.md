# 官方数值审计报告（B4/B8 · Barbarian 卷）

> 数据来源：官方 TTS mod `Dice Throne [official] [scripted]`（by NateJC）图包切片，**逐张读图人工提取**，2026-10-13。
> 来源可靠性：卡图为官方印刷卡面扫描，属最高可信来源 A。官方卡面文本仅作内部核对用，**不搬入代码**。
> 交叉验证伙伴：`review-queue.md`（OCR 逐张卡名基准）、`extracted-meta.json`（mod 文本元数据）。

## 1. 骰面（已修入代码 ✅）

| 面 | 官方符号 | 旧实现（错误） |
|---|---|---|
| 1-3 | SWORD ×3 | axe ×2 + strength |
| 4-5 | LIFE ×2 | strength + rage |
| 6 | POW | rage |

## 2. 官方能力清单（读自升级卡面，含卡面下方相邻 L1 格）

| 能力 | tier | 升级费 | 激活条件 | 效果 | 来源卡 |
|---|---|---|---|---|---|
| **Smack** | L2 | 2 CP | graded：3剑/4剑/5剑 | 5/7/9 伤害；**4-of-a-kind(同点数)时不可防御** | card-18 |
| **Smack** | L3 | 3 CP | 同上 | 6/8/10 伤害；同上 | card-19 |
| **Sturdy Blow** | L2 | **1 CP** | 2剑+2星 | 5 点不可防御 | card-20 |
| **Sturdy Blow** | L3 | 2 CP | 同上 | 6 点不可防御 | card-21 |
| **Mighty Blow** | L2 | 2 CP | 小顺 | **8 点不可防御** | card-22 |
| **Crit Smash** | L1 | — | 3 星 | 施加 **Concussion** → 2 点不可防御 | card-23 下格 |
| **Crit Bash** | L2 | 2 CP | 4 星 | 施加 **Stun** → 7 点不可防御 | card-23 |
| **Overpower** | L2 | 2 CP | 3剑+2星 | **Roll 3 骰 → 伤害 = 总点数**；若 ≥10 → 施加 Concussion | card-25 |
| **War Cry** | L1 | — | 2剑+2心 | 治疗 2 + 2 点不可防御 | card-25 下格 |
| **Reckless** | L2 | 2 CP | **大顺** | 20 伤害 + 自身 5 反噬；**反噬仅当至少 1 点伤害成功造成** | card-26 |
| **Fortitude** | L2 | 2 CP | graded：3心/4心/5心 | 治疗 5/6/7；**3-of-a-kind(同点数)时可移除自身 1 个状态** | card-24 |
| **Thick Skin** | L2 | 3 CP | **防御掷骰出 4** | 治疗 2 × 防御骰红心数；防御骰双心时可预防 1 个来袭状态 | card-27 |

## 3. 与旧实现的关键差异（按严重度）

1. **能力集合整体错位**：旧 heavyBlow / whirlwind / ironWill / bloodlust 在官方卡组中不存在；官方 Smack / Sturdy Blow / Mighty Blow / Crit Bash / Overpower / War Cry / Fortitude / Thick Skin 未实装。唯一撞对的是 `reckless`。
2. **激活条件全错**：旧 matcher 基于错误符号池（axe/strength/rage），官方条件含 graded 分档、组合匹配（2剑+2星）、防御骰点数匹配——后两类旧 DSL 均未覆盖。
3. **Reckless 的反噬是条件性的**：官方「Return dmg only applies if at least 1 dmg was dealt successfully」= `hitSuccess` 语义，印证架构裁决（`hitSuccess` 与 `onDamageDealt` 分离）。
4. **Ultimate 缺失**：Barbarian 的 Ultimate 印在实体英雄面板上，TTS 切片未包含，**数值未知**。
5. **全部 L1 数值缺失**（除 War Cry / Crit Smash 两个从卡面相邻格读到的）：L1 印在实体面板，未获取。

## 4. Pyromancer 现状

- 骰面已校准（flame×3 / blaze / fierySoul / meteor，三方印证）✅
- fireball / combustion / ignite / moltenArmor 的 L2 与官方卡名对上（A 组 5 张已 confirmed）
- **官方存在但未实装的能力**：Pyroblast（II/III）、Meteorite（II）、Burning Soul（II）、Hot Streak（II）——重构时需并入
- **旧 scorchTheEarth（Ultimate）在官方卡组无对应**，待核实官方 Ultimate
- `pyromancer:moltenArmor:3` 有实体卡图（card-27），旧实现缺该 tier

## 5. 遗留与建议

- [ ] Barbarian 代码重构：按 §2 官方值重写（L1 缺失处用推定值并标注 `official:false`）
- [ ] Pyromancer 重构：并入 Pyroblast / Meteorite / Burning Soul / Hot Streak，删除 scorchTheEarth（待官方 Ultimate 确认）
- [ ] 行动卡扩充：官方每英雄约 20 张行动卡（清单见 review-queue.md B/C 组），当前 shared 仅 5 张通用卡
- [ ] L1 与 Ultimate 数值：需实体面板/规则书来源，或读中文版 mod（3446854288）的对应图
- [ ] 其余 5 英雄（Gunslinger / ShadowThief / MoonElf / Ninja / Raveness）卡名已全部识别，待内容层扩充时消费

---

# 第二轮校准（2026-10-13 下午 · Pyromancer 卷 + 行动卡）

> 同一来源（官方 TTS mod 图包切片）逐张读图提取。本轮后 Barbarian / Pyromancer 双英雄
> 的升级卡与行动卡层已对齐官方；引擎为承接官方机制扩展了 6 处能力（见 §9）。

## 6. Pyromancer 官方能力（读自升级卡面）

| 能力 | tier | 升级费 | 激活条件 | 效果 | 来源卡 |
|---|---|---|---|---|---|
| **Fireball** | L2 | 1 CP | graded：3/4/5 焰 | 4/6/8 伤害 + **Gain 2 Fire Mastery** | card-18 |
| **Pyroblast** | L2 | 2 CP | 3焰+1meteor | Deal 6 + Roll 2：**每焰 +3 伤害**；blaze→Burn；gain 2 FM；meteor→Knockdown | card-19 |
| **Pyroblast** | L3 | 3 CP | 同上 | 同上 + 可重掷 1 颗池骰（自动模式不行使） | card-20 |
| **Ignite** | L1 | — | 2blaze+2fierySoul（BLAZING SOUL） | **FM 上限 +1**、gain 5 FM、Knockdown | card-24 下格 |
| **Ignite** | L2 | 2 CP | **大顺** | gain 2 FM、Burn、4 伤害 + 每 FM 2 伤害 | card-24 |
| **Burning Soul** | L2 | 1 CP | 2 fierySoul | 3 FS→Burn；4 FS→**FM 上限 +1**；gain 2 FM；1×FS collateral | card-21 |
| **Hot Streak** | L1 | — | 2焰+2blaze（SCORCH） | gain 2 FM、Burn、6 伤害 | card-23 下格 |
| **Hot Streak** | L2 | 2 CP | 小顺 | gain 2 FM、6 伤害 + 每 FM 1 伤害 | card-23 |
| **Meteorite** | L1 | — | 3 meteor（METEOROID） | Knockdown + Burn + Stun | card-25 下格 |
| **Meteorite** | L2 | 2 CP | 4 meteor | gain 2 FM、Stun、每 FM 1 点不可防御、另 3 点 collateral | card-25 |
| **Combustion** | L2 | 2 CP | 4 符号各 1 | gain 1 FM；**移除至多 4 FM，每枚 4 点不可防御** | card-22 |
| **Molten Armor** | L2 | 1 CP | DEFENSE ROLL 5 | gain 1×fierySoul FM；焰+blaze 同掷→Burn；1×flame 反伤 | card-26 |
| **Molten Armor** | L3 | 3 CP | DEFENSE ROLL 5 | gain 1×FS + 1×meteor FM；同上 Burn；1×flame+1×meteor 反伤 | card-27 |

与旧实现的关键差异：
1. **Fireball II 不是 5/7/9**，而是 4/6/8 + 2 FM；官方**没有 Fireball III**（已删）。
2. **Combustion 语义完全不同**：官方是「消耗自身 Fire Mastery」而非「移除对手状态」。
3. **Ignite II 是大顺**（旧实现小顺错位）；Hot Streak II 才是小顺。
4. Molten Armor 官方**防御骰 5 颗**（旧 1 颗），反伤按符号计数而非点数和。
5. `promptNumber` 兜底绑定 0：Combustion「移除至多 N」与 Warm Up「自由花 CP 换 FM」
   需要自由出价输入，自动模式不行使（语义保守，不替玩家做主）。

## 7. Fire Mastery（官方状态卡面）

- Stack limit **5**（已修入 statuses.ts，旧 4）；持有者每回合 Upkeep「冷却」移除 1 层。
- 可被 Fire Up! / Blazing Soul / Burning Soul II **抬高上限**（引擎 statusCapOverrides 已支持）。

## 8. 行动卡清单（每英雄共有 15 张 + 功能卡 3 张）

| 卡名 | 费用 | 时机 | 效果（机制化） |
|---|---|---|---|
| Transference! | 2 | main | 转移 1 状态 token |
| What Status Effects? | 2 | main | 清空一名玩家全部状态 |
| Vegas Baby! | 0 | main | Roll 1 → ⌈点数/2⌉ CP |
| Get That Outta Here! | 1 | main | 移除一名玩家 1 状态 |
| Triple Up! | 2 | instant | Draw 3 |
| Double Up! | 1 | instant | Draw 2 |
| Buh, Bye! | 2 | instant | 移除一名玩家 1 状态 |
| Tip It! | 1 | instant | 任意骰 ±1 |
| Getting Paid! | 0 | instant | Gain 2 CP |
| Not This Time! | 1 | roll | 一名玩家防止 6 伤害 |
| Twice As Wild! | 3 | roll | 改 2 骰值（auto：设 6） |
| Try, Try Again! | 1 | roll | 重掷至多 2 骰 |
| So Wild! | 2 | roll | 改 1 骰值（auto：设 6） |
| Samesies! | 1 | roll | 1 骰复制另 1 骰 |
| One More Time! | 1 | roll | ≈1 次额外掷骰机会 |
| Helping Hand | 1 | roll | 强制对手重掷 1 骰 |
| Better D! | 0 | roll | 防御阶段重掷 5 骰（**待引擎防御重掷窗口，暂空效果**） |
| Six-It! | 1 | roll | 己方 1 骰设为 6 |

Pyromancer 专属 5 张：Warm Up!（0：+1 FM）、Fire Up!（3：FM 上限 +1、+2 FM）、
Red Hot!（1：攻击修正每 FM +1 伤害）、Huzzah!（1：攻击修正 Roll 1 四符号分支）、
Infernal Infusion!（0 PROMO：meteor→FM 补满，否则抽 1）。
攻击修正类在 then 窗口排入同一 bucket，与主攻击合并 flush —— 无需新增引擎机制。

## 9. 本轮引擎扩展（为承接官方机制）

1. `dealDamage.recoilOnHit`：条件反噬（官方 Reckless），flush 时按 triggerToSeat net≥1 触发。
2. `rollDicePool.perDie`：每颗命中骰各结算一次（官方 Pyroblast「Add 3 × 🔥」）。
3. `increaseStackLimit` 真实实现：per-player `statusCapOverrides`。
4. `Expr.ceilDiv`（Vegas Baby!）；`adjustDie` / `copyDieFace` 子句（Tip It! / Samesies!）。
5. `transferStatus` 支持 `'any'`；`rerollDice` 支持目标引用（Helping Hand）。
6. 防御能力 matcher 现在会以防御骰为作用域求值（此前从未求值，thickSkin「防御骰出 4」失效）；
   `countSymbol`/`diceSymbolAtLeast` 在防御上下文中按防守方英雄换算符号。

## 10. 更新后的遗留

- [x] Barbarian 重构（上一轮完成）
- [x] Pyromancer 重构（本轮完成；Ultimate 仍为占位）
- [x] 行动卡扩充（15 通用 + 3 功能 + 5 专属已录入；Better D! 待防御重掷窗口）
- [ ] L1 与 Ultimate 数值：需实体面板/规则书，或读中文版 mod（3446854288）
- [ ] 「4-of-a-kind 不可防御」（Smack）与「3-of-a-kind 移除状态」（Fortitude）仍缺引擎条件
- [ ] 其余 5 英雄（Gunslinger / ShadowThief / MoonElf / Ninja / Raveness）待内容层扩充

---

# 第三轮：卡名批量确认（DT-OCR-002）+ Barbarian 专属卡

## 11. Barbarian 专属行动卡（card-28..32 读图）

| 卡名 | 费用 | 时机 | 效果 |
|---|---|---|---|
| Concuss! | 1 | main | 对一名对手施加 Concussion |
| Head Bash! | 0 | 防御结算后 | 若本轮已成功造成 ≥8 伤害 → Concussion |
| Get Some! | 2 | 攻击修正 | Roll 5：每剑 +1 总伤害；施加 Concussion |
| Feelin' Good! | 0 | instant | Roll 3：治疗 1 + 2×心 |
| Adrenaline Surge! | 0 PROMO | main | Roll 1：出心 → 治疗 2 + Concussion；其他 → 抽 1 |

## 12. 卡名 → defId 批量确认

- 新增基准表 `packs/local-tts/name-map.json`（官方英文卡名规范化 → 内容层 defId，48 张）
- 新增脚本 `scripts/confirm-tts-mapping.ts`（npm run assets:confirm）：
  命中即把 manifest 条目 logicalId 改为 defId、confirmed=true（nameSource=canonical）；
  同一 defId 多英雄重复图只确认首张（通用卡每英雄牌堆各一张，共 108 张 duplicate 跳过）。
- 本轮确认 43 张（barbarian 32 + pyromancer 15，其中通用卡 18 + 升级卡 + 专属卡）；
  未匹配 74 张 = 其余 5 英雄未实装（Gunslinger/MoonElf/Ninja/Raveness/ShadowThief 的
  升级卡与专属卡，M3 实装后直接扩 name-map 再跑即可）。
- 命中率变化：**23/84 → 66/89**（card 类 48/48 全命中）。剩余缺 23：
  abilityIcon 19（TTS 包无独立能力图标）、statusIcon 3（stun/concussion/knockdown 无 token 图）、
  background 1（桌面，表现层自由发挥）。

---

# 第四轮：可玩闭环 + 中文版 mod 数值接入（2026-10-14）

## 13. 可玩闭环（本轮重点，非数值）

- `packages/shared/src/engine/legal.ts` 新增 `computeLegalActions / getLegalActions / toAction`：
  按与 `reduce()` **相同守卫**推导动作集，「UI 可见 ⇔ 引擎接受」；
  CP 不足等不可执行项仍下发但 `enabled=false` + `reason`（灰显说明原因，而非按钮消失）。
- `PlayerView.legalActions` 下发（架构 §2.2.3 落地）。
- `packages/shared/src/engine/legal.test.ts`：
  - 属性测试：5 个种子各推进到分出胜负，每步断言 legalActions 中 enabled 项喂给 reduce 必被接受；
    非行动方不得出现越权动作。
  - **T14 投影泄漏测试**（架构 §2.2.2 要求 M1 前落地）：断言 PlayerView 中不含对手手牌/牌库 uid、
    自己牌库 uid（顺序属隐藏信息）、rng 状态、bucket 明细。
- 前端：本地热座模式（`packages/web/src/local.ts`，浏览器内直接跑引擎，权威端是本标签页，
  仍走 `projectState` 投影，UI 与联机模式同构）；出牌/卖牌/买升级/弃牌/choose 全部由
  legalActions 驱动；战斗日志来自引擎事件流。

## 14. 中文版 mod（3446854288）—— 已就绪，等订阅

现状：本机 TTS 工坊缓存只有英文官方版 `908560170.json`（`Dice Throne [official] [scripted]`），
**中文版 mod 未订阅**，因此数值仍以英文版为准。

接入 SOP（订阅后 3 步）：

1. Steam 创意工坊订阅中文版并在 TTS 里打开一次 → 缓存出现
   `…/Mods/Workshop/3446854288.json`。
2. `npm run assets:import -- --mod "D:/Users/InfinityFzz/Documents/My Games/Tabletop Simulator/Mods/Workshop/3446854288.json"`
   （切片 + 入库 manifest；真图仍不入库）
3. `node --import tsx scripts/ocr-card-names.ts --lang chi_sim`
   本轮已把 OCR 语言参数化（`--lang`，默认 eng），并把 `confirm-tts-mapping.ts` 的卡名规范化
   改为保留汉字（`\p{L}\p{N}`），中文卡名可直接进 `name-map.json` 对照。

## 15. 待补数值（精确清单）

| 项 | 现状 | 需要 |
|---|---|---|
| `barbarian:bloodlust`（血怒，Ultimate） | 占位：5 METEOR？数值自撰 | 官方 Ultimate 条件与伤害 |
| `pyromancer:scorchTheEarth`（焦土，Ultimate） | 占位 | 官方 Ultimate 条件与伤害 |

L1 数值：Barbarian（官方技能板）与 Pyromancer（升级卡面 L1 行）**均已齐备**，无需补。
其余已知偏差见 §10：Smack 4-of-a-kind 不可防御、Fortitude 3-of-a-kind 移除状态、
Better D! 防御重掷窗口 —— 均为引擎条件缺口，与数值来源无关。

---

# 第五轮：引擎条件补全 + 两个 Ultimate 官方值 + 中文包评估（2026-10-14）

## 16. 引擎条件补全（P2 清零）

| 项 | 实现 |
|---|---|
| **nOfAKind 条件** | `Condition` 新增 `{ c: 'nOfAKind', n, target? }`：骰值轴判定（防御上下文以 tempDice 为准，否则看主骰池任一点数出现 ≥n 次） |
| **Smack 4-of-a-kind 不可防御** | `dealDamage` 新增 `undefendableIf`：effectWalk 时按条件把 damageType 翻转为 undefendable（避免为 graded 三档各复制一份副本）。三个 tier 全部接入 |
| **Fortitude 3-of-a-kind 移除状态** | heal 后接 `conditional(nOfAKind 3) → optional(removeStatus any 1 self)`；auto 模式不行使（保守） |
| **Better D! 防御重掷窗口** | 新增 `defenseWindow` pending：防御骰掷出后、结算前，防守方可打出防御时机卡（preDefense/postDefense），窗口可重入；`rerollDice` 新增 `scope:'defense'`（重掷 tempDice）。无可用卡时不开窗直接结算；auto/pass = 直接结算 |

附带修复：脚本对战与测试 AI 的决策表补 `defenseWindow → respondPass`。

## 17. 两个 Ultimate 官方值（此前唯一内容缺口）

英雄面板图**不存在于任何本地 mod**（英文包 Leaflet、中文包英雄提示卡均为状态说明/FAQ；
规则书 PDF 亦无英雄能力表）。官方值经双源交叉确认：

| Ultimate | 官方效果 | 来源 |
|---|---|---|
| **Barbarian「怒火 Rage」** | 5 POW → 施加 Stun + **15 点伤害**（Ultimate 伤害：不可防御且不可避免） | ①原版 S1 社区数据（namu wiki 逐字）；②法媒评测（aumeeplereporter.fr）「Rage, at 5 stars, inflicts 15 damage and a stun」 |
| **Pyromancer「焦土 Scorch the Earth!」** | 5-of-a-kind Meteor → 施加 Knockdown & Burn → **Gain 3 Fire Mastery** → **Deal 12 dmg** → 另对所有对手 **2 点 collateral** | ①原版 S1 规则书 PDF v1.1（官方 filesusr 托管，文本层逐字）；②Season One ReRolled 规则书（rulespal.com）—— 两版此条目完全一致 |

实现注记：引擎无独立 `ultimate` 伤害类型（架构裁定 4 类），以 `undefendable + sourceKind:'ultimate'`
表达；「不可避免」维度（avoid 类状态）待有 avoid 机制时在 bucket 过滤层区分。

## 18. 中文版图包评估（3446854288 / 2823163294 / 3591191228 / 3415098082）

| 包 | 结论 |
|---|---|
| **3446854288 全26中文角色**（6.1MB） | 规模最大（979 牌堆/31940 格），卡面 901×901，但**每卡仅 ≈180px**（W5H7 网格）——低于英文包；无英雄面板。状态 token 图 256×256 与英文包同规格 |
| 2823163294 侠技霸骰（3.8MB） | 图源已失效（HTTP 拉取 0 字节），出局 |
| 3591191228 / 3415098082（1.9MB） | 分辨率最高（711×1131 卡面）但仅 33 牌堆（2-3 英雄），且无 Barbarian/Pyromancer 面板 |
| 结论 | **英文官方包仍是本两英雄最优素材源**；中文包状态 token 无分辨率增益。导入收益仅剩：中文卡名 OCR（--lang chi_sim 已就绪）与 M3 其余 24 英雄的图源 |

## 19. statusIcon 确认（命中率 66/89 → 69/89）

- `confirm-tts-mapping.ts` 扩展支持 statusIcon：按 manifest `source` 字段解析状态名查表确认
  （stun/concussion/knockdown/burn/fireMastery/evasive/poison），与卡确认同一可复现链路。
- 本轮确认 3 条：common:stun / common:concussion / common:knockdown。
- **当前命中 69/89：card 48/48 + statusIcon 20/20 全满**；剩缺 abilityIcon 19（TTS 包无独立能力图标）
  + background 1（表现层自由发挥）。资产侧无已知可补缺口。

# 第六轮：Gunslinger 实装（2026-10-14 · M3 第一位新英雄）

## 20. 官方数值来源（三源交叉，全部 official ✅ 零推定值）

| 来源 | 覆盖 |
|---|---|
| ① TTS 官方图包逐张读图 | panel.webp（骰面/状态/stack limit）+ card-18..32 共 15 张专属卡（L2/L3 数值、升级 CP、专属行动卡全文、卡面下方相邻 L1 格 ×3） |
| ② boardgame.bg《Dice Throne S2 Battle Chest》规则书 | 英雄面板官方排版全文：HP 50、全部能力 L1 数值（Revolver 3/4/5、BountyHunter 1、Showdown 7/5、Deadeye 6、TakeCover 5、FanTheHammer 7、QuickDraw passive、Duel 全文、Ultimate 全文） |
| ③ namu wiki Gunslinger 条目 | L1 数值与升级效果逐能力列出，与 ①② 一致 |

三源与卡图 L2/L3 **完美衔接**（Revolver 3/4/5→4/5/6、Showdown 7/5→8/6→9/6、
BountyHunter 1→2、TakeCover 5→6、FanTheHammer 7→8、Deadeye 6→8）。
Ultimate「枪林弹雨（Fill 'Em With Lead!）」双源一致：5 靶心 → 获得 1 闪避 + 悬赏 & 击倒 + 10 点伤害
（② boardgame.bg + 繁中规则书 gokids PDF「槍林彈雨」）。

## 21. 实装清单

- **状态**（gunslinger 专属 2 + 通用修订 1）：
  - `gunslinger:reload 装填`（正面，limit 2，spendEffect = 掷 1 骰加 ⌈点数/2⌉ 伤害）
  - `gunslinger:bounty 悬赏`（负面，limit 1，Persistent，onAttacked = 攻击者 +1 伤害 & +1 CP）
  - `common:evasive 闪避` stackLimit **2→3**（官方面板值；此前内容层无引用，修订无涟漪）
- **能力 9 槽**：左轮 / 赏金猎人 / 对决 / 寻找掩护 / 花式射击 / 神枪手 / 决斗（防御，DEFENSE ROLL 1）/
  快速拔枪（passive）/ 枪林弹雨（Ultimate）。
- **卡组 33 张**：通用 18 + 升级 9 + 专属行动 5 + PROMO 1（且战且走，Dice Throne Comic #1）。
  升级卡 9 张是官方卡组构成（读图），非缺漏。

## 22. 为本英雄做的引擎扩展（4 项，全部通用机制、零英雄特判）

| 扩展 | 官方机制 | 实现点 |
|---|---|---|
| `StatusDef.onAttacked` 契约 | Bounty「被攻击时攻击者 +1 伤害 & +1 CP」 | dealDamage handler 入桶时查目标状态的 onAttacked（官方 FAQ 三条口径见 core.ts 注释） |
| `Condition.boundCompare` | Duel/Showdown「你与对手各掷 1 骰并比较」 | evalCondition 比较两个运行期绑定值 |
| `Expr.incomingDamage` | Duel「防止 ½ 来袭伤害（向上取整）」 | 按 bucket 中 defendable 待结算量求值（与 prevention 同口径） |
| `rollDicePool.owner` | Duel/Showdown 对手那颗按**对手**英雄骰面映射 | handler 按 owner 查英雄骰面；池归属契约不变 |

## 23. 已知偏差（全部显式记账，非静默）

| 项 | 官方 | 现状 | 原因 |
|---|---|---|---|
| Duel 二选一 | 玩家 may choose deal 3 / prevent ½ | `choose` 自动取 default（= prevent，保守） | 引擎 choose 无挂起（诚实桩） |
| Roulette「选一名玩家」 | 可含自己 | 固定对手 | 同上；目标选择入口就绪后改 choose |
| Quick Draw passive | upkeep 得装填 + spend 重掷 | 完全不生效（matcher const false 诚实渲染） | 引擎无 passive upkeep 钩子 + spend 无玩家入口（双路径断） |
| Wild West! | spend 装填时可重掷 +1 伤害 | 打出后仅 log | 依赖 spend 玩家入口（缺失） |
| Reload/Evasive 的 spend | 玩家任意时机消耗 | 状态数据完备、无法主动消耗 | 引擎/合法动作均无 spendStatus 入口（与 evasive 既有现状一致） |
| Ultimate 尾注 | 消耗装填可重掷 | 不属效果，未实装 | 属掷骰阶段玩家交互，依赖 spend 入口 |

**thenNode 打出窗口缺失**（本轮确认的既有缺口，非本轮引入）：redHot / Get Some! / Eat Lead! 等
Roll Phase Action 卡当前只能在 main 阶段宽松打出（playCard 不校验 timing），伤害入桶后悬置
到下一次 flushNow。补 thenNode 窗口是独立的引擎任务（与官方「攻击修正」时序对齐），本轮不做。

# 第七轮：Shadow Thief 实装（2026-10-14 · M3 第二位新英雄）

## 24. 官方数值来源（三源交叉，全部 official ✅ 零推定值）

| 来源 | 覆盖 |
|---|---|
| ① TTS 官方图包逐张读图 | panel.webp（骰面 1-2 匕首 / 3-4 钱袋 / 5 卡牌 / 6 阴影、3 个状态与 stack limit）+ card-18..32 共 15 张专属卡（L2 数值、升级 CP、专属行动卡全文） |
| ② rulespal《Dice Throne S1 ReRolled》规则书 | 英雄面板官方排版全文：全部能力 L1 数值（匕首打击 4/6/8、扒窃 2/3/4、狡诈打击 +3 CP、阴险打击 +3 CP、暗影之舞、卡牌丰饶、暗影防御掷 4、反击掷 5）+ Ultimate 逐字 |
| ③ namu wiki Shadow Thief 条目 | L1 数值与升级效果逐能力列出，与 ①② 一致 |

L1 与卡图 L2 **完美衔接**（扒窃 2/3/4→3/4/5/6、狡诈/阴险 +3→+4、暗影防御 4→5 骰、
反击 1→2×匕首）。Ultimate「暗影刺击（Shadow Shank!）」= 5 阴影 → 获得 3 CP + 阴影，
造成 CP+5 伤害（② rulespal 面板逐字）。

## 25. 实装清单

- **状态**（shadowthief 专属 2 + 通用修订 1）：
  - `shadowthief:shadows 隐入暗影`（正面，limit 1，Persistent，onAttacked.avoid + discardAtTurnEnd）
  - `shadowthief:sneakAttack 偷袭`（正面，limit 1，spendEffect = 掷 1 骰加点数伤害）
  - `common:poison 中毒` **官方化**：stackLimit 5→3、persistent false→true。
    此前 5/非持续是早期未记录值；官方面板（Shadow Thief 面板 + S1 规则书）均为 3 + Persistent。
- **能力 10 槽**：匕首打击 / 扒窃 / 狡诈打击 / 阴险打击 / 阴影打击 / 刺伤攻击 / 暗影之舞 /
  卡牌丰饶 + **双防御**（暗影防御 掷 4、反击 掷 5）+ Ultimate 暗影刺击。
- **卡组 33 张**：通用 18 + 升级 8 + 专属行动 6 + PROMO 1（暗影融合，Dice Throne Comic #1）。
  升级卡 8 张是官方卡组构成（读图），非缺漏。

## 26. 为本英雄做的引擎扩展（4 项，全部通用机制、零英雄特判）

| 扩展 | 官方机制 | 实现点 |
|---|---|---|
| `StatusDef.onAttacked.avoid` | 阴影「被普通攻击时全部避开；不防 Ultimate 与非攻击伤害」 | dealDamage handler：命中目标状态的 avoid 契约时按 defendable 量全避；`sourceKind==='ultimate'` 与 damageType≠attack 豁免 |
| `StatusDef.discardAtTurnEnd` + `StatusInstance.sinceTurn` | 阴影「带着它完整结束一个自己回合后弃置」 | inflictStatus 盖 sinceTurn 章；endTurn 时仅弃 `sinceTurn < 当前回合`（本回合内获得的不弃） |
| `defensiveRoll.abilityId` + `AbilityTier.defenseDiceCount` | 影贼有两个防御能力，官方要求**掷骰前二选一**；暗影防御 L2 掷骰数 4→5 | doDefensiveRoll 按 id 选槽（缺省取第一个，向后兼容）；legal.ts 守方下发全部防御选项并带 abilityId |
| 注册表校验放宽 | 官方「匕首打击 II」升级价为 **0 CP**（读图） | `upgradeCostCP` 由「严格递增」改为「非递减」，只拦越升越便宜 |

## 27. 已知偏差（全部显式记账，非静默）

| 项 | 官方 | 现状 | 原因 |
|---|---|---|---|
| 扒窃偷取 | 玩家选「至多 N CP 改为从对手处偷」 | choose 自动取 default（不偷，保守） | 引擎 choose 无挂起（诚实桩） |
| 阴影打击 / 刺伤攻击 | 需先购入对应 II 级升级才解锁 | 常驻 L1 | 引擎能力槽无「随升级解锁」机制 |
| 狂野暗影 | 玩家选骰并改面值 | `playIf` 恒 false 诚实灰显，仅 log | 需要「选骰 + 选面值」挂起窗口，不做虚假自动改骰 |
| 毒伤（Poison Wound!） | 「选一名玩家」（可含自己） | 固定对手 | 与 Roulette 同款，目标选择入口就绪后改 choose |
| 偷袭 / 装填 / 闪避 的 spend | 玩家任意时机消耗 | 状态数据完备、无法主动消耗 | 引擎无 spendStatus 玩家入口（既有缺口，与 Gunslinger 轮一致） |
| thenNode 打出窗口 | Roll Phase Action 卡须在特定时机打出 | 只能在 main 宽松打出、伤害悬桶 | 独立引擎任务，见第六轮 §23 |

---

# 第八轮：引擎契约扩展（MoonElf 前置，2026-10-14）

> 定位：**只补通用引擎契约，不写死任何英雄/状态 id**（架构硬约束：引擎不得对具体内容 id 特判）。
> TARGETED / ENTANGLE / BLIND 三个状态的注册由 MoonElf 内容层任务按既有模式
> （gunslinger:bounty / shadowthief:shadows）以 `moonelf:` 前缀完成；本轮行为取证全部走
> **自建 registry + 自造状态**（`test:` 前缀），引擎中立。

## 28. 契约总览（4 项，全部通用机制、零英雄特判）

| 契约 | 官方机制（MoonElf 面板状态卡原文） | 实现点 |
|---|---|---|
| `StatusDef.onAttacked` 逐字段独立求值 | TARGETED「+2 incoming Attack damage: When a player afflicted with this token is Attacked by an opponent, the attacker increases their dmg by 2. Persistent.」 | `engine/effects.ts` dealDamage handler：bonusDamage 与 attackerGainsCp 各自独立定位、独立生效（历史上 Bounty 两者总是一起出现，纯 CP 状态曾被漏发） |
| `StatusDef.onRollPhaseStart` | ENTANGLE「Lose 1 roll attempt: A player afflicted with this token gets 1 fewer roll attempts during their next Offensive Roll Phase.」 | `engine/engine.ts` openOffensiveRoll：按当前进攻方状态汇总 rollAttemptsDelta（下限 0）后设置基础次数；`legal.ts`「剩 N 次」标签读 rollAttemptsLeft 自动跟随 |
| `StatusDef.onConcludeRollPhase.failDie` | BLIND「On 1-2, fail Offensive Roll Phase: The next time a player afflicted with this token concludes their Offensive Roll Phase, they must remove this token and roll 1 die. On 1-2, their Offensive Roll Phase fails and has no effect of any kind.」 | `engine/engine.ts` concludeOffensiveRoll：announceAbility 宣布能力**之前** / passAbility 时点火——移除状态 → 掷骰 → 命中 failValues 则整个阶段作废（不激活能力、不入桶、不开防御，直接 main2） |
| `StatusDef.expiresAtRollPhaseEnd` | ENTANGLE「At the conclusion of the Roll Phase, remove this token.」 | 与 failDie 同一收场点统一移除整枚 token；与 `discardAtTurnEnd`（endTurn + sinceTurn 判定）时机分离，不得混用 |

## 29. 契约 1：onAttacked 逐字段解耦（TARGETED）

- 官方 FAQ 口径沿用 Bounty 三条（入桶即触发、不因 pure 反伤触发、主伤害 >0 才触发），
  已写入 `types/content.ts` 的 `StatusDef.onAttacked` 注释（原注释断言两字段总是一起出现，
  属过度断言，本轮同步修正）。
- 改动：dealDamage handler 由「两字段同时存在才触发」改为逐字段独立定位与生效；
  日志 note 按实际生效字段拼接（只有加伤 / 只有 CP / 两者皆有）。
- 取舍：每字段各取状态数组顺序中第一个携带它的状态（官方均为 limit 1，不叠加）；
  多层叠加语义无官方依据，不做投机泛化。回归用例固化「两字段皆有」行为不破。

## 30. 契约 2：onRollPhaseStart（ENTANGLE 少 N 次掷骰）

- 实现：openOffensiveRoll 按当前进攻方身上所有状态的 rollAttemptsDelta 汇总，
  `Math.max(0, MAX_ROLL_ATTEMPTS + delta)`；下限 0 防负数次数（pending 选项与
  performRoll 守卫均假设 ≥ 0）。`legal.ts` 与 rollPendingOptions 的「掷骰（剩 N 次）」
  读 rollAttemptsLeft，自动跟随，无需额外改动。
- 取舍：delta 用常量 `number` 而非 Expr（官方为固定 1 次；按层数缩放的机制出现时再拓宽，
  求值点不变）。与 `grantExtraRollAttempt` 正交——前者只开场结算一次，后者是效果执行期增量。

## 31. 契约 3：onConcludeRollPhase.failDie（BLIND 收场掷骰）

- 实现：concludeOffensiveRoll 在 announceAbility **宣布能力之前**与 passAbility 时点火：
  先移除整枚 token（官方「must remove this token and roll 1 die」，移除与骰果无关）→
  掷 failDie.count 颗骰（命名流 `dice:fail:<seat>`，种子化确定性）→ 任一面值命中 failValues
  → 整个进攻掷骰阶段作废：不激活能力、不入桶、不开防御、不走 ultimateGate，
  直接进 main2（只挂 cardWindow 窗口）。
- 半结算防护：作废发生在 resolveAbility 之前，本契约不碰 bucket / defenseUsed / ladderStep；
  进入阶段前既有的 bucket 内容（如 main2 悬置伤害，其结算时机由既有契约决定）不属本契约
  管辖范围，保持原状。
- UI 事件：`rollPhaseFailDie`（骰值 / 失败面 / failed 标记）+ `rollPhaseFailed` + `abilityVoided`；
  移除本身走 statusChanged（经效果系统的 removeStatus，复用既有事件链）。
- 出口语义：放弃激活同样触发收场（官方原文不区分出口）——阶段本就无效果，作废标记不改变
  结果，但移除与掷骰照常发生。
- failDie 字段保留 optional：当前唯一定义的收场行为；将来新增其他收场行为时在此加字段，
  同步补引擎分支与 describe 模板。

## 32. 契约 4：expiresAtRollPhaseEnd（ENTANGLE 结论时弃置）

- 实现：与 failDie 同一收场点（concludeOffensiveRoll）无条件移除整枚 token（全部层数，
  官方「remove this token」不是 1 层）；事件 `rollPhaseTokenExpired`。
- 时机分离守门（测试固化）：expiresAtRollPhaseEnd 收场即弃；discardAtTurnEnd 收场不弃、
  要等 endTurn 且带 sinceTurn 判定——两个契约不得混用同一时机。

## 33. 取证与守门

- 行为级取证 **18 例**（`packages/shared/src/engine/moonelf.test.ts`）：自建 registry +
  自造状态（test:notTargeted / test:notBlind / test:notEntangle 等），全程走自建 registry
  自己的 reduce；守方统一神枪手（狂战士防御骰含生命面会回血，污染 HP 断言）；
  完整回合流 main1 →endMainPhase→ offensiveRoll →passAbility→ main2 →endMainPhase→
  discard →endTurn。种子固化两例（`qa-me-blind-hit` 实测掷 2 作废 / `qa-me-blind-miss`
  实测掷 4 照常），seed 名仅为可复现编号，实测值写在用例注释里。
- describe 层新增渲染测试 **6 例**（`content/describe.test.ts`）：逐字段 onAttacked /
  onRollPhaseStart / failDie / expiresAtRollPhaseEnd；全契约状态 zh 无渲染残渣、en 非空。
- 已知边界：收场钩子只在 announceAbility / passAbility 两个出口点火（阶段机当前仅此两个
  正常出口）；failDie 的 count>1 官方未出现（契约按 count 泛化实现，官方值 1）。

## 34. 内容层待办（MoonElf 实装任务消费）

- [x] `moonelf:targeted`（负面，limit 1，Persistent，`onAttacked.bonusDamage = 2`）
- [x] `moonelf:entangle`（负面，limit 1，`onRollPhaseStart.rollAttemptsDelta = -1` + `expiresAtRollPhaseEnd`）
- [x] `moonelf:blind`（负面，limit 1，`onConcludeRollPhase.failDie = { count: 1, failValues: [1, 2] }`）
- common: 下**不放**通用版：官方状态 token 按英雄面板独立发行（evasive 在 common: 下是因为
  多英雄面板共同印发），凭自觉造通用版没有官方依据（理由已写入 `content/statuses.ts` 头注）。

---

# 第九轮：MoonElf 实装（2026-10-14 · M3 第五位新英雄）

> 定位：**内容层实装 + 2 处通用小扩展，零英雄特判引擎改动**。骰面/数值全部
> official（三源交叉，零推定值）；已知偏差全部显式记账。行为取证 50 例
> （moonelf.test.ts：18 契约 + 32 内容）+ describe 渲染 9 例；QA 独立探针
> moonelf-contract-probe.test.ts 45 例不动。

## 35. 官方数值来源（三源交叉，全部 official ✅ 零推定值）

| 来源 | 覆盖 |
|---|---|
| ① TTS 官方图包逐张读图 | panel.webp（骰面 1-3 ARROW / 4-5 FOOT / 6 MOON、3 个状态与 stack limit）+ card-18..32 共 15 张专属卡（L2/L3 数值、升级 CP、专属行动卡全文、卡面下方相邻 L1 格 ×4） |
| ② 2017 规则书（v0.9.4 两份扫描） | 英雄面板官方排版全文：HP 50、全部能力 L1 数值（长弓 4/5/7、致命射击 4、掩护射击 7、爆裂箭、缠足射击 7、致盲射击 8、月蚀 7、打偏防御全文）+ Ultimate 逐字 |
| ③ namu wiki MoonElf 条目 | L1 数值与升级效果逐能力列出，与 ①② 一致（机翻仅作核对，不作依据） |

L1 与卡图 L2/L3 **完美衔接**（长弓 4/5/7→4/6/8→5/7/9、致命射击 4→6、掩护射击 7→9、
缠足射击 7→9、致盲射击 8→10、月蚀 7→9、打偏 ⌊箭/2⌋→每箭）。
Ultimate「月蚀！（Lunar Eclipse!）」双源一致：5 月 → 获得闪避 + 施加致盲/缠足/锁定 + 12 点伤害。

**版本判定（旧文 vs 现行版）**：Ultimate 伤害 2017 规则书旧值 **13**，现行版
（TTS 面板 + namu）为 **12** → 按现行版 12 实装；BLIND 触发点 2017 规则书旧文
「造成伤害时」，现行契约为「收场时」→ 按第八轮已过质量门的契约实装。

**⚠️ 任务 spec 修正（向 team-lead flagged）**：任务书描述 Longbow II/III 缠足条件为
「4 同色 / 3 同色」，但 TTS 卡图 card-18/19 逐字为 "On 4-of-a-kind (#'s), inflict Entangle"
/ "On 3-of-a-kind (#'s)"（#s = 骰值同点图标），namu 机翻亦为「same number」——
**按卡图实装** `nOfAKind 4`（L2）/ `nOfAKind 3`（L3），与 Barbarian Smack 的
of-a-kind 同构；**不是**同符号/同色。正反例已入测试（4 同点缠足 / 无 4 同点不缠足）。

## 36. 实装清单

- **状态 3**（`moonelf:targeted 锁定` / `moonelf:entangle 缠足` / `moonelf:blind 致盲`）
  + 通用修订 1（`common:evasive` 官方化，见 §37）。
- **能力 13 槽**：长弓（3 档）/ 致命射击（2 档）/ 掩护射击（2 档）/ 爆裂箭（3 档）/
  缠足射击（2 档）/ 致盲射击（2 档）/ 月蚀（2 档）/ 专注（附赠）/ 闪避行动（附赠）/
  月赐（附赠）/ 月影（附赠）/ 打偏（防御，2 档）/ 月蚀！（Ultimate）。
- **卡组 33 张**：通用 18 + 升级 10 + 专属行动 5（月之魔法 4CP / 接招 0CP /
  齐射 1CP / 闪避 1CP / 暗月之影 PROMO 0CP）。
- **注册挂图 6 处**：`registry.registerHero` / `index.ts` 命名导出 /
  `describe.ts` ALL_HEROES + 新符号名（箭/足/月）/ `name-map.json` 15 条 /
  `gen-asset-catalog.ts` HEROES → `catalog.ts` **153→188 条** / `assets:check` 通过。

## 37. 通用小扩展 2 处（全部通用机制、零英雄特判）

| 扩展 | 官方机制 | 实现点 |
|---|---|---|
| `Expr.floorDiv` | 打偏 L1「每 2 支箭 → 1 点伤害」= ⌊箭数/2⌋ | `types/core.ts` 联合成员 + `effects.ts` evalExpr case（b=0 归 0，与 ceilDiv 同口径）+ `describe.ts` 模板（zh `⌊a ÷ b⌋` / en `floor(a / b)`）+ 渲染测试（与 ceilDiv 措辞区分守门） |
| `common:evasive` 官方化 | 面板原文「Spend & roll 1-2 to dodge an Attack」 | spendEffect = 掷 1 骰 → 点数 ≤2 才 avoidDamage；无论点数都消耗 1 层（spendStatus handler 先 removeStatus(1) 再执行 spendEffect）。顺带移除旧数据 next 里多余的 removeStatus（handler 已扣 1 层，旧数据属潜在双扣缺陷，因 spend 无入口未暴露） |

## 38. 已知偏差（全部显式记账，非静默）

| 项 | 官方 | 现状 | 原因 |
|---|---|---|---|
| 4 个附赠能力解锁 | 需先购入对应 II 级升级才解锁（Demising Shot II→Focus 等） | 常驻 L1 | 引擎能力槽无「随升级解锁」机制（同 ShadowThief 模式） |
| Evasive Action / Evade! 目标 | 「a chosen player」可含自己/对手 | 固定自己 | 目标选择入口就绪后改 choose |
| Ultimate 伤害 | 2017 规则书 13 | 12 | 现行版（TTS 面板 + namu）双源一致 12 |
| BLIND 触发点 | 2017 规则书「造成伤害时」 | 收场时（announce / passAbility） | 第八轮契约经质量门验证（PASS），按契约实装 |
| 接招 / 齐射打出时机 | Roll Phase Action 特定时机 | 只能 main 宽松打出、伤害悬桶 | thenNode 窗口缺失（既有缺口，第六轮 §23） |
| 闪避 spend | 玩家任意时机消耗 | 状态数据完备、无主动消耗入口（测试用自建卡驱动 handler） | 引擎无 spendStatus 玩家入口（既有缺口） |
| 升级卡张数 | 官方每张张数未获取 | 每张 1 本 | 图包无张数信息 |

## 39. 取证与守门

- 行为级取证 **50 例**（`engine/moonelf.test.ts` = 18 契约 + 32 内容）：
  - 注册冒烟：骰面 1-3 箭 / 4-5 足 / 6 月、掷 5 骰、50 HP、13 能力 / 3 状态 / 33 卡组（18+10+5）、registry 校验、对局可建；
  - TARGETED +2 不给 CP（守方带锁定入桶 6、CP 不变；对照悬赏入桶 5、CP +1）；
  - ENTANGLE 完整回合流（缠足射击上 token → 对手回合开场 3→2 → 对手收场整枚移除）；
  - BLIND 两分支（seed `qa-me-blind-hit` 实测掷 2 作废 / `qa-me-blind-miss` 实测掷 4 照常）；
  - Missed Me L1 vs L2 同 seed 对照（防御骰 [1,1,5,5,1]：L1 回击 ⌊3/2⌋=1、L2 每箭=3，防止 ⌈4/2⌉=2 不变）；
  - 爆裂箭池骰归属（seed `qa-me` 池 [6,5,2,1,6]：伤害 3+2 箭+1 足=6、按**池**月扣 2 CP——与进攻骰的 3 月不同，证明池归属契约）；
  - 长弓三档 + of-a-kind 缠足正反例（4 同点 6 伤+缠足 / 3 箭无 4 同点 4 伤不缠足 / L3 三同点 5 伤+缠足）；
  - Ultimate 12 不可防御（守 HP 38、不开防御窗口、三状态 + 己方闪避）；
  - evasive 掷骰版 4 例（掷 1/2 避伤、掷 3/6 不避，无论点数都 3→2）；
  - 其余能力数值 9 例（致命/掩护/月蚀/缠足/致盲射击 + 4 个附赠能力，含同帧锁定吃 +2 的入桶 6/9）。
- describe 层新增渲染测试 **9 例**（`content/describe.test.ts` MoonElf 组）：
  三状态契约措辞、打偏 L1 floorDiv vs L2 每箭区分、长弓 L2 三档 + 4 同点条件、
  爆裂箭公式符号、Ultimate 12 不可防御 + 终极技能标注、月之魔法 / 暗月之影双分支。
- 质量门：`npm test` **475/475**（434 基线 + 41 新增）；三包 `tsc` 零错误；
  e2e 完整局 164 步通过；match 脚本对战通过；`assets:check` **188 条**。
