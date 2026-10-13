# ADR-005：持久化与回放方案

- **状态**：Accepted（MVP 范围；P2 增强项已列出）
- **日期**：2025-xx-xx（架构基线）
- **决策者**：程基岩（engineering-lead）
- **相关**：ADR-003（引擎范式）、ADR-004（随机性）、ADR-006（单体 vs 拆分）

## 背景

需要持久化的东西有三类，诉求完全不同：

| 数据 | 写频率 | 一致性要求 | 体积 | 丢失代价 |
|---|---|---|---|---|
| 账号 / 身份 | 极低 | 强 | 小 | 高 |
| 对局中状态（`GameState`） | 每次动作 | 中（可重放恢复） | 小（<50KB） | 中（MVP 可接受） |
| 对局记录（用于回放/历史） | 每局一次 | 弱（追加） | 小（一局 ~20–60KB） | 低（MVP 可无） |

同时已知：
- 回放的真相源是 `seed + actionLog`（ADR-004），不是事件流。
- MVP 是单进程单体，房间状态在内存。
- lean 优先：不希望在 MVP 阶段引入数据库运维负担。

## 决策

**MVP（M0–M2）：内存 + 追加式 JSONL 落盘；不引入数据库。M3 起按触发条件引入 SQLite（→ Postgres）。**

### 决策 1：运行时状态在内存，不做每次写库

- `MatchActor` 持有 `GameState`，只在内存中推进。
- **理由**：单局状态 < 50KB、动作频率 < 1/s，写库的收益（崩溃恢复）在 MVP 阶段低于其成本（延迟、事务、运维）。崩溃丢局通过「判为无效局 + 不记录战绩」处理。
- 缓解：断线 60s 宽限 + 重连补发快照（ADR-001/002）覆盖了**最常见的**中断场景（网络问题），进程崩溃是低频事件。

### 决策 2：对局结束后（或每 N 步）追加写入 JSONL

```
data/matches/2025-10-12/<matchId>.jsonl
```

- 每行动作写一条 `ActionEnvelope`（追加，fsync 可选）。
- 结束时写一行 `MatchRecord` 终局。
- **为什么是 JSONL 追加而不是每次覆盖写 JSON**：① 追加是 crash-safe 的（最坏丢最后一行）；② 天然就是 actionLog；③ 无需数据库即可实现回放与审计；④ 调试时 `tail -f` 即可观察对局。
- 生产环境若需更强保证，把 JSONL 换成一次事务写 Postgres 表即可，**业务代码不变**（`MatchRepo` 接口隔离）。

### 决策 3：回放以 `MatchRecord` 为真相源，不存事件流

```
replay(matchRecord) → { finalState, events[] }
  initial = setup(record.seed, record.setup)
  fold over record.actions (含 sys: 动作)
```

- 不存事件流：事件是 `actionLog` 的函数，存它是冗余，且会随引擎版本漂移（改一次事件命名，所有历史录像都要处理）。
- 回放一致性校验：`hash(finalState)` 与 `record.finalState` 比对（T15）。
- **版本化**：`MatchRecord` 记录 `schemaVersion` / `engineVersion` / `contentVersion`。回放时若版本不匹配 → MVP 直接拒绝（明确报错），不做兼容层。理由：兼容层的维护成本在 MVP 阶段高于「旧录像不可看」的代价。

### 决策 4：账号系统 MVP 可用「游客 ID + 本地存储」，正式账号 P2

- MVP：首次访问生成一个匿名 `userId`（服务端签发的长效 JWT），昵称本地保存。
- P2：邮箱注册 / 第三方登录，落库。

### 决策 5：`MatchRepo` 接口隔离，实现可替换

```ts
interface MatchRepo {
  create(rec: MatchRecord): Promise<void>;
  appendAction(matchId: string, env: ActionEnvelope): Promise<void>;
  load(matchId: string): Promise<MatchRecord | null>;
  listByUser(userId: string, limit: number): Promise<MatchSummary[]>;
}
// MVP: JsonlMatchRepo   P2: SqliteMatchRepo / PgMatchRepo
```
业务代码只依赖接口，替换实现不改上层。

### 决策 6：不做 CQRS / 不做读写分离

- 数据量与查询复杂度都极低。引入 read model 是纯粹的过度工程。

## 备选方案

