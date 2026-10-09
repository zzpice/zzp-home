# ZZP · 个人导航

[导航首页](https://zzp.moe/) · [我的项目](https://zzp.moe/projects/) · [架构](docs/architecture.md) · [维护与发布](docs/maintenance.md) · [迁移审查](docs/migration.md)

GitHub Pages 上的个人导航：分组、搜索、置顶、网格 / 列表、浅深色和共享外观。首页与项目页默认使用纯色背景，可选择共用的顶部壁纸；顶栏「设置」可选择每日轮换、固定图片或关闭，个人偏好保存在本浏览器。成人内容默认隐藏，可在设置中开启，编辑器保留全部数据。原生网页编辑器管理网站、分类与顺序，支持触摸拖动、撤销重做、草稿恢复、配置导入导出，以及直接保存到 GitHub。7 个现有项目和有效链接保留在 `/projects/`。

Go 标准库负责校验、SunPanel 迁移、图标索引与静态预渲染；浏览器使用 HTML、CSS 和原生 JavaScript，无前端框架、数据库或常驻后端。普通浏览不调用 GitHub API；首屏使用一张图标图集，壁纸只请求当天选中的轻量背景图，完整版本缓存后可离线浏览与编辑。

## 数据与权限

`data/navigation.json` 是跨设备正式数据来源，包含稳定 ID、分类、网站数组与共享外观。分类内数组顺序即自定义顺序；置顶仍属于原分类，以网站的可选 pinOrder 独立排序。`data/projects.json` 维护项目介绍和链接；图标原图仅在 [zzpice/assets](https://github.com/zzpice/assets) 维护，`data/icons.json` 固定提交和校验值。

网页修改首先保存在本机 IndexedDB 草稿中，不会改变公开配置。发布时临时输入仅授权 zzp-home 的 fine-grained PAT（Contents 读写权限），GitHub API 检查实际仓库权限、比较文件 SHA、直接写入 main 的 data/navigation.json。Token 只留在本次操作内存中，输入框立即清空，不写入浏览器存储或配置。普通访客可尝试编辑本机草稿，但没有仓库权限便无法提交云端修改；隐藏按钮不承担权限控制。

**保存后由 Actions 自动部署，其他设备更新页面即可获取修改。** 不需要手工合并。文件 SHA 变化时停止写入并提供冲突合并，断网保留草稿；响应丢失后重试会先检查正式内容，避免重复提交。权限和操作见[保存说明](docs/maintenance.md#网页保存)。

纯 Pages 无法保密 OAuth client secret，继续使用临时限权 PAT，由 GitHub 授权控制写入。

## 本地开发

需要 Go 1.27 或更新版本；Node.js 24 和 Playwright 只用于开发测试。

```sh
go run ./cmd/zzp-home validate
go run ./cmd/zzp-home build
go run ./cmd/zzp-home serve
```

打开 `http://127.0.0.1:4173/`。构建首次从 assets 的固定提交下载所需图标和来源记录，之后复用 `.cache/assets/`；也可加 `-assets ../assets` 使用对应的本地资源库。图标 SHA 不一致会停止构建。

自定义 `build -out` 时，仓库内输出必须位于 `build/` 下；构建会替换输出目录，不能指向源码、正式数据或仓库根目录。

```sh
go test ./...
go vet ./...
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install --with-deps --only-shell chromium webkit
node --test tests/*.test.js
node scripts/browser-check.cjs
```

浏览器检查服务实际 `build/pages` 产物，包含两引擎、四种宽度、CRUD、排序、恢复、离线和 Chromium 的缓存升级 / 多标签页检查。GitHub 发布测试使用模拟 API，不会向真实仓库写入测试内容。真机安装仍需设备确认；详见[验证记录](docs/verification.md)。

## 部署与恢复

保留 GitHub Actions → GitHub Pages 和 `CNAME: zzp.moe`。提交到 main 后自动检查，成功后才发布 `build/pages` 白名单产物；源码、迁移报告、原始导出、草稿和开发依赖不进入站点产物。失败时保留上次部署。

Service Worker 按完整版本校验、缓存页面与资源。打开期间继续使用当前版，新版完整下载后提示更新；其他标签页有未发布编辑时拒绝强制切换。本机草稿独立于页面缓存。「设置 → 故障恢复 → 缓存恢复」仅清理本站导航缓存和对应 Worker，保留草稿。浏览器仍可能因配额或用户清理而移除本地数据，重要草稿可导出备份。

撤销问题提交并重新部署即可回滚。其他项目继续使用其原有 `zzpice.github.io/<项目>/` 地址与独立缓存，不迁入 zzp.moe 子路径。
