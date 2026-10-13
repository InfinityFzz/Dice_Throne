/**
 * 通用卡牌库 —— 2026-10-13 官方校准（读图逐张提取，见 docs/content-audit-report.md §行动卡）。
 *
 * 覆盖官方每个英雄牌库共有的 15 张行动卡（Transference!..One More Time!）
 * 与 3 张同名功能卡（Helping Hand / Better D! / Six-It!）。
 * 机制化描述，无官方卡面文本；auto 模式语义（出价/选骰类）用「兜底不行使」并在注释标注。
 */
import type { CardDef } from '../types/content.js';

const TIMING_MAIN = ['main1', 'main2'] as const;
const TIMING_WINDOW = ['thenNode', 'preDefense', 'postDefense'] as const;

/** 「移除一名玩家 1 个状态」的公共骨架（Get That Outta Here! / Buh, Bye!） */
function removeOneStatus(): CardDef['effects'] {
  return [{
    clause: {
      kind: 'choose', who: 'owner',
      options: [
        { id: 'self', label: '移除自己的 1 个状态', isDefault: true,
          effects: [{ clause: { kind: 'removeStatus', status: 'any', stacks: 1, to: { r: 'self' } } }] },
        { id: 'opp', label: '移除对手的 1 个状态',
          effects: [{ clause: { kind: 'removeStatus', status: 'any', stacks: 1, to: { r: 'opponent' } } }] },
      ],
    },
  }];
}

