/**
 * ⚠️ 本文件由 scripts/gen-asset-catalog.ts 生成 —— 勿手改。
 * 重新生成：node --import tsx scripts/gen-asset-catalog.ts
 * 守门检查：node --import tsx scripts/gen-asset-catalog.ts --check
 *
 * 数据来源：packages/shared/src/content/{heroes,cards,statuses}.ts（生成期快照）。
 * 运行时资产层不 import shared，本文件是唯一的桥。
 */
import type { CatalogEntry } from './types.js';

export const ASSET_CATALOG: readonly CatalogEntry[] = Object.freeze([
  { key: "background:table", kind: "background", id: "table", label: "对战桌面", sublabel: "表现层", hue: 207, derived: false },
  { key: "heroPanel:barbarian", kind: "heroPanel", id: "barbarian", label: "狂战士", sublabel: "HP 50 · 骰×5", hue: 45, derived: true, heroId: "barbarian", slots: [{ id: "barbarian:heavyBlow", label: "重击", kind: "offensive", tierCount: 3 }, { id: "barbarian:whirlwind", label: "旋风斩", kind: "offensive", tierCount: 3 }, { id: "barbarian:reckless", label: "鲁莽挥砍", kind: "offensive", tierCount: 2 }, { id: "barbarian:ironWill", label: "钢铁意志", kind: "defensive", tierCount: 2 }, { id: "barbarian:bloodlust", label: "血怒", kind: "ultimate", tierCount: 1 }] },
  { key: "abilityIcon:barbarian:heavyBlow", kind: "abilityIcon", id: "barbarian:heavyBlow", label: "重击", sublabel: "狂战士", hue: 133, derived: true, heroId: "barbarian", abilityKind: "offensive" },
  { key: "abilityIcon:barbarian:whirlwind", kind: "abilityIcon", id: "barbarian:whirlwind", label: "旋风斩", sublabel: "狂战士", hue: 328, derived: true, heroId: "barbarian", abilityKind: "offensive" },
  { key: "abilityIcon:barbarian:reckless", kind: "abilityIcon", id: "barbarian:reckless", label: "鲁莽挥砍", sublabel: "狂战士", hue: 344, derived: true, heroId: "barbarian", abilityKind: "offensive" },
  { key: "abilityIcon:barbarian:ironWill", kind: "abilityIcon", id: "barbarian:ironWill", label: "钢铁意志", sublabel: "狂战士", hue: 152, derived: true, heroId: "barbarian", abilityKind: "defensive" },
  { key: "abilityIcon:barbarian:bloodlust", kind: "abilityIcon", id: "barbarian:bloodlust", label: "血怒", sublabel: "狂战士", hue: 138, derived: true, heroId: "barbarian", abilityKind: "ultimate" },
  { key: "dieFace:barbarian:face:1", kind: "dieFace", id: "barbarian:face:1", label: "骰面 1", sublabel: "axe", hue: 50, derived: true, heroId: "barbarian", dieValue: 1, dieSymbols: ["axe"] },
  { key: "dieFace:barbarian:face:2", kind: "dieFace", id: "barbarian:face:2", label: "骰面 2", sublabel: "axe", hue: 231, derived: true, heroId: "barbarian", dieValue: 2, dieSymbols: ["axe"] },
  { key: "dieFace:barbarian:face:3", kind: "dieFace", id: "barbarian:face:3", label: "骰面 3", sublabel: "strength", hue: 52, derived: true, heroId: "barbarian", dieValue: 3, dieSymbols: ["strength"] },
  { key: "dieFace:barbarian:face:4", kind: "dieFace", id: "barbarian:face:4", label: "骰面 4", sublabel: "strength", hue: 233, derived: true, heroId: "barbarian", dieValue: 4, dieSymbols: ["strength"] },
  { key: "dieFace:barbarian:face:5", kind: "dieFace", id: "barbarian:face:5", label: "骰面 5", sublabel: "rage", hue: 54, derived: true, heroId: "barbarian", dieValue: 5, dieSymbols: ["rage"] },
  { key: "dieFace:barbarian:face:6", kind: "dieFace", id: "barbarian:face:6", label: "骰面 6", sublabel: "rage", hue: 235, derived: true, heroId: "barbarian", dieValue: 6, dieSymbols: ["rage"] },
  { key: "card:barbarian:heavyBlow:2", kind: "card", id: "barbarian:heavyBlow:2", label: "重击 II", sublabel: "4 CP", hue: 338, derived: true, ownerId: "barbarian:heavyBlow", heroId: "barbarian", cardKind: "upgrade", costCp: 4, tier: 2 },
  { key: "card:barbarian:heavyBlow:3", kind: "card", id: "barbarian:heavyBlow:3", label: "重击 III", sublabel: "8 CP", hue: 157, derived: true, ownerId: "barbarian:heavyBlow", heroId: "barbarian", cardKind: "upgrade", costCp: 8, tier: 3 },
  { key: "card:barbarian:whirlwind:2", kind: "card", id: "barbarian:whirlwind:2", label: "旋风斩 II", sublabel: "4 CP", hue: 163, derived: true, ownerId: "barbarian:whirlwind", heroId: "barbarian", cardKind: "upgrade", costCp: 4, tier: 2 },
  { key: "card:barbarian:whirlwind:3", kind: "card", id: "barbarian:whirlwind:3", label: "旋风斩 III", sublabel: "8 CP", hue: 344, derived: true, ownerId: "barbarian:whirlwind", heroId: "barbarian", cardKind: "upgrade", costCp: 8, tier: 3 },
  { key: "card:barbarian:reckless:2", kind: "card", id: "barbarian:reckless:2", label: "鲁莽 II", sublabel: "5 CP", hue: 201, derived: true, ownerId: "barbarian:reckless", heroId: "barbarian", cardKind: "upgrade", costCp: 5, tier: 2 },
  { key: "card:barbarian:ironWill:2", kind: "card", id: "barbarian:ironWill:2", label: "钢铁意志 II", sublabel: "3 CP", hue: 149, derived: true, ownerId: "barbarian:ironWill", heroId: "barbarian", cardKind: "upgrade", costCp: 3, tier: 2 },
  { key: "heroPanel:pyromancer", kind: "heroPanel", id: "pyromancer", label: "焰术士", sublabel: "HP 50 · 骰×5", hue: 151, derived: true, heroId: "pyromancer", slots: [{ id: "pyromancer:fireball", label: "火球", kind: "offensive", tierCount: 3 }, { id: "pyromancer:combustion", label: "燃尽", kind: "offensive", tierCount: 2 }, { id: "pyromancer:ignite", label: "点燃", kind: "offensive", tierCount: 2 }, { id: "pyromancer:moltenArmor", label: "熔岩护甲", kind: "defensive", tierCount: 2 }, { id: "pyromancer:scorchTheEarth", label: "焦土", kind: "ultimate", tierCount: 1 }] },
  { key: "abilityIcon:pyromancer:fireball", kind: "abilityIcon", id: "pyromancer:fireball", label: "火球", sublabel: "焰术士", hue: 179, derived: true, heroId: "pyromancer", abilityKind: "offensive" },
  { key: "abilityIcon:pyromancer:combustion", kind: "abilityIcon", id: "pyromancer:combustion", label: "燃尽", sublabel: "焰术士", hue: 201, derived: true, heroId: "pyromancer", abilityKind: "offensive" },
  { key: "abilityIcon:pyromancer:ignite", kind: "abilityIcon", id: "pyromancer:ignite", label: "点燃", sublabel: "焰术士", hue: 200, derived: true, heroId: "pyromancer", abilityKind: "offensive" },
  { key: "abilityIcon:pyromancer:moltenArmor", kind: "abilityIcon", id: "pyromancer:moltenArmor", label: "熔岩护甲", sublabel: "焰术士", hue: 168, derived: true, heroId: "pyromancer", abilityKind: "defensive" },
  { key: "abilityIcon:pyromancer:scorchTheEarth", kind: "abilityIcon", id: "pyromancer:scorchTheEarth", label: "焦土", sublabel: "焰术士", hue: 179, derived: true, heroId: "pyromancer", abilityKind: "ultimate" },
  { key: "dieFace:pyromancer:face:1", kind: "dieFace", id: "pyromancer:face:1", label: "骰面 1", sublabel: "flame", hue: 206, derived: true, heroId: "pyromancer", dieValue: 1, dieSymbols: ["flame"] },
  { key: "dieFace:pyromancer:face:2", kind: "dieFace", id: "pyromancer:face:2", label: "骰面 2", sublabel: "flame", hue: 27, derived: true, heroId: "pyromancer", dieValue: 2, dieSymbols: ["flame"] },
  { key: "dieFace:pyromancer:face:3", kind: "dieFace", id: "pyromancer:face:3", label: "骰面 3", sublabel: "flame", hue: 208, derived: true, heroId: "pyromancer", dieValue: 3, dieSymbols: ["flame"] },
  { key: "dieFace:pyromancer:face:4", kind: "dieFace", id: "pyromancer:face:4", label: "骰面 4", sublabel: "meteor", hue: 21, derived: true, heroId: "pyromancer", dieValue: 4, dieSymbols: ["meteor"] },
  { key: "dieFace:pyromancer:face:5", kind: "dieFace", id: "pyromancer:face:5", label: "骰面 5", sublabel: "meteor", hue: 202, derived: true, heroId: "pyromancer", dieValue: 5, dieSymbols: ["meteor"] },
  { key: "dieFace:pyromancer:face:6", kind: "dieFace", id: "pyromancer:face:6", label: "骰面 6", sublabel: "flame+meteor", hue: 23, derived: true, heroId: "pyromancer", dieValue: 6, dieSymbols: ["flame", "meteor"] },
  { key: "card:pyromancer:fireball:2", kind: "card", id: "pyromancer:fireball:2", label: "火球 II", sublabel: "4 CP", hue: 168, derived: true, ownerId: "pyromancer:fireball", heroId: "pyromancer", cardKind: "upgrade", costCp: 4, tier: 2 },
  { key: "card:pyromancer:fireball:3", kind: "card", id: "pyromancer:fireball:3", label: "火球 III", sublabel: "9 CP", hue: 347, derived: true, ownerId: "pyromancer:fireball", heroId: "pyromancer", cardKind: "upgrade", costCp: 9, tier: 3 },
  { key: "card:pyromancer:ignite:2", kind: "card", id: "pyromancer:ignite:2", label: "点燃 II", sublabel: "4 CP", hue: 91, derived: true, ownerId: "pyromancer:ignite", heroId: "pyromancer", cardKind: "upgrade", costCp: 4, tier: 2 },
  { key: "card:pyromancer:combustion:2", kind: "card", id: "pyromancer:combustion:2", label: "燃尽 II", sublabel: "5 CP", hue: 290, derived: true, ownerId: "pyromancer:combustion", heroId: "pyromancer", cardKind: "upgrade", costCp: 5, tier: 2 },
  { key: "card:pyromancer:moltenArmor:2", kind: "card", id: "pyromancer:moltenArmor:2", label: "熔岩护甲 II", sublabel: "3 CP", hue: 133, derived: true, ownerId: "pyromancer:moltenArmor", heroId: "pyromancer", cardKind: "upgrade", costCp: 3, tier: 2 },
  { key: "statusIcon:common:poison", kind: "statusIcon", id: "common:poison", label: "中毒", sublabel: "临时", hue: 265, derived: true, polarity: "negative", stackLimit: 5 },
  { key: "statusIcon:common:burn", kind: "statusIcon", id: "common:burn", label: "灼烧", sublabel: "临时", hue: 24, derived: true, polarity: "negative", stackLimit: 3 },
  { key: "statusIcon:common:evasive", kind: "statusIcon", id: "common:evasive", label: "闪避", sublabel: "持续", hue: 332, derived: true, polarity: "positive", stackLimit: 2 },
  { key: "statusIcon:common:fireMastery", kind: "statusIcon", id: "common:fireMastery", label: "火焰掌控", sublabel: "持续", hue: 90, derived: true, polarity: "positive", stackLimit: 4 },
  { key: "card:common:minorHeal", kind: "card", id: "common:minorHeal", label: "小幅治疗", sublabel: "2 CP", hue: 283, derived: true, cardKind: "mainPhase", costCp: 2 },
  { key: "card:common:quickStudy", kind: "card", id: "common:quickStudy", label: "快速研习", sublabel: "1 CP", hue: 244, derived: true, cardKind: "mainPhase", costCp: 1 },
  { key: "card:common:focus", kind: "card", id: "common:focus", label: "凝神", sublabel: "2 CP", hue: 212, derived: true, cardKind: "rollPhase", costCp: 2 },
  { key: "card:common:powerSurge", kind: "card", id: "common:powerSurge", label: "力量涌动", sublabel: "3 CP", hue: 297, derived: true, cardKind: "rollPhase", costCp: 3 },
  { key: "card:common:evasiveManeuver", kind: "card", id: "common:evasiveManeuver", label: "闪避动作", sublabel: "2 CP", hue: 140, derived: true, cardKind: "mainPhase", costCp: 2 },
]);
