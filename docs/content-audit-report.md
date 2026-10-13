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
