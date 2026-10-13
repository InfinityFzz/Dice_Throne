# 英雄 / 卡牌 / 状态效果 DSL — 类型定义与实例化草稿

> 配套文件：`D:\workbuddy\design\dice-throne-design-spec.md`（§3 为设计说明，本文为实现级数据）
> 任务号：DT-DES-001　|　作者：文策渊（design-strategist）
> **本文件是 engineering-lead 直接消费的数据模型源。**
> 数值标注：✅ 已交叉验证　🔶 需 rules-lawyering 校准 pass（见主文档 §7 Q8）

---

## 0. IP 声明

本文档为**游戏机制的结构化表达**，不包含任何官方卡面文本、规则书原文、美术资产或 flavor text。
所有 `AbilityId` / `CardId` / `StatusId` 仅为内部调试用占位标识，重皮时可整体替换。
数据文件中出现的字符串均为**机制符号与效果逻辑**，不含叙事文本。

---

## 1. 核心类型定义

```ts
/* ══════════════════════════════════════════════════════════════
   §1.1 基础标识
   ══════════════════════════════════════════════════════════════ */

export type HeroId    = string;   // "barbarian" | "pyromancer" | ...
export type AbilityId = string;   // "barb:reckless"  命名空间避免跨英雄撞车
export type CardId    = string;   // "barb:upg_reckless_2"
export type StatusId  = string;   // "pyro:burn" | "common:knockdown"
export type PlayerId  = string;

export type FaceIndex = 1 | 2 | 3 | 4 | 5 | 6;
export type Sym       = string;   // 英雄作用域内的机制符号 id

/* ══════════════════════════════════════════════════════════════
   §1.2 骰子视图与匹配器
   ══════════════════════════════════════════════════════════════ */

/**
 * 骰面定义（DT-DES-002 §4-4 新增，用于表达 Wild / 多符号面）。
 * MVP 4 英雄每面 symbols.length === 1。
 */
export interface DieFace {
  /** 顺子判定用的点数（1..6） */
  value: FaceIndex;
  /** 该面的符号集合；长度 >1 即为 Wild 面（可充当任一符号 / 任一值） */
  symbols: Sym[];
}

export interface DiceView {
  faces:   FaceIndex[];      // 长度 5
  symbols: Sym[];            // 长度 5，由 faces 经 hero.dieFaces 映射得到
  locked:  boolean[];        // 长度 5
  /** 🆕 骰面符号覆写（扩展点 E2，MVP 不使用） */
  overrideSymbols?: Partial<Record<number, Sym>>;
}

export interface MatchResult {
  matched: boolean;
  /** 满足条件的骰子下标 —— 直接驱动 UI 高亮（主文档 §1.3） */
  matchedDiceIndices: number[];
  /** graded 匹配器命中的档位索引 */
  tier?: number;
}

export type DiceMatcher =
  /** N 个同类【符号】（如 3×flame） */
  | { kind: "countSymbol"; symbol: Sym; count: number }
  /** N 个同类【点数】（2/3/4/5-of-a-kind，官方按点数不按符号） */
  | { kind: "countFace"; face: FaceIndex; count: number }
  /** 向上兼容：3+ 表示 3/4/5 都满足 */
  | { kind: "atLeast"; of: DiceMatcher }
  /** 4 连号 */
  | { kind: "smallStraight" }
  /** 5 连号 */
  | { kind: "largeStraight" }
  /** 分档：3个→X / 4个→Y / 5个→Z，取满足的最高档（Fireball / Patience） */
  | { kind: "graded"; symbol: Sym; tiers: { min: number; effects: Effect[] }[]; pick: "highest" }
  /** 全部子条件同时满足（Combustion：四种符号各一） */
  | { kind: "allOf"; of: DiceMatcher[] }
  | { kind: "anyOf"; of: DiceMatcher[] }
  | { kind: "not";   of: DiceMatcher }
  /** 恒真：被动 / 防御能力 / 无骰型条件的卡牌 */
  | { kind: "const"; value: boolean };

/* ══════════════════════════════════════════════════════════════
   §1.3 目标引用
   ══════════════════════════════════════════════════════════════ */

export type TargetRef =
  | { kind: "self" }
  | { kind: "activePlayer" }
  /** 1v1 下唯一对手；多人模式下非法（须用 chosen / allOpponents） */
  | { kind: "opponent" }
  | { kind: "attacker" }
  | { kind: "defender" }
  /** 需要玩家选择 → 产生 PendingPrompt */
  | { kind: "chosen"; prompt: string; legal: TargetRef[] }
  /** 多人扩展（MVP 不出现） */
  | { kind: "allOpponents" }
  /** 伙伴扩展（E1，MVP 不出现） */
  | { kind: "companion"; owner: TargetRef };

/* ══════════════════════════════════════════════════════════════
   §1.4 数值 / 条件表达式
   ══════════════════════════════════════════════════════════════ */

export type CmpOp = "<" | "<=" | ">" | ">=" | "==";

export type NumExpr =
  | number
  /** 状态的当前堆叠数 —— "每枚 Fire Mastery +2" */
  | { v: "statusStacks"; status: StatusId; target: TargetRef }
  /**
   * 某符号的个数。
   * - "final" = **当前结算中的主骰池**：进攻能力结算时 = Final Dice Result；
   *   防御能力结算时 = 防御掷骰结果（DT-DES-002 澄清，Molten Armor / Moon Defense 依赖此语义）。
   * - "lastRoll" = 最近一次 rollDice 产生的临时骰池（A17：判定后销毁）。
   */
  | { v: "countSymbol"; symbol: Sym; dice: "final" | "lastRoll" }
  /** 最近一次 rollDice 的点数总和 —— "Roll 3: 伤害 = 总点数" */
  | { v: "sumFaces"; dice: "lastRoll" }
  | { v: "cp"; target: TargetRef }
  | { v: "hp"; target: TargetRef }
  | { v: "handSize"; target: TargetRef }
  /** 临时变量，配合 bind / bindRemovedTo */
  | { v: "var"; name: string }
  | { v: "add"; a: NumExpr; b: NumExpr }
  | { v: "sub"; a: NumExpr; b: NumExpr }
  | { v: "mul"; a: NumExpr; b: NumExpr }
  | { v: "min"; a: NumExpr; b: NumExpr }
  | { v: "max"; a: NumExpr; b: NumExpr };

export type Condition =
  | { c: "statusPresent"; target: TargetRef; status: StatusId; minStacks?: NumExpr }
  | { c: "hpCompare"; target: TargetRef; op: CmpOp; value: NumExpr }
  | { c: "cpCompare"; target: TargetRef; op: CmpOp; value: NumExpr }
  /** 本 Roll Phase 已造成的伤害总额 ≥ N（条件卡：造成 ≥8 才可用） */
  | { c: "damageDealtAtLeast"; value: NumExpr }
  /** 最近一次 rollDice 中某符号个数 ≥ min */
  | { c: "diceSymbolRolled"; symbol: Sym; min: number }
  /** 最近一次 rollDice 的点数和 ≥ N（Overpower 阈值判定用，与 Bucket 累计伤害区分） */
  | { c: "diceSumAtLeast"; value: number }
  /** 攻击命中（即使被完全闪避，攻击仍标记成功） */
  | { c: "hitSuccess" }
  | { c: "phaseIs"; phase: PhaseId }
  | { c: "and"; of: Condition[] }
  | { c: "or";  of: Condition[] }
  | { c: "not"; of: Condition };

/* ══════════════════════════════════════════════════════════════
   §1.5 伤害类型
   ══════════════════════════════════════════════════════════════ */

/**
 * **类型轴** —— 只描述「能否被防御 / 能否被 avoid / 能否被 Attack Modifier 增强」。
 *
 * 四分类，与 design spec §1.1 **A14（权威定义）** 一致。
 * 本文件原先列了 5 个（多一个 `"self"`）——那属于把「目标是谁」混进了类型轴，
 * 会让下游每个 `switch (type)` 都长出特判。DT-DES-003 已拆成两个正交维度：
 *   - `type: DamageType`         —— 类型轴（本类型）
 *   - `sourceKind: DamageSourceKind` —— 来源轴（谁产生的）
 *   - `target: TargetRef`        —— 目标轴（含 `{kind:"self"}`）
 */
export type DamageType =
  | "attack"        // 可防御。**是对手 Defense 的唯一触发条件**；受 prevent/avoid 影响；可被 Attack Modifier 增强
  | "undefendable"  // 不可防御；不受 prevent / avoid 影响；可被 Attack Modifier 增强（若来自进攻能力）
  | "collateral"    // 无目标（溅射），不算 Attack；不触发防御掷骰；**不可被增强**；但**可被 avoid 闪避**（C7）
  | "pure";         // 非攻击来源（状态 / Upkeep / **反伤**）；不触发防御掷骰；
                    // **不受 prevent / avoid 影响，也不可被增强**
                    // （官方原则：非攻击来源的伤害没有伤害类型）
                    // ★ 反伤（防御能力打向攻击方的伤害）走这一类 —— DT-DES-003 §R1

/**
 * **来源轴** —— 谁产生了这笔伤害。与 `DamageType` 正交。
 * `ultimate` 不进入 DamageType：终极伤害的「不可削减/防止/响应」由 A15 的
 * actionPermission 与 P2 ULTIMATE GATE 保证，类型轴仍走 `undefendable`。
 */
export type DamageSourceKind =
  | "ability"    // 进攻/防御能力的直接效果（**默认值**）
  | "status"     // 状态效果（Poison / Burn 的 Upkeep 伤害）
  | "ultimate"   // 终极能力
  | "recoil";    // 自我反噬（Reckless 反噬 4 点）

/**
 * **「造成的伤害」判定**（供 `damageDealtAtLeast` 条件卡与 `onDamageDealt` 钩子使用）：
 *
 *   计入 ⟺  `target !== self`  **且**  `sourceKind !== "recoil"`
 *
 * 自我伤害与反噬不计入——否则 Reckless 的自伤会触发"你造成了 ≥N 伤害"类条件卡，
 * 也会让 `onDamageDealt` 在打自己时触发。
 *
 * **反伤计入**（`target: attacker` ≠ self，`sourceKind: "ability"`）。这不会造成泄漏，
 * 因为累计器 `turnDamageDealt[seat]` **按回合（`turnIndex`）重置**：
 * 防守方在对手回合打出的反伤，只计入"本回合"的防守方累计值，
 * 不会带进防守方自己回合的条件卡判定。
 */

/* ══════════════════════════════════════════════════════════════
   §1.6 效果原语
   ══════════════════════════════════════════════════════════════ */

export type Effect =
  // ── 伤害 / 治疗 ─────────────────────────────
  | { t: "dealDamage";    amount: NumExpr; type: DamageType; target: TargetRef;
                          sourceKind?: DamageSourceKind }  // 默认 "ability"
                          // 自我反噬（Reckless −4）必须写 sourceKind:"recoil"
                          // —— 否则会被"你造成 ≥N 伤害"条件卡误计
  | { t: "heal";          amount: NumExpr; target: TargetRef }
  | { t: "preventDamage"; amount: NumExpr; target: TargetRef }
  /** 完全闪避（Evasive / Shadows）。C7：只作用于 attack + collateral */
  | { t: "avoidDamage";   target: TargetRef }

  // ── 资源 ───────────────────────────────────
  | { t: "gainCP"; amount: NumExpr; target: TargetRef }
  | { t: "loseCP"; amount: NumExpr; target: TargetRef }
  | { t: "draw";   amount: NumExpr; target: TargetRef }
  | { t: "discard"; amount: NumExpr; mode: "random" | "choice"; target: TargetRef }

  // ── 状态 ───────────────────────────────────
  | { t: "inflictStatus"; status: StatusId; stacks: NumExpr; target: TargetRef }
  /** bindRemovedTo：把实际移除数写入变量（Combustion 需要） */
  | { t: "removeStatus"; status: StatusId | "any"; stacks: NumExpr; target: TargetRef;
      bindRemovedTo?: string }
  | { t: "transferStatus"; status: StatusId; from: TargetRef; to: TargetRef }
  | { t: "increaseStackLimit"; status: StatusId; by: number; target: TargetRef }

  // ── 骰子 ───────────────────────────────────
  /** "Roll N：On [sym] → ..."。每个 case 只结算一次（A16） */
  | { t: "rollDice"; count: NumExpr; diceSet: "hero" | "generic";
      cases: { on: Sym; effects: Effect[] }[] }
  | { t: "setDieFace"; face: FaceIndex; count: NumExpr;
      scope: "chosen" | "random"; owner: TargetRef }
  /** 重掷：不消耗 Roll Attempt */
  | { t: "rerollDice"; count: NumExpr; scope: "chosen" | "random"; owner: TargetRef }
  | { t: "grantExtraRollAttempt"; amount: number }

  // ── 流程控制 ───────────────────────────────
  | { t: "sequence"; steps: Effect[] }
  /** 🆕 打开响应窗口（主文档 §2.3 P4），窗口关闭后执行 steps */
  | { t: "then"; steps: Effect[] }
  | { t: "if"; cond: Condition; then: Effect[]; else?: Effect[] }
  | { t: "choose"; who: "owner" | "target"; prompt: string;
      options: { label: string; effects: Effect[] }[] }
  /** "up to N"：玩家可选择执行 0..N 次 */
  | { t: "optional"; prompt: string; steps: Effect[] }
  | { t: "repeat"; times: NumExpr; steps: Effect[] }
  | { t: "bind"; name: string; value: NumExpr }
  /** Stun 的额外进攻回合（C3：先 flush 再开新回合） */
  | { t: "grantExtraOffensiveRollPhase" }
  | { t: "skipPhase"; phase: PhaseId; target: TargetRef }
  | { t: "log"; text: string };

/* ══════════════════════════════════════════════════════════════
   §1.7 能力槽（含升级分档）
   ══════════════════════════════════════════════════════════════ */

export type AbilityCategory = "offensive" | "defensive" | "passive" | "ultimate";

export interface AbilityTier {
  /** 1 = 面板印刷版；2/3 = 升级卡版本 */
  level: 1 | 2 | 3;
  /** 从【上一级】升到本级的 CP 差价（跳级购买时付全价 = 本值） */
  upgradeCostCP: number;
  matcher: DiceMatcher;
  effects: Effect[];
}

export interface AbilitySlot {
  id: AbilityId;
  category: AbilityCategory;
  /** UI 显示名（重皮时替换） */
  displayName: string;
  tiers: AbilityTier[];
  /** 防御能力专用：防御掷骰的骰数 */
  defenseDiceCount?: number;
  /** Ultimate 标记 —— 激活后剥夺对手行动权（P0） */
  isUltimate?: boolean;
}

/* ══════════════════════════════════════════════════════════════
   §1.8 状态效果
   ══════════════════════════════════════════════════════════════ */

export type PhaseId =
  | "upkeep" | "income" | "main1" | "offensiveRoll"
  | "targeting" | "defensiveRoll" | "main2" | "discard";

export type StatusHook =
  /** Knockdown：Offensive Roll Phase 开始前付 2 CP 否则跳过 */
  | { on: "offensiveRollPhaseStart"; effect: Effect }
  /** Concussion：跳过 Income 的抽牌与 CP */
  | { on: "incomePhaseStart"; effect: Effect }
  /** 伤害相关：avoid（P3）/ prevent（P5）/ modify（P4） */
  | { on: "incomingDamage"; timing: "avoid" | "prevent" | "modify"; effect: Effect;
      auto?: boolean }
  /** Thick Skin II：状态写入前阻止（P1） */
  | { on: "statusInflicted"; status: StatusId; timing: "before"; effect: Effect }
  /** Blind：能力激活前使其失效（P2） */
  | { on: "abilityActivation"; timing: "before"; effect: Effect }
  | { on: "turnStart"; effect: Effect }
  | { on: "turnEnd"; effect: Effect }
  | { on: "attackResolved"; effect: Effect };

export interface StatusDef {
  id: StatusId;
  displayName: string;
  polarity: "positive" | "negative";
  /** 基础 Stack Limit（可被 increaseStackLimit per-player 提升） */
  stackLimit: number;
  /** 持久型：直到游戏结束或被效果移除 */
  persistent: boolean;
  /** 可主动消耗（任意阶段、任意玩家回合；消耗不可被打断） */
  spendable: boolean;
  spendEffect?: Effect[];
  /** Upkeep 阶段触发（C6：先扣血类，再资源衰减类） */
  upkeep?: { order: "damage" | "decay"; effects: Effect[] };
  hooks?: StatusHook[];
  /** 给 UI 的规则文本（describe 模板的兜底） */
  ruleText: string;
}

/* ══════════════════════════════════════════════════════════════
   §1.9 卡牌
   ══════════════════════════════════════════════════════════════ */

export type ActionTiming = "instant" | "mainPhase" | "rollPhase";

export interface CardDef {
  id: CardId;
  displayName: string;
  kind: "upgrade" | "action";
  /** action 专用 */
  actionTiming?: ActionTiming;
  /** upgrade 专用：覆盖哪个能力槽、升到几级 */
  upgrade?: { targetAbility: AbilityId; targetLevel: 2 | 3 };
  costCP: number;
  /** 条件卡：仅当条件满足时可打（如"造成 ≥8 伤害后"） */
  playCondition?: Condition;
  effects: Effect[];
  ruleText: string;
}

/* ══════════════════════════════════════════════════════════════
   §1.10 英雄
   ══════════════════════════════════════════════════════════════ */

export interface HeroDef {
  id: HeroId;
  displayName: string;
  complexity: 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * 骰面定义。DT-DES-002 §4-4 修正：由「每面一个符号」升级为「每面可声明多个符号」，
   * 以表达 Wild 面（多符号）。MVP 4 英雄每面 symbols.length === 1。
   * value = 顺子判定用的点数（1..6）；symbols = 该面的符号集合（Wild 面 >1 个）。
   */
  dieFaces: [DieFace, DieFace, DieFace, DieFace, DieFace, DieFace];

  /** 符号 → 图标资源 key；重皮时只换图不改数据 */
  symbolIcons: Record<Sym, string>;
  startHp: number;   // 50
  startCp: number;   // 2
  abilities: AbilitySlot[];
  statuses: StatusDef[];
  deck: CardDef[];
}

/* ══════════════════════════════════════════════════════════════
   §1.11 运行时 / 引擎接口（给 engineering-lead）
   ══════════════════════════════════════════════════════════════ */

export interface GameState {
  players: PlayerState[];
  activePlayer: PlayerId;
  phase: PhaseId;
  turnIndex: number;
  bucket: DamageBucket;
  windowStack: ResponseWindow[];
  rng: RngState;
  events: GameEvent[];
}

export interface PlayerState {
  id: PlayerId;
  heroId: HeroId;
  hp: number;
  cp: number;
  deck: CardId[];
  hand: CardId[];
  discard: CardId[];
  /** abilityId → 当前等级 */
  abilityLevels: Record<AbilityId, 1 | 2 | 3>;
  /** statusId → 当前堆叠数 */
  statusStacks: Record<StatusId, number>;
  /** per-player Stack Limit 加成（increaseStackLimit，持续整局） */
  stackLimitBonus: Record<StatusId, number>;
  /** P0 权限令牌：Ultimate / Stun 会置为受限 */
  actionPermission: "ALL" | "NONE";
  dice: DiceView;
  rollAttemptsLeft: number;
  defenseRollGranted: boolean;
}

export interface DamageBucket {
  defendable:   { amount: number; source: string }[];   // DamageType = attack
  /** **raw 池**：DamageType ∈ { undefendable, pure }，含反伤与自我反噬
   *  （DT-DES-003 §R1：反伤从 collateral 移入本池；§R3：自我反噬亦在此） */
  undefendable: { amount: number; source: string }[];
  collateral:   { amount: number; source: string }[];   // 溅射（allOpponents），可被 avoid
  healing:      { amount: number; source: string }[];
  prevention:   { amount: number; source: string }[];
  avoidFlags:   { source: string }[];
}

export interface ResponseWindow {
  id: string;
  trigger: "then" | "preDefense" | "postDefense" | "preFlush" | "rollPool";
  eligiblePlayers: PlayerId[];      // 受 actionPermission 约束
  allowedActions: ("rollPhaseCard" | "instantCard" | "spendStatus")[];
  order: "nonActiveFirst";
  passStreak: number;               // 达到 2 关闭
  actionCount: number;              // 硬上限 4
  perActionTimeoutMs: number;       // 12000（R7 收紧，DT-DES-002 §6.2-M1）
}

/** 纯函数式：无副作用，便于快照 / 回滚 / 测试 / AI 搜索 */
export type ResolveFn = (
  state: GameState,
  effects: Effect[]
) => { state: GameState; prompts: PendingPrompt[]; events: GameEvent[] };

export interface PendingPrompt {
  playerId: PlayerId;
  kind: "chooseAbility" | "chooseTarget" | "chooseOption" | "chooseDice" | "discard";
  legalOptions: unknown[];
  timeoutMs: number;
  fallback: unknown;   // 保守默认值
}

export type GameEvent =
  | { e: "phaseEnter"; phase: PhaseId; player: PlayerId }
  | { e: "roll"; player: PlayerId; faces: FaceIndex[]; attempt: number }
  | { e: "lockToggle"; player: PlayerId; dieIndex: number; locked: boolean }
  | { e: "abilityActivated"; player: PlayerId; ability: AbilityId; level: 1|2|3 }
  | { e: "damage"; target: PlayerId; amount: number; type: DamageType; source: string }
  | { e: "heal"; target: PlayerId; amount: number; source: string }
  | { e: "prevent"; target: PlayerId; amount: number; source: string }
  | { e: "avoid"; target: PlayerId; source: string }
  | { e: "statusInflicted"; target: PlayerId; status: StatusId; stacks: number; ok: boolean }
  | { e: "statusRemoved"; target: PlayerId; status: StatusId; stacks: number }
  | { e: "cardPlayed"; player: PlayerId; card: CardId; costCP: number }
  | { e: "windowOpen" | "windowClose"; windowId: string }
  | { e: "flush"; target: PlayerId; detail: FlushDetail }
  | { e: "gameOver"; winner: PlayerId | "draw" };

export interface FlushDetail {
  incomingDefendable: number;
  incomingUndefendable: number;
  incomingCollateral: number;
  prevention: number;
  healing: number;
  avoided: boolean;
  netDamage: number;
  hpBefore: number;
  hpAfter: number;
}
```

