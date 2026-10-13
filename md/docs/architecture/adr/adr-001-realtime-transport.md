# ADR-001：实时通信方案

- **状态**：Accepted
- **日期**：2025-xx-xx（架构基线）
- **决策者**：程基岩（engineering-lead）
- **相关**：ADR-002（权威与同步）、ADR-006（单体 vs 拆分）

## 背景

DT-Web 是回合制 1v1 卡牌对战，但对局中存在多处**非活跃玩家的实时交互**：防守掷骰、掷骰阶段打牌响应窗口、弃牌决策。因此：

- 需要**服务端主动推送**（不能靠轮询，响应窗口的体感延迟必须 < 200ms）。
- 需要 **per-seat 差异化广播**（两个客户端收到不同的投影，见 ADR-002），即「房间内分组广播」。
- 连接质量要求高：移动网络下的断线重连必须无感（对局状态不能丢）。
- MVP 团队规模小（1–3 人），不希望自建重连/心跳/降级协议。
- 单局时长约 15–30 分钟，每局消息量小（约 200–600 帧），**不是**高吞吐场景。

## 决策

**采用 Socket.IO v4（服务端 `socket.io`，客户端 `socket.io-client`），WebSocket 优先传输、自动降级到 HTTP 长轮询；MVP 单实例，不引入 Redis Adapter。**

配套约束：

1. **上行只允许「意图」**：客户端只发 `game:intent`（含 `matchId`、`clientSeq`、`action`）。禁止发状态。
2. **下行两种帧**：
   - `game:snapshot` —— 全量 `PlayerView`（重连/阶段切换时下发，MVP 状态 < 50KB）
   - `game:patch` —— `{ view: PlayerView, events: GameEvent[] }`（每次动作后下发）
   MVP 一律发 `game:patch` 携带完整 view，不做增量 diff（状态小，diff 的复杂度收益为负）。
3. **房间语义**：用 Socket.IO Room（`socket.join(roomId)`）做分组广播；但**每个 seat 单独 emit**（因为投影不同），不用 `io.to(room).emit`。
4. **鉴权**：连接握手阶段（`io.use`）校验 JWT，绑定 `userId`；`seat` 由服务端根据房间成员表推导，**永不信任客户端声明**。
5. **心跳与超时**：用 Socket.IO 内置 ping/pong（默认 25s/20s 调为 10s/5s，移动端更快感知）；业务层超时统一由 `MatchActor` 的定时器管理（ADR-002）。
6. **重连**：客户端 `reconnection: true, reconnectionAttempts: Infinity, reconnectionDelayMax: 5000`；重连后服务端下发完整快照。

## 备选方案

| 方案 | 优点 | 为什么不选 |
|---|---|---|
| **原生 WebSocket（`ws`）** | 最轻、无框架开销、协议透明 | 需要自己实现：重连退避、心跳、房间分组、降级、消息 ACK/重放。这些正是我们最需要且最容易写错的部分；移动端断线重连的边界情况（半开连接、代理超时）会吃掉数周工期 |
| **WebRTC DataChannel** | P2P 低延迟、无服务器带宽 | 回合制不需要 <50ms 延迟；P2P 与「服务端权威」直接冲突（一端作弊即可伪造，或至少无法仲裁）；NAT 穿透复杂度高 |
| **HTTP 轮询 / SSE + POST** | 实现简单、穿透性好 | 轮询延迟与浪费；SSE 只是单向，上行仍要 POST，且断线语义要自己处理；无房间分组原生支持 |
| **gRPC-web / tRPC subscription** | 类型安全端到端 | 生态与 Socket.IO 相比在「连接生命周期管理」上弱；浏览器支持与代理穿透问题更多；团队熟悉度低 |
| **Colyseus**（游戏房间框架） | 内置状态同步、房间生命周期 | 其内置的状态同步模型（schema 增量同步）与我们的「per-seat 投影 + 全量状态不下发」模型不匹配，会打架；额外抽象层不划算 |
| **MQTT over WS** | 轻量、QoS | 面向 IoT 的语义（主题订阅、保留消息）对回合制对战是噪声；房间/匹配逻辑仍要自建 |

## 理由

1. **我们要的正好是 Socket.IO 免费给的三件事**：自动重连 + 心跳/断线检测 + 房间分组广播。这三件事是本项目网络层的主要风险（见主文档 R1），自建的边际成本远高于引入依赖。
2. **自动降级到长轮询**在企业网络/老旧代理环境下是真实需求，WebSocket-only 方案在这些环境直接不可用。
3. **消息量极小**（每局数百帧），Socket.IO 的协议开销（每帧几十字节）完全无感。性能不是选型因素。
4. **生态与熟悉度**：Socket.IO 的运维/调试工具、Redis Adapter、监控方案成熟，团队上手成本接近零。
5. **不锁定**：我们的业务层通过 `Transport` 接口（`emitToSeat(seat, frame)` / `onIntent(cb)`）与 Socket.IO 解耦，未来换 `ws` 只需替换一个适配器文件。

## 后果与风险

**正面**

- 断线重连、心跳、房间广播几乎零成本获得。
- 扩展到多实例时，`@socket.io/redis-adapter` 是官方路径，改动量小（前提：房间 Actor 串行化，见 ADR-006）。
- 客户端/服务端同构的 TS 类型可直接复用（信封类型放 `@dt/shared`）。

**负面 / 需管理**

| 风险 | 缓解 |
|---|---|
| Socket.IO 不是标准 WebSocket 协议，非浏览器客户端（如未来的 bot 服务）必须用 `socket.io-client` | Bot 用 Node + `socket.io-client`，成本可接受；若未来需要非 JS 客户端，改为在服务端开一路 REST `POST /match/:id/intent` 备用入口（意图管线本就是纯函数，易复用） |
| Socket.IO 服务器**有状态**（连接归属实例）→ 多实例必须加 Adapter | 已在 ADR-006 定义触发条件；MVP 单实例无此问题 |
| 协议版本升级时客户端/服务端必须匹配 | 锁定版本；CI 中校验两端 major 一致 |
| 长连接在移动网络下会「假在线」（半开连接） | 调短 ping 间隔（10s）；业务层 30s 决策超时做兜底；重连后必发全量快照 |
| 单帧体积若不控制会膨胀（例如把整局事件流塞进 view） | `view.log` 只保留最近 50 条；`game:patch` 只带本次新增事件；传输层加帧大小断言（> 256KB 告警） |

## 落地检查项

- [ ] `packages/shared/src/types/transport.ts` 定义 `ClientIntent` / `ServerFrame` 并用 zod 校验
- [ ] `packages/server/src/net/socketio.ts` 实现 `Transport` 接口，`io.use` 鉴权
- [ ] `packages/web/src/net/socket.ts` 重连参数按本 ADR 配置
- [ ] CI：client/server `socket.io` major 版本一致检查
- [ ] 集成测试 I1（传输层无泄漏）、I2（断线重连）、I3（并发意图串行）

## 复核触发条件

出现以下任一情况需重新评审本 ADR：

- 需要支持非 JS 的一等客户端（原生 App / Unity 客户端）
- 单实例承载不了，需要多实例且 Redis Adapter 引入后仍有跨实例一致性问题
- 出现 > 5% 的连接因协议/代理问题无法建立（此时考虑 REST 兜底入口）
