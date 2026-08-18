# AI 书友平台：全球书目、图书馆馆藏与价格数据方案

> 文档版本：v1.0  
> 日期：2026-08-17  
> 适用范围：BookMate 托管网页端、BookMate Agent Kit、MCP Server、Library/Price Skills

## 1. 结论先行

这个项目不应该“自己手工整理全球所有图书、馆藏和实时价格”，也不可能依靠一个开源数据库解决全部问题。

正确路线是：

1. 自己维护统一的数据契约、实体合并规则、来源追踪和质量体系。
2. 冷启动使用开放书目、开放地点数据和用户自带图书。
3. 馆藏和价格通过国家、地区、机构及商业供应商适配器实时接入。
4. 把“发现附近图书馆”“发现馆藏”“确认当前可借”作为三个不同证据层级。
5. 把“发现购买页面”“获得当前标价”“计算到手总价”作为三个不同证据层级。
6. 开源仓库不打包受版权保护的全文、受限馆藏数据或未经授权的商家价格数据。

全球数据不是“全开源”与“全自建”的二选一，而是分层组合：开放基础数据负责广度，机构接口负责本地准确性，合作数据负责实时性和覆盖率，BookMate 自己负责标准化与可信表达。

## 2. 为什么没有一个现成的全球真相库

“一本书”至少包含四种不同实体：

- `Work`：抽象作品，例如《局外人》。
- `Edition`：具体语言、译者、出版社、年份、装帧和 ISBN 的版本。
- `Holding`：某个图书馆系统或分馆是否记录了某个版本。
- `Offer`：某商家在特定地区、时间、币种、品相和配送条件下的报价。

它们的更新周期和权利边界完全不同：

| 数据对象 | 典型变化速度 | 全球开放程度 | BookMate 的策略 |
|---|---:|---|---|
| 作品、作者、主题 | 月/年 | 较高但不完整 | 聚合开放书目并做实体合并 |
| 版本、ISBN、译者 | 月/年 | 中等 | 多源校验，保留来源冲突 |
| 图书馆位置 | 天/月 | 较高 | OSM/机构名录，保留许可证归属 |
| 某馆是否收藏 | 天/周 | 低到中 | 联合目录、OPAC、SRU 或合作 API |
| 当前可借/已借出 | 秒/分钟 | 很低 | 直接查询本馆 ILS/数字借阅服务 |
| 商家库存和标价 | 秒/分钟 | 很低 | 官方/联盟 API 或商家深链 |
| 含运费税费总价 | 每个用户请求 | 几乎无全球开放库 | 按目的地动态计算并声明未知项 |

因此，“搜索不到”只能解释为“在已查询数据源中没有发现”，不能直接解释为“全球不存在”。

## 3. 数据源全景

### 3.1 书目与版本元数据

| 来源 | 类型/许可现实 | 能提供什么 | 主要限制 | 建议用途 |
|---|---|---|---|---|
| Open Library | 开放 API 与数据导出 | Work、Edition、ISBN、封面关联 | 覆盖和字段质量不均；本次开发网络未能稳定访问官方页面 | 全球冷启动与交叉标识 |
| Wikidata | CC0，SPARQL/REST/导出 | 跨语言作者、作品、主题和外部 ID | 不适合作为完整版本目录 | 实体链接与多语言别名 |
| Google Books API | 公共开发者 API，通常需 key | 卷、ISBN、描述、封面、部分地区销售信息 | 不是可任意再发布的全球开放数据集；字段随国家和图书变化 | 在线补全与购买发现 |
| Library of Congress | 公共 API、目录与数字馆藏 | 规范名、书目记录、控制号 | 对非美国大众出版物覆盖不完整 | 权威标识与元数据校验 |
| Crossref REST API | 开放检索接口 | DOI、出版物、图书章节和学术书元数据 | 大众图书覆盖有限 | 学术专著与章节 |
| Project Gutenberg | 公版文本和元数据 | 公版电子书全文 | 仅限公版作品，版本与现代纸书不同 | 合法全文体验与测试语料 |
| 出版社/ISBN 机构数据 | 国家和合同各异 | 权威版本、出版社与 ISBN 信息 | 许可、字段开放性和价格差异大 | 重点市场的版本权威源 |