---

## 2. 通用状态效果库（跨英雄共享）

```ts
export const COMMON_STATUSES: StatusDef[] = [
  {
    id: "common:stun",
    displayName: "眩晕",
    polarity: "negative",
    stackLimit: 1,
    persistent: false,
    spendable: false,
    ruleText: "被眩晕者无法采取任何行动。眩晕在伤害之前施加。若来自终极能力，对手在其结算完毕前不能采取任何行动。",
  },
  {
    id: "common:knockdown",
    displayName: "击倒",
    polarity: "negative",
    stackLimit: 1,
    persistent: false,
    spendable: false,
    ruleText: "持有者在自己的进攻掷骰阶段开始前支付 2 CP 以移除；否则跳过该阶段并移除本状态。",
    hooks: [
      {
        on: "offensiveRollPhaseStart",
        effect: {
          t: "choose",
          who: "owner",
          prompt: "支付 2 CP 移除击倒？",
          options: [
            { label: "支付 2 CP",
              effects: [{ t: "loseCP", amount: 2, target: { kind: "self" } },
                        { t: "removeStatus", status: "common:knockdown", stacks: 1,
                          target: { kind: "self" } }] },
            { label: "跳过进攻掷骰阶段",
              effects: [{ t: "skipPhase", phase: "offensiveRoll", target: { kind: "self" } },
                        { t: "removeStatus", status: "common:knockdown", stacks: 1,
                          target: { kind: "self" } }] },
          ],
        },
      },
    ],
  },
];
```

