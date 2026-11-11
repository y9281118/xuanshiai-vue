# 记忆内核核心 v1 — 架构契约

> 状态：**核心与投影已交付，读路径默认不切换**（详见 §7 模式矩阵）。
> 产品口径见 `PRODUCT.md` §「记忆内核核心 v1」；安全决策见
> `docs/ai/AI_PRODUCT_SECURITY_DECISIONS.md`；交付与回滚见
> `docs/ai-memory-core-rollout-20260905.md`、`docs/ai-memory-phase2-rollout-20260905.md`。
> 本文是**冻结契约**：下列规则由 `app/services/ai/memory/policy.py` 单点强制，
> 其他模块不得自行实现一份。

## 1. 分层与职责

| 层 | 模块 | 职责 | 是否访问数据库 |
| --- | --- | --- | --- |
| Ledger | `ledger.py` | 只追加事件、分配 owner 内 `server_seq` | 是 |
| Policy | `policy.py` | 来源优先级、canonical 键、主体互锁、抑制守卫 | 否（纯函数） |
| Materializer | `materializer.py` | 事件 → Observation / Claim / Insight / State 视图 | 是 |
| Service | `service.py` | 确认 / 纠正 / 删除 / 解除等对外语义 | 是 |
| Derivations | `derivations.py` | 视图变更 → outbox 事件（投影重建触发器） | 是 |
| Projection | `projections.py`、`projection_policy.py` | 构建版本化投影、授权门、`read_active` | 是 |

调用方向单向向下：Service → Ledger/Policy，Materializer 只消费事件，Derivations 只消费
视图。**反向路径不存在**，因此不存在"物化器回写事件"这类环形因果。

## 2. 数据模型

Core v1 建立 7 张表（`ai_memory_owner_sequence`、`ai_memory_event`、
`ai_memory_observation`、`ai_memory_claim`、`ai_memory_insight`、`ai_memory_state`、
`ai_memory_suppression`），Phase 2 追加 2 张投影表
（`ai_memory_projection_grant`、`ai_memory_projection`）。全部为纯新增表，不修改任何既有
业务表，因此代码回滚不需要执行 down 迁移。

关键列：

- `ai_memory_event`：`event_id`、`owner_user_id`、`server_seq`、`event_type`、`subject`、
  `dimension`、`source_kind`、`source_turn_id`、`source_ref`、`source_quote`、
  `causal_event_ids_json`、`consent_scope`、`idempotency_key`。唯一键
  `uk_ai_memory_event_owner_seq (owner_user_id, server_seq)` 保证 owner 内序号连续唯一；
  `uk_ai_memory_event_owner_idempotency` 保证同一 `Idempotency-Key` 只产生一条事件（重放
  返回原事件，不新建）。
- `ai_memory_claim`：`fact_kind`、`dimension`、`value_json`、`confidence`、`importance`、
  `constraint_type`、`status`、`source_kind`、`last_event_id`、`last_event_seq`。
  `uk_ai_memory_claim_canonical` 建立在 canonical 键上，同一主体同一维度只有一条活动结论。
- `ai_memory_state`：`namespace`、`canonical_key`、`value_json`、`valid_until`、`status`。
  索引 `idx_ai_memory_state_owner_valid (owner_user_id, valid_until)` 服务于到期扫描。
- `ai_memory_suppression`：墓碑行，记录被用户删除/解除的主体与维度，用于阻断自动重抽取。

## 3. 只追加账本（append-only）

`ai_memory_event` 是 **append-only** 的：代码里不存在 UPDATE / DELETE 该表的路径。
用户确认、纠正、删除、解除、过期全部表达为**新事件**，并通过 `causal_event_ids_json`
指回被它取代的事件，从而保留完整因果链。任何"改写历史"的需求都必须表述为追加一条
纠正事件；如果实现上需要原地更新，说明建模错了。

唯一的非追加行为是 retention 与账号删除链路的批量清理，两者都属于既有 outbox /
清理消费者，不经 Ledger。

`server_seq` 在 owner 内单调递增。首写采用 **ensure-first**（幂等 upsert 先建序号行），
后到事务阻塞在 duplicate-key 检查上按行锁串行——旧的"先 SELECT FOR UPDATE 再
insert-if-missing"在 REPEATABLE READ 下会让真并发首写互持间隙锁并实测 1213 死锁。

## 4. 主体与 `fact_kind` 互锁

记忆只有两个主体：

- `personal` —— 当前用户本人的画像，对应 `fact_kind = about_user`；
- `ideal_partner` —— 当前用户的择偶偏好，对应 `fact_kind = partner_preference`。

互锁在 `MemoryPolicy` 里硬校验（`expected = "about_user" if subject == "personal" else
"partner_preference"`），不匹配时整轮拒绝、零记忆入库，并抛 `MemoryPolicyDenied`。
**第三方主体不可表达**——不存在"关于某个具体他人"的记忆类型，这是模型层面的限制，
不是靠调用方自律。错误消息只携带 subject / `fact_kind` / canonical 键，绝不带用户原话。

## 5. 来源与断言模式

来源优先级（`MEMORY_SOURCE_RANK`，高者不被低者静默覆盖）：

```
user_explicit > user_confirmed > user_feedback > inferred > behavior
```

冲突**绝不** last-write-wins；低优先级来源只能生成新版本候选或提出澄清，不能顶掉显式结论。
`behavior` 位置最低，本期也**不自动产生**（无真实行为学习生产者）。

