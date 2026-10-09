# Actions 排查记录（2026-10-09）

核对最近 30 条工作流记录（12 条 failure、2 条 cancelled、16 条 success），并对照失败日志、对应提交和后续成功记录。`37885928392` 的两次尝试均停在同一 WebKit 壁纸检查；重跑没有修复原因。排查期间最新的 `37886729601` 已完成检查与 Pages 发布，当时没有仍在执行的工作流。

## 逐次失败与分类

| 工作流 | 日志与原因 | 分类及处理 |
|---|---|---|
| [37885928392](https://github.com/zzpice/zzp-home/actions/runs/37885928392) | WebKit 选择离线壁纸后等待 `data-wallpaper=on` 超时。该标志既不能证明缓存写入完成，也可能是上一张图留下的状态。进一步独立复现发现 WebKit 的 `setOffline(true)` 会拒绝本地 Blob 图片解码，缓存中图片存在也无法显示。 | 测试设计与浏览器模拟问题。本次等待完成状态后检查 Cache Storage，并阻断实际 HTTP 请求验证失网回退，两个引擎执行同样断言。 |
| [37883535596](https://github.com/zzpice/zzp-home/actions/runs/37883535596) | 新增 GitHub 工具后图库图片断言 `3 != 6`：把所有非 Anki / 基金项目都当成图库。 | 测试设计；`43fef75` 已按 `preview=gallery` 计算，[37883825016](https://github.com/zzpice/zzp-home/actions/runs/37883825016) 通过。 |
| [37862834723](https://github.com/zzpice/zzp-home/actions/runs/37862834723) | 升级页面的配置已加载，但管理按钮仍处于初始化中。测试误判为折叠入口并打开设置，随后桌面按钮被设置弹窗遮挡。 | 测试竞态，本次等待管理按钮初始化后按其实际 DOM 位置打开；保留升级后恢复草稿的验证。 |
| [37804129019](https://github.com/zzpice/zzp-home/actions/runs/37804129019) | 保存后返回正式配置断言 `5 != 14`，预期仍使用旧的日常网站总量。 | 测试设计；`73a9c10` 已从受控样本推导保存后数量，[37804552659](https://github.com/zzpice/zzp-home/actions/runs/37804552659) 通过。 |
| [37803694838](https://github.com/zzpice/zzp-home/actions/runs/37803694838) | Emby 搜索断言 `2 != 3`，重复计算置顶区与原分类里的同一网站。 | 测试设计；`0943e92` 已按受控样本的唯一网站数验证。 |
| [37802668812](https://github.com/zzpice/zzp-home/actions/runs/37802668812) | Go 迁移库存测试固定初始网站、分类、置顶与备用网址总量；正常编辑正式数据后不再符合。 | 测试设计；`3045bb7` 已将迁移预期移至固定样本，正式数据只检查有效配置契约。 |
| [37789914807](https://github.com/zzpice/zzp-home/actions/runs/37789914807) | WebKit 图集 `img.decode()` 抛出 `Aborted by source change`；懒加载和 DOM 重建改变了正在解码的图片。 | 测试等待问题；`2567689` 已轮询最终图片的 `complete` 与 `naturalWidth`，[37790659819](https://github.com/zzpice/zzp-home/actions/runs/37790659819) 通过。 |
| [37789222592](https://github.com/zzpice/zzp-home/actions/runs/37789222592) | WebKit 图集尚未完成加载就读取 `complete`，得到 `false != true`。 | 测试等待问题；最初改为 `decode()` 仍不足，最终以 `2567689` 的最终加载状态检查解决。 |
| [37786678448](https://github.com/zzpice/zzp-home/actions/runs/37786678448) | 升级协调提示等待超时，诊断中候选 Worker 已安装，但没有预期的多标签页消息。 | 混合问题：升级测试的异步谓词提前通过，历史产品逻辑也存在注册作用域选择和首次安装误报更新的问题；最终修复见下文。 |
| [37786491247](https://github.com/zzpice/zzp-home/actions/runs/37786491247) | 同一升级协调超时；仅改注册选择尚不足以解决。 | 混合问题，不能将相同末端超时视为同一根因。 |
| [37785927838](https://github.com/zzpice/zzp-home/actions/runs/37785927838) | 同一升级协调超时；候选版本变化后仍使用过早出现的更新状态。 | 混合问题，后续补齐候选等待与更新横幅状态。 |
| [37785490284](https://github.com/zzpice/zzp-home/actions/runs/37785490284) | 第二标签页尚在空白页时访问 `navigator.serviceWorker.addEventListener`，对象不存在。 | 测试顺序错误；`6ffb648` 已先加载第二页再安装监听。 |

早期升级问题中，`700e7d0` 修正当前文档的注册选择；`864f3e7` 修正首次安装与失效候选的更新提示，并改为同步读取已取得的 registration 状态。[37788040400](https://github.com/zzpice/zzp-home/actions/runs/37788040400) 随后通过。这里包含真实历史产品缺陷和测试错误，不把全部升级超时都归为环境故障；旧日志也不能精确量化各问题的单独贡献。

两条 cancelled 单独核对：[37782896560](https://github.com/zzpice/zzp-home/actions/runs/37782896560) 浏览器安装耗时约 14 分钟，取消前仍出现上述升级协调超时；[37797931317](https://github.com/zzpice/zzp-home/actions/runs/37797931317) 在安装系统依赖期间被取消，日志停在 apt 下载，没有足够证据认定具体镜像故障或取消来源。`05bf66c` 已兼容 Ubuntu 两种 apt 源格式并替换原 Azure 镜像，[37799708665](https://github.com/zzpice/zzp-home/actions/runs/37799708665) 通过。取消与断言失败分别记录。

## 本次修复

- 壁纸加载完成的状态在异步缓存写入之后设置；先等待此状态，再用 `page.evaluate` 明确检查缓存。当前固定的 Playwright 1.62.1 中，`waitForFunction(async () => false)` 会立即通过，本地 Chromium / WebKit 均已独立复现，因此轮询只使用同步谓词。
- 失网前删除受控目标 beta 的缓存，避免每日轮换预先缓存它而让测试假通过；阻断所有 assets HTTP 请求，确认显示“使用上次已缓存的壁纸”且 LAST 仍指向 alpha，再验证网络恢复后加载 beta。两引擎均检查相同行为。
- WebKit 1.62.1 的独立 Blob 图片实验结果：在线解码成功，`setOffline(true)` 解码失败，直接阻断 HTTP 时本地解码成功。这个实验没有运行本站代码。上游也记录了类似的[离线模拟拒绝本地 Worker 响应问题](https://github.com/microsoft/playwright/issues/42775)；该报告使用 1.63.0，不能据此断言本站使用版本的全部内部原因。Chromium 的整站 `setOffline` 离线导航、搜索、项目页和编辑检查保留。
- 编辑和外观入口先等待应用初始化，再判断按钮的实际位置。移除固定 100ms 等待与自动选择“使用正式配置”的行为；需要恢复草稿的用例明确点击恢复，不再由公共助手悄悄丢弃草稿提示。
- 发布后的“没有未同步草稿”检查主动打开草稿列表并等待读取结果，避免在 IndexedDB 尚未读取时仅凭恢复按钮暂不存在而通过。
- 基金预览按正式项目数据中的 `preview=fund` 数量逐个检查，保留四基金比例与无溢出的业务断言；不会因增删项目而假定永远只有一个基金面板。
- 主入口、浏览器检查脚本、受控样本和恢复页面改动触发完整浏览器套件；编辑 / 发布 / 模型修改也保留离线和存储失败验证。避免改了测试却没有执行对应分组。纯数据修改仍校验并构建，未增加工作流或部署机制。
- 两个 job 固定 `ubuntu-24.04`，保留现有 Node、Go、Playwright 配置及 Pages 发布方式，避免 `ubuntu-latest` 自动切换系统大版本。此项是预防环境漂移，不认定它造成了此前的断言失败。

本次未修改 `web/`、正式数据或页面设计；构建仍为 `7572e24811fbbeac40f1`。未增加超时、自动重试或跳过用例，未删除跨浏览器、离线、编辑、发布、错误响应、升级协调和草稿恢复验证。

## 验证与剩余边界

本地 Go 全部测试、vet、正式配置校验、构建及 Node 24 项测试通过；相关检查范围选择的 12 种路径和缺失 base 回退通过。Chromium / WebKit 的完整相关浏览器套件通过：四种宽度、浅深色与无 JS、受控失网壁纸回退、编辑与草稿恢复、置顶操作、存储失败；Chromium 另验证模拟 GitHub 发布、整站离线、完整缓存升级与多标签页协调。提交本次修复会触发完整套件，线上检查和 Pages 发布以对应 main 提交的 [Actions 记录](https://github.com/zzpice/zzp-home/actions/workflows/pages.yml)为准。

未发现需要在本次修改产品代码的功能缺陷。浏览器模拟问题不等于真实 Safari 的离线缺陷；WebKit 响应式测试不能替代 iOS 真机验证。外部 npm / apt / 浏览器下载 / 固定资源下载和 GitHub runner 仍可能出现可观察的环境故障；固定系统大版本不能消除镜像补丁变化。这些故障应保留失败日志，不以自动重跑或放宽功能断言掩盖。