---

## 3. 英雄实例化 ①：Barbarian「狂战士」（复杂度 1，DSL 基础验证）

> 骰面符号池 🔶：`[strength, strength, strength, vitality, vitality, healing]`
> 机制定位：无资源引擎的直球爆发 + 自我治疗，靠 Concussion 破坏对手经济、靠 Stun 抢额外回合。

### 3.1 状态效果

```ts
export const BARBARIAN_STATUSES: StatusDef[] = [
  {
    id: "barb:concussion",
    displayName: "震荡",
    polarity: "negative",
    stackLimit: 1,
    persistent: false,
    spendable: false,
    ruleText: "持有者跳过下一次收入阶段的抽牌与 CP 获取。",
    hooks: [
      {
        on: "incomePhaseStart",
        effect: { t: "sequence", steps: [
          { t: "log", text: "震荡：跳过抽牌与 CP" },
          { t: "removeStatus", status: "barb:concussion", stacks: 1,
            target: { kind: "self" } },
        ] },
      },
    ],
  },
  // common:stun 由 Barbarian 施加（复用通用库）
];
```

### 3.2 能力（5 进攻 + 1 防御 + 1 终极）

```ts
export const BARBARIAN_ABILITIES: AbilitySlot[] = [

  /* ─────────────────────────────────────────────────────────
     ① 猛击 Slam —— 最基础的 3 同点数，教学用
     ───────────────────────────────────────────────────────── */
  {
    id: "barb:slam",
    displayName: "猛击",
    category: "offensive",
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "countFace", face: 1, count: 3 },
        effects: [ { t: "dealDamage", amount: 5, type: "attack",
                     target: { kind: "opponent" } } ] },
      { level: 2, upgradeCostCP: 2,
        matcher: { kind: "countFace", face: 1, count: 3 },
        effects: [ { t: "dealDamage", amount: 7, type: "attack",
                     target: { kind: "opponent" } } ] },
    ],
  },

  /* ─────────────────────────────────────────────────────────
     ② 压制 Overpower —— 3×力量，然后 Roll 3 决定伤害，达标追加震荡
        验证：rollDice + 变量 + if 条件
     ───────────────────────────────────────────────────────── */
  {
    id: "barb:overpower",
    displayName: "压制",
    category: "offensive",
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "countSymbol", symbol: "strength", count: 3 },
        effects: [
          { t: "rollDice", count: 3, diceSet: "generic", cases: [] },
          { t: "bind", name: "rollTotal",
            value: { v: "sumFaces", dice: "lastRoll" } },
          { t: "dealDamage", amount: { v: "var", name: "rollTotal" },
            type: "attack", target: { kind: "opponent" } },
          // 阈值判定：本次 rollDice 点数和 >= 14 → 震荡
          { t: "if",
            cond: { c: "diceSumAtLeast", value: 14 },
            then: [ { t: "inflictStatus", status: "barb:concussion", stacks: 1,
                      target: { kind: "opponent" } } ] },
        ] },
      { level: 2, upgradeCostCP: 2,
        matcher: { kind: "countSymbol", symbol: "strength", count: 3 },
        effects: [
          { t: "rollDice", count: 3, diceSet: "generic", cases: [] },
          { t: "bind", name: "rollTotal", value: { v: "sumFaces", dice: "lastRoll" } },
          { t: "dealDamage", amount: { v: "var", name: "rollTotal" },
            type: "attack", target: { kind: "opponent" } },
          { t: "if",
            cond: { c: "diceSumAtLeast", value: 10 },   // 升级：阈值 14 → 10
            then: [ { t: "inflictStatus", status: "barb:concussion", stacks: 1,
                      target: { kind: "opponent" } } ] },
        ] },
    ],
  },

  /* ─────────────────────────────────────────────────────────
     ③ 鲁莽 Reckless —— 大顺，高风险高回报 + 自我反噬
        验证：largeStraight + 自我伤害 + hitSuccess 条件
     ───────────────────────────────────────────────────────── */
  {
    id: "barb:reckless",
    displayName: "鲁莽",
    category: "offensive",
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "largeStraight" },
        effects: [
          { t: "dealDamage", amount: 15, type: "attack", target: { kind: "opponent" } },
          // 自我反噬：type 必须是 pure 而非 undefendable —— undefendable 的语义含
          //   「可被 Attack Modifier 增强」，而反噬来自进攻能力，会被误加成（DT-DES-003 §R2）
          //   sourceKind:"recoil" 使其不计入"造成的伤害"
          { t: "if", cond: { c: "hitSuccess" },
            then: [ { t: "dealDamage", amount: 4, type: "pure",
                      sourceKind: "recoil", target: { kind: "self" } } ] },
        ] },
      { level: 2, upgradeCostCP: 2,
        matcher: { kind: "largeStraight" },
        effects: [
          { t: "dealDamage", amount: 20, type: "attack", target: { kind: "opponent" } },
          { t: "if", cond: { c: "hitSuccess" },
            then: [ { t: "dealDamage", amount: 5, type: "pure",
                      sourceKind: "recoil", target: { kind: "self" } } ] },
        ] },
    ],
  },

  /* ─────────────────────────────────────────────────────────
     ④ 忍耐 Patience —— graded 分档治疗，升级后附带净化
        验证：graded 匹配器（3/4/5 档不同效果）
     ───────────────────────────────────────────────────────── */
  {
    id: "barb:patience",
    displayName: "忍耐",
    category: "offensive",
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: {
          kind: "graded", symbol: "vitality", pick: "highest",
          tiers: [
            { min: 5, effects: [ { t: "heal", amount: 6, target: { kind: "self" } } ] },
            { min: 4, effects: [ { t: "heal", amount: 5, target: { kind: "self" } } ] },
            { min: 3, effects: [ { t: "heal", amount: 4, target: { kind: "self" } } ] },
          ],
        },
        effects: [] },   // graded 的 effects 由命中档位提供
      { level: 2, upgradeCostCP: 2,
        matcher: {
          kind: "graded", symbol: "vitality", pick: "highest",
          tiers: [
            { min: 5, effects: [
                { t: "heal", amount: 7, target: { kind: "self" } },
                { t: "if", cond: { c: "diceSymbolRolled", symbol: "vitality", min: 5 },
                  then: [ { t: "removeStatus", status: "any", stacks: 1,
                            target: { kind: "self" } } ] } ] },
            { min: 4, effects: [ { t: "heal", amount: 6, target: { kind: "self" } } ] },
            { min: 3, effects: [ { t: "heal", amount: 5, target: { kind: "self" } } ] },
          ],
        },
        effects: [] },
    ],
  },

  /* ─────────────────────────────────────────────────────────
     ⑤ 战吼 War Cry —— 小顺，伤害 + 经济干扰 🔶
     ───────────────────────────────────────────────────────── */
  {
    id: "barb:warcry",
    displayName: "战吼",
    category: "offensive",
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "smallStraight" },
        effects: [
          { t: "dealDamage", amount: 7, type: "attack", target: { kind: "opponent" } },
          { t: "inflictStatus", status: "barb:concussion", stacks: 1,
            target: { kind: "opponent" } },
        ] },
      { level: 2, upgradeCostCP: 3,
        matcher: { kind: "smallStraight" },
        effects: [
          { t: "dealDamage", amount: 9, type: "attack", target: { kind: "opponent" } },
          { t: "inflictStatus", status: "barb:concussion", stacks: 1,
            target: { kind: "opponent" } },
          { t: "gainCP", amount: 1, target: { kind: "self" } },
        ] },
    ],
  },

  /* ─────────────────────────────────────────────────────────
     ⑥ 厚皮 Thick Skin —— 防御能力，掷 3 骰，心=治疗×2
        验证：defenseDiceCount + countSymbol(final)
     ───────────────────────────────────────────────────────── */
  {
    id: "barb:thickSkin",
    displayName: "厚皮",
    category: "defensive",
    defenseDiceCount: 3,
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "const", value: true },
        effects: [
          { t: "heal", amount: { v: "mul", a: 2,
              b: { v: "countSymbol", symbol: "vitality", dice: "final" } },
            target: { kind: "self" } },
          { t: "heal", amount: { v: "countSymbol", symbol: "healing", dice: "final" },
            target: { kind: "self" } },
        ] },
      { level: 2, upgradeCostCP: 3,
        matcher: { kind: "const", value: true },
        effects: [
          { t: "heal", amount: { v: "mul", a: 2,
              b: { v: "countSymbol", symbol: "vitality", dice: "final" } },
            target: { kind: "self" } },
          { t: "heal", amount: { v: "countSymbol", symbol: "healing", dice: "final" },
            target: { kind: "self" } },
          // Thick Skin II：消耗 2 点治疗额度以阻止一个负面状态
          { t: "bind", name: "vitCount",
            value: { v: "countSymbol", symbol: "vitality", dice: "final" } },
          { t: "if", cond: { c: "diceSymbolRolled", symbol: "vitality", min: 2 },
            then: [ { t: "log", text: "厚皮 II：本回合可阻止 1 个负面状态" } ] },
        ] },
    ],
  },

  /* ─────────────────────────────────────────────────────────
     ⑦ 暴怒！Anger! —— 终极，5×力量，眩晕 + 不可防御大伤害
        验证：isUltimate + countSymbol(5)
     ───────────────────────────────────────────────────────── */
  {
    id: "barb:anger",
    displayName: "暴怒！",
    category: "ultimate",
    isUltimate: true,
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "countSymbol", symbol: "strength", count: 5 },
        effects: [
          { t: "inflictStatus", status: "common:stun", stacks: 1,
            target: { kind: "opponent" } },
          { t: "dealDamage", amount: 15, type: "undefendable",
            target: { kind: "opponent" } },
          { t: "grantExtraOffensiveRollPhase" },   // C3：先 flush，再开新回合
        ] },
    ],
  },
];
```

