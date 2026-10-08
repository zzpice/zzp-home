# ZZP · 个人导航

[导航首页](https://zzp.moe/) · [我的项目](https://zzp.moe/projects/) · [架构](docs/architecture.md) · [维护与发布](docs/maintenance.md) · [迁移审查](docs/migration.md)

GitHub Pages 上的个人导航：分组、搜索、置顶、网格 / 列表、浅深色和共享外观。原生网页编辑器管理网站、分类与顺序，支持触摸拖动、撤销重做、草稿恢复、配置导入导出，以及提交 GitHub PR。7 个现有项目和有效链接保留在 `/projects/`。

Go 标准库负责校验、SunPanel 迁移、图标索引与静态预渲染；浏览器使用 HTML、CSS 和原生 JavaScript，无前端框架、数据库或常驻后端。普通浏览不调用 GitHub API；首屏使用一张图标图集，完整版本缓存后可离线浏览与编辑。

## 数据与权限

`data/navigation.json` 是跨设备正式数据来源，包含稳定 ID、分类、网站数组与共享外观。数组顺序即自定义顺序。`data/projects.json` 维护项目介绍和链接；图标原图仅在 [zzpice/assets](https://github.com/zzpice/assets) 维护，`data/icons.json` 固定提交和校验值。

网页修改首先保存在本机 IndexedDB 草稿中，不会改变公开配置。发布时临时输入仅授权 zzp-home 的 fine-grained PAT（Contents 与 Pull requests 写权限），GitHub API 检查实际仓库权限、比较文件 SHA、写入独立分支并创建 PR。Token 只留在本次操作内存中，输入框立即清空，不写入浏览器存储或配置。普通访客可尝试编辑本机草稿，但没有仓库权限便无法提交云端修改；隐藏按钮不承担权限控制。

**PR 合并且 Actions 部署成功后，其他设备才能获取修改。** 编辑器始终走 PR，不绕过分支保护，不自动合并。纯 Pages 不能安全保存 OAuth client secret，本版采用临时限权 PAT，不提供伪装成 OAuth 的不安全代理。冲突、断网、权限和重试流程见[发布说明](docs/maintenance.md#网页发布)。

## 本地开发

需要 Go 1.27 或更新版本；Node.js 24 和 Playwright 只用于开发测试。

```sh
go run ./cmd/zzp-home validate
go run ./cmd/zzp-home build
go run ./cmd/zzp-home serve
```

打开 `http://127.0.0.1:4173/`。构建首次从 assets 的固定提交下载所需图标和来源记录，之后复用 `.cache/assets/`；也可加 `-assets ../assets` 使用对应的本地资源库。图标 SHA 不一致会停止构建。

```sh
go test ./...
go vet ./...
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install --with-deps --only-shell chromium webkit
node --test tests/*.test.js
node scripts/browser-check.cjs
```

浏览器检查服务实际 `build/pages` 产物，包含两引擎、四种宽度、CRUD、排序、恢复、离线和 Chromium 的缓存升级 / 多标签页检查。GitHub 发布测试使用模拟 API，不会向真实仓库写入测试内容。真机安装和生产 Token 发布仍需上线后确认；详见[验证记录](docs/verification.md)。

## 部署与恢复

保留 GitHub Actions → GitHub Pages 和 `CNAME: zzp.moe`。PR 运行检查，只有 main 检查成功后发布 `build/pages` 白名单产物；源码、迁移报告、原始导出、草稿和开发依赖不进入站点产物。失败时保留上次部署。

Service Worker 按完整版本校验、缓存页面与资源。打开期间继续使用当前版，新版完整下载后提示更新；其他标签页有未发布编辑时拒绝强制切换。本机草稿独立于页面缓存。页脚「缓存恢复」仅清理本站导航缓存和对应 Worker，保留草稿。浏览器仍可能因配额或用户清理而移除本地数据，重要草稿可导出备份。

撤销问题提交并重新部署即可回滚。其他项目继续使用其原有 `zzpice.github.io/<项目>/` 地址与独立缓存，不迁入 zzp.moe 子路径。
