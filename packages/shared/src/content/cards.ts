/**
 * 通用卡牌库。
 * ⚠️ 自用学习定位：仅机制化描述，无官方卡面文本。
 */
import type { CardDef } from '../types/content.js';

export const COMMON_CARDS: readonly CardDef[] = [
  {
    defId: 'common:minorHeal',
    name: '小幅治疗',
    kind: 'mainPhase',
    costCp: 2,
    timing: ['main1', 'main2'],
    effects: [{ clause: { kind: 'heal', amount: 6, to: { r: 'self' } } }],
    count: 3,
  },
  {
    defId: 'common:quickStudy',
    name: '快速研习',
    kind: 'mainPhase',
    costCp: 1,
    timing: ['main1', 'main2'],
    effects: [{ clause: { kind: 'drawCards', amount: 2, to: { r: 'self' } } }],
    count: 3,
  },
  {
    defId: 'common:focus',
    name: '凝神',
    kind: 'rollPhase',
    costCp: 2,
    timing: ['thenNode', 'preDefense', 'postDefense'],
    effects: [{ clause: { kind: 'setDieFace', toFace: 6, count: 1 } }],
    count: 3,
  },
  {
    defId: 'common:powerSurge',
    name: '力量涌动',
    kind: 'rollPhase',
    costCp: 3,
    timing: ['thenNode', 'preDefense', 'postDefense'],
    effects: [{
      clause: {
        kind: 'dealDamage',
        amount: 4,
        damageType: 'undefendable',
        to: { r: 'opponent' },
        sourceKind: 'ability',
      },
    }],
    count: 3,
  },
  {
    defId: 'common:evasiveManeuver',
    name: '闪避动作',
    kind: 'mainPhase',
    costCp: 2,
    timing: ['main1', 'main2'],
    effects: [{ clause: { kind: 'inflictStatus', status: 'common:evasive', stacks: 1, to: { r: 'self' } } }],
    count: 2,
  },
];
