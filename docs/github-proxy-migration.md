# GitHub 文件加速入口更新（2026-10-09）

正式入口统一为 [gh.zzp.moe](https://gh.zzp.moe/)，新增“我的项目”卡片，同时更新原导航 sp-02-019。当前审计文件的链接也已更新；原始迁移记录仍保留在 Git 历史中。

复用项目卡片设计与导航既有 assets 图标，不新增图标资源或复制其他项目主题。代理独立维护于 zzpice/github-proxy，使用 Cloudflare 原生 GitHub 自动部署，不改变本导航的 GitHub Pages 流程。

本次检查：Go 配置校验、构建与相关 sitebuild / config 测试通过；实际构建产物通过 Chromium / WebKit 的 320 / 390 / 768 / 1440 宽度、项目链接、浅深色、无 JS 与既有偏好检查。代理正式域名的五类公开下载、Range、只读 Git 与安全检查已通过。
