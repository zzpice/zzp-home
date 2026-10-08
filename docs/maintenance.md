# 维护与发布

## 日常修改

导航使用网页右上角「管理导航」。网站和分类有稳定 ID；拖动手柄排序，也可用上下移动按钮。删除非空分类时必须选择接收分类，网站会保留。网站支持备用网址、置顶和文字回退。共享外观在编辑器中修改，顶栏主题仅为本机覆盖。

修改会自动保存到本机 IndexedDB，包括尚未点击「应用」的表单；状态栏明确显示保存结果。刷新后重新打开编辑器可选择恢复，其他标签页的草稿独立保留。存储失败时及时导出；未发布草稿不会自动跨设备同步。预览只影响当前页面，正式数据仍来自 GitHub。

导入导出使用 schemaVersion 1 的导航 JSON。SunPanel 格式须先在本地迁移。S-UI 与 Sub-Store 使用用户批准的完整原始入口；GitHub Token、密码和其他未批准凭据不得写入配置或草稿，原始导出不提交。

## 网页发布

1. 在 GitHub 创建 fine-grained PAT，Resource owner 选有权限的账号，仅授权 zzpice/zzp-home，Contents 与 Pull requests 设为 Read and write，使用适当的有效期。组织审批、SSO 和规则限制仍按 GitHub 要求执行。
2. 编辑器点击「提交到 GitHub」，临时输入 Token。它只发给 api.github.com，不保存在浏览器存储、草稿、配置或日志；操作结束销毁内存引用。
3. 程序先检查实际仓库 push 权限，再读取 main 的精确配置版本。没有变化时直接报告已在 main；基线变化时停止写入，提供合并或从云端重新开始。
4. 独立 `nav/edit-<UUID>` 分支只提交 data/navigation.json，并创建 PR。打开 GitHub 核对差异、检查结果和分支规则后合并。程序不自动合并，不修改工作流，不绕过保护。
5. 等待 main 的 Pages Actions 成功。其他设备点击页脚「检查更新」，待完整新版准备好后切换；打开期间仍显示原完整版本。PR 创建成功不代表已上线。

认证失败会显示 401；403 可能来自仓库权限、Token 范围、组织审批、限流或分支规则；404 也可能是授权范围不足，不能直接认定仓库不存在。网络中断时草稿与无凭据发布进度保留，重新输入 Token 可继续。提交响应丢失后先读取同一分支配置，PR 响应丢失后先查询已有 PR，避免重复写入。

冲突采用三方合并：不重叠字段可组合；同字段、删除与编辑、竞争排序或移动会列出路径。无法自动解决时导出当前草稿，再在 GitHub 核对，或「从云端重新开始」；旧草稿会另存。已关闭但未合并的 PR 不会被自动重新打开，可以保留草稿、修改后创建新申请，或在 GitHub 处理原 PR。

分支保护要求审批或状态检查时照常等待；仓库规则禁止创建编辑分支时发布会失败并保留草稿，应在 GitHub 处理权限或规则。检查 / 构建 / 部署失败时，查看 Actions 日志，修复后重跑；不会把失败状态报告为发布完成。

## 数据维护

直接编辑 data/navigation.json 也可以，但须在独立分支执行 `go run ./cmd/zzp-home validate`、构建和相关测试。不要修改数组 ID 来表示排序；移动数组项即可。项目入口、说明和预览在 data/projects.json 维护。

首次迁移命令会重建导航，**不要在日常编辑后直接重跑覆盖新配置**。可在临时 checkout 中核对历史迁移：

```sh
go run ./cmd/zzp-home migrate -input /path/to/export.sun-panel.json -uploads /path/to/uploads.zip
```

迁移读取 data/icon-aliases.json，生成脱敏导航和 docs/migration-audit.json；uploads 只核对原路径是否存在，不自动选图或公开压缩包。当前分类规则针对已审查的原导出，新分类会停止并要求维护者审查。凭据检查覆盖常见形式，不保证识别任意秘密随机路径，新增入口仍需人工核对。

链接复查：

```sh
go run ./cmd/zzp-home check-links -out docs/link-audit.json
```

它不请求普通内网 IP，只对公开地址做限时 HEAD。认证、反爬、TLS、超时和非标准状态码不能作为自动删站依据。

## 图标维护

先按 assets 的 icons/README.md、SOURCES.md 和 scripts/README.md 增加 / 替换图标，运行其生成器及检查。在资源库提交并推送后刷新索引：

```sh
go run ./cmd/zzp-home icons -assets ../assets
go run ./cmd/zzp-home validate
go run ./cmd/zzp-home build -assets ../assets
```

索引固定资源库提交和 SHA-256，当前网站不会在每次访问时追踪 main。确保该提交可公开下载；合并资源 PR 时保留已引用提交，不删除其可达历史。资源原图只维护一份；构建再生图集，网页编辑器使用同一索引。新图标在索引刷新并部署后才会出现在选择器里。

## 缓存与故障恢复

完整缓存安装后可离线浏览首页、项目页、搜索与编辑；外部网站仍需相应网络。缓存更新保留整个版本，不实时拼接 GitHub 配置。新版完整下载后提示更新，其他打开标签页有编辑时会拒绝切换；先保存 / 导出，关闭相应编辑页后再更新。关闭所有旧页后浏览器也可自然激活新版。重要草稿先导出，浏览器存储可能被用户或系统清理。

页脚「缓存恢复」清理本导航的 Worker 与 zzp-home-shell-* 缓存，保留 IndexedDB、主题偏好和其他产品缓存。联网后重新打开即可；若恢复页自身无法加载，可在浏览器站点设置中只移除该 Worker / Cache Storage，谨慎避免清除 IndexedDB 草稿。

代码回滚使用 Git revert 和原 Pages 工作流重新部署，保留域名 / HTTPS 设置。不改为直接发布仓库根目录，那里是源码而非构建产物。其他项目继续使用原地址和各自缓存。

## 检查与发布边界

README 列出本地命令，CI 用 Go、Node 单元测试和 Chromium / WebKit 检查实际 build/pages。修改数据、网页、构建器或缓存逻辑都需要重新构建；缓存升级测试会生成一个真实的第二版本并验证完整性失败、更新协调和草稿恢复。

真机 iOS / Android 安装、生产 Token 的网页发布、真实保护规则拒绝和人工合并后的生产部署需要在上线时核实，不能以模拟 API 通过代替。当前独立分支 / PR 检查不部署 main。
