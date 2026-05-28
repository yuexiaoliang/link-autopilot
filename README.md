# link-autopilot

全自动外链铺设与反向链接建设 CLI 工具。

## 安装

```bash
npm install -g link-autopilot
```

## 快速开始

```bash
# 1. 进入项目目录（需要包含 .backlink-data/ 目录）
cd your-project

# 2. 配置邮箱域名（用于平台注册）
link-autopilot config email-domain yourdomain.com

# 3. 添加监控域名
link-autopilot add-domain example.com

# 4. 扫描 sitemap
link-autopilot scan

# 5. 查看缺铺情况
link-autopilot domains
link-autopilot list example.com

# 6. 标记铺设完成
link-autopilot done example.com telegra.ph https://example.com/page-a
```

## CLI 命令

### 域名管理

```bash
link-autopilot add-domain <domain>          # 添加监控域名
link-autopilot rm-domain <domain>           # 移除监控域名
link-autopilot domains                      # 列出活跃域名及缺铺统计
link-autopilot scan [domain]                # 扫描 sitemap（省略则扫描所有）
```

### 缺铺查询

```bash
link-autopilot list <domain>                # 列出缺铺的 (URL, 平台) 组合
link-autopilot summary <domain>             # 各平台覆盖统计
link-autopilot platforms <domain>           # 列出已知平台 slug
```

### 状态更新

```bash
link-autopilot done <domain> <platform> <url>...   # 标记 URL 在指定平台铺设完成
```

### 邮箱管理

```bash
link-autopilot config email-domain [domain]        # 配置/查看邮箱域名
link-autopilot email generate <platform>            # 生成平台专属邮箱（自动保存 pending 状态）
link-autopilot email list [platform]                # 列出已生成邮箱及状态
link-autopilot keywords show <domain>               # 查看已缓存的关键词
link-autopilot keywords refresh <domain>            # 刷新域名核心词缓存（URL 缓存保留）
link-autopilot log [YYYY-MM-DD]                     # 查看平台提交日志（省略则为今天）
```

## 目录结构

```
.backlink-data/
├── config.json                     # CLI 全局配置（emailDomain 等）
├── monitored-domains.json          # 监控域名列表
├── accounts.json                   # 平台账号信息（邮箱、用户名、密码、状态）
├── platform-submission-log/        # 各平台按日期拆分的提交记录
│   └── YYYY-MM-DD.json
└── urls/
    └── {domain}.json               # 按域名隔离的 URL 列表及铺设状态
```

## Skill 触发

本项目包含两个 Claude Skill：

| Skill | 触发方式 | 职责 |
|-------|---------|------|
| `link-autopilot` | `/link-autopilot` | 外链铺设（只操作已知平台） |
| `link-explore` | `/link-explore` | 新平台发现、测试、注册 |

## 注册链路

平台注册的完整流程：

1. `link-autopilot email generate <platform>` → 生成邮箱（如 `github-gist-1@yourdomain.com`）
2. 使用生成的邮箱在目标平台注册
3. 验证码邮件经 Cloudflare catch-all 转发到统一收件箱
4. 通过 colonymail 读取验证码并完成验证
5. 注册成功后更新 `accounts.json` 状态为 `active`
