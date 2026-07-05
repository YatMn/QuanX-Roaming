# QuanX-Roaming 新手模块化方案设计

日期：2026-07-05

## 目标

设计一套适合新手使用的 QuanX-Roaming 分发方案：用户可以安全地添加自己的节点订阅，同时继续从 GitHub 获取规则和 rewrite 的持续更新。

项目不应再把 GitHub Raw 的完整配置描述成长期工作配置。我们已经在 Quantumult X 中验证：完整配置一旦处于远程关联状态，就不能通过资源页面或官方 `add-resource` URL Scheme 追加 `server_remote` 节点资源。

## 决策

采用模块化模型：

- 用户自己的本地或 iCloud 配置：日常使用的可编辑主配置。
- GitHub 托管的资源模块：公开规则和 rewrite 模块，通过 `filter_remote` 和 `rewrite_remote` 持续更新。
- GitHub 托管的完整配置文件：安装模板，而不是用户长期远程关联使用的主配置。

新手流程保持简单：

1. 下载或导入配置模板。
2. 保存或复制为本地 / iCloud 配置。
3. 在 Quantumult X 中添加自己的私有节点订阅。
4. 让公开 filter 和 rewrite 资源从 GitHub 自动更新。
5. 只有框架配置变化时，才按 changelog 手动升级。

## 非目标

- 不为新手支持 Git、fork、upstream merge 或生成式 overlay 工作流。
- 不要求用户在常规安装过程中编辑原始配置文本。
- 不发布节点订阅、服务商名称、token 或私有节点细节。
- 不承诺 GitHub Raw 远程关联的完整配置可以被编辑或追加节点资源。
- 不把稳定框架拆得过碎，避免新手排查问题时更难理解。

## 仓库结构

目标公开结构：

```text
profiles/
  QuanX-Roaming.conf

resources/
  filters/
    core.list
    ai.list
    apps.list
    media.list
    finance.list
  rewrites/
    core.conf
    optional.conf

docs/
  install.md
  update.md
  changelog.md
```

`profiles/QuanX-Roaming.conf` 保持为新手安装模板。README 应明确说明：用户需要把它保存为本地或 iCloud 配置后，再添加自己的节点。

`resources/filters/*.list` 和 `resources/rewrites/*.conf` 是公开、无敏感信息的模块，由模板配置通过 GitHub Raw URL 引用。

## 配置边界

这些内容保留在用户可编辑的模板配置中：

- `[general]`
- `[task_local]`
- `[server_local]`
- `[server_remote]` 空区块和用户添加节点的提示
- `[dns]`
- `[policy]`
- 最终 fallback 规则
- 少量必须贴近 fallback 行为的紧急本地规则

这些内容移动或聚合到 GitHub 托管资源中：

- AI 分流规则
- Google、YouTube、Telegram、社交和 App 类分流规则
- 媒体和流媒体分流规则
- 金融支付分流规则
- 默认启用的低风险 rewrite 资源
- 可选 / 高风险 rewrite 资源

`[policy]` 里的策略组名称是公开模块依赖的接口契约。远程 filter 模块只能引用模板中稳定存在的策略组，例如 `AI`、`Google`、`YouTube`、`Telegram`、`Netflix`、`国际媒体`、`金融支付`、`广告拦截`、`兜底分流`。

## 用户流程

README 应只主推一条推荐路径：

1. 获取最新版 `profiles/QuanX-Roaming.conf` 模板。
2. 在 Quantumult X 中保存或复制为本地 / iCloud 配置。
3. 切换到这个本地 / iCloud 配置。
4. 添加用户自己的节点订阅。
5. 更新节点资源。
6. 确认地区节点组和 App 策略组能看到可用节点。

README 可以保留 Raw 链接，但必须说明：把 Raw 链接作为远程关联配置更适合预览或下载模板，不是推荐的长期工作方式。原因是我们已验证远程关联配置无法追加节点资源。

## 更新模型

更新分成两类。

自动资源更新：

- `resources/filters/` 下的 filter 模块
- `resources/rewrites/` 下的 rewrite 模块
- 不改策略组名称、不改框架结构的规则变化

手动框架更新：

- 策略组变化
- 地区节点组变化
- DNS、MITM、fallback 或 server 区块变化
- 任何要求用户替换或编辑本地 / iCloud 模板的变化

`docs/changelog.md` 应区分“资源更新”和“框架更新”。框架更新需要给已有用户一段短迁移说明。

## 错误处理

预期问题和文档响应：

- 没有节点出现：先在本地 / iCloud 配置中添加节点订阅，再更新节点资源。
- 无法添加节点订阅：确认当前配置是本地或 iCloud 配置，而不是 GitHub Raw 远程关联配置。
- 规则更新了，但新策略组不存在：本地框架配置过旧，需要应用最新版模板或按 changelog 迁移。
- 某个 App 路由异常：先检查对应 App 策略组，再检查地区节点组，最后检查 rewrite 资源。
- 支付或银行 App 异常：先把 `金融支付` 切到 `direct`；在修改大范围路由前，先关闭高风险 rewrite 模块排查。

## 验证要求

发布模块化变更前：

- 确认每个 `force-policy` 目标都存在于模板 `[policy]` 区块中。
- 确认金融规则仍路由到 `金融支付`，并且位于宽泛代理规则之前。
- 确认地区节点组继续排除订阅信息节点，例如流量、到期、重置、URL、通知类节点。
- 确认没有私有 `.conf`、订阅 URL、token、服务商名称或节点细节被暂存。
- 重新阅读改动过的文档，确认没有违背已验证的远程关联配置行为。

现有验证脚本继续覆盖模板配置：

- `.superpowers/sdd/validate-region-policy.sh profiles/QuanX-Roaming.conf`
- `.superpowers/sdd/validate-finance-button.sh profiles/QuanX-Roaming.conf`
- `.superpowers/sdd/validate-finance-egress.sh profiles/QuanX-Roaming.conf`

后续实施时应新增模块化资源检查：

- 被引用的远程资源文件必须存在。
- 资源模块中的 `force-policy` 值必须匹配模板策略组。
- `.gitignore` 只允许预期公开模块进入 Git，同时继续忽略私有配置。

## 实施注意事项

当前 `.gitignore` 会忽略除 `profiles/QuanX-Roaming.conf` 以外的所有 `.conf` 文件。实施时必须二选一：

- 如果 Quantumult X 接受，公开模块优先使用非 `.conf` 扩展名；或
- 显式放开特定公开资源路径，例如 `resources/rewrites/*.conf`。

在更新 ignore 规则并确认文件不含秘密信息之前，不要强制添加被忽略的文件。
