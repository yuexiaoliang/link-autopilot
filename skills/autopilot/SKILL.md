---
name: link-autopilot
description: '全自动外链铺设与反向链接建设。仅当用户消息以 /link-autopilot 开头时激活。触发词：铺设外链、link autopilot、外链建设、海量外链、发布外链。'
metadata:
  author: yuexiaoliang
  version: '1.1.0'
---

# 铺设外链

**触发方式**：用户消息以 `/link-autopilot` 开头时激活。

通过 `link-autopilot list {域名}` 获取 URL 列表及铺设状态，找出缺铺的 (URL, 平台) 组合并执行铺设。

## 重要：必须使用 link-autopilot CLI

**禁止自己编写脚本来查询或操作数据。** 所有数据交互通过 `link-autopilot` CLI 完成。

如果 CLI 不可用，告知用户：
> 请先安装 link-autopilot CLI：`npm install -g link-autopilot`

**CLI 命令：**

```bash
link-autopilot scan [domain]           # 扫描 sitemap（省略则扫描所有）
link-autopilot domains                 # 列出活跃域名及缺铺统计
link-autopilot list <domain>           # 列出缺铺清单
link-autopilot summary <domain>        # 各平台覆盖统计
link-autopilot platforms <domain>      # 列出活跃平台
link-autopilot done <domain> <platform> <url>...  # 标记完成
link-autopilot add-domain <domain>     # 添加监控域名
link-autopilot rm-domain <domain>      # 移除监控域名

# 邮箱管理
link-autopilot config email-domain [domain]  # 配置/查看邮箱域名（如 llmrank.top）
link-autopilot email generate <platform>     # 生成平台专属邮箱（如 github-gist-1@llmrank.top）
link-autopilot email list [platform]         # 列出已生成邮箱
link-autopilot keywords show <domain>         # 查看已缓存的关键词
link-autopilot keywords refresh <domain>      # 刷新域名核心词缓存（URL 缓存保留）
link-autopilot log [YYYY-MM-DD]               # 查看平台提交日志（省略则为今天）
```

## 平台池来源

本 skill **只操作已知活跃平台**，不执行新平台探索。

活跃平台池由 [[link-explore]] 技能维护。铺设前按以下分工读取：

| 文件 | 读取内容 | 不读内容 |
|------|---------|---------|
| `platform-success-rate.md` | 各平台成功率、尝试次数、失败原因、最后尝试日期 | 不读 API 格式、认证方式等技术细节 |
| `lessons/platforms.md` | 各平台 API 格式、认证方式、频率上限、注意事项、不可用平台列表 | 不读统计数据 |

**两个文件各司其职，不重复。** 成功率等统计数据只在 `platform-success-rate.md` 中更新；技术细节和经验教训只在 `lessons/platforms.md` 中更新。

## 执行流程（Agent 全自动）

### 准备阶段：扫描新 URL（必须优先执行）

执行铺设前，先运行 sitemap 扫描，确保 URL 列表为最新：

```bash
link-autopilot scan
```

此命令会自动从 `.backlink-data/monitored-domains.json` 读取所有活跃域名，抓取 sitemap，发现新 URL 并写入 `.backlink-data/urls/{域名}.json`。

### 准备阶段：轮次配额分配

运行以下命令查看所有活跃域名及缺铺统计：

```bash
link-autopilot domains
```

输出会列出每个活跃域名的 URL 总数、已完成数、待铺数和缺铺组合数。

**配额规则**：

不设固定总预算。配额按域名缺铺比例分配，实际执行受**平台日限**约束。

1. 每个活跃域名保底分配 **1 个外链**（确保不被饿死）
2. 扫描后有新 URL 的域名，优先系数 **×1.5**
3. 剩余容量按各域名缺铺比例分配

配额公式：

```
domainQuota = max(1, round(domainNeed / totalNeed × totalCapacity))
```