### 3.3 卡牌（3 张升级 + 2 张行动）

```ts
export const BARBARIAN_CARDS: CardDef[] = [
  /* ── 升级卡 ────────────────────────────────────────────── */
  {
    id: "barb:upg_reckless_2",
    displayName: "鲁莽 II",
    kind: "upgrade",
    upgrade: { targetAbility: "barb:reckless", targetLevel: 2 },
    costCP: 2,
    effects: [],
    ruleText: "鲁莽的伤害提升至 20，反噬提升至 5。",
  },
  {
    id: "barb:upg_overpower_2",
    displayName: "压制 II",
    kind: "upgrade",
    upgrade: { targetAbility: "barb:overpower", targetLevel: 2 },
    costCP: 2,
    effects: [],
    ruleText: "压制的震荡阈值从 14 降为 10。",
  },
  {
    id: "barb:upg_thickskin_2",
    displayName: "厚皮 II",
    kind: "upgrade",
    upgrade: { targetAbility: "barb:thickSkin", targetLevel: 2 },
    costCP: 3,
    effects: [],
    ruleText: "厚皮额外掷 1 颗骰；掷出 2 个以上心时可阻止 1 个负面状态。",
  },

  /* ── 主要阶段行动卡 ─────────────────────────────────────── */
  {
    id: "barb:act_concuss",
    displayName: "造成震荡！",
    kind: "action",
    actionTiming: "mainPhase",
    costCP: 1,
    effects: [ { t: "inflictStatus", status: "barb:concussion", stacks: 1,
                 target: { kind: "opponent" } } ],
    ruleText: "使对手获得震荡。",
  },

  /* ── 掷骰阶段行动卡 ─────────────────────────────────────── */
  {
    id: "barb:act_come_on",
    displayName: "再来！",
    kind: "action",
    actionTiming: "rollPhase",
    costCP: 2,
    effects: [
      { t: "rollDice", count: 5, diceSet: "hero",
        cases: [ { on: "strength",
                   effects: [ { t: "dealDamage", amount: 1, type: "undefendable",
                                target: { kind: "opponent" } } ] } ] },
      { t: "inflictStatus", status: "barb:concussion", stacks: 1,
        target: { kind: "opponent" } },
    ],
    ruleText: "掷 5 颗英雄骰：每颗力量造成 1 点不可防御伤害。使对手获得震荡。",
  },
];
```