建议：以 `Work -> Edition -> Identifier` 建立内部图谱，不把标题字符串当主键。任何“精确版本”判断至少依赖 ISBN 或供应商版本 ID；标题/作者模糊匹配必须标记为 `unverified`。

### 3.2 图书馆位置、馆藏和流通

| 来源 | 层级 | 开放现实 | 不能证明什么 |
|---|---|---|---|
| OpenStreetMap / Overpass | 附近分馆位置 | ODbL 开放数据，必须署名并遵守数据库许可 | 不能证明某书有馆藏，更不能证明可借 |
| 公共 OPAC、SRU/CQL、Z39.50 | 单馆/联盟目录 | 部分公开，协议和字段各异 | 目录命中不一定是实时可借状态 |
| Koha REST API | 单馆 ILS | 软件开源，但每个图书馆的接口权限由机构决定 | 不能因为使用 Koha 就假定 API 公共开放 |
| FOLIO/其他 ILS API | 单馆 ILS | 部署与访问机构化 | 无法提供默认全球访问 |
| OCLC WorldCat Search API | 全球联合目录与 holdings | 官方说明通常需要符合条件的 OCLC 订阅或商业合作 | 不是免费的完整全球开放馆藏库 |
| OverDrive APIs | 数字借阅、可用性、预约、借出 | 需要申请凭据与合作权限 | 不能视为匿名开放 API |
| 国家/地区联合目录 | 国家或联盟馆藏 | 各国开放度、协议、覆盖不同 | 通常不含完整实时流通状态 |

中国市场应优先按城市和图书馆系统接入：国家图书馆、高校/联盟目录、城市公共图书馆 OPAC 可以用于目录发现或深链，但自动化接口、实时流通、读者登录与预约能力必须逐机构核验，不应从网页可访问推导出可批量抓取。

证据必须固定为三层：

| 证据级别 | 能说的话 | 不能说的话 |
|---|---|---|
| `nearby_only` | “附近有这家图书馆” | “这家馆有这本书” |
| `catalog_holding` | “目录记录显示该馆收藏此作品/版本” | “现在可借” |
| `realtime_circulation` | “供应商在某时间报告可借/借出/可预约” | “到馆时一定仍可借” |

### 3.3 实时价格与购买

| 来源 | 能力 | 开放现实 | 建议 |
|---|---|---|---|
| Google Books `saleInfo` | 国家相关的售卖状态、list/retail price、buy link（若提供） | 字段不保证存在，覆盖与国家相关 | 作为发现源，不宣称全网比价 |
| 出版社直销 | 精确版本和定价 | 很少有统一开放 API | 重点出版社合作或深链 |
| 零售商 API | 当前报价、库存、购买链接 | 多数需要开发者/商业/联盟资质 | 按国家建立 provider adapter |
| Affiliate Feed/API | 多商家报价和链接 | 合同、佣金、刷新频率与地区限制 | 明示联盟关系，佣金不参与排序 |
| Marketplace API | 新旧书、卖家和品相 | 授权、地区和调用限制 | 品相分组，不能与新书直接混排 |
| 搜索结果/网页深链 | 发现购买入口 | 不等于结构化、可缓存的实时价格 | 只作为用户自行核验入口 |

没有完整、开放、实时的“全球最低书价”数据库。Amazon 等平台的开发者/联盟接口也不应被当成永远开放的公共基础设施；其旧 PA-API 已有弃用迁移安排，接入前必须重新核验 Creators API 等当前政策。

平台只能承诺：

> 在本次查询覆盖的供应商、地区、版本、品相和可比总价范围内，价格最低的可比报价是……

不能承诺：

> 这是全球最低价。

## 4. 到底哪些数据需要自己做

### 4.1 必须由 BookMate 建设

这些是项目真正的数据资产，也是可以合法开源的核心：

