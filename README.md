# BookMate / 泊舟

[English README](README.en.md)

BookMate 是一个本地优先、模型可替换、数据可迁移的个人 AI 书友。它面向已经读过一本书、希望继续交流思想的人；不是摘要生成器，也不要求先搭建复杂 RAG 基础设施。

本项目采用非商业源代码可用许可：个人、教育、研究与其他非商业用途可使用、修改和分发；商业使用必须另行获得书面授权。详情见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。由于包含非商业限制，它不是 OSI 定义下的开源许可证。

默认能力：

- 一个稳定、透明、不冒充真人的 AI 书友“泊舟”；
- “广泛书友 / 本书房间”双模式；
- “不联网 / 需要时先问 / 动态问题自动查”策略；
- 多个 OpenAI Chat Completions 兼容模型和 Responses 模型的本地配置档；可在聊天中按轮次切换；
- 个人书架：书目独立于文件，可标记想读、在读、已读或暂搁，并绑定多个版本、笔记和资料；
- 无全文书房：保存阅读进度、剧透边界、交流姿态、摘录、读后感和问题；
- TXT、Markdown、PDF、EPUB 本地上传、解析、检索、重新归档和删除；
- SQLite、本地文件和单一数据目录；
- 本地会话恢复，以及全局、单书、会话三层的用户确认记忆；
- 对话、记忆和书库元数据 JSON 导出；
- 一个容器、一个端口，不需要 PostgreSQL、Redis 或向量数据库。

## 五分钟启动

### Windows 一键启动

已安装 Python 3.11+ 和 Node.js 22+ 时，双击 `start-local.cmd`，或运行：

```powershell
.\start-local.ps1
```

脚本会创建项目自己的 `.venv`、构建网页并在 `http://localhost:8000` 启动。个人数据仍保存在 `./data`。

### Docker 启动

需要安装 Docker Desktop 或兼容的 Docker Compose。

```powershell
docker compose up --build
```

打开 `http://localhost:8000`：

1. 在左下角“偏好与模型设置”的“模型连接”中填写名称、Base URL、模型 ID 和可选 API Key；这里也可设置仅影响本地界面显示的用户称呼；
2. 保存后测试连接；聊天输入框上方可按轮次选择已保存的模型；
3. 点击右上角“本地书库”，先将一本书加入“我的书架”（实体书、阅读 App 中读过的书也可以）；
4. 选择书目，设置读到哪里、剧透边界和希望书友如何陪你聊；
5. 粘贴一段摘录、写一句读后感，或上传自己合法持有的 TXT、Markdown、PDF、EPUB；
6. 进入本书房间。

个人数据保存在 `./data`。删除或升级容器不会删除这个目录；迁移时备份整个目录即可。

## 模型接口

BookMate 使用两个最小文本适配器：

- `chat_completions`：Base URL 下的 `/chat/completions`；
- `responses`：Base URL 下的 `/responses`。

Base URL 一般包含 `/v1`，例如 `http://host.docker.internal:11434/v1`。如果模型服务运行在宿主电脑上，容器中不要使用 `127.0.0.1`，因为它会指向 BookMate 容器自身；Windows/macOS/Linux Compose 均已配置 `host.docker.internal`。

“OpenAI-compatible”并不是所有第三方都完整实现的统一认证标准。BookMate 首版只依赖模型名、文本输入和非流式文本输出；保存后应使用“测试连接”验证实际兼容性。OpenAI Docs 在当前开发网络返回 403，发布前需要在可访问环境重新核对当时的官方 Responses 和 Chat Completions 字段。

也可以通过环境变量配置，环境变量优先于网页中保存的值：

```powershell
Copy-Item .env.example .env
# 编辑 .env 后：
docker compose up --build
```

Windows `start-local.ps1` 同样会读取 `.env` 中的上述白名单变量，且不会打印其值。脚本只接受 BookMate 配置字段，不会执行 `.env` 里的任意命令。

API Key 不会通过设置 API 回显。网页保存的密钥位于本地 `data/bookmate.db`；如果电脑有多人账户或数据目录会被同步，优先使用环境变量或系统秘密管理工具。用户称呼只用于本地界面标签，不会自动成为泊舟的长期记忆，也不会自动发送给模型服务。

## 本地知识库

上传流程完全在 BookMate API 进程中执行：

- TXT/Markdown：UTF-8、GB18030 等常见文本编码；
- PDF：按页提取可读取文本，扫描件首版不会自动 OCR；
- EPUB：按 spine 顺序读取 XHTML，并限制条目数和展开大小；
- 文本分块与零配置字符/关键词检索保存在 SQLite。