---

## 4. 英雄实例化 ②：Pyromancer「火术士」（复杂度 3，DSL 压力测试）

> 骰面符号池 🔶：`[flame, flame, flame, blaze, fierySoul, meteor]`
> 机制定位：玻璃大炮。Fire Mastery 是核心资源（每回合 Upkeep 冷却 −1），Burn 是跨回合持续伤害，Knockdown/Stun 剥夺对手回合，终极用不可防御伤害收尾。
> **这个英雄是 DSL 表达力的压力测试**：分档伤害、四符号组合、then 响应窗口、消耗 token 换伤害、伤害依赖运行时 token 数、Stack Limit 动态提升——全都在这里。

### 4.1 状态效果

```ts
export const PYROMANCER_STATUSES: StatusDef[] = [
  {
    id: "pyro:fireMastery",
    displayName: "火焰掌控",
    polarity: "positive",
    stackLimit: 5,
    persistent: false,
    spendable: false,
    ruleText: "持有者在自己的维持阶段移除 1 枚（冷却）。可被能力消耗以造成不可防御伤害。",
    upkeep: { order: "decay",      // C6：资源衰减类，晚于扣血类
              effects: [ { t: "removeStatus", status: "pyro:fireMastery",
                           stacks: 1, target: { kind: "self" } } ] },
  },
  {
    id: "pyro:burn",
    displayName: "燃烧",
    polarity: "negative",
    stackLimit: 1,
    persistent: true,              // 官方：持续到被移除
    spendable: false,
    ruleText: "持有者在自己的维持阶段受到 2 点不可防御伤害。",
    upkeep: { order: "damage",     // C6：扣血类，先于资源衰减
              effects: [ { t: "dealDamage", amount: 2, type: "undefendable",
                           target: { kind: "self" } } ] },
  },
  // common:knockdown / common:stun 复用通用库
];
```

### 4.2 能力（6 进攻 + 1 防御 + 1 终极）

