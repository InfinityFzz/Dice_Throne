/**
 * 核心类型：标识、阶段、伤害分类、骰子与骰型匹配器、效果 IR。
 *
 * 硬约束（架构 ADR-003）：EffectDef 中禁止出现函数 / 闭包 / class 实例。
 * 所有可变量必须是纯数据，行为通过 EFFECT_HANDLERS 注册表查找。
 * 这是「可序列化 → 可挂起 → 可持久化 → 可回放」的前提。
 */

// ── 标识 ─────────────────────────────────────────────
export type Seat = 0 | 1;
export type EntityId = string;
export type HeroId = string;
export type StatusId = string;
export type CardId = string;
export type Sym = string;

// ── 回合阶段与结算阶梯 ────────────────────────────────
export type Phase =
  | 'setup' | 'upkeep' | 'income' | 'main1'
  | 'offensiveRoll' | 'defensiveRoll' | 'main2' | 'discard' | 'gameOver';

/** 结算阶梯 P1–P8（架构 §2.4.2）。targeting 在 1v1 恒 no-op，仅留枚举位。 */
export type LadderStep =
  | 'activate' | 'ultimateGate' | 'effectWalk' | 'responseWindow'
  | 'defensiveRoll' | 'simultaneous' | 'postThen' | 'cleanup';
export type ResolutionStep = LadderStep | 'targeting';

export type WindowTrigger =
  | 'then' | 'preDefense' | 'postDefense' | 'preFlush' | 'rollPool' | 'postFlush';

export type PendingKind =
  | 'abilityAnnounce' | 'defensiveRoll' | 'defenseWindow' | 'cardWindow' | 'discard'
  | 'choice' | 'optionalPrompt' | 'chooseDice' | 'knockdownPay' | 'upkeepOrder';

// ── 伤害三轴（正交）───────────────────────────────────
/** 类型轴：能否防御 / 被 avoid / 被 Attack Modifier 增强。恒 4 类。 */
export type DamageType = 'attack' | 'undefendable' | 'collateral' | 'pure';
/** 来源轴：谁产生的。与类型轴正交。 */
export type DamageSourceKind = 'ability' | 'status' | 'ultimate' | 'recoil';
export type BucketKind = 'defendable' | 'undefendable' | 'collateral' | 'prevention';

export const BUCKET_OF: Readonly<Record<DamageType, BucketKind>> = Object.freeze({
  attack: 'defendable',
  undefendable: 'undefendable',
  collateral: 'collateral',
  pure: 'undefendable', // ★ 反伤/反噬/状态伤害：不可防御、不可增强
});

export const COUNTS_AS_ATTACK: Readonly<Record<DamageType, boolean>> = Object.freeze({
  attack: true, undefendable: false, collateral: false, pure: false,
});

// ── 骰子 ─────────────────────────────────────────────
export interface DieFace {
  readonly value: 1 | 2 | 3 | 4 | 5 | 6;
  readonly symbols: readonly Sym[];
}

export type DiceMatcher =
  | { k: 'countSymbol'; symbol: Sym; count: number }
  | { k: 'countFace'; face: number; count: number }
  | { k: 'atLeast'; of: DiceMatcher }
  | { k: 'smallStraight' }
  | { k: 'largeStraight' }
  | { k: 'graded'; symbol: Sym; tierMins: readonly number[] }
  | { k: 'allOf'; of: readonly DiceMatcher[] }
  | { k: 'anyOf'; of: readonly DiceMatcher[] }
  | { k: 'not'; of: DiceMatcher }
  | { k: 'const'; value: boolean };

export interface DiceView {
  readonly values: readonly number[];
  readonly symbols: readonly Sym[];
  readonly locked: readonly boolean[];
}

export interface MatchResult {
  readonly matched: boolean;
  readonly indices: readonly number[];
  readonly tier?: number;
}

