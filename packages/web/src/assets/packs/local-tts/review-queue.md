# 卡名核对清单（review-queue）

> 由 `scripts/apply-card-name-mapping.ts` 生成，**按 OCR 置信度升序**（低置信排最前）。
> 卡名基准来自对卡图卡名带的**逐张视觉复核**；OCR 原始值保留在 `ocr-results.json` 的 `ocrCleanedText`。
> 结果：卡面 230 张 · 已确认映射 5 张 · 待人工 225 张 · 未识别 0 张。

## 结论先说：待确认的不是「卡名」，而是「内容层 id」

绝大多数卡名已可判读，**真正卡住的是 shared 内容层的覆盖面**：

| 批次 | 张数 | 说明 | 需要谁决策 |
|---|---|---|---|
| A. 已确认 | 5 | 卡名与 shared defId 同名同档，已写 `confirmed: true` | 请复核我对齐得对不对 |
| B. barb/pyro 未对齐 | 61 | 英雄已在内容层，但印刷版卡名在 shared 里**没有同名 defId** | 文策渊：是否让内容层改成与印刷版卡组同 id（M3） |
| C. 其余 5 英雄 | 164 | 英雄本身还没进内容层 | 文策渊 + 主理人：M3 排期 |
| D. OCR 读空 | 0 | 读空但已由基准表补全 | 已处理，仅记录 |

> 命名空间以代码为准：`barbarian:` / `pyromancer:` / `common:`（`barb:` / `pyro:` 在仓库里不存在）。

### 内容层缺图提醒（shared 有 defId、但印刷版卡组里没有对应卡）
- `pyromancer:fireball:3`
- `barbarian:heavyBlow:2`
- `barbarian:heavyBlow:3`
- `barbarian:whirlwind:2`
- `barbarian:whirlwind:3`
- `barbarian:ironWill:2`

这些 id 目前**拿不到实体卡图**，UI 会回落到占位图。要么在 M3 补齐卡图，要么从内容层移除。

---

## B 组：barbarian / pyromancer（英雄已在内容层，等卡组 id 对齐）

需要确认的是：**是否把 shared 的卡组替换/对齐成印刷版卡组**。当前 shared 是自制数值卡组，
卡名（中文）与印刷版英文卡名对不上，所以我只对齐了 5 张同名同档的升级卡。