其中：
- `domainNeed` = 该域名缺铺数 × 新URL系数（1.0 或 1.5）
- `totalNeed` = 所有域名 domainNeed 之和
- `totalCapacity` = 所有活跃平台当日剩余容量之和（由 `platform-submission-log` 计算）

**任务终止条件**：所有活跃平台日限耗尽，或所有域名缺铺清空。

配额计算完成后，按域名轮询方式跨域名执行铺设。

### 准备阶段：执行前检查清单（必须逐项确认）

在开始铺设前，按以下顺序读取记忆并确认：

1. **读取 `lessons/platforms.md`** — 确认各平台 API 格式、认证方式、频率上限、已知坑点
   → 标记为"已确认不可用"的平台，直接跳过
2. **读取 `lessons/rate-limiting.md`** — 确认各平台安全频率
3. **读取 `lessons/content.md`** — 确认已验证有效的文案模式
4. **读取 `lessons/troubleshooting.md`** — 确认常见异常处理方式
5. **读取 `platform-success-rate.md`** — 读取各平台成功率统计
   → 成功率 < 30% 的平台，跳过
   → 成功率 < 70% 的平台，作为备选
   → **技术细节不在此文件中**，如有疑问回到步骤 1 读 `lessons/platforms.md`
6. **执行 `link-autopilot log`** — 查看当日平台提交情况
   → 超过单日上限的平台，本次跳过
7. **执行 `link-autopilot email list`** — 查看已有账号，复用 token/密码
   → 禁止重复注册同一平台的新账号
   → 只在已有账号不可用或需要额外配额时才注册新账号
8. **读取 `index.md`（最近 3 条）** — 了解上次执行概况

### Step 1：读取 URL 与平台覆盖状态

1. **逐域名获取缺铺清单**。对配额分配中涉及的每个域名运行：
   ```bash
   link-autopilot list {域名}
   ```
   命令会读取 `.backlink-data/urls/{域名}.json`，按平台分组输出缺铺的 (URL, 平台) 组合。**不要直接读取 JSON 文件**——文件可能很大，CLI 已为你预处理。
2. **汇总缺铺数据**。将各域名的缺铺清单合并，按"域名配额"截取每个域名的待铺列表：
   - 域名 A 配额 10 → 取该域名缺铺清单前 10 个组合
   - 域名 B 配额 6 → 取该域名缺铺清单前 6 个组合
   - 以此类推
3. 若所有域名缺铺组合数均为 0，记录"所有 URL 已覆盖本轮目标平台，执行结束"，直接归档并退出。
4. 根据策略确定**本轮目标平台列表**（来自 `platform-success-rate.md` 的高成功率平台 + 配额内平台）。
5. **生成锚文本策略**：
   - **读取关键词缓存**：执行 `link-autopilot keywords show {域名}`，若返回非空 JSON 则使用
   - **缓存未命中时抓取**：
     - 抓取目标域名首页，读取 `<title>` 提取品牌词/核心词 → 写入缓存
     - 逐个抓取待铺 URL，读取 `<title>`、`<meta name="description">`、`<h1>` → 写入缓存
   - **缓存写入后复用**：同一 URL 的关键词永久缓存。域名核心词缓存 **30 天**
   - **过期检查流程**：
     1. 执行 `link-autopilot keywords show {域名}` 获取缓存 JSON，检查 `domainUpdatedAt` 字段
     2. 若无 `domainUpdatedAt` 或距今超过 30 天 → 重新抓取首页 → 更新 `domain` 和 `domainUpdatedAt` → 保存文件
     3. 若在 30 天内 → 直接使用缓存中的 `domain` 数据
   - **手动刷新**：网站改版或品牌词变更时，执行 `link-autopilot keywords refresh {域名}` 立即清除 `domain` 和 `domainUpdatedAt`，下次任务自动重新抓取
   - **结合平台调性选择锚文本类型**：
     | 平台类型 | 推荐锚文本 |
     |---------|-----------|
     | 技术/开发者平台（GitHub 等）| 关键词锚文本、纯 URL |
     | 社区/论坛（Reddit 等）| 优先纯 URL，偶尔品牌词 |
     | 内容平台（Medium 等）| 自然融入语境的长尾词 |
     | 通用平台 | 混合使用，避免单一模式 |
   - **保底方案**：纯 URL（`https://example.com/page`）任何平台都安全接受

