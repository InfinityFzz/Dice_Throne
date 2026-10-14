/**
 * 通用状态效果库。
 *
 * ⚠️ IP 声明：本项目定位为「自用学习」。所有数据均为**机制化描述**，
 * 不含官方卡面文本（flavor text）与美术资产。符号 id 使用机制名而非官方专名。
 *
 * ⚠️ MoonElf 面板三状态（TARGETED / ENTANGLE / BLIND）**不在本文件注册**：
 * 它们是英雄面板专属 token，按既有模式（gunslinger:bounty / shadowthief:shadows）
 * 应由 MoonElf 内容层任务以 `moonelf:` 前缀注册；引擎侧通用契约已就绪且不认任何
 * 具体 id（onAttacked 逐字段 / onRollPhaseStart / onConcludeRollPhase /
 * expiresAtRollPhaseEnd，见 types/content.ts 与审计报告第八轮）。
 * common: 下不放通用版的理由：官方 Dice Throne 的状态 token 按英雄面板独立发行，
 * 不存在跨英雄通用版（evasive 在 common: 下是因为多英雄面板共同印发）；凭自觉造一个
 * 通用版只会多一份没有官方依据的注册，还会让「谁施加的」在数据层变得不可追溯。
 */
import type { StatusDef } from '../types/content.js';

export const COMMON_STATUSES: readonly StatusDef[] = [
  {
    // 官方值（Shadow Thief 面板原图 + S1 规则书，2026-10-14 修正）：Stack limit 3；Persistent；
    // 每层在维持阶段受 1 点不可防御伤害。此前 limit 5 / 非持续为早期未记录值（审计第七轮销项）。
    id: 'common:poison',
    name: '中毒',
    polarity: 'negative',
    stackLimit: 3,
    persistent: true,
    spendable: false,
    upkeep: {
      order: 'damage',
      effects: [{
        clause: {
          kind: 'dealDamage',
          amount: { e: 'statusStacks', status: 'common:poison', target: { r: 'self' } },
          damageType: 'pure',
          to: { r: 'self' },
          sourceKind: 'status',
        },
      }],
    },
  },
  {
    // 官方值（Pyromancer 技能板原图，2026-10-13）：Stack limit 1；回合开始受 2 伤害；Persistent
    id: 'common:burn',
    name: '灼烧',
    polarity: 'negative',
    stackLimit: 1,
    persistent: true,
    spendable: false,
    upkeep: {
      order: 'damage',
      effects: [{
        clause: {
          kind: 'dealDamage',
          amount: { e: 'mul', a: { e: 'statusStacks', status: 'common:burn', target: { r: 'self' } }, b: 2 },
          damageType: 'pure',
          to: { r: 'self' },
          sourceKind: 'status',
        },
      }],
    },
  },
  {
    // 官方值（Barbarian 技能板原图）：Stack limit 1。
    // 机制在引擎层：被晕者在当前攻击中不得执行任何动作（含响应窗口）；
    // 攻击结束后施加者移除此 token 并获得一次额外进攻掷骰阶段（grantExtraOffensiveRollPhase）。
    id: 'common:stun',
    name: '眩晕',
    polarity: 'negative',
    stackLimit: 1,
    persistent: true,
    spendable: false,
  },
  {
    // 官方值（Barbarian 技能板原图）：Stack limit 1。
    // 机制在引擎层：持有者跳过其收入阶段，然后移除此 token（skipPhase income）。
    id: 'common:concussion',
    name: '脑震荡',
    polarity: 'negative',
    stackLimit: 1,
    persistent: true,
    spendable: false,
  },
  {
    // 官方值（Pyromancer 技能板原图）：Stack limit 1；赎金 2 CP。
    // 机制在引擎层：进入进攻掷骰阶段前可支付 2 CP 免除本次攻击（挂起点 knockdownPay）。
    id: 'common:knockdown',
    name: '击倒',
    polarity: 'negative',
    stackLimit: 1,
    persistent: true,
    spendable: false,
  },
  {
    // 官方值（MoonElf 面板原图逐字，2026-10-14 官方化修正）：Stack limit 3；Persistent。
    // 面板原文（mechanized）：「Spend & roll 1-2 to dodge an Attack：受到伤害时可消耗 1 层，
    //   掷 1 骰；1-2 则不受该次伤害（其他附带效果仍生效）。多个闪避可对同一来源分别尝试。」
    // 官方化修正（记账）：此前是「花费即自动避」，与面板「掷 1-2 才避」不符 —— 现改为
    //   rollDicePool 掷 1 骰 → 点数 ≤2 才 avoidDamage。
    // 「无论点数都移除 1 层」由 spendStatus handler 承担（handler 先 removeStatus 1 层再返回
    //   spendEffect 链，effects.ts），因此 spendEffect 内**不得**再写 removeStatus ——
    //   旧数据在 next 里跟了一条 removeStatus，属潜在双扣缺陷（spend 路径此前无入口故未暴露），
    //   本次官方化一并移除。
    // ⚠️ 既有边界不变：spend 尚无玩家主动消耗的动作入口（引擎/合法动作均无 spendStatus 入口），
    //    状态数据先按官方登记，入口补齐后即生效（与 gunslinger:reload 同款）。
    id: 'common:evasive',
    name: '闪避',
    polarity: 'positive',
    stackLimit: 3,
    persistent: true,
    spendable: true,
    spendEffect: [
      { clause: { kind: 'rollDicePool', count: 1, bindSumTo: 'evasiveRoll' } },
      // 掷出 3-6 什么都不会发生（token 已花掉）；掷出 1-2 才避开本次伤害
      { clause: { kind: 'conditional', cond: { c: 'boundAtLeast', name: 'evasiveRoll', min: 3 },
        then: [], else: [{ clause: { kind: 'avoidDamage', to: { r: 'self' } } }] } },
    ],
  },
  {
    // 官方值（Pyromancer 技能板原图，2026-10-13）：Stack limit 5；每回合自己 Upkeep「冷却」移除 1 层
    id: 'common:fireMastery',
    name: '火焰掌控',
    polarity: 'positive',
    stackLimit: 5,
    persistent: true,
    spendable: false,
    upkeep: {
      order: 'decay',
      effects: [{ clause: { kind: 'removeStatus', status: 'common:fireMastery', stacks: 1, to: { r: 'self' } } }],
    },
  },
];
