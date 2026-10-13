/**
 * 资产层类型契约。
 *
 * 设计约束（团队架构裁决，勿推翻）：
 * 1. 内容数据层（packages/shared）不允许出现任何图片路径 / 美术引用。
 * 2. 全项目唯一的「逻辑 id → 资产」耦合点就是本目录下的 manifest。
 * 3. 因此本文件只描述「引用」，不描述规则；shared 不 import 本目录，本目录也不 import shared。
 *
 * 目录一致性：所有 id 均为 string，避免与 packages/shared/src/types/core.ts 的
 * 标称类型（HeroId / CardId / StatusId）产生编译期耦合。越界一致性由 scripts/gen-asset-catalog.ts 的
 * `--check` 在 CI 中守门。
 */

/** 资产用途分类。background 属纯表现层，不参与「与内容层 id 一一对应」校验。 */
export type AssetKind = 'card' | 'heroPanel' | 'abilityIcon' | 'dieFace' | 'statusIcon' | 'background';

export const ASSET_KINDS: readonly AssetKind[] = [
  'card', 'heroPanel', 'abilityIcon', 'dieFace', 'statusIcon', 'background',
] as const;

/** 这些 kind 的逻辑 id 必须能从 shared 内容层派生出来，否则视为孤立 id（CI 报错）。 */
export const CONTENT_DERIVED_KINDS: readonly AssetKind[] = [
  'card', 'heroPanel', 'abilityIcon', 'dieFace', 'statusIcon',
] as const;

/** 内置三档资源包。 */
export type BuiltinPackId = 'placeholder' | 'local-tts' | 'reskin';

/**
 * PackId：保留内置字面量的补全提示，同时允许注册自定义包（测试夹具 / 未来活动皮肤）。
 * 写法参考 TS 的 "string & {}" 惯用法。
 */
export type PackId = BuiltinPackId | (string & Record<never, never>);

/** 单一资产引用。UI 只吃这个结构，不关心它来自哪个包、是文件还是程序化生成。 */
export interface AssetRef {
  /** 请求的逻辑 id（回显，便于 UI 打日志） */
  readonly logicalId: string;
  readonly kind: AssetKind;
  /** 真正提供资源的包（可能与请求的不同——命中 fallback 时可见） */
  readonly pack: PackId;
  /** 可直接喂给 `<img src>` 或 CSS `url()`：data URI 或构建器产出的静态资源 URL */
  readonly url: string;
  /** file = 真实图片；generated = 程序化占位 */
  readonly source: 'file' | 'generated';
  /** 命中 fallback 时为 true（开发期用来快速找出「图包还缺什么」） */
  readonly substituted: boolean;
  readonly width: number;
  readonly height: number;
}

export interface ResolveOptions {
  /** 指定本次解析使用的资源包；缺省用全局激活包。 */
  readonly pack?: PackId;
  /** 显式指定 fallback 链（不含重复项），末尾会被强制补上 placeholder。 */
  readonly chain?: readonly PackId[];
  /** 命中 fallback 时是否在占位图上标注缺失来源，默认 true（仅当请求包非 placeholder）。 */
  readonly annotateMissing?: boolean;
  /** 传给占位生成器的附加尺寸，缺省用 CATALOG 里该 kind 的默认尺寸。 */
  readonly width?: number;
  readonly height?: number;
}

/**
 * 资源包接口：resolve 返回 null 表示「本包没有这张图」，由 manifest 继续走 fallback 链。
 * 包自身永远不负责兜底——兜底是 manifest 的职责，这样才能保证链序唯一可控。
 */
export interface AssetPack {
  readonly id: PackId;
  readonly label: string;
  readonly kind: 'generated' | 'file';
  readonly resolve: (logicalId: string, kind: AssetKind, opts: ResolveOptions) => AssetRef | null;
}

/** 卡牌表现类别（与 shared 的 CardKind 结构上对齐，但不 import shared）。 */
export type CardVisualKind = 'upgrade' | 'mainPhase' | 'rollPhase' | 'instant';

/** 目录项：一条「逻辑 id + 展示元数据」。由 scripts/gen-asset-catalog.ts 生成，勿手改。 */
export interface CatalogEntry {
  /** `${kind}:${id}` —— 全局唯一键 */
  readonly key: string;
  readonly kind: AssetKind;
  /** 逻辑 id，必须与 shared 内容层里的 id 完全一致 */
  readonly id: string;
  /** 中文展示名（占位图上的主标题） */
  readonly label: string;
  /** 副标题（通常是所属英雄名 / 费用描述） */
  readonly sublabel: string;
  /** 占位图色相 0–359，由生成器确定性分配 */
  readonly hue: number;
  /** true = 由 shared 内容层派生（参与 lint 校验）；false = 纯表现层 id */
  readonly derived: boolean;

  readonly ownerId?: string;
  readonly heroId?: string;
  readonly cardKind?: CardVisualKind;
  readonly costCp?: number;
  readonly tier?: number;
  readonly tierCount?: number;
  readonly abilityKind?: string;
  readonly dieValue?: number;
  readonly dieSymbols?: readonly string[];
  readonly polarity?: 'positive' | 'negative';
  readonly stackLimit?: number;
  /** heroPanel 专用：能力槽列表 */
  readonly slots?: readonly { readonly id: string; readonly label: string; readonly kind: string; readonly tierCount: number }[];
}
