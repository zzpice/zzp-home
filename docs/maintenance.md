# 维护与发布

## 日常修改

导航使用网页右上角「管理导航」。网站和分类有稳定 ID；拖动手柄排序，也可用上下移动按钮。删除非空分类时必须选择接收分类，网站会保留。网站支持备用网址、置顶和文字回退。编辑分类顶部的「全部置顶」可集中拖动、取消置顶或搜索已有网站加入；不改变原分类和分类内顺序。共享外观在编辑器中修改，顶栏主题仅为本机覆盖。

修改会自动保存到本机 IndexedDB，包括尚未点击「应用」的表单；状态栏明确显示保存结果。刷新后重新打开编辑器可选择恢复，其他标签页的草稿独立保留。存储失败时及时导出；未发布草稿不会自动跨设备同步。预览只影响当前页面，正式数据仍来自 GitHub。

导入导出使用 schemaVersion 1 的导航 JSON。SunPanel 格式须先在本地迁移。S-UI 与 Sub-Store 使用用户批准的完整原始入口；GitHub Token、密码和其他未批准凭据不得写入配置或草稿，原始导出不提交。

## 网页保存

1. 在 GitHub 创建 fine-grained PAT，仅授权 zzpice/zzp-home，Contents 设为 Read and write；不需要 Pull requests 权限。
2. 编辑器点击「保存到 GitHub」，临时输入 Token，再点击「保存正式配置」。Token 只发给 api.github.com，操作结束清空，不写入浏览器存储、草稿、配置或日志。
3. 保存先检查仓库 push 权限及 main 的配置文件 SHA，随后只更新 data/navigation.json。GitHub 在写入时再次比较 SHA，其他设备的新配置不会被覆盖；相同内容不重复提交。
4. Actions 自动校验、构建和部署。其他设备在新版准备好后更新；保存成功和部署成功是两个步骤，失败时查看弹窗中的 Actions 链接。

断网时保留草稿，重新输入 Token 即可重试；提交响应丢失后读取 main 内容判断是否已保存，无需维护发布进度、编辑分支或 PR。成功保存会更新本机基线，后续编辑无需等待部署。

版本冲突可合并不重叠字段；重叠修改会列出路径。可导出备份核对，或「从云端重新开始」，原草稿另存。401 是授权失效；403 / 404 可来自权限或授权范围；422 可能来自配置或分支规则。错误不会回显 GitHub 原始响应。

两个仓库的 main 当前允许直接保存，无需调整分支设置；如 GitHub 拒绝写入，按其实际错误处理权限或对应规则，不绕过保护。

## 数据维护

直接编辑 data/navigation.json 也可以，完成后执行 `go run ./cmd/zzp-home validate`、构建和相关测试。网站 / 分类排序移动数组项；置顶使用现有网站上的可选 pinOrder 整数，不复制记录。相关测试通过后直接提交并推送 main，无需创建 PR。项目入口、说明和预览在 data/projects.json 维护。

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

索引固定资源库提交和 SHA-256，当前网站不会在每次访问时追踪 main。确保该提交可公开下载；先推送 assets，再固定其提交、更新并推送 zzp-home。资源原图只维护一份；构建再生图集，网页编辑器使用同一索引。新图标在索引刷新并部署后才会出现在选择器里。

## 缓存与故障恢复

完整缓存安装后可离线浏览首页、项目页、搜索与编辑；外部网站仍需相应网络。缓存更新保留整个版本，不实时拼接 GitHub 配置。新版完整下载后提示更新，其他打开标签页有编辑时会拒绝切换；先保存 / 导出，关闭相应编辑页后再更新。关闭所有旧页后浏览器也可自然激活新版。重要草稿先导出，浏览器存储可能被用户或系统清理。

页脚「缓存恢复」清理本导航的 Worker 与 zzp-home-shell-* 缓存，保留 IndexedDB、主题偏好和其他产品缓存。联网后重新打开即可；若恢复页自身无法加载，可在浏览器站点设置中只移除该 Worker / Cache Storage，谨慎避免清除 IndexedDB 草稿。

代码回滚使用 Git revert 和原 Pages 工作流重新部署，保留域名 / HTTPS 设置。不改为直接发布仓库根目录，那里是源码而非构建产物。其他项目继续使用原地址和各自缓存。

## 检查与发布边界

README 列出本地命令，CI 用 Go、Node 单元测试和 Chromium / WebKit 检查实际 build/pages。修改数据、网页、构建器或缓存逻辑都需要重新构建；缓存升级测试会生成一个真实的第二版本并验证完整性失败、更新协调和草稿恢复。

真机 iOS / Android 安装仍需设备确认；API 错误路径使用模拟测试，不能宣称已修改真实保护规则。生产保存与部署的实际验证见 verification.md。
