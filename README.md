# ZZP · 项目入口

[打开入口](https://zzp.moe/) · [GitHub Pages 原始地址](https://zzpice.github.io/zzp-home/) · [项目架构](docs/architecture.md)

个人网页工具、图片资源与公开网络规则的目录。纯 HTML / CSS 与少量原生 JavaScript，没有前端构建、运行依赖、后端或运行时 GitHub API。

## 定位

`zzp.moe` 只负责帮助人找到公开项目。网页工具直接打开应用，规则与设置先打开接入说明；各项目自己负责数据、安装、离线和维护。GitHub 保存源码、资源、规则与文档，Pages 托管适合公开的网页。

入口不聚合私人服务地址、仓库元数据、订阅或凭据。折叠区域、HTML 注释和浏览器存储都不是访问控制。

## 维护

`index.html` 是项目名称、用途、顺序和链接的唯一维护位置：

- 网页工具放在 `#web`，主链接引用唯一标题和说明 ID；少量直达入口放在主链接外的 `.entry-footer`。
- 规则与设置放在 `#network`，指向公开仓库 README，避免手机用户直接打开二进制文件。
- 只收录确认适合公开的项目。不要同步私有仓库的名称、地址或说明；页脚仓库链接依靠 GitHub 本身的授权。
- 顺序按实际用途维护，不同步提交时间、星数、状态面板或另一份项目清单。

真实链接支持右键、复制、文字选择与浏览器原生打开方式；次要入口不嵌套在主链接中。桌面用三个任务入口和双列规则索引呈现，手机使用带小预览的短入口行，让三种工具在首屏内可见。顶栏「外观」可选择浅色、深色或跟随系统，键盘有跳转入口与焦点轮廓。

主题偏好只保存在本机 `zzp-home-theme`；跟随系统时移除此键，并实时响应系统变化。同站其他标签页、刷新与重新打开也会恢复正确状态；存储被禁用时选择在当前页面仍有效。内联初始化在样式和控制脚本下载前设置背景、原生控件外观与浏览器主题色，`theme.js` 管理后续交互。配色仍在本项目 `style.css` 维护；修改静态界面资源时，同步更新 HTML 中受影响的资源版本，避免旧浏览器缓存混用。

工具入口的三张图片缩略图来自本人 [图片资源库的现有生成图](https://github.com/zzpice/assets/blob/main/wallpapers/SOURCES.md)，来源说明沿用该清单；不引入第三方产品的品牌素材。

本地预览：

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

检查 `http://127.0.0.1:4173/`。浏览器检查只需要开发依赖：

```sh
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install --with-deps chromium webkit
node scripts/browser-check.cjs
```

检查两种引擎、桌面 / 手机 / 平板、浅深色、键盘、安装说明、资源路径及公开链接。CI 先组装 `build/pages`，再用 `SITE_ROOT=build/pages` 检查实际发布文件。界面文件不需要打包。

## 安装与部署

浅深两份 manifest 使用相同安装身份，按当前外观选择；`theme-color` 与页面实时同步。操作系统的启动画面可能沿用安装时缓存的 manifest，已有快捷入口不保证即时更新。manifest 的 `id` 固定为域名根路径 `/`，对应 `zzp.moe` 的安装身份；`scope`、`start_url` 使用相对路径，适配域名根路径与项目子路径。添加到主屏幕只提供快捷入口。这里需要联网，没有 Service Worker，不接管其他项目的缓存。

Pages 使用 GitHub Actions：检查成功后，仅打包 `index.html`、`style.css`、`theme.js`、`icons/`、两份 manifest、`CNAME` 和 `.nojekyll`，再发布到同一地址。文档、维护脚本和开发依赖不进入部署产物；具体流程见 [.github/workflows/pages.yml](.github/workflows/pages.yml)。失败时保留上次成功页面，修复后重跑工作流或提交修复。

`CNAME` 仍为 `zzp.moe`，不建立带自定义域名的 `zzpice.github.io` 用户站点，避免其他项目继承域名并改变浏览器数据来源。各应用继续使用 `https://zzpice.github.io/<项目>/`；原图和 raw 规则地址也保持不变。修改域名时必须一起检查 DNS、HTTPS、重定向和浏览器本地数据迁移。

恢复页面时可撤销有问题的提交，再运行检查和部署。若工作流本身损坏，可修复工作流后重跑；紧急时可在 Pages 设置恢复 `main` 根目录发布，但它会绕过检查门槛。域名退役前先调整 DNS，避免失效的托管指向。

[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) · [项目站点与域名继承](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages)