1. 统一 `Work / Edition / Holding / Offer` 契约。
2. ISBN、OCLC、LCCN、DOI、供应商 ID 的交叉映射。
3. 标题、作者、译者、语言、出版社和版本的实体合并规则。
4. Provider Adapter 接口与字段映射。
5. 每条结果的 `provider_id / source_url / observed_at / expires_at / license`。
6. 数据质量分、版本匹配分、证据等级和冲突保留机制。
7. 按国家、供应商和数据类型计算的 Coverage Report。
8. 搜索策略、用户授权、写操作确认和隐私边界。
9. 用户自带 EPUB/PDF 的本地索引；索引与原文件默认不上传。

### 4.2 不应自行人工维护

1. 全球商家的实时价格表。
2. 全球图书馆每册书的当前借阅状态。
3. 未获许可的版权书全文。
4. 通过规避条款或反爬措施得到的零售商/图书馆页面镜像。
5. 把第三方受限数据库重新打包成开源数据集。

### 4.3 可以选择性缓存

- 作品与版本元数据：按来源条款使用数天至数月 TTL。
- 目录馆藏：建议先以 24 小时 TTL 起步。
- 实时流通：建议 1–10 分钟 TTL，最终以机构政策为准。
- 实时报价：建议 5–30 分钟 TTL，最终以供应商/联盟条款为准。
- 用户位置：优先只在请求期内使用城市、邮编或粗粒度坐标，不默认长期保存完整地址。

“可缓存多久”和“能否向第三方再展示”必须按每个 provider 配置，不能只依赖统一技术默认值。

## 5. 标准化 Skill 与 MCP 的职责分工

只提供 MCP 不够灵活，因为 MCP 解决“有什么工具可调用”，不完整解决“何时调用、如何判断证据、怎样向用户解释”。只提供 Skill 也不够，因为 Skill 本身不是全球数据接口。

推荐三层：

```text
Skill（工作流、判断、表达与安全边界）
  -> MCP Tools（稳定、厂商中立的工具契约）
    -> Provider Adapters（Google Books、OSM、WorldCat、Koha、零售商等）
```

当前已经生成两个标准化 Skill：

- `packages/agent-kit/skills/find-library-books`
- `packages/agent-kit/skills/compare-book-prices`

每个 Skill 包含：

- `SKILL.md`：触发场景、执行步骤、证据与安全规则。
- `references/contracts.md`：供应商无关的标准结果结构。
- `references/providers.md`：开放/授权边界与 provider 选择。
- `scripts/validate_*.py`：零依赖的本地数据校验、去重、分组和排序。
- `agents/openai.yaml`：Agent 客户端展示与默认提示元数据。

Skill 不绑定 BookMate 官方服务，即使用户不使用托管网页端，也可以把它和自己配置的 MCP、脚本或本地图书馆接口组合使用。

## 6. MCP 工具建议

### 6.1 公共工具

| Tool | 输入重点 | 输出重点 | 是否写操作 |
|---|---|---|---|
| `books.resolve_edition` | 标题/作者/ISBN/语言/译者 | Work、Edition 候选与匹配等级 | 否 |
| `providers.coverage` | 国家、能力、格式 | 可查询/不可用 provider 与原因 | 否 |
| `locations.resolve` | 城市/邮编/经用户同意的坐标 | 粗粒度地理边界 | 否 |

### 6.2 图书馆工具

| Tool | 用途 |
|---|---|
| `libraries.nearby` | 查找附近分馆，只返回 `nearby_only` |
| `libraries.search_holdings` | 查询目录馆藏，至少返回 `catalog_holding` |
| `libraries.check_availability` | 查询流通状态，成功时返回 `realtime_circulation` |
| `libraries.get_actions` | 返回目录、导航、联系、预约或借阅入口 |
| `libraries.place_hold` | 预约写操作；必须由宿主进行明确确认和认证 |

### 6.3 价格工具

| Tool | 用途 |
|---|---|
| `prices.search_offers` | 按 ISBN、地区、币种、格式和品相查询报价 |
| `prices.normalize_offer` | 将 provider 结果映射到标准 Offer |
| `prices.compare` | 只在同一可比组内按到手总价排序 |
| `prices.get_buy_action` | 返回购买链接和联盟声明 |
| `prices.checkout` | 第一阶段不提供；未来也必须显式确认并由商家完成 |

工具返回必须包含覆盖信息，而不只是结果数组：