export const COMMON_CARDS: readonly CardDef[] = [
  // ── Main Phase Action（蓝框）──────────────────────────
  {
    // 官方：转移 1 个状态 token 从一名玩家到另一名玩家。'any' 转移按 removeStatus
    // 同序（负面优先）取第一层；目标达堆叠上限时该层丢失（MVP 近似）。
    defId: 'common:transference', name: '状态转移', kind: 'mainPhase', costCp: 2,
    timing: [...TIMING_MAIN], count: 2,
    effects: [{
      clause: {
        kind: 'choose', who: 'owner',
        options: [
          { id: 'selfToOpp', label: '把自己的 1 个状态转给对手', isDefault: true,
            effects: [{ clause: { kind: 'transferStatus', status: 'any', from: { r: 'self' }, to: { r: 'opponent' } } }] },
          { id: 'oppToSelf', label: '把对手的 1 个状态转给自己',
            effects: [{ clause: { kind: 'transferStatus', status: 'any', from: { r: 'opponent' }, to: { r: 'self' } } }] },
        ],
      },
    }],
  },
  {
    defId: 'common:whatStatusEffects', name: '什么状态效果？', kind: 'mainPhase', costCp: 2,
    timing: [...TIMING_MAIN], count: 2,
    effects: [{
      clause: {
        kind: 'choose', who: 'owner',
        options: [
          { id: 'self', label: '移除自己的全部状态', isDefault: true,
            effects: [{ clause: { kind: 'removeStatus', status: 'any', stacks: 99, to: { r: 'self' } } }] },
          { id: 'opp', label: '移除对手的全部状态',
            effects: [{ clause: { kind: 'removeStatus', status: 'any', stacks: 99, to: { r: 'opponent' } } }] },
        ],
      },
    }],
  },
  {
    // 官方：Roll 1，获得 ⌈点数/2⌉ CP
    defId: 'common:vegasBaby', name: '维加斯宝贝', kind: 'mainPhase', costCp: 0,
    timing: [...TIMING_MAIN], count: 2,
    effects: [
      { clause: { kind: 'rollDicePool', count: 1, bindSumTo: 'vb' } },
      { clause: { kind: 'gainCp', amount: { e: 'ceilDiv', a: { e: 'var', name: 'vb' }, b: 2 }, to: { r: 'self' } } },
    ],
  },
  {
    defId: 'common:getThatOuttaHere', name: '给我消失', kind: 'mainPhase', costCp: 1,
    timing: [...TIMING_MAIN], count: 2, effects: removeOneStatus(),
  },
  // ── Instant（红框 !）──────────────────────────────────
  { defId: 'common:tripleUp', name: '三倍下注', kind: 'instant', costCp: 2,
    timing: [...TIMING_WINDOW], count: 2,
    effects: [{ clause: { kind: 'drawCards', amount: 3, to: { r: 'self' } } }] },
  { defId: 'common:doubleUp', name: '双倍下注', kind: 'instant', costCp: 1,
    timing: [...TIMING_WINDOW], count: 2,
    effects: [{ clause: { kind: 'drawCards', amount: 2, to: { r: 'self' } } }] },
  { defId: 'common:buhBye', name: '拜拜了您', kind: 'instant', costCp: 2,
    timing: [...TIMING_WINDOW], count: 1, effects: removeOneStatus() },
  {
    // 官方：任意骰 ±1（1 不能减、6 不能加）。自动模式取第一颗未锁定骰。
    defId: 'common:tipIt', name: '轻推一下', kind: 'instant', costCp: 1,
    timing: [...TIMING_WINDOW], count: 2,
    effects: [{
      clause: {
        kind: 'choose', who: 'owner',
        options: [
          { id: 'up', label: '+1', isDefault: true, effects: [{ clause: { kind: 'adjustDie', delta: 1 } }] },
          { id: 'down', label: '-1', effects: [{ clause: { kind: 'adjustDie', delta: -1 } }] },
        ],
      },
    }],
  },
  { defId: 'common:gettingPaid', name: '结账收钱', kind: 'instant', costCp: 0,
    timing: [...TIMING_WINDOW], count: 2,
    effects: [{ clause: { kind: 'gainCp', amount: 2, to: { r: 'self' } } }] },
  // ── Roll Phase Action（橙框）──────────────────────────
  {
    // 官方：一名玩家防止 6 点来袭伤害
    defId: 'common:notThisTime', name: '这次不行', kind: 'rollPhase', costCp: 1,
    timing: ['preDefense', 'postDefense'], count: 2,
    effects: [{
      clause: {
        kind: 'choose', who: 'owner',
        options: [
          { id: 'self', label: '自己防止 6 点', isDefault: true,
            effects: [{ clause: { kind: 'preventDamage', amount: 6, to: { r: 'self' } } }] },
          { id: 'opp', label: '对手防止 6 点',
            effects: [{ clause: { kind: 'preventDamage', amount: 6, to: { r: 'opponent' } } }] },
        ],
      },
    }],
  },
  {
    // 官方：改变任意 2 骰的值（自由改值）。自动模式设为 6（最强面）。
    defId: 'common:twiceAsWild', name: '加倍狂野', kind: 'rollPhase', costCp: 3,
    timing: [...TIMING_WINDOW], count: 2,
    effects: [{ clause: { kind: 'setDieFace', toFace: 6, count: 2 } }],
  },
  { defId: 'common:tryTryAgain', name: '再试一次', kind: 'rollPhase', costCp: 1,
    timing: [...TIMING_WINDOW], count: 2,
    effects: [{ clause: { kind: 'rerollDice', count: 2 } }] },
  {
    // 官方：改变 1 骰的值（自由改值）。自动模式设为 6。
    defId: 'common:soWild', name: '太狂野了', kind: 'rollPhase', costCp: 2,
    timing: [...TIMING_WINDOW], count: 2,
    effects: [{ clause: { kind: 'setDieFace', toFace: 6, count: 1 } }],
  },
  {
    // 官方：让 1 骰变成另一骰的值。自动模式：第二颗未锁定 ← 第一颗未锁定。
    defId: 'common:samesies', name: '一模一样', kind: 'rollPhase', costCp: 1,
    timing: [...TIMING_WINDOW], count: 1,
    effects: [{ clause: { kind: 'copyDieFace' } }],
  },
  {
    // 官方：一名玩家可在其进攻掷骰阶段重掷至多 5 骰 ≈ 1 次额外掷骰机会
    defId: 'common:oneMoreTime', name: '再来一次', kind: 'rollPhase', costCp: 1,
    timing: [...TIMING_WINDOW], count: 2,
    effects: [{ clause: { kind: 'grantExtraRollAttempt', amount: 1 } }],
  },
  // ── 功能卡（每英雄同名同文）──────────────────────────
  {
    // 官方：强制对手重掷其 1 颗骰
    defId: 'common:helpingHand', name: '援手', kind: 'rollPhase', costCp: 1,
    timing: [...TIMING_WINDOW], count: 1,
    effects: [{ clause: { kind: 'rerollDice', count: 1, to: { r: 'opponent' } } }],
  },
  {
    // ⚠️ 官方：一名玩家可在其防御掷骰阶段重掷至多 5 骰。
    // 防御骰「掷后重掷并重结算」需引擎扩展（preDefense 窗口在掷骰前、postDefense 在结算后），
    // 现为占位空效果（log），待防御重掷窗口落地后接入。
    defId: 'common:betterD', name: '更好的防御', kind: 'rollPhase', costCp: 0,
    timing: ['preDefense', 'postDefense'], count: 1,
    effects: [{ clause: { kind: 'log', text: 'Better D!：防御重掷窗口待引擎支持，暂无效果' } }],
  },
  { defId: 'common:sixIt', name: '六它一下', kind: 'rollPhase', costCp: 1,
    timing: [...TIMING_WINDOW], count: 1,
    effects: [{ clause: { kind: 'setDieFace', toFace: 6, count: 1 } }] },
];