“书”是稳定的个人书目，文件只是它的一个版本、笔记或辅助资料。一份资料可以在网页中重新归入另一部作品，或改回未归档；从书架移除书目只会解除关联，不会删除文件。只有选择某份本地文档并在“本书房间”聊天时，相关片段才进入模型上下文。文件留在本地不代表片段永远不离开电脑：如果使用远程模型，相关片段会发送给用户配置的模型服务。

### 没有电子书，也能开始

选择书架中的作品后，可以直接保存：

- `摘录`：原文和可选的页码、章节或位置；
- `读后感`：自己的理解、认同、反对或情绪；
- `想继续问`：暂时没有答案的问题。

这些内容会以“读者阅读痕迹”进入当前书房，而不是被当成模型已经核验过的完整原文。书房还会保存阅读进度、剧透边界和交流姿态（慢慢探索、认真较真、整理线索、准备读书会）。即使没有上传文件，也能开始长期对话；如果使用远程模型，相关阅读痕迹也可能被发送给该模型服务。

首版没有强制 embedding。个人书库可以先依靠简单检索和模型长上下文；后续再按需增加 OpenAI-compatible embeddings、混合检索和 reranker。

## 对话与记忆

每次聊天都会保存到本机 SQLite，可从右上角“我们记得的事”恢复旧对话。泊舟可以提出一条简短记忆候选，但不会自动把候选当作长期事实：只有用户点击确认后，它才会按以下范围参与后续对话。

- `跨书线索`：适合阅读偏好和长期讨论方式；
- `本书线索`：只用于当前作品或上传资料；
- `仅此会话`：只在当前对话中保留。

用户可以随时删除单条记忆、删除整段对话，或导出会话、记忆和书库元数据。导出不包含原始书籍文件和 API Key。

## 本地开发

### API

```powershell
cd services/api
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
.\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

API 文档：`http://localhost:8000/docs`。

### Web

另开终端：

```powershell
cd apps/web
npm install
npm run dev
```

开发页面：`http://localhost:3000`。未设置 `NEXT_PUBLIC_API_BASE_URL` 时，开发页面连接 `http://localhost:8000`。

### 测试

```powershell
cd services/api
python -m pytest

cd ..\..\apps\web
npm run build
npm audit --omit=dev
```

## 数据和隐私边界

- 服务通过 Compose 默认只映射到本机 `127.0.0.1:8000`，不要直接暴露公网。
- 原始文件使用内部 ID 保存，不能用上传文件名构造磁盘路径。
- 默认最大上传 50 MB，可用 `BOOKMATE_MAX_UPLOAD_MB` 调整。
- 删除文档会删除 BookMate 保存的文件副本、文本块和索引。
- 删除一段对话会删除该会话消息和关联记忆；界面会明确要求确认。
- 版权书以用户自己合法拥有和私人使用为前提；仓库不分发版权全文。
- 图书馆、价格和网页搜索是可选 Skill/连接器，不影响完全离线的基本交流。

详细架构见 `docs/AI书友平台_本地优先开源架构方案.md`；全球数据边界见 `docs/AI书友平台_全球书目馆藏与价格数据方案.md`；仓库边界和开发约定见 `docs/REPOSITORY.md`。

## License And Governance

- [LICENSE](LICENSE): PolyForm Noncommercial License 1.0.0; commercial use requires a separate written license.
- [NOTICE](NOTICE): required copyright and data-distribution notices.
- [CONTRIBUTING.md](CONTRIBUTING.md): development checks and contribution boundaries.
- [AGENTS.md](AGENTS.md): durable project memory and guidance for Codex and other coding agents.
- [SECURITY.md](SECURITY.md): handling for credentials, private reader data, and vulnerabilities.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [GOVERNANCE.md](GOVERNANCE.md): collaboration and maintainer decisions.

## 当前限制

- PDF 扫描件需要后续 OCR 插件。
- 当前零配置检索适合个人书库，不适合数十万文档。
- 书架已支持手动 ISBN、阅读进度、剧透边界和阅读痕迹；相机扫码、封面识别和自动版本匹配仍待实现。
- 阅读 App 的专属导入器、通用标注 CSV / JSON 导入、图片 OCR 和手机分享入口仍待实现。
- 网页资料目前尚未导入；下一步会先做用户主动保存 URL 的来源记录，再考虑受控抓取与搜索连接器。
- MCP Server、embedding、记忆编辑/合并，以及图书馆/价格 provider adapter 是下一阶段。
