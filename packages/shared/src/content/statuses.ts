/**
 * 通用状态效果库。
 *
 * ⚠️ IP 声明：本项目定位为「自用学习」。所有数据均为**机制化描述**，
 * 不含官方卡面文本（flavor text）与美术资产。符号 id 使用机制名而非官方专名。
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
    // 官方值（Gunslinger 技能板原图，2026-10-14）：Stack limit 3；spend 后 roll 1-2 免除本次伤害。
    // spend 尚无玩家动作入口（引擎/合法动作均无 spendStatus 入口）——与 reload 同款已知边界，
    // 状态数据先按官方登记，入口补齐后即生效。
    id: 'common:evasive',
    name: '闪避',
    polarity: 'positive',
    stackLimit: 3,
    persistent: true,
    spendable: true,
    spendEffect: [{
      clause: { kind: 'avoidDamage', to: { r: 'self' } },
      next: [{ clause: { kind: 'removeStatus', status: 'common:evasive', stacks: 1, to: { r: 'self' } } }],
    }],
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