```json
{
  "queried_providers": ["provider-a", "provider-b"],
  "unavailable_providers": [
    {"id": "provider-c", "reason": "credential_missing"}
  ],
  "region": "CN",
  "observed_at": "2026-08-17T10:00:00Z",
  "results": []
}
```

这样“0 条结果”才能被正确解释为覆盖范围内未发现，而不是全球不存在。

## 7. 数据平台架构

### 7.1 在线请求链路

```text
用户问题
  -> 意图与动态性判断
  -> 联网策略 off / ask / auto
  -> 版本解析
  -> Capability Router
  -> 并发 Provider Adapters
  -> 标准化 + 合同校验
  -> 实体合并 + 证据/可比性分组
  -> 带来源、时间与覆盖边界的答案
```

ReAct 只应用于多步外部任务，例如“识别版本 -> 找附近馆 -> 查馆藏 -> 查实时状态”。一本已知书的思想交流不需要每轮都运行 Agent 循环；否则延迟、成本和工具噪声会破坏心流。

### 7.2 建议服务

| 服务 | 责任 |
|---|---|
| Metadata Service | Work/Edition 解析、标识映射和封面元数据 |
| Provider Registry | provider 能力、地区、凭据、许可、TTL 和健康状态 |
| Library Gateway | 附近馆、目录和流通适配器 |
| Price Gateway | 地区化报价、品相、运费税费和联盟声明 |
| Provenance Store | 原始来源引用、观察时间、映射版本和冲突 |
| Coverage Service | 查询覆盖率、失败率、国家和格式缺口 |
| Companion Orchestrator | Role、记忆、搜索策略、Skill 与回答组织 |

### 7.3 存储建议

- PostgreSQL：Work、Edition、Identifier、Provider、来源与用户配置。
- pgvector 或独立向量库：用户合法提供的全文/笔记块和语义召回。
- Redis：短 TTL 流通状态、报价、限流和请求去重。
- 对象存储：允许保存的封面、用户私有原文件和处理产物；按租户隔离。
- OpenTelemetry：provider 延迟、失败、命中率、费用和端到端追踪。

不要把第三方 API 原始返回无限期落库。每个 provider 必须配置 `storage_allowed`、`display_allowed`、`max_ttl`、`attribution` 和 `deletion_policy`。

## 8. 质量、排序与可信回答

### 8.1 图书馆排序

排序优先级：

1. 证据等级：实时流通 > 目录馆藏 > 附近分馆。
2. 版本匹配：精确版本 > 同一作品其他版本 > 未核验。
3. 行动性：可借/电子书可借 > 可预约 > 已借出 > 未知。
4. 距离。
5. 新鲜度。

距离不能覆盖证据：500 米外的“附近分馆”不能排在 2 公里外的“当前可借”前面并让用户误解。

### 8.2 价格排序

只有以下字段相容时才进入同一可比组：

- 精确版本或用户明确允许的版本范围。
- 目的地国家/地区。
- 币种，或显式提供汇率来源、汇率和时间。
- 购买/租赁/订阅类型。
- 新书、二手品相或数字格式。
- 到手总价的完整度。

运费或税费未知的报价单独展示，不能仅因为商品标价低就排名第一。联盟佣金绝不进入排序分。

### 8.3 关键指标

- `edition_exact_match_rate`
- `holding_evidence_distribution`
- `realtime_availability_hit_rate`
- `offer_landed_total_completeness`
- `provider_success_rate / p95_latency / stale_rate`
- `zero_result_with_coverage_rate`
- 用户点击目录后确认“确有馆藏/可借”的比例
- 用户点击报价后确认“版本和总价一致”的比例

## 9. 隐私、版权与商业边界

1. 位置：默认使用城市/邮编；精确定位需请求授权，并设置短生命周期。
2. 借阅账户：读者证、借阅史和预约记录属于高敏感个人数据，不进入普通对话记忆。
3. 写操作：预约、借出、下单、订阅和付款必须二次确认。
4. 全文：版权书以用户自带或正式授权为前提；开放仓库只包含连接器和索引工具。
5. 引文：从模型记忆生成的文字不能伪装成原文；精确引文必须可定位到合法来源。
6. 商业：购买链接必须披露联盟关系；思想推荐和价格排序分开，避免“佣金更高所以推荐”。
7. 数据许可：OSM 等开放数据仍有署名/衍生数据库义务；“开放访问”不等于“无许可要求”。

