/**
 * 资产层单测 —— 不依赖 Vite / DOM / sharp / 网络。
 * 运行：node --import tsx --test packages/web/src/assets/assets.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  registerPack,
  unregisterPack,
  resolveAsset,
  setActivePack,
  getActivePack,
  listCatalogIds,
  getCatalogEntry,
  listPacks,
} from './manifest.js';
import { ASSET_CATALOG } from './catalog.js';
import { createLocalTtsPack, type LocalTtsManifest } from './packs/local-tts/index.js';
import type { AssetPack } from './types.js';

// ── catalog 完整性 ───────────────────────────────────────────────

test('catalog：每个 key 全局唯一且等于 kind:id', () => {
  const seen = new Set<string>();
  for (const e of ASSET_CATALOG) {
    assert.equal(e.key, `${e.kind}:${e.id}`, `key 应为 kind:id —— ${e.key}`);
    assert.ok(!seen.has(e.key), `重复 key ${e.key}`);
    seen.add(e.key);
  }
  assert.ok(ASSET_CATALOG.length >= 40, `目录条目过少：${ASSET_CATALOG.length}`);
});

test('catalog：覆盖两个已实现英雄的面板/能力/骰面/卡牌', () => {
  for (const hero of ['barbarian', 'pyromancer'] as const) {
    assert.ok(getCatalogEntry(hero, 'heroPanel'), `缺 heroPanel:${hero}`);
    assert.equal(listCatalogIds('dieFace').filter((x) => x.id.startsWith(`${hero}:face:`)).length, 6, `${hero} 应有 6 个骰面`);
  }
  assert.ok(listCatalogIds('card').length >= 16, 'common + 两英雄升级卡应 ≥16');
  assert.equal(listCatalogIds('statusIcon').length, 4, '应有 4 个 common 状态');
});

// ── placeholder 兜底 ─────────────────────────────────────────────

test('resolveAsset：placeholder 包对所有已知 id 都产出可用占位（永不白屏）', () => {
  setActivePack('placeholder');
  for (const { kind, id } of listCatalogIds()) {
    const ref = resolveAsset(id, kind);
    assert.equal(ref.source, 'generated', `${kind}:${id} 应为程序化占位`);
    assert.equal(ref.substituted, false);
    assert.ok(ref.url.startsWith('data:image/svg+xml'), `${kind}:${id} 应产出 SVG data URI`);
    assert.ok(ref.width > 0 && ref.height > 0);
  }
});

test('resolveAsset：未知 id 直接抛错（逻辑 id 不许发明）', () => {
  assert.throws(() => resolveAsset('no-such-card', 'card'), /未知逻辑 id/);
  assert.throws(() => resolveAsset('barbarian', 'card'), /未知逻辑 id/); // kind 错配也拦
});

// ── 切包与 fallback 链 ───────────────────────────────────────────

function fakePack(id: string, hits: ReadonlySet<string>): AssetPack {
  return {
    id,
    label: id,
    kind: 'file',
    resolve: (logicalId, kind) => hits.has(`${kind}:${logicalId}`)
      ? { logicalId, kind, pack: id, url: `file://${id}/${kind}/${logicalId}`, source: 'file', substituted: false, width: 10, height: 10 }
      : null,
  };
}

test('resolveAsset：指定包缺图时落到 placeholder，并标注缺口来源', () => {
  const p = fakePack('test-a', new Set(['card:common:focus']));
  registerPack(p);
  try {
    const hit = resolveAsset('common:focus', 'card', { pack: 'test-a' });
    assert.equal(hit.pack, 'test-a');
    assert.equal(hit.substituted, false);

    const miss = resolveAsset('common:quickStudy', 'card', { pack: 'test-a' });
    assert.equal(miss.pack, 'placeholder');
    assert.equal(miss.source, 'generated');
    assert.equal(miss.substituted, true);
    assert.ok(decodeURIComponent(miss.url).includes('缺图: test-a'), '占位图应标注缺口来源');
    assert.ok(decodeURIComponent(miss.url).includes('快速研习'), '占位图应带中文展示名');
  } finally {
    unregisterPack('test-a');
  }
});

test('resolveAsset：自定义链序 + 末尾强制 placeholder', () => {
  const a = fakePack('chain-a', new Set());
  const b = fakePack('chain-b', new Set(['statusIcon:common:burn']));
  registerPack(a);
  registerPack(b);
  try {
    const ref = resolveAsset('common:burn', 'statusIcon', { chain: ['chain-a', 'chain-b'] });
    assert.equal(ref.pack, 'chain-b');
    assert.equal(ref.substituted, true, '命中非首选包 = substituted');

    const none = resolveAsset('common:poison', 'statusIcon', { chain: ['chain-a', 'chain-b'] });
    assert.equal(none.pack, 'placeholder');
  } finally {
    unregisterPack('chain-a');
    unregisterPack('chain-b');
  }
});

test('resolveAsset：切包生效（setActivePack）', () => {
  const a = fakePack('switch-a', new Set(['heroPanel:pyromancer']));
  registerPack(a);
  try {
    setActivePack('switch-a');
    assert.equal(getActivePack(), 'switch-a');
    assert.equal(resolveAsset('pyromancer', 'heroPanel').pack, 'switch-a');
    setActivePack('placeholder');
    assert.equal(resolveAsset('pyromancer', 'heroPanel').source, 'generated');
  } finally {
    unregisterPack('switch-a');
  }
});

test('manifest：placeholder 包不允许覆盖/注销，未注册包抛错', () => {
  assert.throws(() => registerPack({ id: 'placeholder', label: 'x', kind: 'generated', resolve: () => null }), /placeholder/);
  assert.throws(() => unregisterPack('placeholder'), /placeholder/);
  assert.throws(() => resolveAsset('common:focus', 'card', { pack: 'nope' }), /未注册/);
});

// ── local-tts 包 ─────────────────────────────────────────────────

function ttsFixture(): LocalTtsManifest {
  return {
    pack: 'local-tts',
    modWorkshopId: 908560170,
    generatedAt: '2025-01-01T00:00:00.000Z',
    entries: [
      { logicalId: 'pyromancer', kind: 'heroPanel', file: 'pyromancer/panels/panel.webp', width: 800, height: 1100, confirmed: true },
      { logicalId: 'tts-pyromancer-card-07', kind: 'card', file: 'pyromancer/cards/card-07.webp', width: 400, height: 620, confirmed: false },
    ],
  };
}

test('local-tts 包：有图给真图，缺图返回 null 走兜底', () => {
  const urls = new Map([['pyromancer/panels/panel.webp', 'http://img/panel.webp']]);
  const pack = createLocalTtsPack(ttsFixture(), urls);
  registerPack(pack);
  try {
    const hit = resolveAsset('pyromancer', 'heroPanel', { pack: 'local-tts' });
    assert.equal(hit.url, 'http://img/panel.webp');
    assert.equal(hit.source, 'file');

    // 文件没导入（urls 里没有）→ null → placeholder 兜底
    setActivePack('local-tts');
    const miss = resolveAsset('barbarian', 'heroPanel');
    assert.equal(miss.pack, 'placeholder');
    assert.equal(miss.substituted, true);

    // 临时 id 只存在于包内库存，UI 按内容层 id 查询不会命中
    assert.equal(pack.resolve('tts-pyromancer-card-07', 'card', {}), null); // 无 url
    assert.equal(resolveAsset('common:focus', 'card').pack, 'placeholder');
  } finally {
    setActivePack('placeholder');
    unregisterPack('local-tts');
  }
});

test('local-tts 包：临时 id 在 manifest 里合法，但 confirmed=false 不冒充内容层', () => {
  const pack = createLocalTtsPack(ttsFixture(), new Map([
    ['pyromancer/cards/card-07.webp', 'http://img/c07.webp'],
  ]));
  // 直接经包查询临时 id 可用（确认工作流用），pack id 正确
  const ref = pack.resolve('tts-pyromancer-card-07', 'card', {});
  assert.ok(ref);
  assert.equal(ref!.pack, 'local-tts');
  assert.equal(ref!.logicalId, 'tts-pyromancer-card-07');
});
