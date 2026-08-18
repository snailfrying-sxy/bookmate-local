# BookMate Agent Kit

BookMate Agent Kit 是“个人 AI 书友”的开放能力层。托管网页端可以闭源运营，但这里的 Skill、契约、校验器和未来的 MCP Server 不依赖官方服务，用户可以接入自己的模型、图书文件、图书馆和价格供应商。

## 当前能力

```text
skills/
  find-library-books/   附近分馆、目录馆藏、实时可借与预约边界
  compare-book-prices/  精确版本、地区、币种、运费税费与报价时效
```

每个 Skill 包含工作流 `SKILL.md`、标准结果契约、provider 说明、零依赖 Python 校验器和 `agents/openai.yaml`。Skill 负责“何时查、如何判断和怎样诚实表达”，实际数据由宿主工具、MCP Server 或 provider adapter 提供。

## 本地校验

```powershell
python skills/find-library-books/scripts/validate_holdings.py --self-test
python skills/compare-book-prices/scripts/validate_offers.py --self-test
```

校验真实结果：

```powershell
python skills/find-library-books/scripts/validate_holdings.py holdings.json
python skills/compare-book-prices/scripts/validate_offers.py offers.json
```

## 数据原则

- 不打包或再分发版权书全文。
- 不把附近分馆推断为有馆藏或当前可借。
- 不把商品标价推断为含运费税费后的全球最低价。
- 每条结果保留 provider、来源链接、观察时间、过期时间和覆盖边界。
- 预约、借出、下单和付款是写操作，必须由宿主请求用户确认。

全球数据接入与 Provider Adapter 路线见 `../../docs/AI书友平台_全球书目馆藏与价格数据方案.md`。