## 10. 分阶段落地路线

### Phase 0：契约与演示（当前）

- 完成 Library/Price 两个 Skill、标准契约和校验器。
- 完成 `general_companion / book_room` 双模式。
- 完成 `off / ask / auto` 搜索策略和动态意图路由。
- 使用模拟 provider 数据验证 UI、证据标签和错误表达。

### Phase 1：中国单城市 + 全球元数据

- Open Library/Wikidata/Google Books/LoC 多源版本解析。
- OSM 附近图书馆位置。
- 选择一个有明确许可的城市图书馆 OPAC/SRU/ILS 试点。
- Google Books saleInfo + 1–2 个正式零售/联盟 provider。
- 先提供目录/购买深链，实时可借与完整到手价按能力渐进增强。

### Phase 2：用户自配置与开源 Agent Kit

- MCP Server 暴露标准工具。
- 用户可配置自己的 Koha/FOLIO/SRU、Google key 和商业 provider 凭据。
- Provider Registry 与健康/覆盖报告。
- 本地 EPUB/PDF/SQLite 适配器。

### Phase 3：地区伙伴网络

- 按国家/地区增加联合目录、数字借阅和零售合作。
- 对实时 availability/offer 建立 SLA 与缓存策略。
- 支持预约深链；谨慎引入带确认的写操作。

### Phase 4：全球化而非“全球完整”

- 用覆盖地图明确哪些国家、格式和供应商可用。
- 提供社区 adapter SDK 与合规测试套件。
- 重点优化高需求市场，不以虚假的全球覆盖率为目标。

## 11. 构建还是购买

| 能力 | 建议 | 原因 |
|---|---|---|
| Work/Edition 统一模型 | 自建并开源 | 是跨 provider 的核心差异化资产 |
| 开放元数据聚合 | 自建适配器 | 成本可控，避免单源锁定 |
| 全球联合馆藏 | 先开放源，规模后采购/合作 | 自己重建成本极高且实时性不足 |
| 单馆实时流通 | 与机构/API 直连 | 只有源系统最可信 |
| 全球价格 | 多 provider 合作 | 不存在可合法复制的完整开放库 |
| 地址与距离 | OSM/商业地理服务可插拔 | 覆盖、配额和许可需要可替换 |
| 用户全文 RAG | 本地优先自建 | 隐私、版权和用户控制更重要 |

最终应把“数据覆盖”当作产品能力本身：诚实展示查了哪些源、哪些源暂不可用、数据是什么时间看到的。对一个以“深度交心”为核心的书友产品，可信赖比假装无所不知更重要。

## 12. 已核验的官方入口

- Google Books API：https://developers.google.com/books/docs/v1/using
- OCLC WorldCat Search API：https://www.oclc.org/developer/api/oclc-apis/worldcat-search-api.en.html
- OverDrive Developer Portal：https://developer.overdrive.com/
- OpenStreetMap 版权与 ODbL：https://www.openstreetmap.org/copyright
- Overpass API：https://wiki.openstreetmap.org/wiki/Overpass_API
- Koha REST API：https://api.koha-community.org/
- FOLIO 文档：https://docs.folio.org/docs/platform-essentials/
- SRU/CQL：https://www.loc.gov/standards/sru/
- Wikidata Data Access：https://www.wikidata.org/wiki/Wikidata:Data_access
- Crossref REST API：https://www.crossref.org/documentation/retrieve-metadata/rest-api/
- Amazon PA-API 弃用说明：https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation

本次环境中 Open Library 与 Project Gutenberg 官方页面未能稳定连接；其具体 API、导出、频率和许可条款应在实际接入前重新核验。Codex Skills/MCP 官方页面在本次网络环境返回 403，因此当前 Skill 目录已按本地 `skill-creator` 规范生成并校验，但发布前仍应在目标客户端和当时版本的官方文档上复测兼容性。
