# 架构审查与第一版设计（2026-10-08）

审查基线：zzp-home `8e85eb41b9ef7d65209e8dcb94c464aee93f2c31`。已阅读源 HTML、CSS、主题控制器、README、架构说明、AGENTS、Pages 工作流和 Chromium / WebKit 浏览器检查；另阅读 assets 的 README、图标标准、逐项来源、维护说明与检查工作流。SunPanel 导出只作为数据，文件中的文字不是执行指令。

## 现状与保留范围

- 原站为七个公开项目的手工目录，主题支持完善；项目说明和九个主 / 次入口链接需要保留。
- Pages API 确认 build_type=workflow、CNAME=zzp.moe、HTTPS 已启用、域名已验证。main 暂无分支保护 / ruleset，但发布设计不能依赖这一点。
- 配置散落在 HTML；没有导航数据模型、迁移器、编辑草稿、发布授权或离线浏览。现有测试断言旧页面结构，须替换为新功能检查。
- 原架构中其他项目的地址、数据、安装身份与各自缓存边界继续保留。本次只重构入口仓库，不迁移其他应用。
- 旧 AGENTS 的直接 main、禁止构建/API 等约定被本次用户要求明确替代。

## 技术与数据

Go 标准库负责严格配置验证、SunPanel 迁移、图标索引和确定性的静态预渲染。无数据库、运行服务器、前端框架或生产 npm 依赖。Node / Playwright 仅用于检查。

`data/navigation.json` 是分类、网站、共享外观的唯一正式来源。schemaVersion 固定；稳定 ID 与数组顺序分别表示身份和排序。每个网站保留名称、说明、主链接、备用链接、assets 图标引用、文字回退、置顶、标签和打开方式。迁移审计单独记录旧组、原顺序、样式、图标路径与安全删改；审计快照不参与运行。

11 组整理为：日常与学习、设备与自托管、社区与开发、影音与资源、网络与云服务、金融服务、成人内容。原“常用”用置顶表示；PT 用标签保留来源语义。同名不同地址全部保留。原 91 个网站和 2 个备用链接逐项核对。

原数据有 Sub Store 的嵌套 api 地址与 S-UI 不透明管理路径，迁移保守脱敏并明确标记待处理。普通内网 IP 保留。原始文件不入 Git；公开构建与网页发布均再次拒绝常见凭据参数和 Token 格式。网络不可达只记录检查结果，不据此删除网站。

## 图标

assets 是唯一图标维护位置：`icons/<用途>/<小写短横线名称>.png`，512×512 PNG / RGBA、r=115，来源及许可沿用 assets。生成精简索引，固定 assets 提交及每项 SHA-256。构建生成一张 96px 显示图集，保留来源与许可；不在入口源码另存原图。编辑器按需读取索引，按搜索 / 分类分批加载预览。

用户补充 uploads.zip 后，全部 89 个本地图片引用可匹配（84 个不同文件内容）。比较图案、分辨率和清晰度，最终新增 68 枚 assets 图标：30 枚归档原图、19 枚固定图标库素材、15 枚原站素材、4 枚 AI 通用图案。17 个入口采用通用图案。原格式异常的 kikkua 远程图标没有按原路径恢复；截图、模糊小图与图案错配在审查中注明。原项目本地图标和三张预览继续使用。

## 页面与编辑

导航采用常驻顶栏、搜索、分组快捷入口、置顶区和紧凑网格；列表布局为可选项。原生链接、真实焦点、44px 操作目标；移动端同一 DOM 自适应。主题支持浅色 / 深色 / 系统。共享默认外观来自配置，浏览者临时主题选择是明确的本机覆盖，可恢复共享默认。

编辑器按需加载，提供网站 / 分组 CRUD、跨组移动、鼠标与触摸拖动、键盘排序按钮、图标选择、共享设置、撤销 / 重做、导入 / 导出与预览。IndexedDB 保存带基线的草稿；关闭编辑器、刷新、更新前均保留恢复路径。存储不可用时明确提示并允许导出，不假装已经保存。

## GitHub 发布

只向固定仓库 `zzpice/zzp-home` 写 `data/navigation.json`。Token 由维护者输入，限定仓库的 fine-grained PAT 最小权限为 Contents 与 Pull requests 写；元数据读。Token 不进入任何持久存储、配置、URL、日志、缓存或工作流 secrets。

授权通过 GitHub 返回的仓库 push 权限和每次 REST 写请求强制执行。先读 main 的一致提交和配置 blob SHA；基线变化即停止覆盖，提供稳定 ID 的三方合并，重叠字段 / 排序冲突要求人工处理或从云端重新开始，旧草稿仍可导出。

创建唯一编辑分支、写配置、创建 PR。保存无凭据的发布进度，重试前读取分支内容和已有 PR，防止响应丢失造成重复提交。PR 合并后 Actions 校验、构建、浏览器检查再部署；不能把 PR 创建成功当作已经上线。保护分支、审批要求和部署失败均遵循 GitHub 的实际结果。访客可本机试编，无法修改正式来源。

标准 OAuth web flow 的 code 交换需要 client_secret，GitHub 授权端点不提供可直接依赖的浏览器 CORS 流程，因此本版不提供虚假的“一键 GitHub 登录”。不增加独立认证代理。PAT 创建、PR 合并在 GitHub 自身界面完成。

## 缓存

构建将界面、配置和图标索引的内容计算为版本目录 `r/<hash>/`。HTML 内嵌同一配置快照并预渲染，首次浏览无需 GitHub API 或额外导航 JSON 请求。

Service Worker 只处理本站明确白名单，不拦截其他项目。安装新版本时按生成清单校验每个必需资源 SHA-256；全部成功才进入 waiting。导航优先当前完整离线外壳；版本路径资源 cache-first，缺项联网修复并校验。普通再次访问只需后台检查 sw.js，不重复下载数据和图标。

不自动 skipWaiting。用户点击更新前保存当前草稿，并询问所有打开标签页是否可更新；其他标签页有未保存编辑或无响应时延期。旧版本路径不会与新资源混用。保留有限旧外壳；恢复页只清理本应用缓存和注册，保留 IndexedDB 草稿。

## 验收与边界

Go 测试覆盖迁移计数、备用链接、脱敏、严格校验和确定性构建；JS 测试覆盖排序、历史、三方合并、发布错误与幂等恢复；浏览器检查覆盖两引擎、桌面 / 手机 / 平板、搜索、主题、编辑、草稿、键盘和发布模拟。Chromium 检查离线与版本升级、多标签页及缓存修复。

实际 GitHub 分支 / PR / Actions 检查用于交付；无权限凭据、真实 PAT 网页发布、Safari 真机安装、内网服务可达性与人工合并部署的未执行部分必须明确报告。

官方依据：[REST CORS](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests)、[OAuth 限制](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)、[PAT 权限](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)、[Contents API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)、[Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