| 置信 | 文件 | 识别卡名 | 建议 id | OCR 与基准差异 |
|---|---|---|---|---|
| 🔴 41 | `pyromancer/cards/card-17.webp` | Six-It! | `tts-pyromancer-six-it` | OCR「Six-it!」→ 修正「Six-It!」 |
| 🔴 42 | `barbarian/cards/card-17.webp` | Six-It! | `tts-barbarian-six-it` | OCR「Six-it!」→ 修正「Six-It!」 |
| 🔴 43 | `pyromancer/cards/card-07.webp` | Tip It! | `tts-pyromancer-tip-it` | OCR「Tip Itm」→ 修正「Tip It!」 |
| 🔴 48 | `barbarian/cards/card-25.webp` | Overpower II | `tts-barbarian-overpower-ii` | — |
| 🔴 48 | `pyromancer/cards/card-20.webp` | Pyroblast III | `tts-pyromancer-pyroblast-iii` | — |
| 🟡 51 | `pyromancer/cards/card-19.webp` | Pyroblast II | `tts-pyromancer-pyroblast-ii` | — |
| 🟡 51 | `pyromancer/cards/card-25.webp` | Meteorite II | `tts-pyromancer-meteorite-ii` | — |
| 🟡 53 | `barbarian/cards/card-24.webp` | Fortitude II | `tts-barbarian-fortitude-ii` | — |
| 🟡 55 | `barbarian/cards/card-18.webp` | Smack II | `tts-barbarian-smack-ii` | OCR「Smack」→ 修正「Smack II」 |
| 🟡 55 | `barbarian/cards/card-23.webp` | Crit Bash II | `tts-barbarian-crit-bash-ii` | OCR「Critbash II」→ 修正「Crit Bash II」 |
| 🟡 60 | `pyromancer/cards/card-27.webp` | Molten Armor III | `tts-pyromancer-molten-armor-iii` | OCR「Molten Armor II」→ 修正「Molten Armor III」 |
| 🟡 63 | `barbarian/cards/card-20.webp` | Sturdy Blow II | `tts-barbarian-sturdy-blow-ii` | — |
| 🟢 70 | `barbarian/cards/card-19.webp` | Smack III | `tts-barbarian-smack-iii` | — |
| 🟢 73 | `barbarian/cards/card-22.webp` | Mighty Blow II | `tts-barbarian-mighty-blow-ii` | — |
| 🟢 75 | `barbarian/cards/card-02.webp` | Vegas Baby! | `tts-barbarian-vegas-baby` | — |
| 🟢 76 | `barbarian/cards/card-07.webp` | Tip It! | `tts-barbarian-tip-it` | OCR「Tip Itm」→ 修正「Tip It!」 |
| 🟢 76 | `barbarian/cards/card-16.webp` | Better D! | `tts-barbarian-better-d` | — |
| 🟢 76 | `pyromancer/cards/card-21.webp` | Burning Soul II | `tts-pyromancer-burning-soul-ii` | — |
| 🟢 79 | `barbarian/cards/card-28.webp` | Concuss! | `tts-barbarian-concuss` | — |
| 🟢 79 | `pyromancer/cards/card-16.webp` | Better D! | `tts-pyromancer-better-d` | — |
| 🟢 80 | `pyromancer/cards/card-15.webp` | Helping Hand | `tts-pyromancer-helping-hand` | — |
| 🟢 80 | `pyromancer/cards/card-23.webp` | Hot Streak II | `tts-pyromancer-hot-streak-ii` | — |
| 🟢 81 | `barbarian/cards/card-15.webp` | Helping Hand | `tts-barbarian-helping-hand` | — |
| 🟢 83 | `barbarian/cards/card-12.webp` | So Wild! | `tts-barbarian-so-wild` | — |
| 🟢 83 | `barbarian/cards/card-27.webp` | Thick Skin II | `tts-barbarian-thick-skin-ii` | — |
| 🟢 83 | `pyromancer/cards/card-02.webp` | Vegas Baby! | `tts-pyromancer-vegas-baby` | — |
| 🟢 84 | `barbarian/cards/card-14.webp` | One More Time! | `tts-barbarian-one-more-time` | — |
| 🟢 84 | `pyromancer/cards/card-14.webp` | One More Time! | `tts-pyromancer-one-more-time` | — |
| 🟢 85 | `barbarian/cards/card-21.webp` | Sturdy Blow III | `tts-barbarian-sturdy-blow-iii` | — |
| 🟢 87 | `pyromancer/cards/card-31.webp` | Huzzah! | `tts-pyromancer-huzzah` | — |
| 🟢 88 | `barbarian/cards/card-13.webp` | Samesies! | `tts-barbarian-samesies` | — |
| 🟢 89 | `pyromancer/cards/card-13.webp` | Samesies! | `tts-pyromancer-samesies` | — |
| 🟢 91 | `pyromancer/cards/card-12.webp` | So Wild! | `tts-pyromancer-so-wild` | — |
| 🟢 92 | `barbarian/cards/card-06.webp` | Buh, Bye! | `tts-barbarian-buh-bye` | OCR「Buh. Bye!」→ 修正「Buh, Bye!」 |
| 🟢 93 | `barbarian/cards/card-01.webp` | What Status Effects? | `tts-barbarian-what-status-effects` | — |
| 🟢 93 | `barbarian/cards/card-31.webp` | Feelin' Good! | `tts-barbarian-feelin-good` | — |
| 🟢 93 | `pyromancer/cards/card-06.webp` | Buh, Bye! | `tts-pyromancer-buh-bye` | OCR「Buh. Bye!」→ 修正「Buh, Bye!」 |
| 🟢 93 | `pyromancer/cards/card-11.webp` | Try, Try Again! | `tts-pyromancer-try-try-again` | OCR「Try. Try Again!」→ 修正「Try, Try Again!」 |
| 🟢 94 | `barbarian/cards/card-03.webp` | Get That Outta Here! | `tts-barbarian-get-that-outta-here` | — |
| 🟢 94 | `barbarian/cards/card-04.webp` | Triple Up! | `tts-barbarian-triple-up` | — |
| 🟢 94 | `barbarian/cards/card-11.webp` | Try, Try Again! | `tts-barbarian-try-try-again` | OCR「Try. Try Again!」→ 修正「Try, Try Again!」 |
| 🟢 94 | `barbarian/cards/card-30.webp` | Get Some! | `tts-barbarian-get-some` | — |
| 🟢 94 | `pyromancer/cards/card-01.webp` | What Status Effects? | `tts-pyromancer-what-status-effects` | — |
| 🟢 94 | `pyromancer/cards/card-03.webp` | Get That Outta Here! | `tts-pyromancer-get-that-outta-here` | — |
| 🟢 94 | `pyromancer/cards/card-04.webp` | Triple Up! | `tts-pyromancer-triple-up` | — |
| 🟢 94 | `pyromancer/cards/card-28.webp` | Warm Up! | `tts-pyromancer-warm-up` | — |
| 🟢 95 | `barbarian/cards/card-05.webp` | Double Up! | `tts-barbarian-double-up` | — |
| 🟢 95 | `barbarian/cards/card-08.webp` | Getting Paid! | `tts-barbarian-getting-paid` | — |
| 🟢 95 | `barbarian/cards/card-09.webp` | Not This Time! | `tts-barbarian-not-this-time` | — |
| 🟢 95 | `barbarian/cards/card-10.webp` | Twice As Wild! | `tts-barbarian-twice-as-wild` | — |
| 🟢 95 | `barbarian/cards/card-29.webp` | Head Bash! | `tts-barbarian-head-bash` | — |
| 🟢 95 | `barbarian/cards/card-32.webp` | Adrenaline Surge! | `tts-barbarian-adrenaline-surge` | — |
| 🟢 95 | `pyromancer/cards/card-05.webp` | Double Up! | `tts-pyromancer-double-up` | — |
| 🟢 95 | `pyromancer/cards/card-08.webp` | Getting Paid! | `tts-pyromancer-getting-paid` | — |
| 🟢 95 | `pyromancer/cards/card-09.webp` | Not This Time! | `tts-pyromancer-not-this-time` | — |
| 🟢 95 | `pyromancer/cards/card-10.webp` | Twice As Wild! | `tts-pyromancer-twice-as-wild` | — |
| 🟢 95 | `pyromancer/cards/card-30.webp` | Red Hot! | `tts-pyromancer-red-hot` | — |
| 🟢 95 | `pyromancer/cards/card-32.webp` | Infernal Infusion! | `tts-pyromancer-infernal-infusion` | — |
| 🟢 96 | `barbarian/cards/card-00.webp` | Transference! | `tts-barbarian-transference` | — |
| 🟢 96 | `pyromancer/cards/card-00.webp` | Transference! | `tts-pyromancer-transference` | — |
| 🟢 96 | `pyromancer/cards/card-29.webp` | Fire Up! | `tts-pyromancer-fire-up` | — |

