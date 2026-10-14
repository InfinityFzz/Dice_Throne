/**
 * content-lint：新增内容必须登记中文名 —— M3 实装前的守门（PROGRESS 缺口 11）。
 *
 * 为什么必须是测试而不是约定：describe 层的名字映射（ABILITY_WORD / STATUS_WORD）
 * 未登记时**静默回落**到去命名空间的英文 id（`smack`、`fireball`），玩家会直接看到英文。
 * describe.test.ts 只断言「渲染无残渣」，拦不住这种回落 —— 它绿着，但玩家看到的是英文 id。
 * 这里按注册表全量比对：凡是内容层声明过的 id，zh 渲染必须含 CJK。
 *
 * M3 新增英雄时若忘记登记名字，本文件立刻红，并逐条列出缺登记的 id。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultRegistry } from './registry.js';
import { COMMON_STATUSES } from './statuses.js';
import { abilityName, statusName, describeCard } from './describe.js';

const content = createDefaultRegistry();
const HAS_CJK = /[\u4e00-\u9fff]/;

describe('content-lint：内容必须登记中文名（zh 渲染不得回落英文 id）', () => {
  test('英雄名与能力名：HeroDef.name / slot.name 含 CJK，且 abilityName(zh) 不回落', () => {
    const problems: string[] = [];
    for (const hero of content.listHeroes()) {
      if (!HAS_CJK.test(hero.name)) problems.push(`英雄 ${hero.id}: name="${hero.name}" 无中文`);
      for (const slot of hero.abilities) {
        if (!HAS_CJK.test(slot.name)) problems.push(`能力 ${slot.id}: name="${slot.name}" 无中文`);
        const rendered = abilityName(slot.id, 'zh');
        if (!HAS_CJK.test(rendered)) {
          problems.push(`能力 ${slot.id}: describe 层回落为 "${rendered}"（ABILITY_WORD.zh 未登记）`);
        }
        for (const t of slot.tiers) {
          if (t.name !== undefined && !HAS_CJK.test(t.name)) {
            problems.push(`能力 ${slot.id} L${t.level}: tier.name="${t.name}" 无中文`);
          }
        }
      }
    }
    assert.deepEqual(problems, [], `以下内容缺中文登记：\n${problems.join('\n')}`);
  });

  test('状态名：StatusDef.name 含 CJK，且 statusName(zh) 不回落', () => {
    const problems: string[] = [];
    const statuses = [...COMMON_STATUSES, ...content.listHeroes().flatMap((h) => h.statuses)];
    const seen = new Set<string>();
    for (const s of statuses) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      if (!HAS_CJK.test(s.name)) problems.push(`状态 ${s.id}: name="${s.name}" 无中文`);
      const rendered = statusName(s.id, 'zh');
      if (!HAS_CJK.test(rendered)) {
        problems.push(`状态 ${s.id}: describe 层回落为 "${rendered}"（STATUS_WORD.zh 未登记）`);
      }
    }
    assert.ok(seen.size >= 7, `状态种类应 ≥ 7，实际 ${seen.size}`);
    assert.deepEqual(problems, [], `以下状态缺中文登记：\n${problems.join('\n')}`);
  });

  test('卡名：CardDef.name 含 CJK，且 describeCard(zh) 是中文模板', () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const card of content.listHeroes().flatMap((h) => h.deck)) {
      if (seen.has(card.defId)) continue;
      seen.add(card.defId);
      if (!HAS_CJK.test(card.name)) problems.push(`卡 ${card.defId}: name="${card.name}" 无中文`);
      // describeCard 不含卡名（卡名由 UI 单独渲染），但模板文本本身必须是中文
      if (!HAS_CJK.test(describeCard(card, 'zh'))) {
        problems.push(`卡 ${card.defId}: zh 描述不含中文（模板或目标名回落英文）`);
      }
    }
    assert.ok(seen.size >= 20, `卡牌种类应 ≥ 20，实际 ${seen.size}`);
    assert.deepEqual(problems, [], `以下卡牌缺中文登记：\n${problems.join('\n')}`);
  });
});
