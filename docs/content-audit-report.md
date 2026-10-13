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