### Step 2：外链铺设

对汇总后的 (URL, 平台, 域名) 列表，按配额跨域名逐个执行外链铺设。切换域名时重新加载该域名的锚文本策略和 URL 上下文。

#### 策略思考框架

针对每个 URL 独立分析，从**已知活跃平台池**中自主决策最优渠道。

##### 第一步：分析目标

先理解 URL 的本质，再决定去哪里铺：

- **内容类型**：博客文章？产品页？工具/开源项目？本地服务？
- **行业领域**：技术/开发者？电商/消费？教育？本地生活？娱乐？
- **语言/地域**：中文？英文？多语言？主要受众在哪里？
- **锚文本方向**：品牌词？长尾关键词？纯 URL？需自然融入语境？

**关键词与平台一致性要求**：

- 外链铺设的关键词必须与目标域名的主要内容保持一致。例如：目标域名为中文网站，则锚文本应使用中文关键词；目标域名为英文网站，则使用英文关键词。
- 铺设平台的选择应尽量与目标域名语言和受众一致。中文网站优先选择中文平台，英文网站优先选择英文平台。

##### 第二步：评估渠道维度

从以下维度自主筛选最优渠道：

| 维度 | 评估要点 |
| --- | --- |
| **权重传递** | dofollow vs nofollow？页面权威度？是否带 `rel="ugc"` / `rel="sponsored"`？ |
| **审核门槛** | 注册难度？内容审核严格度？是否需要实名/手机号？ |
| **存活周期** | 链接多久会被清理？平台对推广内容的容忍度？ |
| **相关性** | 平台受众与目标内容的匹配度？ |
| **成本** | 是否完全免费？是否需要时间/人力成本？ |
| **可规模化** | 能否快速批量复制？ |

##### 第三步：选择策略方向

根据目标分析结果，自主组合以下方向：

- **内容寄生**：在允许用户生成内容的平台发布高质量文章/帖子，自然植入链接。优先选择权重高、审核松、内容长期存活的位置。
- **社区渗透**：在论坛、问答、讨论区中以有价值回答/评论的形式植入链接。关键是先提供价值，再附带链接。
- **资源投放**：将目标内容包装为可下载资源（PDF、文档、代码仓库、工具），投放到资源聚合平台。
- **媒体曝光**：通过新闻稿、客座博客、PR 等方式获取编辑型外链。
- **资产构建**：利用免费基础设施（GitHub Pages、Vercel 等）搭建卫星站/着陆页，形成可控外链网络。
- **社交裂变**：利用社交平台的传播机制，通过话题、标签、互动扩大内容曝光，获取自然转发带来的间接外链。

##### 第四步：频率感知

Agent 通过浏览器自动化操作（打开网页、填写表单、点击提交），天然具有人工操作的时间间隔。**不设固定的数量上限**，但遵循以下原则：

- **分散铺设**：优先将 URL 分散到不同平台，避免集中轰炸单一平台
- **实时响应**：遇到验证码、封禁提示、人机验证时，立即暂停该平台，切换其他渠道
- **记录感知**：执行 `link-autopilot log` 了解当日已提交情况，作为参考而非硬约束

##### 第五步：动态调整

执行过程中持续评估效果，实时调整：

- 某个平台连续失败？跳过，记录原因，换下一个。
- 发现某个渠道效果特别好？加大投入，复制模式。
- 遇到验证码/封禁/人机验证？尝试绕过或记录后切换渠道，不要卡住不动。
- 目标 URL 的内容属性特殊？创造性地寻找匹配它的 niche 平台（从已知活跃平台池中筛选）。

### Step 3：更新状态