---

## C 组：其余 5 个英雄（等内容层扩充）

| 置信 | 文件 | 识别卡名 | 建议 id | OCR 与基准差异 |
|---|---|---|---|---|
| 🔴 0 | `gunslinger/cards/card-07.webp` | Tip It! | `tts-gunslinger-tip-it` | OCR「Tip Im」→ 修正「Tip It!」 |
| 🔴 30 | `moonelf/cards/card-24.webp` | Entangling Shot II | `tts-moonelf-entangling-shot-ii` | OCR「Entangling Shot」→ 修正「Entangling Shot II」 |
| 🔴 32 | `gunslinger/cards/card-22.webp` | Fan The Hammer II | `tts-gunslinger-fan-the-hammer-ii` | OCR「Fan The Hammerne」→ 修正「Fan The Hammer II」 |
| 🔴 35 | `raveness/cards/card-17.webp` | Six-It! | `tts-raveness-six-it` | OCR「Six-it!」→ 修正「Six-It!」 |
| 🔴 40 | `gunslinger/cards/card-17.webp` | Six-It! | `tts-gunslinger-six-it` | OCR「Six-it!」→ 修正「Six-It!」 |
| 🔴 41 | `gunslinger/cards/card-23.webp` | Bounty Hunter II | `tts-gunslinger-bounty-hunter-ii` | — |
| 🔴 41 | `moonelf/cards/card-30.webp` | Volley! | `tts-moonelf-volley` | — |
| 🔴 41 | `shadowthief/cards/card-17.webp` | Six-It! | `tts-shadowthief-six-it` | OCR「Six-it!」→ 修正「Six-It!」 |
| 🔴 43 | `shadowthief/cards/card-07.webp` | Tip It! | `tts-shadowthief-tip-it` | OCR「Tip Itm」→ 修正「Tip It!」 |
| 🔴 44 | `ninja/cards/card-20.webp` | Smokescreen II | `tts-ninja-smokescreen-ii` | — |
| 🔴 46 | `moonelf/cards/card-21.webp` | Covered Shot II | `tts-moonelf-covered-shot-ii` | OCR「Covered Shot I」→ 修正「Covered Shot II」 |
| 🔴 46 | `shadowthief/cards/card-21.webp` | Insidious Strike II | `tts-shadowthief-insidious-strike-ii` | OCR「Insidious Strikenl」→ 修正「Insidious Strike II」 |
| 🔴 47 | `gunslinger/cards/card-20.webp` | Showdown III | `tts-gunslinger-showdown-iii` | — |
| 🔴 47 | `moonelf/cards/card-22.webp` | Exploding Arrow II | `tts-moonelf-exploding-arrow-ii` | OCR「Exploding Arrow Inh」→ 修正「Exploding Arrow II」 |
| 🔴 49 | `shadowthief/cards/card-23.webp` | Carducopia II | `tts-shadowthief-carducopia-ii` | OCR「Carducopian」→ 修正「Carducopia II」 |
| 🟡 50 | `shadowthief/cards/card-19.webp` | Pickpocket II | `tts-shadowthief-pickpocket-ii` | — |
| 🟡 52 | `raveness/cards/card-25.webp` | Nothing More II | `tts-raveness-nothing-more-ii` | — |
| 🟡 53 | `ninja/cards/card-18.webp` | Slash II | `tts-ninja-slash-ii` | — |
| 🟡 54 | `gunslinger/cards/card-21.webp` | Revolver II | `tts-gunslinger-revolver-ii` | OCR「Revolver I」→ 修正「Revolver II」 |
| 🟡 55 | `raveness/cards/card-20.webp` | Craven II | `tts-raveness-craven-ii` | — |
| 🟡 57 | `gunslinger/cards/card-24.webp` | Take Cover II | `tts-gunslinger-take-cover-ii` | OCR「Take Cover」→ 修正「Take Cover II」 |
| 🟡 57 | `moonelf/cards/card-07.webp` | Tip It! | `tts-moonelf-tip-it` | OCR「Tipim」→ 修正「Tip It!」 |
| 🟡 57 | `moonelf/cards/card-27.webp` | Missed Me II | `tts-moonelf-missed-me-ii` | — |
| 🟡 57 | `ninja/cards/card-24.webp` | Shadewalk II | `tts-ninja-shadewalk-ii` | — |
| 🟡 57 | `shadowthief/cards/card-22.webp` | Shadow Dance II | `tts-shadowthief-shadow-dance-ii` | — |
| 🟡 59 | `raveness/cards/card-16.webp` | Better D! | `tts-raveness-better-d` | — |
| 🟡 60 | `raveness/cards/card-21.webp` | Chamber II | `tts-raveness-chamber-ii` | OCR「Chamber I」→ 修正「Chamber II」 |
| 🟡 61 | `raveness/cards/card-29.webp` | Stone Beak! | `tts-raveness-stone-beak` | OCR「Stone Beak?」→ 修正「Stone Beak!」 |
| 🟡 62 | `ninja/cards/card-21.webp` | Walk The Line II | `tts-ninja-walk-the-line-ii` | OCR「Walk The Line」→ 修正「Walk The Line II」 |
| 🟡 62 | `raveness/cards/card-15.webp` | Helping Hand | `tts-raveness-helping-hand` | OCR「Helping Hand!」→ 修正「Helping Hand」 |
| 🟡 63 | `gunslinger/cards/card-19.webp` | Showdown II | `tts-gunslinger-showdown-ii` | — |
| 🟡 63 | `moonelf/cards/card-15.webp` | Helping Hand | `tts-moonelf-helping-hand` | OCR「Helping Hand!」→ 修正「Helping Hand」 |
| 🟡 63 | `moonelf/cards/card-29.webp` | Take That! | `tts-moonelf-take-that` | — |
| 🟡 63 | `ninja/cards/card-22.webp` | Poison Blade II | `tts-ninja-poison-blade-ii` | — |
| 🟡 63 | `shadowthief/cards/card-20.webp` | Shifty Strike II | `tts-shadowthief-shifty-strike-ii` | — |
| 🟡 63 | `shadowthief/cards/card-28.webp` | Wild Shadow! | `tts-shadowthief-wild-shadow` | — |
| 🟡 64 | `raveness/cards/card-19.webp` | Fowl Friend II | `tts-raveness-fowl-friend-ii` | — |
| 🟡 65 | `gunslinger/cards/card-18.webp` | Duel II | `tts-gunslinger-duel-ii` | — |
| 🟡 66 | `raveness/cards/card-12.webp` | So Wild! | `tts-raveness-so-wild` | — |
| 🟡 66 | `shadowthief/cards/card-25.webp` | Counter Strike II | `tts-shadowthief-counter-strike-ii` | OCR「Counterstrike II」→ 修正「Counter Strike II」 |
| 🟡 69 | `raveness/cards/card-22.webp` | Murder Of Crows II | `tts-raveness-murder-of-crows-ii` | OCR「Murder Of Crowsiii」→ 修正「Murder Of Crows II」 |
| 🟢 70 | `raveness/cards/card-11.webp` | Try, Try Again! | `tts-raveness-try-try-again` | OCR「Try. Try Again!」→ 修正「Try, Try Again!」 |
| 🟢 71 | `moonelf/cards/card-09.webp` | Not This Time! | `tts-moonelf-not-this-time` | — |
| 🟢 71 | `moonelf/cards/card-11.webp` | Try, Try Again! | `tts-moonelf-try-try-again` | OCR「Try. Try Again!」→ 修正「Try, Try Again!」 |
| 🟢 71 | `moonelf/cards/card-14.webp` | One More Time! | `tts-moonelf-one-more-time` | — |
| 🟢 71 | `ninja/cards/card-10.webp` | Twice As Wild! | `tts-ninja-twice-as-wild` | — |
| 🟢 71 | `ninja/cards/card-17.webp` | Six-It! | `tts-ninja-six-it` | OCR「Six-it!」→ 修正「Six-It!」 |
| 🟢 71 | `raveness/cards/card-09.webp` | Not This Time! | `tts-raveness-not-this-time` | — |
| 🟢 71 | `raveness/cards/card-10.webp` | Twice As Wild! | `tts-raveness-twice-as-wild` | — |
| 🟢 71 | `raveness/cards/card-14.webp` | One More Time! | `tts-raveness-one-more-time` | — |
| 🟢 72 | `moonelf/cards/card-18.webp` | Longbow II | `tts-moonelf-longbow-ii` | — |
| 🟢 72 | `moonelf/cards/card-19.webp` | Longbow III | `tts-moonelf-longbow-iii` | — |
| 🟢 73 | `raveness/cards/card-07.webp` | Tip It! | `tts-raveness-tip-it` | OCR「Tipit」→ 修正「Tip It!」 |
| 🟢 74 | `gunslinger/cards/card-25.webp` | Deadeye II | `tts-gunslinger-deadeye-ii` | — |
| 🟢 74 | `moonelf/cards/card-20.webp` | Demising Shot II | `tts-moonelf-demising-shot-ii` | — |
| 🟢 74 | `ninja/cards/card-23.webp` | Shadow Fang II | `tts-ninja-shadow-fang-ii` | — |
| 🟢 75 | `raveness/cards/card-18.webp` | Peck II | `tts-raveness-peck-ii` | OCR「Peck I」→ 修正「Peck II」 |
| 🟢 76 | `ninja/cards/card-25.webp` | Shade Shift II | `tts-ninja-shade-shift-ii` | — |
| 🟢 76 | `raveness/cards/card-24.webp` | Beguile II | `tts-raveness-beguile-ii` | — |
| 🟢 77 | `ninja/cards/card-02.webp` | Vegas Baby! | `tts-ninja-vegas-baby` | — |
| 🟢 78 | `ninja/cards/card-19.webp` | Death Blossom II | `tts-ninja-death-blossom-ii` | — |
| 🟢 79 | `gunslinger/cards/card-16.webp` | Better D! | `tts-gunslinger-better-d` | — |
| 🟢 79 | `shadowthief/cards/card-16.webp` | Better D! | `tts-shadowthief-better-d` | — |
| 🟢 80 | `gunslinger/cards/card-15.webp` | Helping Hand | `tts-gunslinger-helping-hand` | — |
| 🟢 80 | `gunslinger/cards/card-26.webp` | Wild West! | `tts-gunslinger-wild-west` | — |
| 🟢 80 | `shadowthief/cards/card-15.webp` | Helping Hand | `tts-shadowthief-helping-hand` | — |
| 🟢 81 | `moonelf/cards/card-26.webp` | Eclipse II | `tts-moonelf-eclipse-ii` | — |
| 🟢 82 | `moonelf/cards/card-02.webp` | Vegas Baby! | `tts-moonelf-vegas-baby` | — |
| 🟢 82 | `moonelf/cards/card-25.webp` | Blinding Shot II | `tts-moonelf-blinding-shot-ii` | — |
| 🟢 83 | `gunslinger/cards/card-02.webp` | Vegas Baby! | `tts-gunslinger-vegas-baby` | — |
| 🟢 83 | `gunslinger/cards/card-14.webp` | One More Time! | `tts-gunslinger-one-more-time` | — |
| 🟢 83 | `shadowthief/cards/card-02.webp` | Vegas Baby! | `tts-shadowthief-vegas-baby` | — |
| 🟢 83 | `shadowthief/cards/card-18.webp` | Dagger Strike II | `tts-shadowthief-dagger-strike-ii` | — |
| 🟢 84 | `moonelf/cards/card-17.webp` | Six-It! | `tts-moonelf-six-it` | OCR「Six-it!」→ 修正「Six-It!」 |
| 🟢 84 | `moonelf/cards/card-23.webp` | Exploding Arrow III | `tts-moonelf-exploding-arrow-iii` | — |
| 🟢 84 | `shadowthief/cards/card-14.webp` | One More Time! | `tts-shadowthief-one-more-time` | — |
| 🟢 85 | `ninja/cards/card-12.webp` | So Wild! | `tts-ninja-so-wild` | — |
| 🟢 85 | `raveness/cards/card-23.webp` | Raven Sight II | `tts-raveness-raven-sight-ii` | — |
| 🟢 86 | `gunslinger/cards/card-31.webp` | Quick Draw II | `tts-gunslinger-quick-draw-ii` | — |
| 🟢 86 | `shadowthief/cards/card-24.webp` | Shadow Defense II | `tts-shadowthief-shadow-defense-ii` | — |
| 🟢 87 | `raveness/cards/card-02.webp` | Vegas Baby! | `tts-raveness-vegas-baby` | — |
| 🟢 88 | `ninja/cards/card-32.webp` | Dojo! | `tts-ninja-dojo` | — |
| 🟢 88 | `raveness/cards/card-13.webp` | Samesies! | `tts-raveness-samesies` | — |
| 🟢 89 | `gunslinger/cards/card-13.webp` | Samesies! | `tts-gunslinger-samesies` | — |
| 🟢 89 | `moonelf/cards/card-06.webp` | Buh, Bye! | `tts-moonelf-buh-bye` | OCR「Buh. Bye!」→ 修正「Buh, Bye!」 |
| 🟢 89 | `ninja/cards/card-13.webp` | Samesies! | `tts-ninja-samesies` | — |
| 🟢 89 | `shadowthief/cards/card-13.webp` | Samesies! | `tts-shadowthief-samesies` | — |
| 🟢 90 | `moonelf/cards/card-13.webp` | Samesies! | `tts-moonelf-samesies` | — |
| 🟢 91 | `gunslinger/cards/card-12.webp` | So Wild! | `tts-gunslinger-so-wild` | — |
| 🟢 91 | `moonelf/cards/card-16.webp` | Better D! | `tts-moonelf-better-d` | — |
| 🟢 91 | `moonelf/cards/card-32.webp` | Lunar Umbra! | `tts-moonelf-lunar-umbra` | — |
| 🟢 91 | `shadowthief/cards/card-12.webp` | So Wild! | `tts-shadowthief-so-wild` | — |
| 🟢 92 | `moonelf/cards/card-12.webp` | So Wild! | `tts-moonelf-so-wild` | — |
| 🟢 92 | `moonelf/cards/card-28.webp` | Moon Magic! | `tts-moonelf-moon-magic` | — |
| 🟢 92 | `ninja/cards/card-16.webp` | Better D! | `tts-ninja-better-d` | — |
| 🟢 92 | `raveness/cards/card-01.webp` | What Status Effects? | `tts-raveness-what-status-effects` | — |
| 🟢 93 | `gunslinger/cards/card-06.webp` | Buh, Bye! | `tts-gunslinger-buh-bye` | OCR「Buh. Bye!」→ 修正「Buh, Bye!」 |
| 🟢 93 | `gunslinger/cards/card-11.webp` | Try, Try Again! | `tts-gunslinger-try-try-again` | OCR「Try. Try Again!」→ 修正「Try, Try Again!」 |
| 🟢 93 | `ninja/cards/card-06.webp` | Buh, Bye! | `tts-ninja-buh-bye` | OCR「Buh. Bye!」→ 修正「Buh, Bye!」 |
| 🟢 93 | `raveness/cards/card-06.webp` | Buh, Bye! | `tts-raveness-buh-bye` | OCR「Buh. Bye!」→ 修正「Buh, Bye!」 |
| 🟢 93 | `raveness/cards/card-27.webp` | Nevermore Attack! | `tts-raveness-nevermore-attack` | — |
| 🟢 93 | `shadowthief/cards/card-06.webp` | Buh, Bye! | `tts-shadowthief-buh-bye` | OCR「Buh. Bye!」→ 修正「Buh, Bye!」 |
| 🟢 93 | `shadowthief/cards/card-11.webp` | Try, Try Again! | `tts-shadowthief-try-try-again` | OCR「Try. Try Again!」→ 修正「Try, Try Again!」 |
| 🟢 93 | `shadowthief/cards/card-27.webp` | Poison Wound! | `tts-shadowthief-poison-wound` | — |
| 🟢 94 | `gunslinger/cards/card-01.webp` | What Status Effects? | `tts-gunslinger-what-status-effects` | — |
| 🟢 94 | `gunslinger/cards/card-03.webp` | Get That Outta Here! | `tts-gunslinger-get-that-outta-here` | — |
| 🟢 94 | `gunslinger/cards/card-04.webp` | Triple Up! | `tts-gunslinger-triple-up` | — |
| 🟢 94 | `gunslinger/cards/card-05.webp` | Double Up! | `tts-gunslinger-double-up` | — |
| 🟢 94 | `gunslinger/cards/card-27.webp` | Wanted! | `tts-gunslinger-wanted` | — |
| 🟢 94 | `gunslinger/cards/card-30.webp` | Eat Lead! | `tts-gunslinger-eat-lead` | — |
| 🟢 94 | `moonelf/cards/card-00.webp` | Transference! | `tts-moonelf-transference` | — |
| 🟢 94 | `moonelf/cards/card-05.webp` | Double Up! | `tts-moonelf-double-up` | — |
| 🟢 94 | `ninja/cards/card-01.webp` | What Status Effects? | `tts-ninja-what-status-effects` | — |
| 🟢 94 | `ninja/cards/card-03.webp` | Get That Outta Here! | `tts-ninja-get-that-outta-here` | — |
| 🟢 94 | `ninja/cards/card-05.webp` | Double Up! | `tts-ninja-double-up` | — |
| 🟢 94 | `ninja/cards/card-07.webp` | Tip It! | `tts-ninja-tip-it` | — |
| 🟢 94 | `ninja/cards/card-09.webp` | Not This Time! | `tts-ninja-not-this-time` | — |
| 🟢 94 | `ninja/cards/card-14.webp` | One More Time! | `tts-ninja-one-more-time` | — |
| 🟢 94 | `ninja/cards/card-29.webp` | Smoke Offering! | `tts-ninja-smoke-offering` | — |
| 🟢 94 | `raveness/cards/card-04.webp` | Triple Up! | `tts-raveness-triple-up` | — |
| 🟢 94 | `raveness/cards/card-08.webp` | Getting Paid! | `tts-raveness-getting-paid` | — |
| 🟢 94 | `raveness/cards/card-26.webp` | Midnight Dreary! | `tts-raveness-midnight-dreary` | — |
| 🟢 94 | `shadowthief/cards/card-01.webp` | What Status Effects? | `tts-shadowthief-what-status-effects` | — |
| 🟢 94 | `shadowthief/cards/card-03.webp` | Get That Outta Here! | `tts-shadowthief-get-that-outta-here` | — |
| 🟢 94 | `shadowthief/cards/card-04.webp` | Triple Up! | `tts-shadowthief-triple-up` | — |
| 🟢 94 | `shadowthief/cards/card-05.webp` | Double Up! | `tts-shadowthief-double-up` | — |
| 🟢 94 | `shadowthief/cards/card-30.webp` | Enter The Shadows! | `tts-shadowthief-enter-the-shadows` | — |
| 🟢 94 | `shadowthief/cards/card-32.webp` | Shadow Meld! | `tts-shadowthief-shadow-meld` | — |
| 🟢 95 | `gunslinger/cards/card-08.webp` | Getting Paid! | `tts-gunslinger-getting-paid` | — |
| 🟢 95 | `gunslinger/cards/card-09.webp` | Not This Time! | `tts-gunslinger-not-this-time` | — |
| 🟢 95 | `gunslinger/cards/card-10.webp` | Twice As Wild! | `tts-gunslinger-twice-as-wild` | — |
| 🟢 95 | `gunslinger/cards/card-28.webp` | Spin The Chamber! | `tts-gunslinger-spin-the-chamber` | — |
| 🟢 95 | `gunslinger/cards/card-29.webp` | Roulette! | `tts-gunslinger-roulette` | — |
| 🟢 95 | `gunslinger/cards/card-32.webp` | Run And Gun! | `tts-gunslinger-run-and-gun` | — |
| 🟢 95 | `moonelf/cards/card-01.webp` | What Status Effects? | `tts-moonelf-what-status-effects` | — |
| 🟢 95 | `moonelf/cards/card-03.webp` | Get That Outta Here! | `tts-moonelf-get-that-outta-here` | — |
| 🟢 95 | `moonelf/cards/card-04.webp` | Triple Up! | `tts-moonelf-triple-up` | — |
| 🟢 95 | `moonelf/cards/card-08.webp` | Getting Paid! | `tts-moonelf-getting-paid` | — |
| 🟢 95 | `moonelf/cards/card-31.webp` | Evade! | `tts-moonelf-evade` | — |
| 🟢 95 | `ninja/cards/card-04.webp` | Triple Up! | `tts-ninja-triple-up` | — |
| 🟢 95 | `ninja/cards/card-08.webp` | Getting Paid! | `tts-ninja-getting-paid` | — |
| 🟢 95 | `ninja/cards/card-11.webp` | Try, Try Again! | `tts-ninja-try-try-again` | OCR「Try. Try Again!」→ 修正「Try, Try Again!」 |
| 🟢 95 | `ninja/cards/card-15.webp` | Helping Hand | `tts-ninja-helping-hand` | — |
| 🟢 95 | `ninja/cards/card-26.webp` | Poison Dart! | `tts-ninja-poison-dart` | — |
| 🟢 95 | `ninja/cards/card-27.webp` | Throwing Stars! | `tts-ninja-throwing-stars` | — |
| 🟢 95 | `ninja/cards/card-28.webp` | Fan Of Knives! | `tts-ninja-fan-of-knives` | — |
| 🟢 95 | `ninja/cards/card-30.webp` | Train! | `tts-ninja-train` | — |
| 🟢 95 | `ninja/cards/card-31.webp` | Escape! | `tts-ninja-escape` | — |
| 🟢 95 | `raveness/cards/card-05.webp` | Double Up! | `tts-raveness-double-up` | — |
| 🟢 95 | `raveness/cards/card-31.webp` | Cull! | `tts-raveness-cull` | — |
| 🟢 95 | `shadowthief/cards/card-08.webp` | Getting Paid! | `tts-shadowthief-getting-paid` | — |
| 🟢 95 | `shadowthief/cards/card-09.webp` | Not This Time! | `tts-shadowthief-not-this-time` | — |
| 🟢 95 | `shadowthief/cards/card-10.webp` | Twice As Wild! | `tts-shadowthief-twice-as-wild` | — |
| 🟢 95 | `shadowthief/cards/card-26.webp` | Sneaky! | `tts-shadowthief-sneaky` | — |
| 🟢 95 | `shadowthief/cards/card-31.webp` | Card Trick! | `tts-shadowthief-card-trick` | — |
| 🟢 96 | `gunslinger/cards/card-00.webp` | Transference! | `tts-gunslinger-transference` | — |
| 🟢 96 | `moonelf/cards/card-10.webp` | Twice As Wild! | `tts-moonelf-twice-as-wild` | — |
| 🟢 96 | `ninja/cards/card-00.webp` | Transference! | `tts-ninja-transference` | — |
| 🟢 96 | `raveness/cards/card-00.webp` | Transference! | `tts-raveness-transference` | — |
| 🟢 96 | `raveness/cards/card-03.webp` | Get That Outta Here! | `tts-raveness-get-that-outta-here` | — |
| 🟢 96 | `raveness/cards/card-28.webp` | Talon Strike! | `tts-raveness-talon-strike` | — |
| 🟢 96 | `raveness/cards/card-30.webp` | Broken Stillness! | `tts-raveness-broken-stillness` | — |
| 🟢 96 | `shadowthief/cards/card-00.webp` | Transference! | `tts-shadowthief-transference` | — |
| 🟢 96 | `shadowthief/cards/card-29.webp` | Shadow Coin! | `tts-shadowthief-shadow-coin` | — |

