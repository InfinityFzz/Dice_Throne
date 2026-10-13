/**
 * 程序化占位图生成器 —— 无任何真实图片时保证 UI 完整可用（不白屏）。
 *
 * 设计约束：
 * - 零依赖、确定性：同一逻辑 id 永远产出同一张占位图（hue 来自 catalog，色相稳定）。
 * - 输出 SVG data URI，可直接喂 <img src> / CSS url()。
 * - 占位图上始终有「占位」角标，肉眼可分辨「这是程序生成的，不是真图」。
 */
import type { AssetKind, CatalogEntry } from './types.js';

/** 各 kind 的占位图默认尺寸（与导入脚本的输出规格对齐）。 */
export const KIND_DEFAULT_SIZE: Readonly<Record<AssetKind, { readonly width: number; readonly height: number }>> = Object.freeze({
  card: { width: 380, height: 590 },      // TTS 卡牌 377×585 同比例
  heroPanel: { width: 800, height: 1100 }, // Leaflet 技能板
  abilityIcon: { width: 256, height: 256 },
  dieFace: { width: 256, height: 256 },
  statusIcon: { width: 256, height: 256 },
  background: { width: 1280, height: 720 },
});

const KIND_TAG: Readonly<Record<AssetKind, string>> = Object.freeze({
  card: '卡牌',
  heroPanel: '技能板',
  abilityIcon: '能力',
  dieFace: '骰面',
  statusIcon: '状态',
  background: '背景',
});

/** HSL → #rrggbb（占位图只需要中低饱和的实色，无需完整色彩空间）。 */
function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export interface PlaceholderSpec {
  readonly label: string;
  readonly sublabel: string;
  readonly hue: number;
  readonly kind: AssetKind;
  readonly width: number;
  readonly height: number;
  /** 命中 fallback 时标注资源缺口来源，如「缺图: local-tts」；缺省不标注。 */
  readonly missingFrom?: string;
}

/** 长文本截断，避免溢出占位框。 */
function fit(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const memo = new Map<string, string>();

/** 生成占位图 data URI（带 memo，重复 resolve 同一 id 不重复产 SVG）。 */
export function renderPlaceholder(spec: PlaceholderSpec): string {
  const memoKey = JSON.stringify(spec);
  const hit = memo.get(memoKey);
  if (hit) return hit;

  const { label, sublabel, hue, kind, width, height } = spec;
  const base = hsl(hue, 0.32, 0.16);
  const band = hsl(hue, 0.45, 0.30);
  const accent = hsl(hue, 0.55, 0.62);
  const ink = '#e8e6e0';
  const pad = Math.round(Math.min(width, height) * 0.06);
  const titleSize = Math.max(16, Math.round(Math.min(width, height) * 0.085));
  const subSize = Math.max(11, Math.round(titleSize * 0.55));
  const titleMax = Math.max(4, Math.floor((width - pad * 2) / (titleSize * 1.05)));
  const subMax = Math.max(6, Math.floor((width - pad * 2) / (subSize * 1.05)));
  const badge = spec.missingFrom ? `缺图: ${spec.missingFrom}` : '占位';

  const svg =
`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
`<rect x="0" y="0" width="${width}" height="${height}" fill="${base}"/>` +
`<rect x="0" y="0" width="${width}" height="${Math.round(height * 0.16)}" fill="${band}"/>` +
// 斜纹水印：让「无真图」一眼可辨
`<g opacity="0.08" stroke="${accent}" stroke-width="${Math.max(2, width * 0.012)}">` +
Array.from({ length: 12 }, (_, i) => {
  const o = i * Math.max(width, height) / 6;
  return `<line x1="${o - height}" y1="${height}" x2="${o}" y2="0"/>`;
}).join('') +
`</g>` +
`<rect x="${Math.round(width * 0.015)}" y="${Math.round(width * 0.015)}" width="${width - Math.round(width * 0.03)}" height="${height - Math.round(width * 0.03)}" fill="none" stroke="${accent}" stroke-width="2" rx="${Math.round(width * 0.03)}"/>` +
`<text x="${pad}" y="${Math.round(height * 0.16) - Math.round(pad * 0.4)}" font-family="'Segoe UI','Microsoft YaHei',sans-serif" font-size="${subSize}" fill="${ink}" opacity="0.85">${esc(KIND_TAG[kind])} · ${esc(fit(sublabel, subMax))}</text>` +
`<text x="${pad}" y="${Math.round(height * 0.52)}" font-family="'Segoe UI','Microsoft YaHei',sans-serif" font-size="${titleSize}" font-weight="700" fill="${ink}">${esc(fit(label, titleMax))}</text>` +
`<rect x="${width - pad - Math.round(subSize * (badge.length + 1) * 0.62)}" y="${height - pad - Math.round(subSize * 1.7)}" width="${Math.round(subSize * (badge.length + 1) * 0.62)}" height="${Math.round(subSize * 1.7)}" rx="${Math.round(subSize * 0.42)}" fill="${accent}" opacity="0.9"/>` +
`<text x="${width - pad - Math.round(subSize * 0.3)}" y="${height - pad - Math.round(subSize * 0.5)}" text-anchor="end" font-family="'Segoe UI','Microsoft YaHei',sans-serif" font-size="${subSize}" font-weight="700" fill="${base}">${esc(badge)}</text>` +
`</svg>`;

  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  memo.set(memoKey, uri);
  return uri;
}

/** 由 catalog 条目构建默认占位参数（尺寸取 kind 默认，可覆盖）。 */
export function placeholderSpecFor(
  entry: Pick<CatalogEntry, 'label' | 'sublabel' | 'hue' | 'kind'>,
  size?: { readonly width?: number; readonly height?: number },
  missingFrom?: string,
): PlaceholderSpec {
  const d = KIND_DEFAULT_SIZE[entry.kind];
  return {
    label: entry.label,
    sublabel: entry.sublabel,
    hue: entry.hue,
    kind: entry.kind,
    width: size?.width ?? d.width,
    height: size?.height ?? d.height,
    ...(missingFrom !== undefined ? { missingFrom } : {}),
  };
}