```ts
export const PYROMANCER_ABILITIES: AbilitySlot[] = [

  /* ─────────────────────────────────────────────────────────
     ① 火球 Fireball —— graded 分档：3/4/5 flame 三档不同伤害
        ✅ 官方规则源已确认分档结构
     ───────────────────────────────────────────────────────── */
  {
    id: "pyro:fireball",
    displayName: "火球",
    category: "offensive",
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: {
          kind: "graded", symbol: "flame", pick: "highest",
          tiers: [
            { min: 5, effects: [
                { t: "dealDamage", amount: 8, type: "attack",
                  target: { kind: "opponent" } },
                { t: "inflictStatus", status: "pyro:fireMastery", stacks: 1,
                  target: { kind: "self" } } ] },
            { min: 4, effects: [
                { t: "dealDamage", amount: 6, type: "attack",
                  target: { kind: "opponent" } },
                { t: "inflictStatus", status: "pyro:fireMastery", stacks: 1,
                  target: { kind: "self" } } ] },
            { min: 3, effects: [
                { t: "dealDamage", amount: 4, type: "attack",
                  target: { kind: "opponent" } },
                { t: "inflictStatus", status: "pyro:fireMastery", stacks: 1,
                  target: { kind: "self" } } ] },
          ],
        },
        effects: [] },
      { level: 2, upgradeCostCP: 1,
        matcher: {
          kind: "graded", symbol: "flame", pick: "highest",
          tiers: [
            { min: 5, effects: [
                { t: "dealDamage", amount: 8, type: "attack",
                  target: { kind: "opponent" } },
                { t: "inflictStatus", status: "pyro:fireMastery", stacks: 2,
                  target: { kind: "self" } } ] },   // 升级：FM 1 → 2
            { min: 4, effects: [
                { t: "dealDamage", amount: 6, type: "attack",
                  target: { kind: "opponent" } },
                { t: "inflictStatus", status: "pyro:fireMastery", stacks: 2,
                  target: { kind: "self" } } ] },
            { min: 3, effects: [
                { t: "dealDamage", amount: 4, type: "attack",
                  target: { kind: "opponent" } },
                { t: "inflictStatus", status: "pyro:fireMastery", stacks: 2,
                  target: { kind: "self" } } ] },
          ],
        },
        effects: [] },
    ],
  },

  /* ─────────────────────────────────────────────────────────
     ② 燃魂 Burning Soul —— 2×blaze 充能 + 溅射；
        L2 追加 3×blaze → 施加燃烧；4×blaze → 提升 FM Stack Limit
        验证：同一能力内的多条件分支 + increaseStackLimit
     ───────────────────────────────────────────────────────── */
  {
    id: "pyro:burningSoul",
    displayName: "燃魂",
    category: "offensive",
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "countSymbol", symbol: "blaze", count: 2 },
        effects: [
          { t: "inflictStatus", status: "pyro:fireMastery", stacks: 2,
            target: { kind: "self" } },
          { t: "dealDamage", amount: 1, type: "collateral",
            target: { kind: "allOpponents" } },
        ] },
      { level: 2, upgradeCostCP: 1,
        matcher: { kind: "countSymbol", symbol: "blaze", count: 2 },
        effects: [
          { t: "inflictStatus", status: "pyro:fireMastery", stacks: 2,
            target: { kind: "self" } },
          { t: "dealDamage", amount: 1, type: "collateral",
            target: { kind: "allOpponents" } },
          { t: "if", cond: { c: "diceSymbolRolled", symbol: "blaze", min: 3 },
            then: [ { t: "inflictStatus", status: "pyro:burn", stacks: 1,
                      target: { kind: "opponent" } } ] },
          { t: "if", cond: { c: "diceSymbolRolled", symbol: "blaze", min: 4 },
            then: [ { t: "increaseStackLimit", status: "pyro:fireMastery", by: 1,
                      target: { kind: "self" } } ] },
        ] },
    ],
  },

  /* ─────────────────────────────────────────────────────────
     ③ 火球爆发 Pyroblast —— 4×flame + 1×meteor，Roll 1 决定附加效果
        验证：allOf 组合匹配 + rollDice cases（On[symbol]）
     ───────────────────────────────────────────────────────── */
  {
    id: "pyro:pyroblast",
    displayName: "火球爆发",
    category: "offensive",
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "allOf", of: [
          { kind: "countSymbol", symbol: "flame",  count: 4 },
          { kind: "countSymbol", symbol: "meteor", count: 1 },
        ] },
        effects: [
          { t: "dealDamage", amount: 6, type: "attack", target: { kind: "opponent" } },
          { t: "rollDice", count: 1, diceSet: "hero",
            cases: [
              { on: "flame",
                effects: [ { t: "dealDamage", amount: 3, type: "attack",
                             target: { kind: "opponent" } } ] },
              { on: "blaze",
                effects: [ { t: "inflictStatus", status: "pyro:burn", stacks: 1,
                             target: { kind: "opponent" } } ] },
              { on: "fierySoul",
                effects: [ { t: "inflictStatus", status: "pyro:fireMastery",
                             stacks: 2, target: { kind: "self" } } ] },
              { on: "meteor",
                effects: [ { t: "inflictStatus", status: "common:knockdown",
                             stacks: 1, target: { kind: "opponent" } } ] },
            ] },
        ] },
    ],
  },

  /* ─────────────────────────────────────────────────────────
     ④ 燃烧 Combustion —— 四符号各一；Then 消耗 FM 换不可防御伤害
        验证：then + optional + bindRemovedTo + 伤害依赖运行时变量
        ⚠️ 这是全 DSL 最难的一条，务必作为引擎验收用例
     ───────────────────────────────────────────────────────── */
  {
    id: "pyro:combustion",
    displayName: "燃烧",
    category: "offensive",
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "allOf", of: [
          { kind: "countSymbol", symbol: "flame",     count: 1 },
          { kind: "countSymbol", symbol: "blaze",     count: 1 },
          { kind: "countSymbol", symbol: "fierySoul", count: 1 },
          { kind: "countSymbol", symbol: "meteor",    count: 1 },
        ] },
        effects: [
          { t: "inflictStatus", status: "pyro:fireMastery", stacks: 1,
            target: { kind: "self" } },
          { t: "then", steps: [
              { t: "bind", name: "burned", value: 0 },
              { t: "optional", prompt: "移除至多 4 枚火焰掌控以造成伤害", steps: [
                  { t: "removeStatus", status: "pyro:fireMastery",
                    stacks: { v: "min", a: 4,
                              b: { v: "statusStacks", status: "pyro:fireMastery",
                                   target: { kind: "self" } } },
                    target: { kind: "self" },
                    bindRemovedTo: "burned" } ] },
              { t: "dealDamage",
                amount: { v: "mul", a: 3, b: { v: "var", name: "burned" } },
                type: "undefendable", target: { kind: "opponent" } },
          ] },
        ] },
    ],
  },

  /* ─────────────────────────────────────────────────────────
     ⑤ 连热 Hot Streak —— 小顺；Then 伤害 = 5 + FM 数
        验证：伤害量依赖运行时状态堆叠数
     ───────────────────────────────────────────────────────── */
  {
    id: "pyro:hotStreak",
    displayName: "连热",
    category: "offensive",
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "smallStraight" },
        effects: [
          { t: "inflictStatus", status: "pyro:fireMastery", stacks: 2,
            target: { kind: "self" } },
          { t: "then", steps: [
              { t: "dealDamage",
                amount: { v: "add", a: 5,
                          b: { v: "statusStacks", status: "pyro:fireMastery",
                               target: { kind: "self" } } },
                type: "attack", target: { kind: "opponent" } },
          ] },
        ] },
      { level: 2, upgradeCostCP: 2,
        matcher: { kind: "smallStraight" },
        effects: [
          { t: "inflictStatus", status: "pyro:fireMastery", stacks: 2,
            target: { kind: "self" } },
          { t: "then", steps: [
              { t: "dealDamage",
                amount: { v: "add", a: 6,
                          b: { v: "statusStacks", status: "pyro:fireMastery",
                               target: { kind: "self" } } },
                type: "attack", target: { kind: "opponent" } },
          ] },
        ] },
    ],
  },

  /* ─────────────────────────────────────────────────────────
     ⑥ 点燃 Ignite —— 大顺；Then 伤害 = 4 + 2×FM
     ───────────────────────────────────────────────────────── */
  {
    id: "pyro:ignite",
    displayName: "点燃",
    category: "offensive",
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "largeStraight" },
        effects: [
          { t: "inflictStatus", status: "pyro:fireMastery", stacks: 2,
            target: { kind: "self" } },
          { t: "then", steps: [
              { t: "dealDamage",
                amount: { v: "add", a: 4,
                          b: { v: "mul", a: 2,
                               b: { v: "statusStacks", status: "pyro:fireMastery",
                                    target: { kind: "self" } } } },
                type: "attack", target: { kind: "opponent" } },
          ] },
        ] },
    ],
  },

  /* ─────────────────────────────────────────────────────────
     ⑦ 陨石 Meteorite —— 4×meteor（面 6）；眩晕 + 按 FM 结算不可防御伤害
     ───────────────────────────────────────────────────────── */
  {
    id: "pyro:meteorite",
    displayName: "陨石",
    category: "offensive",
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "countFace", face: 6, count: 4 },
        effects: [
          { t: "inflictStatus", status: "pyro:fireMastery", stacks: 2,
            target: { kind: "self" } },
          { t: "inflictStatus", status: "common:stun", stacks: 1,
            target: { kind: "opponent" } },
          { t: "then", steps: [
              { t: "dealDamage",
                amount: { v: "statusStacks", status: "pyro:fireMastery",
                          target: { kind: "self" } },
                type: "undefendable", target: { kind: "opponent" } },
              { t: "dealDamage", amount: 2, type: "collateral",
                target: { kind: "allOpponents" } },
              { t: "grantExtraOffensiveRollPhase" },
          ] },
        ] },
      { level: 2, upgradeCostCP: 2,
        matcher: { kind: "countFace", face: 6, count: 4 },
        effects: [
          { t: "inflictStatus", status: "pyro:fireMastery", stacks: 2,
            target: { kind: "self" } },
          { t: "inflictStatus", status: "common:stun", stacks: 1,
            target: { kind: "opponent" } },
          { t: "then", steps: [
              { t: "dealDamage",
                amount: { v: "statusStacks", status: "pyro:fireMastery",
                          target: { kind: "self" } },
                type: "undefendable", target: { kind: "opponent" } },
              { t: "dealDamage", amount: 3, type: "collateral",   // 升级：溅射 2 → 3
                target: { kind: "allOpponents" } },
              { t: "grantExtraOffensiveRollPhase" },
          ] },
        ] },
    ],
  },

  /* ─────────────────────────────────────────────────────────
     ⑧ 熔岩护甲 Molten Armor —— 防御：掷 5 骰，每个 flame 反伤 1
        验证：防御能力也能造成伤害（官方：她的防御就是进攻）
     ───────────────────────────────────────────────────────── */
  {
    id: "pyro:moltenArmor",
    displayName: "熔岩护甲",
    category: "defensive",
    defenseDiceCount: 5,
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "const", value: true },
        effects: [
          { t: "inflictStatus", status: "pyro:fireMastery", stacks: 1,
            target: { kind: "self" } },
          // 反伤：DT-DES-003 §R1 定为 pure（原 DT-DES-002 §4-5 定为 collateral，已推翻）
          //   依据：反伤来自【防御能力】，不是 Attack ⇒ 非攻击来源 ⇒ 无伤害类型
          //   ⇒ 不触发防御掷骰、不受 prevent/avoid 影响、不可被 Attack Modifier 增强
          //   ⚠️ collateral 可被 avoid 抹除，会让反伤重新变成「可防御」，
          //      破坏防御链一步收敛的终止性证明 —— 故不能是 collateral
          //   计入判定：target=attacker ≠ self 且 sourceKind≠recoil ⇒ **计入** damageDealt
          //      （按回合重置，不会泄漏到防守方自己回合的条件卡判定，见 §1.5）
          { t: "dealDamage",
            amount: { v: "countSymbol", symbol: "flame", dice: "final" },
            type: "pure", sourceKind: "ability", target: { kind: "attacker" } },
        ] },
    ],
  },

  /* ─────────────────────────────────────────────────────────
     ⑨ 焦土！Scorch the Earth! —— 终极：5 个面 6
        验证：countFace(6,5) + isUltimate + 多状态 + 不可防御
     ───────────────────────────────────────────────────────── */
  {
    id: "pyro:scorch",
    displayName: "焦土！",
    category: "ultimate",
    isUltimate: true,
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "countFace", face: 6, count: 5 },
        effects: [
          { t: "inflictStatus", status: "pyro:fireMastery", stacks: 3,
            target: { kind: "self" } },
          { t: "inflictStatus", status: "common:knockdown", stacks: 1,
            target: { kind: "opponent" } },
          { t: "inflictStatus", status: "pyro:burn", stacks: 1,
            target: { kind: "opponent" } },
          { t: "dealDamage", amount: 12, type: "undefendable",
            target: { kind: "opponent" } },
          { t: "dealDamage", amount: 2, type: "collateral",
            target: { kind: "allOpponents" } },
        ] },
    ],
  },
];
```

