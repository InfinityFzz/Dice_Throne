/**
 * 卡面文本描述层 —— design §3.6 E6 / 附录 A-7（对 engineering 的硬约束）：
 * 「每类 effect 需要一个 describe(e, lang) 模板函数，否则玩家看到 JSON」。
 *
 * 设计原则：
 * 1. **纯函数、零引擎依赖**：只吃内容数据，不碰 GameState / Draft，UI 与服务端都能调用。
 * 2. **机制化生成**：所有句子由结构化字段拼装，不承载任何官方卡面文本（flavor text）。
 *    数值一律走 describeExpr，绝不落数字于模板里 —— 数据与文案不会漂移。
 * 3. **可穷尽校验**：CLAUSE_TEMPLATES 用 `Record<EffectClause['kind'], ...>` 声明，
 *    TypeScript 在编译期强制每种 kind 都有模板；describe.test.ts 再用运行期 lint 守门
 *    （与 EFFECT_HANDLERS 的 key 集合比对），新增 kind 忘补模板 → 测试立刻红。
 * 4. **未知 kind 不静默**：默认输出显式占位标记 UNKNOWN_CLAUSE_MARK；strict 模式直接抛错。
 *
 * ⚠️ IP 声明：本项目自用学习。此处所有措辞均为「机制描述」，符号/阶段/伤害分类的叫法
 * 是数据层可替换的键位映射（setStatusLabel 等），不含官方专名、台词或卡面文本。
 */
import type {
  Condition, DamageSourceKind, DamageType, DiceMatcher, EffectClause, EffectDef,
  Expr, Phase, StatusId, Sym, TargetRef, WindowTrigger,
} from '../types/core.js';
import type { AbilitySlotDef, CardDef, StatusDef } from '../types/content.js';
import { COMMON_STATUSES } from './statuses.js';
import { BARBARIAN, GUNSLINGER, PYROMANCER, SHADOWTHIEF } from './heroes.js';

/** 新增英雄只改这一行（名称词表随数据自动构建，漏登记会被 lint 守门抓住） */
const ALL_HEROES = [BARBARIAN, PYROMANCER, GUNSLINGER, SHADOWTHIEF] as const;

// ── 语言 ─────────────────────────────────────────────
export type Lang = 'zh' | 'en';

/** 与 EffectClause 同义的短别名（design 文档里的称呼） */
export type Clause = EffectClause;

export const DEFAULT_LANG: Lang = 'zh';

/** 未登记 kind 的显式占位标记（便于 UI 高亮 / 测试断言，绝不静默成空白） */
export const UNKNOWN_CLAUSE_MARK = '【未登记效果】';

export interface DescribeOptions {
  /** true = 遇到未登记 kind 直接抛错（lint 严格模式）；缺省 = 输出占位标记 */
  readonly strict?: boolean;
}

// ── 文本拼接工具 ──────────────────────────────────────
function stripEnd(s: string, lang: Lang): string {
  const end = lang === 'zh' ? '。' : '.';
  return s.endsWith(end) ? s.slice(0, -end.length) : s;
}

/** 末尾补句号；已经以终止标点结尾时不重复补（避免「？。」这类叠标点） */
function withEnd(s: string, lang: Lang): string {
  if (s.length === 0) return '';
  return /[。！？!?]$/.test(s) ? s : s + (lang === 'zh' ? '。' : '.');
}

/** 把若干子句拼成一句（末尾补句号） */
function joinSentences(parts: readonly string[], lang: Lang): string {
  const kept = parts.map((p) => stripEnd(p, lang)).filter((p) => p.trim().length > 0);
  if (kept.length === 0) return '';
  return withEnd(kept.join(lang === 'zh' ? '；' : '; '), lang);
}

/**
 * 嵌套分支包括号：当分支体自身已含并列分号时，用全角括号界定作用域，
 * 否则「若 A，则 X；否则若 B，则 Y；否则 Z」会被读成歧义句。
 */
function scope(s: string, sep: string, lang: Lang): string {
  if (!s.includes(sep)) return s;
  return lang === 'zh' ? `（${s}）` : `(${s})`;
}

// ── 键位映射表（数据层，可整体替换）────────────────────
const TARGET_OBJ: Record<Lang, Record<TargetRef['r'], string>> = {
  zh: { self: '自己', opponent: '对手', attacker: '攻击者', defender: '防守方', active: '当前行动方' },
  en: { self: 'you', opponent: 'the opponent', attacker: 'the attacker', defender: 'the defender', active: 'the active player' },
};

const TARGET_POS: Record<Lang, Record<TargetRef['r'], string>> = {
  zh: { self: '自己的', opponent: '对手的', attacker: '攻击者的', defender: '防守方的', active: '当前行动方的' },
  en: { self: 'your', opponent: "the opponent's", attacker: "the attacker's", defender: "the defender's", active: "the active player's" },
};