// ── 目标引用与数值表达式 ──────────────────────────────
export type TargetRef =
  | { r: 'self' }
  | { r: 'opponent' }
  | { r: 'attacker' }
  | { r: 'defender' }
  | { r: 'active' };

export type Expr =
  | number
  | { e: 'statusStacks'; status: StatusId; target: TargetRef }
  | { e: 'countSymbol'; symbol: Sym }
  | { e: 'sumFaces' }
  | { e: 'cp'; target: TargetRef }
  | { e: 'hp'; target: TargetRef }
  | { e: 'var'; name: string }
  /**
   * 当前 bucket 中 target 的**待结算可防御伤害**（defendable 入桶总量）。
   * 官方 Gunslinger Duel「prevent ½ dmg (rounded up)」：防御窗口内防止一半来袭伤害。
   * 为什么只算 defendable：prevention 在 flush 时只抵消 defendable 桶（bucket.ts），
   * 按同一口径求值才不会宣称防止它实际防止不了的伤害。
   */
  | { e: 'incomingDamage'; target: TargetRef }
  | { e: 'add' | 'sub' | 'mul'; a: Expr; b: Expr }
  | { e: 'min' | 'max'; a: Expr; b: Expr }
  /** 向上取整除法（Vegas Baby!：获得 ⌈点数/2⌉ CP） */
  | { e: 'ceilDiv'; a: Expr; b: Expr }
  /** 向下取整除法（官方 MoonElf Missed Me L1「每 2 支箭 → 1 点伤害」= ⌊箭数/2⌋；b 为 0 时归 0） */
  | { e: 'floorDiv'; a: Expr; b: Expr };

export type Condition =
  | { c: 'always' }
  | { c: 'statusPresent'; target: TargetRef; status: StatusId; minStacks?: Expr }
  | { c: 'hpCompare'; target: TargetRef; op: '<' | '<=' | '>' | '>='; value: Expr }
  | { c: 'damageDealtAtLeast'; value: Expr }
  /** graded 展开后的条件分支：当前骰面中某符号的数量 ≥ min */
  | { c: 'diceSymbolAtLeast'; symbol: Sym; min: number }
  /**
   * n-of-a-kind：骰值轴判定 —— 当前骰池（防御上下文为防御骰）中存在某个点数
   * 出现 ≥ n 次。官方 Smack「4-of-a-kind 不可防御」、Fortitude「3-of-a-kind 移除状态」。
   */
  | { c: 'nOfAKind'; n: number; target?: TargetRef }
  | { c: 'boundAtLeast'; name: string; min: number }
  /**
   * 两个绑定值互相比较（官方 Gunslinger Duel「你与攻击者各掷 1 骰，你的点数 ≥ 对手」）。
   * 绑定值都是运行期变量，无法用 boundAtLeast（min 是常量）表达。
   */
  | { c: 'boundCompare'; a: string; op: '>=' | '>' | '<=' | '<'; b: string }
  | { c: 'and'; of: readonly Condition[] }
  | { c: 'not'; of: Condition };

// ── 效果 IR（引擎可执行的最小闭包）────────────────────
export interface RecoilOnHit {
  /** 反噬量（在 dealDamage 入桶时求值固化） */
  readonly amount: Expr;
  /** 反噬承受者（官方 Reckless 语义：必须 self） */
  readonly to: TargetRef;
}