### 4.3 卡牌（3 张升级 + 2 张行动）

```ts
export const PYROMANCER_CARDS: CardDef[] = [
  /* ── 升级卡 ────────────────────────────────────────────── */
  {
    id: "pyro:upg_fireball_2",
    displayName: "火球 II",
    kind: "upgrade",
    upgrade: { targetAbility: "pyro:fireball", targetLevel: 2 },
    costCP: 1,
    effects: [],
    ruleText: "火球获得的火焰掌控从 1 提升至 2。",
  },
  {
    id: "pyro:upg_burningsoul_2",
    displayName: "燃魂 II",
    kind: "upgrade",
    upgrade: { targetAbility: "pyro:burningSoul", targetLevel: 2 },
    costCP: 1,
    effects: [],
    ruleText: "燃魂掷出 3 个 blaze 时施加燃烧；掷出 4 个时火焰掌控堆叠上限 +1（持续整局）。",
  },
  {
    id: "pyro:upg_hotstreak_2",
    displayName: "连热 II",
    kind: "upgrade",
    upgrade: { targetAbility: "pyro:hotStreak", targetLevel: 2 },
    costCP: 2,
    effects: [],
    ruleText: "连热的基础伤害从 5 提升至 6。",
  },

  /* ── 主要阶段行动卡：预热 ───────────────────────────────── */
  {
    id: "pyro:act_warm_up",
    displayName: "预热",
    kind: "action",
    actionTiming: "mainPhase",
    costCP: 1,
    effects: [
      { t: "inflictStatus", status: "pyro:fireMastery", stacks: 2,
        target: { kind: "self" } },
    ],
    ruleText: "获得 2 枚火焰掌控。",
  },

  /* ── 掷骰阶段行动卡：点燃！—— 改骰，把 1 颗骰变成 flame ── */
  {
    id: "pyro:act_fire_up",
    displayName: "燃起！",
    kind: "action",
    actionTiming: "rollPhase",
    costCP: 1,
    effects: [
      { t: "setDieFace", face: 1, count: 1, scope: "chosen",
        owner: { kind: "self" } },   // 面 1 = flame
    ],
    ruleText: "将你 1 颗已掷出的骰子改为 flame。",
  },
];
```

---

## 5. 英雄实例化 ③/④：Moon Elf「月弓手」/ Ninja「影行者」（骨架）

> 按任务要求只完整实例化 2 个；这两位给出**骰面池 + 状态定义 + 核心能力骨架**，足以让 engineering-lead 验证数据加载管线，完整数值待校准 pass。

### 5.1 Moon Elf 月弓手（复杂度 2）🔶

```ts
export const MOON_ELF_DICE: [Sym, Sym, Sym, Sym, Sym, Sym] =
  ["arrow", "arrow", "arrow", "moon", "moon", "foot"];

export const MOON_ELF_STATUSES: StatusDef[] = [
  {
    id: "elf:evasive",
    displayName: "灵动",
    polarity: "positive",
    stackLimit: 2,
    persistent: false,
    spendable: true,                 // 关键：主动消耗闪避
    ruleText: "消耗 1 枚：完全避免一次来自对手进攻掷骰阶段的伤害（攻击仍视为命中）。",
    spendEffect: [
      { t: "avoidDamage", target: { kind: "self" } },
      { t: "removeStatus", status: "elf:evasive", stacks: 1, target: { kind: "self" } },
    ],
  },
  {
    id: "elf:blind",
    displayName: "致盲",
    polarity: "negative",
    stackLimit: 1,
    persistent: false,
    spendable: false,
    ruleText: "持有者下一次激活的进攻能力有概率完全失效。",
    hooks: [
      { on: "abilityActivation", timing: "before",
        effect: { t: "if", cond: { c: "diceSymbolRolled", symbol: "moon", min: 0 },
                  then: [ { t: "log", text: "致盲判定" } ] } },
    ],
  },
  {
    id: "elf:entangle",
    displayName: "缠绕",
    polarity: "negative",
    stackLimit: 1,
    persistent: false,
    spendable: false,
    ruleText: "持有者的下一次进攻掷骰阶段减少 1 次 Roll Attempt。",
    hooks: [
      { on: "offensiveRollPhaseStart",
        effect: { t: "sequence", steps: [
          { t: "log", text: "缠绕：Roll Attempt −1" },
          { t: "removeStatus", status: "elf:entangle", stacks: 1,
            target: { kind: "self" } },
        ] } },
    ],
  },
  {
    id: "elf:targeted",
    displayName: "标记",
    polarity: "negative",
    stackLimit: 1,
    persistent: false,
    spendable: false,
    ruleText: "持有者受到的攻击伤害 +2。",
    hooks: [
      { on: "incomingDamage", timing: "modify", auto: true,
        effect: { t: "dealDamage", amount: 2, type: "pure",
                  target: { kind: "self" } } },
    ],
  },
];

export const MOON_ELF_ABILITIES: AbilitySlot[] = [
  {
    id: "elf:longbow",
    displayName: "长弓",
    category: "offensive",
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "graded", symbol: "arrow", pick: "highest",
          tiers: [
            { min: 5, effects: [ { t: "dealDamage", amount: 9, type: "attack",
                                   target: { kind: "opponent" } } ] },
            { min: 4, effects: [ { t: "dealDamage", amount: 6, type: "attack",
                                   target: { kind: "opponent" } } ] },
            { min: 3, effects: [ { t: "dealDamage", amount: 5, type: "attack",
                                   target: { kind: "opponent" } } ] },
          ] },
        effects: [] },
    ],
  },
  {
    id: "elf:coveredShot",
    displayName: "掩护射击",
    category: "offensive",
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "countSymbol", symbol: "foot", count: 3 },
        effects: [
          { t: "dealDamage", amount: 4, type: "attack", target: { kind: "opponent" } },
          { t: "inflictStatus", status: "elf:evasive", stacks: 1,
            target: { kind: "self" } },
        ] },
    ],
  },
  {
    id: "elf:moonDefense",
    displayName: "月之守护",
    category: "defensive",
    defenseDiceCount: 3,
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "const", value: true },
        effects: [
          { t: "preventDamage",
            amount: { v: "mul", a: 2,
                      b: { v: "countSymbol", symbol: "moon", dice: "final" } },
            target: { kind: "self" } },
          // 反伤：pure（DT-DES-003 §R1；同 Molten Armor，不可防御以保证防御链收敛）
          { t: "dealDamage",
            amount: { v: "countSymbol", symbol: "arrow", dice: "final" },
            type: "pure", sourceKind: "ability", target: { kind: "attacker" } },
        ] },
    ],
  },
  {
    id: "elf:lunarEclipse",
    displayName: "月蚀！",
    category: "ultimate",
    isUltimate: true,
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "countSymbol", symbol: "moon", count: 5 },
        effects: [
          { t: "dealDamage", amount: 10, type: "undefendable",
            target: { kind: "opponent" } },
          { t: "inflictStatus", status: "elf:blind", stacks: 1,
            target: { kind: "opponent" } },
          { t: "inflictStatus", status: "elf:entangle", stacks: 1,
            target: { kind: "opponent" } },
          { t: "inflictStatus", status: "elf:targeted", stacks: 1,
            target: { kind: "opponent" } },
        ] },
    ],
  },
];
```