---

## A 组：本次已写 `confirmed: true` 的映射（请复核）

| 文件 | 卡名 | logicalId | 依据 |
|---|---|---|---|
| `pyromancer/cards/card-18.webp` | Fireball II | `pyromancer:fireball:2` | 卡名 slug == defId slug，档位一致（OCR 直接命中） |
| `pyromancer/cards/card-22.webp` | Combustion II | `pyromancer:combustion:2` | 卡名 slug == defId slug，档位一致（OCR 直接命中） |
| `pyromancer/cards/card-24.webp` | Ignite II | `pyromancer:ignite:2` | 卡名 slug == defId slug，档位一致（OCR 直接命中） |
| `pyromancer/cards/card-26.webp` | Molten Armor II | `pyromancer:moltenArmor:2` | 卡名 slug == defId slug，档位一致（视觉复核） |
| `barbarian/cards/card-26.webp` | Reckless II | `barbarian:reckless:2` | 卡名 slug == defId slug，档位一致（OCR 直接命中） |

---

## 怎么用这份清单

1. 先看 C 组里标 🔴 的（置信 <50）：这些是 OCR 最不确定的，请对着 `images/<hero>/cards/card-NN.webp` 目视确认卡名。
2. B 组不是「名字对不对」的问题，而是**产品决策**：shared 内容层的卡组要不要改成印刷版卡组。
3. 确认后把 `manifest.json` 里该条的 `logicalId` 改成 shared id、`confirmed: true`（文件名不用动），
   然后 `node --import tsx scripts/gen-asset-catalog.ts --check` 必须保持绿色。