每个 (URL, 平台) 组合铺设成功后，通过 CLI 更新状态：

```bash
link-autopilot done {域名} {平台名} {URL1} {URL2} ...
```

- **铺设成功** → `link-autopilot done` 自动将平台名追加到该 URL 的数组中
- **铺设失败** → 在 `platform-success-rate.md` 更新失败计数和失败原因摘要；**技术细节和异常分析写入 `lessons/troubleshooting.md`，不重复写入 `platform-success-rate.md`**
- **主动跳过** → 不记录，换其他平台继续尝试

外链 URL、日期、失败原因等详情记录在 `.backlink-data/memory/history/{日期}-{时分}.md` 中，不在此文件重复存储。

### Step 4：记忆归档

将铺设结果归档到 `.backlink-data/memory/` 目录。

---

## 记忆清理

**history 文件**：仅保留最近 5 个（按文件名日期排序），任务结束时自动删除更早的文件。关键经验已在任务结束时提炼到 `platform-success-rate.md` 的备注栏中，history 文件只保留近期供审计参考。

---

## 全自动执行宣言

Agent 在本项目中具备以下能力，**不需要人类手动操作**：

1. **浏览器自动化** — 通过 chrome-devtools MCP 打开网页、填写表单、点击按钮、完成人机验证（如需）。
2. **内容生成** — 自动生成符合平台调性的文案、标题、描述，避免被识别为垃圾信息。
3. **账号管理** — 自动记录注册信息、Cookie、Token，维护多平台账号状态。
4. **链接追踪** — 自动记录已发布的外链 URL，生成外链分布报表。
5. **错误恢复** — 遇到验证码、IP 限制、封禁时，自动切换策略或跳过并记录。
6. **结果汇报** — 执行完成后自动生成外链铺设报告，包含 URL 列表、平台分布、预计权重传递效果。

---

## 状态持久化文件

- `.backlink-data/urls/{域名}.json` — **按域名隔离**，单层字典：key = URL，value = 已成功铺设的平台名数组（空数组表示未铺设）
- `.backlink-data/keywords/{域名}.json` — **关键词缓存**。通过 `link-autopilot keywords show {域名}` 读取，禁止 Agent 直接读取文件
- `.backlink-data/config.json` — CLI 全局配置
  - 示例：`{ "emailDomain": "llmrank.top" }`
- `.backlink-data/accounts.json` — 注册账号信息。通过 `link-autopilot email list` 读取，禁止 Agent 直接读取文件
  - 邮箱使用自定义域名 catch-all，由 CLI 自动生成：`{平台名}-{序号}@{配置的域名}`
  - 结构示例：
    ```json
    {
      "github-gist": {
        "accounts": [
          {
            "email": "github-gist-1@llmrank.top",
            "username": "xxx",
            "password": "xxx",
            "status": "active",
            "createdAt": "2026-05-28"
          }
        ]
      }
    }
    ```
- `.backlink-data/platform-submission-log/{YYYY-MM-DD}.json` — 各平台按日期拆分的提交记录（仅记录各平台当日提交次数，用于频率控制）
- `scripts/` — **Agent 自编写脚本目录**。浏览器自动化脚本、批量提交脚本等由 Agent 在执行过程中根据需要自行编写并存入此处
- `tmp/` — **临时文件目录**。执行过程中产生的临时文件（缓存、截图、调试日志、中间 HTML、Cookie 文件等）一律存入此处。该目录已被 `.gitignore` 排除，不会被 git 追踪。

---

## 记忆系统

### 节点格式（插入 `.backlink-data/memory/index.md` 顶部）

```markdown
- **{YYYY-MM-DD HH:mm}** | [blast] | {目标域名} | 铺设{n}个外链，成功{m} | [{status}] | [详情](history/{文件名}.md)
  - 备注：{平台表现、异常、优化建议}
```

### 详细记录文件（`.backlink-data/memory/history/{日期}-{时分}.md`）

**包含内容**：