| 方案 | 优点 | 为什么不选（MVP） |
|---|---|---|
| **A. 从一开始就上 PostgreSQL** | 强一致、可查询、可扩展 | MVP 阶段引入 DB 运维（容器、迁移、备份、连接池），而唯一真实需求是「崩了不丢局」。成本收益比差。P2 再上（决策 5 已预留接口） |
| **B. 每次动作写 Redis（热存储）** | 崩溃可恢复、延迟低 | 引入 Redis 只为这一件事不划算；且引入后仍需持久化兜底。等真正需要多实例时随 Adapter 一起引入（ADR-006） |
| **C. 事件溯源存全部 GameEvent** | 审计最强、可任意时间点重建 | 事件流是 actionLog 的函数（冗余）；且随引擎版本漂移；体积约为 actionLog 的 5–10 倍。**除非未来需要「任意时刻状态回放/时间旅行调试」才考虑** |
| **D. 不持久化任何东西** | 零成本 | 无法回放、无法审计、无法查历史；且失去 T15 这类最强回归测试的数据来源。追加 JSONL 的成本几乎为零，**没有理由不做** |
| **E. 用 Prisma/Drizzle + ORM 从第一天开始** | 类型安全、迁移工具 | MVP 无 DB；引入 ORM 会诱导过早设计 schema。等 DB 真的来了再选（倾向 Drizzle，更轻、更贴近 SQL） |
| **F. 前端 localStorage 存对局记录** | 零服务端成本 | 客户端可篡改 → 审计/回放失去意义。服务端记录是唯一可信来源 |

## 理由

1. **JSONL 追加是 crash-safe 且零依赖的最小可行方案**，同时天然就是我们想要的 actionLog 形态。
2. **回放真相源 = seed + actions** 已经由 ADR-004 决定，本 ADR 只是把它落到存储格式上，不引入第二套真相。
3. **接口隔离（决策 5）让「推迟 DB 决策」变得无成本**——这是本 ADR 的核心价值：不是「永远不用 DB」，而是「把 DB 引入时点变成一次低风险替换」。
4. **lean**：MVP 存储层代码预计 < 200 行。

## 后果与风险

**正面**

- MVP 零运维：不需要数据库容器、迁移、备份。
- 回放与审计能力在 M0 就可用（对调试极有价值）。
- 引入 DB 时是替换实现而非重构。

**负面 / 需管理**

| 风险 | 缓解 |
|---|---|
| **进程崩溃丢局** | MVP 接受；判为无效局不记战绩；P2 用 E5（快照 + 日志重放）恢复。短期：开局 UI 不承诺「永不中断」 |
| **JSONL 文件增长**（长期无人清理） | 按日期分目录；保留策略（默认 90 天）；P2 由 DB 接管后归档到对象存储 |
| **并发写同一文件** | 每局一个文件，写者唯一（房间 Actor 串行，ADR-006）→ 无并发问题 |
| **磁盘 IO 阻塞事件循环** | 用 `fs.promises.appendFile`，不 fsync；写入失败只记日志不阻断对局（存储是旁路，不是关键路径） |
| **旧版本回放失效** | 版本校验 + 明确拒绝；`engineVersion` 语义化，事件序列变更才 bump minor 并记 CHANGELOG |
| **匿名账号被盗用/丢失** | MVP 可接受；P2 提供绑定邮箱升级路径 |
| **GDPR/隐私**：对局记录含用户行为 | MVP 只存 userId 与动作，不存 IP/UA；P2 提供删除接口 |

## 落地检查项

- [ ] `packages/server/src/persistence/MatchRepo.ts` 接口定义
- [ ] `JsonlMatchRepo` 实现：按日期分目录、追加写、写失败降级为日志告警
- [ ] `MatchRecord` 含 `schemaVersion` / `engineVersion` / `contentVersion` / `seed` / `actions` / `finalState`
- [ ] `tools/replay.ts` CLI：加载 MatchRecord → 重放 → 输出终局哈希与事件摘要
- [ ] T15 回放一致性测试
- [ ] 日志保留策略脚本（P2）

## 复核触发条件

- 出现「崩溃丢局」影响真实用户体验（→ 提前做 E5）
- 需要跨实例共享房间状态（→ 随 ADR-006 引入 Redis/DB）
- 需要战绩/排行榜/统计查询（→ 引入 SQLite/Postgres，Drizzle 优先）
- 单日对局文件 > 1GB（→ 归档策略）