/**
 * 伤害类型轴：attack 为默认（可防御），不额外加词；其余必须显式标注，否则语义丢失。
 * pure 依 design §8.0-④：无伤害类型 → 不可防御、不可被攻击修正增强 → 文案必须带「不可防御」。
 */
const DAMAGE_TYPE_WORD: Record<Lang, Record<DamageType, string>> = {
  zh: { attack: '', undefendable: '不可防御', collateral: '溅射', pure: '不可防御的直接' },
  en: { attack: '', undefendable: 'undefendable', collateral: 'collateral', pure: 'direct undefendable' },
};

/** 来源轴：与类型轴正交，非 ability 来源必须标注 */
const SOURCE_KIND_WORD: Record<Lang, Record<DamageSourceKind, string>> = {
  zh: { ability: '', ultimate: '终极技能', status: '状态来源', recoil: '反噬' },
  en: { ability: '', ultimate: 'ultimate', status: 'from status', recoil: 'recoil' },
};

const PHASE_WORD: Record<Lang, Record<Phase, string>> = {
  zh: {
    setup: '准备', upkeep: '维持', income: '收入', main1: '主阶段一',
    offensiveRoll: '进攻掷骰', defensiveRoll: '防御掷骰', main2: '主阶段二',
    discard: '弃牌', gameOver: '游戏结束',
  },
  en: {
    setup: 'setup', upkeep: 'upkeep', income: 'income', main1: 'main phase 1',
    offensiveRoll: 'offensive roll', defensiveRoll: 'defensive roll', main2: 'main phase 2',
    discard: 'discard', gameOver: 'game over',
  },
};

const TRIGGER_WORD: Record<Lang, Record<WindowTrigger, string>> = {
  zh: {
    then: 'Then', preDefense: '防御前', postDefense: '防御后',
    preFlush: '伤害结算前', rollPool: '掷骰池', postFlush: '伤害结算后',
  },
  en: {
    then: 'then', preDefense: 'pre-defense', postDefense: 'post-defense',
    preFlush: 'pre-flush', rollPool: 'roll-pool', postFlush: 'post-flush',
  },
};

const CARD_KIND_WORD: Record<Lang, Record<CardDef['kind'], string>> = {
  zh: { upgrade: '升级', mainPhase: '主阶段行动', rollPhase: '掷骰阶段行动', instant: '瞬时' },
  en: { upgrade: 'upgrade', mainPhase: 'main-phase action', rollPhase: 'roll-phase action', instant: 'instant' },
};

/** 骰面符号名：机制名（数据层键位），非官方专名 */
const SYM_WORD: Record<Lang, Record<string, string>> = {
  zh: {
    sword: '剑', life: '生命', pow: '力量',
    flame: '焰', blaze: '炽焰', fierySoul: '炎魂', meteor: '陨星',
    bullet: '子弹', dash: '疾冲', bullseye: '靶心',
    dagger: '匕首', bag: '钱袋', card: '卡牌', shadow: '阴影',
  },
  en: {
    sword: 'sword', life: 'life', pow: 'power',
    flame: 'flame', blaze: 'blaze', fierySoul: 'fiery soul', meteor: 'meteor',
    bullet: 'bullet', dash: 'dash', bullseye: 'bullseye',
    dagger: 'dagger', bag: 'bag', card: 'card', shadow: 'shadow',
  },
};

const STATUS_WORD: Record<Lang, Record<string, string>> = {
  zh: { any: '任意状态' },
  en: { any: 'any status' },
};
// 通用状态 + 各英雄专属状态统一入表（新增英雄/状态零登记，直接从数据构建）
const ALL_STATUSES: readonly StatusDef[] = [...COMMON_STATUSES, ...ALL_HEROES.flatMap((h) => h.statuses)];
for (const s of ALL_STATUSES) {
  STATUS_WORD.zh[s.id] = s.name;
  STATUS_WORD.en[s.id] = shortId(s.id);
}

/** 新增英雄/状态时补登记名称（否则回落到去命名空间后的 id） */
export function setStatusLabel(id: StatusId, lang: Lang, name: string): void {
  STATUS_WORD[lang][id] = name;
}

/** 能力名（升级卡文案需要）；与状态名同源，均可在数据层整体替换 */
const ABILITY_WORD: Record<Lang, Record<string, string>> = { zh: {}, en: {} };
for (const hero of ALL_HEROES) {
  for (const slot of hero.abilities) {
    ABILITY_WORD.zh[slot.id] = slot.name;
    ABILITY_WORD.en[slot.id] = shortId(slot.id);
  }
}

export function setAbilityLabel(id: string, lang: Lang, name: string): void {
  ABILITY_WORD[lang][id] = name;
}