### 5.2 Ninja 影行者（复杂度 3）🔶

```ts
export const NINJA_DICE: [Sym, Sym, Sym, Sym, Sym, Sym] =
  ["shuriken", "shuriken", "shuriken", "smoke", "smoke", "mask"];

export const NINJA_STATUSES: StatusDef[] = [
  {
    id: "ninja:poison",
    displayName: "剧毒",
    polarity: "negative",
    stackLimit: 3,
    persistent: true,
    spendable: false,
    ruleText: "持有者在自己的维持阶段，每枚剧毒受到 1 点伤害。",
    upkeep: { order: "damage",
      effects: [ { t: "dealDamage",
                   amount: { v: "statusStacks", status: "ninja:poison",
                             target: { kind: "self" } },
                   type: "pure", target: { kind: "self" } } ] },
  },
  {
    id: "ninja:smokeBomb",
    displayName: "烟雾",
    polarity: "positive",
    stackLimit: 2,
    persistent: false,
    spendable: true,
    ruleText: "消耗 1 枚：本回合内受到的伤害减少至多 6 点。",
    spendEffect: [
      { t: "preventDamage", amount: 6, target: { kind: "self" } },
      { t: "removeStatus", status: "ninja:smokeBomb", stacks: 1,
        target: { kind: "self" } },
    ],
  },
  {
    id: "ninja:ninjutsu",
    displayName: "忍术",
    polarity: "positive",
    stackLimit: 3,
    persistent: false,
    spendable: true,
    ruleText: "消耗 1 枚：本回合下一次进攻伤害 +3。",
    spendEffect: [
      { t: "bind", name: "nj", value: 1 },
      { t: "removeStatus", status: "ninja:ninjutsu", stacks: 1,
        target: { kind: "self" } },
    ],
  },
];

export const NINJA_ABILITIES: AbilitySlot[] = [
  {
    id: "ninja:shurikenStorm",
    displayName: "手里剑风暴",
    category: "offensive",
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "graded", symbol: "shuriken", pick: "highest",
          tiers: [
            { min: 5, effects: [ { t: "dealDamage", amount: 10, type: "attack",
                                   target: { kind: "opponent" } } ] },
            { min: 4, effects: [ { t: "dealDamage", amount: 7, type: "attack",
                                   target: { kind: "opponent" } } ] },
            { min: 3, effects: [ { t: "dealDamage", amount: 5, type: "attack",
                                   target: { kind: "opponent" } } ] },
          ] },
        effects: [] },
    ],
  },
  {
    id: "ninja:poisonBlade",
    displayName: "毒刃",
    category: "offensive",
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "smallStraight" },
        effects: [
          { t: "dealDamage", amount: 6, type: "attack", target: { kind: "opponent" } },
          { t: "inflictStatus", status: "ninja:poison", stacks: 2,
            target: { kind: "opponent" } },
        ] },
    ],
  },
  {
    id: "ninja:smokeScreen",
    displayName: "烟幕",
    category: "defensive",
    defenseDiceCount: 2,
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "const", value: true },
        effects: [
          { t: "preventDamage",
            amount: { v: "mul", a: 3,
                      b: { v: "countSymbol", symbol: "smoke", dice: "final" } },
            target: { kind: "self" } },
          { t: "inflictStatus", status: "ninja:smokeBomb", stacks: 1,
            target: { kind: "self" } },
        ] },
    ],
  },
  {
    id: "ninja:shadowStrike",
    displayName: "影袭！",
    category: "ultimate",
    isUltimate: true,
    tiers: [
      { level: 1, upgradeCostCP: 0,
        matcher: { kind: "countFace", face: 6, count: 5 },
        effects: [
          { t: "dealDamage", amount: 11, type: "undefendable",
            target: { kind: "opponent" } },
          { t: "inflictStatus", status: "ninja:poison", stacks: 3,
            target: { kind: "opponent" } },
        ] },
    ],
  },
];
```

---

## 6. 引擎验收用例（建议直接作为单元测试）

| # | 用例 | 期望 |
|---|---|---|
| T1 | `pyro:combustion`，FM = 5，玩家选择移除 4 | `burned = 4`，伤害 = 12 undefendable，FM 剩 3（含刚获得的 1 枚） |
| T2 | `pyro:hotStreak`，激活前 FM = 0 | 先 +2 到 2，Then 伤害 = 5 + 2 = 7 |
| T3 | `pyro:ignite`，激活前 FM = 5（含上限提升） | 伤害 = 4 + 2×5 = 14 |
| T4 | `pyro:fireball`，掷出 4 个 flame | 走 min:4 档 → 6 伤害 + 1 FM；**不走 min:5 档** |
| T5 | `barb:thickSkin` 防御，掷出 2 心 1 药 | 治疗 = 2×2 + 1 = 5 |
| T6 | `barb:anger`（Ultimate）激活 | 对手 `actionPermission = NONE`；Stun 立即施加；15 undefendable 写入 Bucket；flush 后触发额外 ORP |
| T7 | Bucket：15 attack + 4 prevention + 3 undefendable + heal 2，HP = 20 | netDefendable = 11，net = 14，HP = 20 − 14 + 2 = 8 |
| T8 | 同上但 HP = 12，heal = 4 | HP = 12 − 14 + 4 = 2 → **存活**（C5 净额救回） |
| T9 | 同上但 HP = 12，heal = 0 | HP = −2 → **判负** |
| T10 | 15 attack + Evasive（avoid）+ 3 undefendable | attack 归零，undefendable 照常 → net = 3；`hitSuccess = true`，后置效果照常触发（C7） |
| T11 | 施加已满 Stack Limit 的状态 | 施加失败，返回 `ok: false`，不消耗 CP，不触发后置（C11） |
| T12 | `increaseStackLimit(FM, +1)` 后再施加第 6 枚 FM | 成功（per-player 上限 6）；另一玩家仍为 5 |
| T13 | matcher 求值：`[1,2,3,4,6]` | `smallStraight` = true（1-2-3-4），`largeStraight` = false |
| T14 | matcher 求值：`[2,3,4,5,6]` | `smallStraight` = true，`largeStraight` = true → **candidates 有 2 项，强制单选** |
| T15 | `transferStatus` 目标已满 | 回滚，token 留在原持有者（C9） |
| T16 | 治疗把 HP 推到 65（起始 50） | clamp 到 60（A2） |
| T17 | `pyro:meteorite` 触发 Stun | **先 flush 当前 Bucket 并做死亡判定**，再开额外 ORP；若对手已死则不触发（C3） |
| T18 | Upkeep：同时有 Burn(2) 与 FM(3) | 先扣 2（damage 序），再 FM 3→2（decay 序）（C6） |

---

## 7. 给 engineering-lead 的实现备注

1. **`graded` 匹配器的 effects 在 tier 内，不在 ability 层**。求值器需支持"匹配器自带效果"这一特例——这是 Fireball / Patience / Longbow / Shuriken Storm 四个能力都依赖的模式，值得单独抽象。
2. **`then` 是效果，不是语法糖**。它必须能打开响应窗口（改 `windowStack`），因此 `ResolveFn` 不能是纯同步的——或在同步求值 + `prompts` 返回的两段式模型里实现（推荐后者，AI 与回放都好做）。
3. **`rollDice` 的 `cases` 每个只结算一次**，即使多个骰子命中同一符号（A16）。引擎需按符号去重而非按骰子数循环。
4. **`optional` 会产生 prompt**，因此 `ResolveFn` 的 `prompts` 是数组而非单个。
5. **`bindRemovedTo` 需要 `removeStatus` 返回实际移除数**（受 Stack Limit 与玩家选择影响），不能预先计算。
6. **所有 `NumExpr` 的求值时机是"执行到该 effect 时"**，不是能力激活时。这是 Hot Streak / Ignite 伤害正确的前提——千万别做提前求值优化。
7. **`symbolIcons` 与 `displayName` 是唯一的"内容"字段**，其余全是逻辑。重皮时只改这两处 + `ruleText`。
