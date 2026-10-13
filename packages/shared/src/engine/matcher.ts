/**
 * 骰型匹配器求值 —— 对应 design §3.2。
 * 求值返回 matchedDiceIndices，直接驱动 UI 高亮（零额外成本）。
 */
import type { DiceMatcher, DiceView, MatchResult } from '../types/core.js';

function longestRun(values: readonly number[]): { length: number; indices: number[] } {
  const uniq = [...new Set(values)].sort((a, b) => a - b);
  let best: number[] = [];
  let cur: number[] = [];
  for (let i = 0; i < uniq.length; i++) {
    const v = uniq[i] as number;
    const prev = i > 0 ? uniq[i - 1] : undefined;
    if (prev !== undefined && v === prev + 1) {
      cur.push(v);
    } else {
      cur = [v];
    }
    if (cur.length > best.length) best = cur.slice();
  }
  // 把面值映射回骰子下标（同一面值可能有多颗，全取）
  const indices: number[] = [];
  best.forEach((v) => {
    values.forEach((dv, i) => {
      if (dv === v && !indices.includes(i)) indices.push(i);
    });
  });
  return { length: best.length, indices };
}

/** 顺子三条硬规则：不环绕 / 面值去重 / 大顺蕴含小顺 */
export function evaluate(m: DiceMatcher, d: DiceView): MatchResult {
  switch (m.k) {
    case 'const':
      return { matched: m.value, indices: [] };

    case 'countSymbol': {
      const idx: number[] = [];
      d.symbols.forEach((s, i) => { if (s === m.symbol) idx.push(i); });
      return { matched: idx.length >= m.count, indices: idx };
    }

    case 'countFace': {
      const idx: number[] = [];
      d.values.forEach((v, i) => { if (v === m.face) idx.push(i); });
      return { matched: idx.length >= m.count, indices: idx };
    }

    case 'atLeast': {
      // 向上兼容：从 count 到 5 依次尝试，取满足的最大者
      const inner = m.of;
      for (let n = 5; n >= 1; n--) {
        const candidate: DiceMatcher = { ...inner, count: n } as DiceMatcher;
        const r = evaluate(candidate, d);
        if (r.matched) return r;
      }
      return { matched: false, indices: [] };
    }

    case 'smallStraight':
    case 'largeStraight': {
      const need = m.k === 'smallStraight' ? 4 : 5;
      const run = longestRun(d.values);
      return run.length >= need
        ? { matched: true, indices: run.indices }
        : { matched: false, indices: [] };
    }

    case 'graded': {
      // 按 tierMins 降序找第一个满足的档
      const order = m.tierMins
        .map((min, tier) => ({ min, tier }))
        .sort((a, b) => b.min - a.min);
      for (const { min, tier } of order) {
        const idx: number[] = [];
        d.symbols.forEach((s, i) => { if (s === m.symbol) idx.push(i); });
        if (idx.length >= min) return { matched: true, indices: idx, tier };
      }
      return { matched: false, indices: [] };
    }

    case 'allOf': {
      const results = m.of.map((sub) => evaluate(sub, d));
      if (results.some((r) => !r.matched)) return { matched: false, indices: [] };
      const union = [...new Set(results.flatMap((r) => r.indices))].sort((a, b) => a - b);
      return { matched: true, indices: union };
    }

    case 'anyOf': {
      for (const sub of m.of) {
        const r = evaluate(sub, d);
        if (r.matched) return r;
      }
      return { matched: false, indices: [] };
    }

    case 'not': {
      const r = evaluate(m.of, d);
      return { matched: !r.matched, indices: [] };
    }
  }
}
