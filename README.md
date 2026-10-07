# ZZP · 项目入口

[打开项目入口](https://zzp.moe/) · [GitHub Pages 原始地址](https://zzpice.github.io/zzp-home/)

个人网页工具、图片资源与公开规则的统一入口。纯 HTML / CSS，无构建、运行依赖、后端、登录或运行时 API 请求。

## 维护项目

只需编辑 `index.html`：

- 网页工具放在 `#web`，复制一个 `.project-card`，填写名称、一句话用途和网页链接。必要时加少量常用直达入口。
- 规则与配置放在 `#network`，复制一个 `.resource-row`，主链接指向公开仓库的 README，避免让手机用户直接下载无法阅读的二进制规则。
- 顺序代表展示优先级；不按最近提交时间自动重排。没有可用页面的项目不标为网页工具。停止维护的项目按实际情况移除或在说明中注明。
- 上线前先核实仓库公开状态和内容是否适合被推荐。**不要把私有仓库的名称、地址、说明或配置写入这里**，也不在 HTML、注释、图标、manifest 中隐藏它们。页脚“管理仓库”依靠 GitHub 自身登录和授权显示私有项目。
- 不需要同步星数、提交时间、构建徽章或每个项目的详细文档；说明由各项目维护。本入口只维护项目去向。
- 只有项目数量明显增多、手机浏览变得困难时，才考虑增加分类或搜索；当前七个项目用两组即可。

本地预览：

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

打开 `http://127.0.0.1:4173/`，检查桌面与手机宽度、键盘焦点、展开安装说明及所有修改的链接，再提交到 `main`。没有前端构建步骤。

## 手机与安装

`manifest.webmanifest` 提供图标与主屏幕安装信息，`id`、`scope`、`start_url` 使用相对路径，适配项目子路径与自定义域名根路径。

此入口需要联网，**没有 Service Worker**，不会拦截或缓存其他项目。添加主屏幕只是方便启动入口，不会合并其他项目的安装、离线能力或本地数据。iOS / Android 的安装入口依浏览器而异；页面提供通用说明。

外部项目在新标签页 / 浏览器窗口打开，并显示 ↗；保留入口，已有工具中的草稿、计算和收藏继续由各工具自身管理。浅深色跟随系统，无额外偏好存储。

## 部署与域名

GitHub Pages 从 `main` 根目录发布，`.nojekyll` 禁用 Jekyll，`CNAME` 绑定 `zzp.moe`。使用独立项目仓库 `zzp-home`，不建立带自定义域名的 `zzpice.github.io` 用户站点，以免让其他项目继承域名并改变访问来源。

Cloudflare DNS 负责解析，GitHub Pages 负责托管与 HTTPS。根域名通过 Cloudflare 的 CNAME Flattening 指向 `zzpice.github.io`；`www` 同样指向 `zzpice.github.io`，GitHub Pages 将其重定向到根域名。两条记录均仅 DNS，不增加代理和第二层缓存。

各项目继续使用现有 `https://zzpice.github.io/<项目>/` 地址；现有原图、raw 规则和配置链接保持原地址。无需迁移浏览器数据或重新安装已有项目 PWA。

若停用此站点，先移除或调整对应 DNS，再停用 Pages，避免留下失效托管指向。新增项目一般不需要改 DNS。

官方参考：[GitHub Pages 域名继承](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages)、[自定义域名配置](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)、[Cloudflare CNAME Flattening](https://developers.cloudflare.com/dns/cname-flattening/)、[MDN 安装要求](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)。