export type EffectClause =
  // 伤害 / 治疗
  | {
      kind: 'dealDamage'; amount: Expr; damageType: DamageType; to: TargetRef; sourceKind?: DamageSourceKind;
      /**
       * 条件反噬（官方 Reckless：「仅当至少 1 点伤害成功造成」）。
       * 为什么不是 Condition：伤害在 P6 flush 才结算，effectWalk（P3）时无从判定，
       * 因此作为 dealDamage 的附属延迟效果，flush 时按目标 seat 的 net ≥ 1 触发。
       */
      recoilOnHit?: RecoilOnHit;
      /**
       * 条件不可防御（官方 Smack「4-of-a-kind 时不可防御」）。
       * 为什么不是外层 conditional：伤害量由 graded 分支决定、可防御性独立翻转，
       * 在 clause 内判定可避免为每个 graded 档复制一份 undefendable 副本。
       */
      undefendableIf?: Condition;
    }
  | { kind: 'heal'; amount: Expr; to: TargetRef }
  | { kind: 'preventDamage'; amount: Expr; to: TargetRef }
  | { kind: 'avoidDamage'; to: TargetRef }
  // 资源
  | { kind: 'gainCp'; amount: Expr; to: TargetRef }
  | { kind: 'loseCp'; amount: Expr; to: TargetRef }
  | { kind: 'drawCards'; amount: Expr; to: TargetRef }
  | { kind: 'discardCards'; amount: Expr; mode: 'random' | 'choice'; to: TargetRef }
  // 状态
  | { kind: 'inflictStatus'; status: StatusId; stacks: Expr; to: TargetRef }
  | { kind: 'removeStatus'; status: StatusId | 'any'; stacks: Expr; to: TargetRef; bindRemovedTo?: string }
  | { kind: 'transferStatus'; status: StatusId | 'any'; from: TargetRef; to: TargetRef }
  | { kind: 'increaseStackLimit'; status: StatusId; by: number; to: TargetRef }
  | { kind: 'spendStatus'; status: StatusId; to: TargetRef }
  // 骰子
  | { kind: 'rollDicePool'; count: Expr; cases?: readonly { on: Sym; effects: readonly EffectDef[] }[]; bindSumTo?: string;
      /** true = 每颗命中骰各结算一次（官方 Pyroblast「Add 3 × 🔥 dmg」语义）；false/缺省 = 每符号至多一次 */
      perDie?: boolean;
      /**
       * 掷**谁的**英雄骰面（缺省 = 效果执行者自己）。
       * 官方 Gunslinger Duel/Showdown「你与攻击者各掷 1 骰」——对手那颗必须按攻击者的英雄骰面
       * 映射符号。掷出的值仍进 tempDice（池归属契约不变），cases 的符号匹配按 owner 骰面。
       */
      owner?: TargetRef }
  | { kind: 'setDieFace'; toFace: 1 | 2 | 3 | 4 | 5 | 6; count: Expr }
  | { kind: 'adjustDie'; delta: Expr }
  | { kind: 'copyDieFace' }
  | { kind: 'rerollDice'; count: Expr; to?: TargetRef;
      /** 'defense' = 重掷防御骰（tempDice；官方 Better D!），缺省 = 主骰池 */ scope?: 'defense' }
  | { kind: 'grantExtraRollAttempt'; amount: number }
  | { kind: 'performRollAttempt' }
  // 流程
  | { kind: 'openWindowThen'; steps: readonly EffectDef[]; trigger: WindowTrigger }
  | { kind: 'additionally'; steps: readonly EffectDef[] }
  | { kind: 'conditional'; cond: Condition; then: readonly EffectDef[]; else?: readonly EffectDef[] }
  | { kind: 'bind'; name: string; value: Expr }
  | { kind: 'choose'; who: 'owner' | 'target'; options: readonly { id: string; label: string; effects: readonly EffectDef[]; isDefault?: boolean }[] }
  | { kind: 'optional'; steps: readonly EffectDef[]; prompt: string }
  | { kind: 'promptNumber'; max: Expr; bindTo: string; prompt: string }
  | { kind: 'grantExtraOffensiveRollPhase' }
  | { kind: 'skipPhase'; phase: Phase }
  | { kind: 'log'; text: string };

/**
 * next = 链式后续（pushFront 保序，**不开窗**）。
 * 注意与 openWindowThen 区分：design 语境的 "Then" 专指响应窗口节点。
 */
export interface EffectDef {
  readonly clause: EffectClause;
  readonly next?: readonly EffectDef[];
}