- 铺设概览（日期、目标域名、待铺设URL数）
- 每个平台的执行详情（账号、内容摘要、外链URL、状态、异常备注）
- 成果统计（尝试/成功/失败平台数、外链总数）
- 外链清单（平台 | URL | 锚文本 | 状态）
- 备注（异常分析 + 优化建议）

### 经验规则库（`.backlink-data/memory/lessons/`）

| 文件 | 内容 |
|------|------|
| `platforms.md` | 各平台特性、API 格式、认证方式、频率上限、已确认不可用平台列表 |
| `content.md` | 验证有效和失败的文案模式 |
| `rate-limiting.md` | 各平台实测安全频率、同平台提交间隔策略 |
| `troubleshooting.md` | 常见异常类型及处理方式 |

**读取优先级**：任务启动时优先读取 `lessons/` 目录，而非从 history 中自己总结。

### 平台成功率记录

维护 `.backlink-data/memory/platform-success-rate.md`，记录各平台的历史表现。格式为每平台独立区块，包含总尝试/成功/失败/成功率、最后尝试日期、尝试记录和**简短备注**。

**记录规则**：

- 每次任务结束时更新此表。
- 成功率 = 成功数 / 总尝试数，保留整数百分比。
- **备注栏只记录统计相关的简短说明**（如失败原因、IP 封禁疑似、服务异常等），**不记录 API 格式、认证方式、字段名等技术细节**——那些写入 `lessons/platforms.md`。
- **优先使用成功率 >= 70% 的平台**，成功率 < 30% 的平台暂时停用，一个月后再试。
- 新平台由 [[link-explore]] 技能验证通过后写入此表，初始标记为"新验证"。

### 记忆流程

1. **任务启动前：扫描新 URL**
   - 执行 `link-autopilot scan`，确保 `.backlink-data/urls/{域名}.json` 为最新状态
2. **任务启动时：读取历史记忆与账号**
   - 读取 `lessons/` 目录（最高优先级）：确认平台状态、频率限制、文案偏好、异常处理
   - 读取 `.backlink-data/memory/platform-success-rate.md`，优先选择成功率高的平台
   - 执行 `link-autopilot email list`，复用已有账号，禁止重复注册
   - 读取 `index.md`（最近 3 条），了解上次执行概况
   - 按当前日期+时分生成文件名（如 `.backlink-data/memory/history/2026-05-14-1430.md`）
2. **执行过程中**：实时写入铺设事件到详情文件
3. **任务结束时**：
   - 完善详情文件中的统计和备注
   - 更新 `.backlink-data/memory/platform-success-rate.md` 中的平台成功率数据
   - 更新 `lessons/` 中如有新经验（API 变更、平台规则调整、新的异常处理）
   - 在 `.backlink-data/memory/index.md` 顶部插入 `[blast]` 类型节点
   - 清理 history 文件（仅保留最近 5 个）
   - history 文件已包含完整执行记录与结果汇总，无需额外报告文件

---

## 输出物

每次执行结束后，Claude 自动生成并保存到项目目录：

- `.backlink-data/memory/index.md` — 更新后的任务索引（blast 铺设节点）
- `.backlink-data/memory/history/{日期}-{时分}.md` — 本次任务的完整执行记录（含策略、明细、统计、优化建议）
- `.backlink-data/memory/platform-success-rate.md` — 各平台成功率统计（持续更新）
- `.backlink-data/memory/lessons/*.md` — 经验规则库（持续更新）
- `.backlink-data/platform-submission-log/{YYYY-MM-DD}.json` — 各平台按日期拆分的提交日志（用于频率控制，持久化文件）

---

## 平台命名规范

所有文件中平台名称统一为 kebab-case slug。

**命名规则**：
- 域名中的点号保留（如 `telegra.ph` → `telegra.ph`）
- 同一服务的不同功能用连字符后缀区分（如 `github.com` 的 Gist 功能 → `github-gist`）
- 遇到新平台时遵循以上规则自行命名，无需询问用户