抽取侧用 `assertion_mode ∈ {explicit, inferred}` 显式声明断言强度，Shadow Write 据此映射为
`source_kind = user_explicit / inferred`。映射**只由 assertion_mode 决定，绝不从
confidence 反推**：高 confidence 的 `inferred` 仍然是 inferred，只能产出 proposed 观察，
不能直接成为 confirmed 结论。历史 candidate 缺少 assertion_mode 时按固定 legacy 规则映射为
`inferred`。

## 6. canonical 键、状态 TTL 与抑制

- **canonical 键** = subject + dimension + 身份摘要的哈希。它是"同一件事"的判定依据，也是
  `uk_ai_memory_claim_canonical` 的索引对象。拼错 canonical 键会让同一事实在不同维度下
  各自成立，属于数据污染而非样式问题。
- **State TTL**：`ai_memory_state` 每行带 `valid_until`。到期不是普通行删除——先追加
  `state_expired` 账本事件，再物化为 expired，保留其事件链。期限由 `AI_MEMORY_STATE_TTL_*`
  配置。
- **Suppression（抑制）**：用户删除/撤回授权会写入墓碑。活动的 suppression 行会
  ①让列表查询以 `NOT EXISTS` 过滤掉被删条目，②阻断自动重抽取（防止"删了又被抽回来"）。
  解除抑制写入新事件并释放墓碑，条目恢复展示。墓碑是"用户意图"的记录，不是缓存标记。

## 7. 投影与读取模式

投影是从 confirmed Claim 派生的**版本化只读文档**，不是第二份事实库：

- 只收 confirmed Claim，活动墓碑对应的事实排除在外；
- 10 字段 entry allowlist（与安全决策文档一致）：`age`、`city_code`、`marriage_status`、
  `education_level`、`height_cm`、`income_band`、`occupation_group`、`interest_tags`、
  `lifestyle_tags`、`relationship_goal`；
- 值类型只支持 string / number / boolean / string_list，区间类 dict 不入投影，对应字段由
  规则引擎记 UNKNOWN（方向保守）；
- 版本单调递增，`projection_input_hash` **不建唯一键**：同内容换授权代
  （`consent_snapshot_id` / `policy_revision` 变化）必须能新建版本，哈希唯一会把它压成
  1062 冲突。幂等在写入侧实现——先读同 hash 的当前版本，命中就直接返回。

读取模式由 `AI_MEMORY_PROJECTION_READ_MODE` 控制，启动时按 Literal 校验、非法值 fail fast：

| 模式 | 行为 | 默认 |
| --- | --- | --- |
| `legacy` | 走既有旧投影，行为与接入前完全一致 | ✅ |
| `shadow` | 双读，返回恒等于 legacy 结果，另有结构化 diff 日志 | |
| `memory` | 读记忆投影，`read_active` 全门校验 | |

`read_active` 的门：owner 匹配 + grant active + consent 快照有效 + `policy_revision` 一致 +
投影 status=active + 版本有效。任一不满足即返回空（fail closed），并按固定策略回退 legacy，
回退会计数。

**当前状态：Search / Compatibility / Recommend 不切换。** 三条读路径都已接入三态分发，
但开关默认 `legacy`；且 `MemoryProjectionService.grant` 至今没有任何生产调用方
（授权生产者属 Phase 3 范围），所以即便把开关切到 `memory` 也会 100% 回退。这是诚实的
fail-safe，不是故障。`memory` 模式下存在有界陈旧窗口：claim 确认 → outbox → worker 重建
之间读到的是上一个有效版本，方向保守（只可能缺最新事实，绝不含未确认数据），随重建自愈。

Future key `counselor_context` / `persona_context` 已登记但全部 fail closed
（`ProjectionFeatureNotEnabled`），不产生 grant 行、投影行或任何下游输入。

## 8. 隐私地板

- `source_quote` 上限 **512 字符**，只保留最小引用；`source_ref` 同理。
- 事件 payload、outbox payload、日志、API 响应**均不含完整 transcript**，也不含字段原文。
  投影响应、diff 日志、证据结构同样只允许 hash、计数、字段 key、差异类型。
- Shadow Write 失败只记录异常类型名与 ID；subject / policy 违规使用可检索标记
  `memory_shadow_policy_denied` / `memory_forward_policy_denied`，消息不含用户原话。
- 授权复用既有 `profile_text_extract` scope，Core v1 **不新增** consent scope 或授权表。

## 9. 并发与锁序

统一约定：**变更入口先取 owner 序列锁**（`lock_owner()`），再取具体行锁；物化器的
claim / suppression INSERT 命中唯一键冲突时由"抛 IntegrityError"降级为"回读让位"
（first-wins，事件保留在账本），消除竞态败者在调用方事务内留下半套物化行的窗口。

grant / revoke 是例外且方向一致：只取 grant 行锁 → projection 行，全程不取 owner 序列锁；
build / rebuild 取 owner 锁 → projection 行。不存在反向顺序路径，因此无 AB-BA 死锁窗口。

## 10. 本期未实现

前端 Memory View；AI 军师 / AI 分身的真实消费；granular consent 产品流程；授权生产者；
真实行为学习；Search / Compatibility / Recommend 的读切换与生产灰度；shadow 差异率的
生产观测面板（本期仅结构化日志）。
