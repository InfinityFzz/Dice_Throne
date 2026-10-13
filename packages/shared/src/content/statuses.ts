/**
 * 通用状态效果库。
 *
 * ⚠️ IP 声明：本项目定位为「自用学习」。所有数据均为**机制化描述**，
 * 不含官方卡面文本（flavor text）与美术资产。符号 id 使用机制名而非官方专名。
 */
import type { StatusDef } from '../types/content.js';

export const COMMON_STATUSES: readonly StatusDef[] = [
  {
    id: 'common:poison',
    name: '中毒',
    polarity: 'negative',
    stackLimit: 5,
    persistent: false,
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
    id: 'common:burn',
    name: '灼烧',
    polarity: 'negative',
    stackLimit: 3,
    persistent: false,
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
    id: 'common:evasive',
    name: '闪避',
    polarity: 'positive',
    stackLimit: 2,
    persistent: true,
    spendable: true,
    spendEffect: [{
      clause: { kind: 'avoidDamage', to: { r: 'self' } },
      next: [{ clause: { kind: 'removeStatus', status: 'common:evasive', stacks: 1, to: { r: 'self' } } }],
    }],
  },
  {
    id: 'common:fireMastery',
    name: '火焰掌控',
    polarity: 'positive',
    stackLimit: 4,
    persistent: true,
    spendable: false,
    // decay：每回合末衰减 1 层
    upkeep: {
      order: 'decay',
      effects: [{ clause: { kind: 'removeStatus', status: 'common:fireMastery', stacks: 1, to: { r: 'self' } } }],
    },
  },
];