export function abilityName(id: string, lang: Lang = DEFAULT_LANG): string {
  return ABILITY_WORD[lang][id] ?? shortId(id);
}

/** 去掉 `namespace:` 前缀，避免把内部 id 直接甩给玩家 */
function shortId(id: string): string {
  const i = id.lastIndexOf(':');
  return i >= 0 ? id.slice(i + 1) : id;
}

// ── 片段渲染器 ───────────────────────────────────────
export function symName(s: Sym, lang: Lang = DEFAULT_LANG): string {
  return SYM_WORD[lang][s] ?? s;
}

export function targetName(t: TargetRef, lang: Lang = DEFAULT_LANG): string {
  return TARGET_OBJ[lang][t.r];
}

export function targetPossessive(t: TargetRef, lang: Lang = DEFAULT_LANG): string {
  return TARGET_POS[lang][t.r];
}

export function statusName(id: StatusId | 'any', lang: Lang = DEFAULT_LANG): string {
  return STATUS_WORD[lang][id] ?? shortId(id);
}

function fmtSigned(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

// ── Expr → 文本 ──────────────────────────────────────
/**
 * 数值表达式渲染。二进制运算统一加括号，避免嵌套时读错优先级；
 * 仅对「×1 / +0」这类恒等运算做安全化简（不改变求值结果）。
 */
export function describeExpr(x: Expr, lang: Lang = DEFAULT_LANG): string {
  if (typeof x === 'number') return String(x);
  const zh = lang === 'zh';
  switch (x.e) {
    case 'statusStacks':
      return zh
        ? `${targetPossessive(x.target, lang)}${statusName(x.status, lang)}层数`
        : `${targetPossessive(x.target, lang)} ${statusName(x.status, lang)} stacks`;
    case 'countSymbol':
      return zh
        ? `当前骰池中${symName(x.symbol, lang)}的数量`
        : `number of ${symName(x.symbol, lang)} in the current dice pool`;
    case 'sumFaces':
      return zh ? '骰池点数总和' : 'sum of the dice pool faces';
    case 'cp':
      return zh ? `${targetPossessive(x.target, lang)}CP` : `${targetPossessive(x.target, lang)} CP`;
    case 'hp':
      return zh ? `${targetPossessive(x.target, lang)}HP` : `${targetPossessive(x.target, lang)} HP`;
    case 'var':
      return x.name;
    case 'incomingDamage':
      return zh
        ? `${targetPossessive(x.target, lang)}来袭伤害`
        : `incoming damage to ${targetName(x.target, lang)}`;
    case 'add':
      if (isLit(x.a, 0)) return describeExpr(x.b, lang);
      if (isLit(x.b, 0)) return describeExpr(x.a, lang);
      return `(${describeExpr(x.a, lang)} + ${describeExpr(x.b, lang)})`;
    case 'sub':
      if (isLit(x.b, 0)) return describeExpr(x.a, lang);
      return `(${describeExpr(x.a, lang)} − ${describeExpr(x.b, lang)})`;
    case 'mul':
      if (isLit(x.a, 1)) return describeExpr(x.b, lang);
      if (isLit(x.b, 1)) return describeExpr(x.a, lang);
      return `(${describeExpr(x.a, lang)} × ${describeExpr(x.b, lang)})`;
    case 'min':
      return `${zh ? '取较小值' : 'min'}(${describeExpr(x.a, lang)}, ${describeExpr(x.b, lang)})`;
    case 'max':
      return `${zh ? '取较大值' : 'max'}(${describeExpr(x.a, lang)}, ${describeExpr(x.b, lang)})`;
    case 'ceilDiv':
      return zh
        ? `⌈${describeExpr(x.a, lang)} ÷ ${describeExpr(x.b, lang)}⌉`
        : `ceil(${describeExpr(x.a, lang)} / ${describeExpr(x.b, lang)})`;
  }
}

function isLit(x: Expr, n: number): boolean {
  return typeof x === 'number' && x === n;
}

// ── Condition → 文本 ─────────────────────────────────
export function describeCondition(c: Condition, lang: Lang = DEFAULT_LANG): string {
  const zh = lang === 'zh';
  switch (c.c) {
    case 'always':
      return zh ? '无条件成立' : 'always true';
    case 'statusPresent': {
      const need = c.minStacks ? describeExpr(c.minStacks, lang) : '1';
      return zh
        ? `${targetPossessive(c.target, lang)}${statusName(c.status, lang)}层数 ≥ ${need}`
        : `${targetPossessive(c.target, lang)} ${statusName(c.status, lang)} stacks ≥ ${need}`;
    }
    case 'hpCompare': {
      const v = describeExpr(c.value, lang);
      const op = c.op === '<=' ? '≤' : c.op === '>=' ? '≥' : c.op;
      return zh
        ? `${targetPossessive(c.target, lang)}HP ${op} ${v}`
        : `${targetPossessive(c.target, lang)} HP ${op} ${v}`;
    }
    case 'damageDealtAtLeast':
      return zh
        ? `本次已造成的伤害 ≥ ${describeExpr(c.value, lang)}`
        : `damage dealt this turn ≥ ${describeExpr(c.value, lang)}`;
    case 'diceSymbolAtLeast':
      return zh
        ? `当前骰池中${symName(c.symbol, lang)}的数量 ≥ ${c.min}`
        : `number of ${symName(c.symbol, lang)} in the current dice pool ≥ ${c.min}`;
    case 'nOfAKind': {
      // 求值语义：tempDice 在场看防御骰，否则看行动方主骰池（effects.ts:152）
      const who = c.target ? targetPossessive(c.target, lang) : (zh ? '当前骰池' : 'the current dice pool');
      return zh
        ? `${who}中存在某个点数出现 ≥ ${c.n} 次`
        : `${who} has some face value appearing ≥ ${c.n} times`;
    }
    case 'boundAtLeast':
      return `${c.name} ≥ ${c.min}`;
    case 'boundCompare': {
      const op = c.op === '<=' ? '≤' : c.op === '>=' ? '≥' : c.op;
      return `${c.a} ${op} ${c.b}`;
    }
    case 'and': {
      if (c.of.length === 0) return zh ? '无条件成立' : 'always true';
      return c.of.map((s) => describeCondition(s, lang)).join(zh ? ' 且 ' : ' and ');
    }
    case 'not':
      return zh ? `并非（${describeCondition(c.of, lang)}）` : `not (${describeCondition(c.of, lang)})`;
  }
}

// ── DiceMatcher → 文本（附加导出，能力面板需要激活条件）──
export function describeMatcher(m: DiceMatcher, lang: Lang = DEFAULT_LANG): string {
  const zh = lang === 'zh';
  switch (m.k) {
    case 'const':
      return m.value ? (zh ? '无条件' : 'no requirement') : (zh ? '永不触发' : 'never');
    case 'countSymbol':
      return zh ? `${m.count} 个${symName(m.symbol, lang)}` : `${m.count} ${symName(m.symbol, lang)}`;
    case 'countFace':
      return zh ? `${m.count} 个点数 ${m.face}` : `${m.count} dice showing ${m.face}`;
    case 'atLeast':
      return zh ? `至少满足 ${describeMatcher(m.of, lang)}` : `at least ${describeMatcher(m.of, lang)}`;
    case 'smallStraight':
      return zh ? '小顺（4 连号）' : 'small straight (4 in a row)';
    case 'largeStraight':
      return zh ? '大顺（5 连号）' : 'large straight (5 in a row)';
    case 'graded':
      return zh
        ? `${symName(m.symbol, lang)} 达到 ${m.tierMins.join('/')} 个（分档结算）`
        : `${symName(m.symbol, lang)} reaching ${m.tierMins.join('/')} (graded)`;
    case 'allOf':
      return `${zh ? '同时满足：' : 'all of: '}${m.of.map((s) => describeMatcher(s, lang)).join(zh ? ' 且 ' : ' and ')}`;
    case 'anyOf':
      return `${zh ? '满足其一：' : 'any of: '}${m.of.map((s) => describeMatcher(s, lang)).join(zh ? ' 或 ' : ' or ')}`;
    case 'not':
      return zh ? `不满足 ${describeMatcher(m.of, lang)}` : `not ${describeMatcher(m.of, lang)}`;
  }
}

// ── 31... 实际 30 种 clause kind 的模板表 ────────────────
/**
 * `Record<EffectClause['kind'], ...>`：TS 编译期强制穷尽；
 * 运行期由 describe.test.ts 与 EFFECT_HANDLERS 的 key 集合比对做 lint 守门。
 */
export const CLAUSE_TEMPLATES: Record<EffectClause['kind'], (c: EffectClause, lang: Lang) => string> = {
  dealDamage(c, lang) {
    if (c.kind !== 'dealDamage') return '';
    const zh = lang === 'zh';
    const n = describeExpr(c.amount, lang);
    const to = targetName(c.to, lang);
    const type = DAMAGE_TYPE_WORD[lang][c.damageType];
    let s = zh
      ? `对${to}造成 ${n} 点${type}伤害`
      : `deal ${n}${type ? ` ${type}` : ''} damage to ${to}`;
    const src = SOURCE_KIND_WORD[lang][c.sourceKind ?? 'ability'];
    if (src) s += zh ? `（${src}）` : ` (${src})`;
    // 条件不可防御：语义与 effects.ts:226 一致 —— 满足条件时整笔伤害翻为 undefendable
    if (c.undefendableIf) {
      const cond = describeCondition(c.undefendableIf, lang);
      s += zh ? `（若${cond}，则本次伤害改为不可防御）` : ` (if ${cond}, this damage becomes undefendable)`;
    }
    // 条件反噬：语义与 effects.ts:232 一致 —— flush 时目标净伤 ≥ 1 才生效
    if (c.recoilOnHit) {
      const amt = describeExpr(c.recoilOnHit.amount, lang);
      const rto = targetName(c.recoilOnHit.to, lang);
      s += zh
        ? `（若本次至少造成 1 点伤害，则对${rto}造成 ${amt} 点反噬伤害）`
        : ` (if at least 1 damage is dealt, deal ${amt} recoil damage to ${rto})`;
    }
    return s;
  },

  heal(c, lang) {
    if (c.kind !== 'heal') return '';
    const n = describeExpr(c.amount, lang);
    const to = targetName(c.to, lang);
    return lang === 'zh' ? `为${to}治疗 ${n} 点生命` : `heal ${n} HP for ${to}`;
  },

  preventDamage(c, lang) {
    if (c.kind !== 'preventDamage') return '';
    const n = describeExpr(c.amount, lang);
    const to = targetName(c.to, lang);
    return lang === 'zh' ? `为${to}防止 ${n} 点伤害` : `prevent ${n} damage for ${to}`;
  },

  avoidDamage(c, lang) {
    if (c.kind !== 'avoidDamage') return '';
    const to = targetName(c.to, lang);
    return lang === 'zh' ? `使${to}避免本次伤害` : `${to} avoids this damage`;
  },

  gainCp(c, lang) {
    if (c.kind !== 'gainCp') return '';
    const n = describeExpr(c.amount, lang);
    return lang === 'zh'
      ? `${targetName(c.to, lang)}获得 ${n} 点 CP`
      : `${targetName(c.to, lang)} gain ${n} CP`;
  },

  loseCp(c, lang) {
    if (c.kind !== 'loseCp') return '';
    const n = describeExpr(c.amount, lang);
    return lang === 'zh'
      ? `${targetName(c.to, lang)}失去 ${n} 点 CP`
      : `${targetName(c.to, lang)} lose ${n} CP`;
  },

  drawCards(c, lang) {
    if (c.kind !== 'drawCards') return '';
    const n = describeExpr(c.amount, lang);
    return lang === 'zh'
      ? `${targetName(c.to, lang)}抽 ${n} 张牌`
      : `${targetName(c.to, lang)} draw ${n} card(s)`;
  },

  discardCards(c, lang) {
    if (c.kind !== 'discardCards') return '';
    const n = describeExpr(c.amount, lang);
    const mode = c.mode === 'random'
      ? (lang === 'zh' ? '随机' : 'at random')
      : (lang === 'zh' ? '自选' : 'by choice');
    return lang === 'zh'
      ? `${targetName(c.to, lang)}弃掉 ${n} 张牌（${mode}）`
      : `${targetName(c.to, lang)} discard ${n} card(s) (${mode})`;
  },

  inflictStatus(c, lang) {
    if (c.kind !== 'inflictStatus') return '';
    const n = describeExpr(c.stacks, lang);
    const nm = statusName(c.status, lang);
    return lang === 'zh'
      ? `对${targetName(c.to, lang)}施加 ${n} 层${nm}`
      : `inflict ${n} stack(s) of ${nm} on ${targetName(c.to, lang)}`;
  },

  removeStatus(c, lang) {
    if (c.kind !== 'removeStatus') return '';
    const zh = lang === 'zh';
    const n = describeExpr(c.stacks, lang);
    const to = targetName(c.to, lang);
    // status 'any' 的求值语义：负面优先、其次字典序（effects.ts:185）
    let s = c.status === 'any'
      ? (zh ? `移除${to}身上共 ${n} 层状态（优先移除负面）` : `remove ${n} status stack(s) from ${to} (negative first)`)
      : (zh ? `移除${to}的 ${n} 层${statusName(c.status, lang)}`
            : `remove ${n} stack(s) of ${statusName(c.status, lang)} from ${to}`);
    if (c.bindRemovedTo) s += zh ? `，实际移除层数记为 ${c.bindRemovedTo}` : `, actual removed recorded as ${c.bindRemovedTo}`;
    return s;
  },

  transferStatus(c, lang) {
    if (c.kind !== 'transferStatus') return '';
    const zh = lang === 'zh';
    const from = targetName(c.from, lang);
    const to = targetName(c.to, lang);
    // 'any' 转移 1 层；具名转移为「全部层数」（effects.ts:307/322）
    return c.status === 'any'
      ? (zh ? `将${from}身上的 1 层状态转移给${to}（优先负面）` : `transfer 1 status stack from ${from} to ${to} (negative first)`)
      : (zh ? `将${from}身上的${statusName(c.status, lang)}全部转移给${to}`
            : `transfer all ${statusName(c.status, lang)} stacks from ${from} to ${to}`);
  },

  increaseStackLimit(c, lang) {
    if (c.kind !== 'increaseStackLimit') return '';
    const nm = statusName(c.status, lang);
    return lang === 'zh'
      ? `${targetPossessive(c.to, lang)}${nm}堆叠上限 ${fmtSigned(c.by)}`
      : `${targetPossessive(c.to, lang)} ${nm} stack limit ${fmtSigned(c.by)}`;
  },

  spendStatus(c, lang) {
    if (c.kind !== 'spendStatus') return '';
    const nm = statusName(c.status, lang);
    return lang === 'zh'
      ? `消耗${targetPossessive(c.to, lang)}1 层${nm}并触发其消耗效果`
      : `spend 1 stack of ${nm} from ${targetName(c.to, lang)} and trigger its spend effect`;
  },

  rollDicePool(c, lang) {
    if (c.kind !== 'rollDicePool') return '';
    const zh = lang === 'zh';
    const n = describeExpr(c.count, lang);
    let s = zh ? `掷 ${n} 颗骰` : `roll ${n} dice`;
    if (c.owner) s += zh ? `（按${targetName(c.owner, lang)}的英雄骰面）` : ` (using ${targetName(c.owner, lang)}'s die faces)`;
    if (c.bindSumTo) s += zh ? `，总点数记为 ${c.bindSumTo}` : `, sum recorded as ${c.bindSumTo}`;
    for (const cs of c.cases ?? []) {
      const sym = symName(cs.on, lang);
      const eff = clauseList(cs.effects, lang);
      // perDie：每颗命中骰各结算一次；否则每符号至多一次（effects.ts:358）
      s += c.perDie
        ? (zh ? `；每颗掷出 ${sym} 的骰：${eff}` : `; each die showing ${sym}: ${eff}`)
        : (zh ? `；若掷出 ${sym}（每种符号至多结算一次）：${eff}` : `; if ${sym} is rolled (once per symbol): ${eff}`);
    }
    return s;
  },

  setDieFace(c, lang) {
    if (c.kind !== 'setDieFace') return '';
    const n = describeExpr(c.count, lang);
    return lang === 'zh'
      ? `将 ${n} 颗骰的点数改为 ${c.toFace}`
      : `set ${n} die/dice to face ${c.toFace}`;
  },

  adjustDie(c, lang) {
    if (c.kind !== 'adjustDie') return '';
    const d = c.delta;
    const txt = typeof d === 'number' ? fmtSigned(d) : describeExpr(d, lang);
    return lang === 'zh'
      ? `将 1 颗未锁定骰的点数 ${txt}`
      : `adjust 1 unlocked die by ${txt}`;
  },

  copyDieFace(_c, lang) {
    return lang === 'zh'
      ? '将 1 颗骰的点数改为另一颗骰的点数'
      : "copy one die's face onto another die";
  },

  rerollDice(c, lang) {
    if (c.kind !== 'rerollDice') return '';
    const zh = lang === 'zh';
    const n = describeExpr(c.count, lang);
    // scope 'defense' = 重掷防御骰 tempDice（effects.ts:407）
    if (c.scope === 'defense') {
      return zh ? `重掷至多 ${n} 颗防御骰` : `re-roll up to ${n} defense dice`;
    }
    const to = targetName(c.to ?? { r: 'self' }, lang);
    return zh ? `重掷${to}的至多 ${n} 颗骰` : `re-roll up to ${n} dice of ${to}`;
  },

  grantExtraRollAttempt(c, lang) {
    if (c.kind !== 'grantExtraRollAttempt') return '';
    return lang === 'zh'
      ? `本回合获得 ${c.amount} 次额外掷骰机会`
      : `gain ${c.amount} extra roll attempt(s) this turn`;
  },

  performRollAttempt(_c, lang) {
    return lang === 'zh' ? '立即执行一次掷骰' : 'perform a roll attempt now';
  },

  openWindowThen(c, lang) {
    if (c.kind !== 'openWindowThen') return '';
    const zh = lang === 'zh';
    const trig = TRIGGER_WORD[lang][c.trigger];
    const steps = clauseList(c.steps, lang);
    return zh ? `开启${trig}响应窗口，随后执行：${steps}` : `open the ${trig} response window, then: ${steps}`;
  },

  additionally(c, lang) {
    if (c.kind !== 'additionally') return '';
    const steps = clauseList(c.steps, lang);
    return lang === 'zh' ? `此外：${steps}` : `additionally: ${steps}`;
  },

  conditional(c, lang) {
    if (c.kind !== 'conditional') return '';
    const zh = lang === 'zh';
    const cond = describeCondition(c.cond, lang);
    const sep = zh ? '；' : '; ';
    const then = scope(clauseList(c.then, lang), sep, lang);
    let s = zh ? `若${cond}，则${then}` : `if ${cond}, then ${then}`;
    if (c.else && c.else.length > 0) {
      const els = scope(clauseList(c.else, lang), sep, lang);
      s += zh ? `；否则${els}` : `; otherwise ${els}`;
    }
    return s;
  },

  bind(c, lang) {
    if (c.kind !== 'bind') return '';
    return `${c.name} = ${describeExpr(c.value, lang)}`;
  },

  choose(c, lang) {
    if (c.kind !== 'choose') return '';
    const zh = lang === 'zh';
    const who = c.who === 'owner'
      ? (zh ? '使用者' : 'the owner')
      : (zh ? '目标' : 'the target');
    // 标注默认项：引擎/超时按 default 结算（design §8.0-⑤），玩家有权知道不选会落到哪
    const opts = c.options
      .map((o) => `${o.label}${o.isDefault ? (zh ? '（默认）' : ' (default)') : ''} → ${clauseList(o.effects, lang)}`)
      .join(zh ? '；' : '; ');
    return zh ? `由${who}选择一项：${opts}` : `${who} chooses one: ${opts}`;
  },

  optional(c, lang) {
    if (c.kind !== 'optional') return '';
    const zh = lang === 'zh';
    const steps = clauseList(c.steps, lang);
    return zh
      ? `（可选）${c.prompt}${steps ? ` → ${steps}` : ''}`
      : `(optional) ${c.prompt}${steps ? ` → ${steps}` : ''}`;
  },

  promptNumber(c, lang) {
    if (c.kind !== 'promptNumber') return '';
    const max = describeExpr(c.max, lang);
    return lang === 'zh'
      ? `由使用者选择 0 至 ${max} 之间的整数并记为 ${c.bindTo}：${c.prompt}`
      : `the owner picks an integer from 0 to ${max}, recorded as ${c.bindTo}: ${c.prompt}`;
  },

  grantExtraOffensiveRollPhase(_c, lang) {
    return lang === 'zh' ? '获得一次额外的进攻掷骰阶段' : 'gain an extra offensive roll phase';
  },

  skipPhase(c, lang) {
    if (c.kind !== 'skipPhase') return '';
    return lang === 'zh'
      ? `跳过${PHASE_WORD[lang][c.phase]}阶段`
      : `skip the ${PHASE_WORD[lang][c.phase]} phase`;
  },

  log(c, lang) {
    if (c.kind !== 'log') return '';
    return lang === 'zh' ? `备注：${c.text}` : `note: ${c.text}`;
  },
};

// ── 对外 API ─────────────────────────────────────────
/** 递归渲染一串 EffectDef（供模板内部嵌套使用，末尾不补句号） */
function clauseList(effects: readonly EffectDef[], lang: Lang, opts?: DescribeOptions): string {
  const strict = opts?.strict === true;
  return effects
    .map((e) => stripEnd(describeEffect(e, lang, { strict }), lang))
    .filter((s) => s.trim().length > 0)
    .join(lang === 'zh' ? '；' : '; ');
}

function renderClause(c: EffectClause, lang: Lang, strict: boolean): string {
  const tpl = (CLAUSE_TEMPLATES as Record<string, ((cl: EffectClause, l: Lang) => string) | undefined>)[c.kind];
  if (!tpl) {
    if (strict) {
      throw new Error(`describe: 未登记的 clause kind "${String(c.kind)}"，请在 CLAUSE_TEMPLATES 补模板`);
    }
    return `${UNKNOWN_CLAUSE_MARK} ${String(c.kind)}`;
  }
  return tpl(c, lang);
}

/** 单个 clause → 一句通顺文本 */
export function describeClause(c: Clause, lang: Lang = DEFAULT_LANG, opts?: DescribeOptions): string {
  return withEnd(renderClause(c, lang, opts?.strict === true), lang);
}

/** EffectDef（含 next 链）→ 一句通顺文本 */
export function describeEffect(e: EffectDef, lang: Lang = DEFAULT_LANG, opts?: DescribeOptions): string {
  const strict = opts?.strict === true;
  const parts: string[] = [renderClause(e.clause, lang, strict)];
  if (e.next?.length) {
    parts.push(...e.next.map((n) => stripEnd(describeEffect(n, lang, { strict }), lang)));
  }
  return joinSentences(parts, lang);
}

/** 一串 EffectDef → 一段文本（UI 打一张卡/一个能力时用） */
export function describeEffects(effects: readonly EffectDef[], lang: Lang = DEFAULT_LANG, opts?: DescribeOptions): string {
  return joinSentences(effects.map((e) => describeEffect(e, lang, opts)), lang);
}

/**
 * 能力 → 文本。tier 缺省时输出全部等级（L1/L2/L3 并列）；
 * 指定 tier 但数据里没有该级时，回落到「不高于它的最高级」（与升级卡的实际生效语义一致）。
 */
export function describeAbility(a: AbilitySlotDef, tier?: 1 | 2 | 3, lang: Lang = DEFAULT_LANG): string {
  const zh = lang === 'zh';
  if (tier === undefined) {
    return a.tiers
      .map((t) => `L${t.level}${zh ? '：' : ': '}${stripEnd(tierText(a, t, lang), lang)}`)
      .join(zh ? '；' : '; ');
  }
  const t = a.tiers.find((x) => x.level === tier)
    ?? [...a.tiers].reverse().find((x) => x.level <= tier)
    ?? a.tiers[0];
  if (!t) return `${UNKNOWN_CLAUSE_MARK} ${a.id}`;
  return tierText(a, t, lang);
}

function tierText(_a: AbilitySlotDef, t: { matcher: DiceMatcher; effects: readonly EffectDef[] }, lang: Lang): string {
  const m = describeMatcher(t.matcher, lang);
  const e = describeEffects(t.effects, lang);
  return lang === 'zh' ? `${m}：${e}` : `${m} — ${e}`;
}

/** 卡牌 → 文本（升级卡无 effects，改为描述其升级目标） */
export function describeCard(card: CardDef, lang: Lang = DEFAULT_LANG): string {
  const zh = lang === 'zh';
  const kind = CARD_KIND_WORD[lang][card.kind];
  const head = `${card.costCp} CP · ${kind}`;
  const colon = zh ? '：' : ': ';
  if (card.kind === 'upgrade') {
    const target = card.targetAbilityId ? abilityName(card.targetAbilityId, lang) : '?';
    return zh
      ? `${head}${colon}将 ${target} 提升到 ${card.tier ?? '?'} 级`
      : `${head}${colon}upgrade ${target} to level ${card.tier ?? '?'}`;
  }
  const eff = describeEffects(card.effects, lang);
  // 打出门槛（CardDef.playIf）：门槛是「能不能打出」的前置条件，渲染在效果正文之前
  const gate = card.playIf
    ? `${zh ? '若' : 'if '}${describeCondition(card.playIf, lang)}${zh ? '，才可打出。' : ', you may play this. '}`
    : '';
  const body = eff.length > 0 ? eff : (zh ? '无直接效果' : 'no direct effect');
  return `${head}${colon}${gate}${body}`;
}

/** 状态 → 文本（含 upkeep / spendEffect 的机制化说明） */
export function describeStatus(s: StatusDef, lang: Lang = DEFAULT_LANG): string {
  const zh = lang === 'zh';
  const bits: string[] = [
    s.name,
    s.polarity === 'negative' ? (zh ? '负面' : 'negative') : (zh ? '正面' : 'positive'),
    zh ? `堆叠上限 ${s.stackLimit} 层` : `stack limit ${s.stackLimit}`,
  ];
  if (s.persistent) bits.push(zh ? '持续' : 'persistent');
  if (s.spendable) bits.push(zh ? '可消耗' : 'spendable');
  if (s.onAttacked) {
    if (s.onAttacked.bonusDamage !== undefined && s.onAttacked.attackerGainsCp !== undefined) {
      bits.push(zh
        ? `被攻击时：攻击者对其伤害 +${describeExpr(s.onAttacked.bonusDamage, lang)} 且攻击者获得 ${describeExpr(s.onAttacked.attackerGainsCp, lang)} CP`
        : `when bearer is attacked: attacker's dmg +${describeExpr(s.onAttacked.bonusDamage, lang)} and attacker gains ${describeExpr(s.onAttacked.attackerGainsCp, lang)} CP`);
    }
    if (s.onAttacked.avoid) {
      bits.push(zh
        ? '被普通攻击时：全部避开（不防 Ultimate 与非攻击伤害）'
        : 'avoids all dmg from normal attacks (not vs Ultimates / non-attack dmg)');
    }
  }
  if (s.discardAtTurnEnd) {
    bits.push(zh ? '带着它完整结束一个自己回合后弃置' : 'discarded after concluding a full turn with it');
  }
  let out = bits.join(' · ');
  if (s.upkeep) {
    const when = s.upkeep.order === 'damage' ? (zh ? '伤害结算时' : 'at damage step') : (zh ? '衰减时' : 'at decay step');
    out += zh ? `；${when}：${describeEffects(s.upkeep.effects, lang)}` : `; ${when}: ${describeEffects(s.upkeep.effects, lang)}`;
  }
  if (s.spendEffect) {
    out += zh ? `；消耗 1 层：${describeEffects(s.spendEffect, lang)}` : `; spend 1 stack: ${describeEffects(s.spendEffect, lang)}`;
  }
  return out;
}
