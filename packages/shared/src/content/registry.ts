/**
 * 内容注册表 —— 架构 §2.6。加载期校验，失败即拒绝启动（fail-fast）。
 */
import type { CardDef, HeroDef, StatusDef } from '../types/content.js';
import type { CardId, DamageType, EffectDef, HeroId, StatusId } from '../types/core.js';
import { COMMON_STATUSES } from './statuses.js';
import { COMMON_CARDS } from './cards.js';
import { BARBARIAN, PYROMANCER } from './heroes.js';

const VALID_DAMAGE_TYPES: readonly DamageType[] = ['attack', 'undefendable', 'collateral', 'pure'];

export class ContentRegistry {
  private readonly heroes = new Map<HeroId, HeroDef>();
  private readonly statuses = new Map<StatusId, StatusDef>();
  private readonly cards = new Map<CardId, CardDef>();

  registerHero(hero: HeroDef): void {
    this.heroes.set(hero.id, hero);
    hero.deck.forEach((c) => this.cards.set(c.defId, c));
    hero.statuses.forEach((s) => this.statuses.set(s.id, s));
  }

  registerStatus(status: StatusDef): void { this.statuses.set(status.id, status); }
  registerCard(card: CardDef): void { this.cards.set(card.defId, card); }

  getHero(id: HeroId): HeroDef {
    const h = this.heroes.get(id);
    if (!h) throw new Error(`content: unknown hero ${id}`);
    return h;
  }
  getStatus(id: StatusId): StatusDef | undefined { return this.statuses.get(id); }
  getCard(id: CardId): CardDef {
    const c = this.cards.get(id);
    if (!c) throw new Error(`content: unknown card ${id}`);
    return c;
  }
  hasCard(id: CardId): boolean { return this.cards.has(id); }
  listHeroes(): readonly HeroDef[] { return [...this.heroes.values()]; }

  /** 找到某英雄的某能力槽 */
  findAbilitySlot(heroId: HeroId, abilityId: string) {
    return this.getHero(heroId).abilities.find((a) => a.id === abilityId);
  }

  /** L3 语义自检（架构 §2.6 清单的子集，覆盖 MVP 必需项） */
  validate(): readonly string[] {
    const errors: string[] = [];
    for (const hero of this.heroes.values()) {
      if (hero.dieFaces.length !== 6) {
        errors.push(`${hero.id}: 骰面必须为 6 个，实际 ${hero.dieFaces.length}`);
      }
      for (const slot of hero.abilities) {
        if (slot.tiers.length === 0) errors.push(`${slot.id}: 无 tier`);
        let prevCost = -1;
        for (const t of slot.tiers) {
          if (t.upgradeCostCP <= prevCost) {
            errors.push(`${slot.id} tier${t.level}: upgradeCostCP 必须严格递增（累计总价口径）`);
          }
          prevCost = t.upgradeCostCP;
        }
        if (slot.kind === 'defensive' && !slot.defenseDiceCount) {
          errors.push(`${slot.id}: 防御能力必须声明 defenseDiceCount`);
        }
        for (const t of slot.tiers) {
          walkEffects(t.effects, (eff) => {
            const c = eff.clause as { kind: string; damageType?: DamageType; status?: StatusId | 'any' };
            if (c.damageType && !VALID_DAMAGE_TYPES.includes(c.damageType)) {
              errors.push(`${slot.id}: 非法 DamageType "${c.damageType}"（伪类型，应改用 sourceKind/target）`);
            }
            if (c.kind === 'dealDamage') {
              const d = c as { sourceKind?: string; to?: { r: string } };
              if (d.sourceKind === 'recoil' && d.to?.r !== 'self') {
                errors.push(`${slot.id}: sourceKind='recoil' 时 target 必须是 self`);
              }
            }
            if (c.status && c.status !== 'any' && !this.statuses.has(c.status)) {
              errors.push(`${slot.id}: 未注册的状态 ${c.status}`);
            }
          });
        }
      }
      for (const card of hero.deck) {
        if (card.kind === 'upgrade') {
          if (!card.targetAbilityId) errors.push(`${card.defId}: upgrade 卡缺 targetAbilityId`);
          else if (!hero.abilities.some((a) => a.id === card.targetAbilityId)) {
            errors.push(`${card.defId}: targetAbilityId ${card.targetAbilityId} 不属于 ${hero.id}`);
          }
        }
      }
    }
    return errors;
  }
}

export function walkEffects(effects: readonly EffectDef[], visit: (e: EffectDef) => void): void {
  for (const e of effects) {
    visit(e);
    if (e.next) walkEffects(e.next, visit);
    const c = e.clause as Record<string, unknown>;
    for (const key of ['steps', 'then', 'else']) {
      const v = c[key];
      if (Array.isArray(v)) walkEffects(v as readonly EffectDef[], visit);
    }
    if (Array.isArray(c['cases'])) {
      for (const cs of c['cases'] as { effects: readonly EffectDef[] }[]) {
        walkEffects(cs.effects, visit);
      }
    }
    if (Array.isArray(c['options'])) {
      for (const o of c['options'] as { effects: readonly EffectDef[] }[]) {
        walkEffects(o.effects, visit);
      }
    }
  }
}

export function createDefaultRegistry(): ContentRegistry {
  const reg = new ContentRegistry();
  COMMON_STATUSES.forEach((s) => reg.registerStatus(s));
  COMMON_CARDS.forEach((c) => reg.registerCard(c));
  reg.registerHero(BARBARIAN);
  reg.registerHero(PYROMANCER);
  const errors = reg.validate();
  if (errors.length > 0) {
    throw new Error(`content-lint 失败:\n${errors.map((e) => ` - ${e}`).join('\n')}`);
  }
  return reg;
}
