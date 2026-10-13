/**
 * 种子化 PRNG —— 架构 ADR-004。
 *
 * 设计要点：
 * 1. 服务端生成种子，**种子绝不下发客户端**（防预知：不存在"未来的骰值"可被读出来）。
 * 2. 命名流（setup / shuffle:0 / dice:0 / misc ...）各自独立计数。
 *    好处：某条流多消耗一次时，只有该流错位，便于定位回归。
 * 3. sfc32：纯 32 位整数运算，跨端/跨引擎逐位一致。
 * 4. 回放 = seed + actionLog。
 */
import type { RngState } from '../types/state.js';

/** 字符串 → 4×32bit 种子 */
export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

export function sfc32(a: number, b: number, c: number, d: number): () => number {
  return function (): number {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function createRng(seed: string): RngState {
  return { seed, counters: {} };
}

/** [0,1) 浮点。返回新状态（不可变）。 */
export function nextFloat(rng: RngState, stream: string): { value: number; rng: RngState } {
  const counter = rng.counters[stream] ?? 0;
  const [a, b, c, d] = cyrb128(`${rng.seed}:${stream}:${counter}`);
  const rnd = sfc32(a, b, c, d);
  // 预热，避免 sfc32 前几个输出质量不佳
  rnd(); rnd(); rnd();
  const value = rnd();
  return {
    value,
    rng: { seed: rng.seed, counters: { ...rng.counters, [stream]: counter + 1 } },
  };
}

/** [0, maxExclusive) 整数 */
export function nextInt(rng: RngState, stream: string, maxExclusive: number): { value: number; rng: RngState } {
  const { value, rng: next } = nextFloat(rng, stream);
  return { value: Math.floor(value * maxExclusive), rng: next };
}

/** Fisher-Yates 洗牌（种子化、可复现） */
export function shuffle<T>(rng: RngState, stream: string, items: readonly T[]): { items: T[]; rng: RngState } {
  const arr = items.slice();
  let r = rng;
  for (let i = arr.length - 1; i > 0; i--) {
    const { value: j, rng: next } = nextInt(r, stream, i + 1);
    r = next;
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return { items: arr, rng: r };
}
