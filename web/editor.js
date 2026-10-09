import {
  History,
  clone,
  equal,
  assertValid,
  moveSite,
  moveGroup,
  allSites,
  pinnedSites,
  setPinned,
  movePinned,
  matches,
  mergeConfig,
  newID,
  containsCredential,
  urlProblem,
} from "./model.js";
import { saveDraft, loadDrafts, tabID } from "./storage.js";
import { GitHubPublisher, ConflictError } from "./github.js";
import { loadWallpaperIndex, fillWallpaperSelect, preference } from "./wallpaper.js";
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const $ = (root, selector) => root.querySelector(selector);
function dialog(className, html) {
  const d = document.createElement("dialog");
  d.className = className;
  d.innerHTML = html;
  document.body.append(d);
  return d;
}
function download(config, name = "zzp-home-navigation.json") {
  assertValid(config);
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(config, null, 2) + "\n"], {
      type: "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const categoryNames = {
  media: "影音与资源",
  social: "社区与社交",
  productivity: "效率工具",
  learning: "学习",
  network: "网络工具",
  "self-hosted": "设备与自托管",
  cloud: "云与域名",
  adult: "成人网站",
  ai: "AI",
  finance: "金融",
  development: "开发",
  gaming: "游戏",
  "media-players": "媒体播放器",
  "proxy-clients": "代理客户端",
  regions: "国家与地区",
  routes: "线路",
};

export async function createEditor({ boot, releaseURL, toast, onPreview }) {
  let base = clone(boot.config),
    baseSha = boot.blobSha,
    history = new History(base),
    selected = base.groups[0]?.id || "";
  let draftId = tabID(),
    working = null,
    pinQuery = "",
    initialized = false,
    iconIndex = null,
    storageError = "",
    saveTimer,
    saveQueue = Promise.resolve(),
    lastSaved = "";
  const main = dialog(
    "editor-dialog",
    `<div class="editor-shell"><header class="editor-header"><h2>管理导航</h2><span class="draft-status" role="status"></span><span class="spacer"></span><button data-action="preview">预览</button><button class="primary" data-action="publish">保存到 GitHub</button><button class="quiet" data-action="close" aria-label="关闭编辑器">✕</button></header><div class="storage-warning" hidden></div><div class="editor-tools"><button data-action="undo" title="撤销（Ctrl / ⌘ Z）">↶ 撤销</button><button data-action="redo" title="重做（Ctrl / ⌘ Shift Z）">↷ 重做</button><button data-action="add-group">＋ 分类</button><button data-action="settings">共享外观</button><button data-action="import">导入</button><button data-action="export">导出</button><span class="help">拖动手柄排序，或使用上下移动按钮</span></div><div class="editor-body"><nav class="editor-groups" aria-label="编辑分类"></nav><div class="editor-list"></div></div><footer class="editor-footer"><span>草稿保存在本机。GitHub 保存并自动部署后，所有设备使用同一正式配置。</span><button class="text-button" data-action="drafts">其他草稿</button></footer><input type="file" id="import-file" accept="application/json,.json" hidden></div>`,
  );
  const dirty = () =>
    !equal(history.value, base) ||
    Boolean(working && !equal(working.values, working.initial));
  function status() {
    const text = storageError
      ? "草稿未保存 · 请导出"
      : dirty()
        ? lastSaved
          ? "未同步 · 草稿已保存 " + lastSaved
          : "未同步 · 正在保存草稿"
        : "与编辑基线一致";
    $(main, ".draft-status").textContent = text;
    $(main, ".storage-warning").hidden = !storageError;
    $(main, ".storage-warning").textContent = storageError;
    $(main, "[data-action=undo]").disabled = !history.canUndo;
    $(main, "[data-action=redo]").disabled = !history.canRedo;
  }
  function safeWorking() {
    if (!working) return null;
    const value = working.values;
    if (
      containsCredential(JSON.stringify(working)) ||
      [value.url, ...String(value.alternateUrls || "").split("\n")]
        .filter(Boolean)
        .some((u) => /认证|凭据/.test(urlProblem(u)))
    )
      throw Error(
        "输入含疑似凭据，未写入草稿。请先移除认证部分，再保存或更新。",
      );
    return clone(working);
  }
  function snapshot() {
    return {
      schemaVersion: 1,
      config: clone(history.value),
      baseConfig: clone(base),
      baseSha,
      history: history.serialize(),
      selected,
      working: safeWorking(),
    };
  }
  async function persist() {
    clearTimeout(saveTimer);
    let record;
    try {
      record = snapshot();
    } catch (error) {
      storageError = error.message;
      status();
      throw error;
    }
    const operation = saveQueue
      .catch(() => {})
      .then(() => saveDraft(draftId, record));
    saveQueue = operation;
    try {
      await operation;
      storageError = "";
      lastSaved = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      status();
    } catch (error) {
      storageError = error.message;
      status();
      throw error;
    }
  }
  function schedule() {
    lastSaved = "";
    status();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist().catch(() => {}), 350);
  }
  function commit(value) {
    if (history.commit(value)) {
      render();
      schedule();
    }
  }
  function image(site) {
    if (!site.icon)
      return `<span>${escape(site.iconText || [...site.title][0])}</span>`;
    const source = boot.iconPaths[site.icon]
      ? new URL(boot.iconPaths[site.icon], releaseURL).href
      : "https://raw.githubusercontent.com/zzpice/assets/" +
        boot.iconRevision +
        "/" +
        site.icon;
    return `<img class="${boot.iconPaths[site.icon] ? "atlas" : ""}" src="${escape(source)}" width="36" height="36" alt="" loading="lazy" data-fallback="${escape(site.iconText || [...site.title][0])}">`;
  }
  function imageFallback(root) {
    for (const img of root.querySelectorAll("img[data-fallback]")) {
      const fail = () => {
        const span = document.createElement("span");
        span.textContent = img.dataset.fallback;
        img.parentElement.classList.remove("sprite");
        img.replaceWith(span);
      };
      img.addEventListener("error", fail, { once: true });
      if (img.complete && !img.naturalWidth) fail();
    }
  }
  function render() {
    if (
      selected !== "settings" &&
      selected !== "pinned" &&
      !history.value.groups.some((g) => g.id === selected)
    )
      selected = history.value.groups[0]?.id || "";
    $(main, ".editor-groups").innerHTML =
      `<div class="editor-group ${selected === "pinned" ? "active" : ""}"><button data-action="select-group" data-id="pinned">☆ 全部置顶 <small>${pinnedSites(history.value).length}</small></button></div>` +
      history.value.groups
        .map(
          (g) =>
            `<div class="editor-group ${selected === g.id ? "active" : ""}" data-group-id="${g.id}"><button class="drag-handle" data-drag="group" data-id="${g.id}" aria-label="拖动 ${escape(g.title)} 分类">⠿</button><button data-action="select-group" data-id="${g.id}">${escape(g.title)} <small>${g.sites.length}</small></button><button class="mini" data-action="edit-group" data-id="${g.id}" aria-label="编辑 ${escape(g.title)} 分类">⋯</button></div>`,
        )
        .join("");
    const panel = $(main, ".editor-list");
    if (selected === "pinned") {
      renderPinned(panel);
      status();
      return;
    }
    if (selected === "settings") {
      renderSettings(panel);
      status();
      return;
    }
    const group = history.value.groups.find((g) => g.id === selected);
    if (!group) {
      panel.innerHTML =
        '<div class="no-sites">先添加一个分类，再放入网站。</div>';
      status();
      return;
    }
    panel.innerHTML = `<div class="editor-list-heading"><h3>${escape(group.title)} <small>· ${group.sites.length}</small></h3><button class="primary" data-action="add-site">＋ 网站</button></div><div class="site-sort-list" data-target-group="${group.id}">${group.sites.map((s, i) => `<div class="edit-site-row" data-site-id="${s.id}" data-target-group="${group.id}"><button class="drag-handle" data-drag="site" data-id="${s.id}" aria-label="拖动 ${escape(s.title)}">⠿</button><span class="site-icon ${boot.iconPaths[s.icon] ? "sprite" : ""}" data-icon="${escape(s.icon)}">${image(s)}</span><div class="edit-site-copy"><strong>${s.pinned ? "☆ " : ""}${escape(s.title)}</strong><small>${escape(s.description || s.url)}</small></div><div class="row-actions"><button data-action="site-up" data-id="${s.id}" aria-label="上移 ${escape(s.title)}" ${i === 0 ? "disabled" : ""}>↑</button><button data-action="site-down" data-id="${s.id}" aria-label="下移 ${escape(s.title)}" ${i === group.sites.length - 1 ? "disabled" : ""}>↓</button><button data-action="edit-site" data-id="${s.id}">编辑</button></div></div>`).join("") || '<p class="no-sites">这个分类还没有网站。添加一个，或从其他分类拖入。</p>'}</div>`;
    imageFallback(panel);
    status();
  }
  function renderPinned(panel) {
    const pins = pinnedSites(history.value);
    const groups = new Map(
      history.value.groups.flatMap((g) => g.sites.map((s) => [s.id, g.title])),
    );
    panel.innerHTML = `<div class="editor-list-heading"><h3>全部置顶 <small>· ${pins.length}</small></h3></div><p class="help-text">拖动调整置顶顺序；网站仍保留在原分类。</p><label class="field"><span>搜索已有网站并加入置顶</span><input type="search" aria-label="搜索已有网站" placeholder="搜索名称、描述或网址"></label><div class="pin-search-results"></div><div class="pin-sort-list">${pins.map((s, i) => `<div class="edit-site-row" data-site-id="${s.id}" data-pin-id="${s.id}"><button class="drag-handle" data-drag="pin" data-id="${s.id}" aria-label="拖动 ${escape(s.title)} 置顶">⠿</button><span class="site-icon ${boot.iconPaths[s.icon] ? "sprite" : ""}" data-icon="${escape(s.icon)}">${image(s)}</span><div class="edit-site-copy"><strong>${escape(s.title)}</strong><small>${escape(groups.get(s.id))}</small></div><div class="row-actions"><button data-action="pin-up" data-id="${s.id}" aria-label="上移 ${escape(s.title)} 置顶" ${i === 0 ? "disabled" : ""}>↑</button><button data-action="pin-down" data-id="${s.id}" aria-label="下移 ${escape(s.title)} 置顶" ${i === pins.length - 1 ? "disabled" : ""}>↓</button><button data-action="unpin" data-id="${s.id}">取消置顶</button></div></div>`).join("") || '<p class="no-sites">还没有置顶网站，可在上方搜索添加。</p>'}</div>`;
    const input = $(panel, "input"),
      results = $(panel, ".pin-search-results");
    input.value = pinQuery;
    const draw = () => {
      const query = (pinQuery = input.value.trim());
      const sites = query
        ? allSites(history.value).filter((s) => !s.pinned && matches(s, query))
        : [];
      results.innerHTML =
        sites
          .map(
            (s) =>
              `<div class="edit-site-row"><span class="site-icon ${boot.iconPaths[s.icon] ? "sprite" : ""}" data-icon="${escape(s.icon)}">${image(s)}</span><div class="edit-site-copy"><strong>${escape(s.title)}</strong><small>${escape(groups.get(s.id))}</small></div><button data-action="pin" data-id="${s.id}">加入置顶</button></div>`,
          )
          .join("") ||
        (query ? '<p class="help-text">没有匹配的未置顶网站。</p>' : "");
      imageFallback(results);
    };
    input.addEventListener("input", draw);
    draw();
    imageFallback(panel);
  }
  function currentGroupOptions(value, exclude = "") {
    return history.value.groups
      .filter((g) => g.id !== exclude)
      .map(
        (g) =>
          `<option value="${g.id}" ${g.id === value ? "selected" : ""}>${escape(g.title)}</option>`,
      )
      .join("");
  }
  function renderSettings(panel) {
    const s =
      working?.type === "settings" ? working.values : history.value.settings;
    panel.innerHTML = `<form class="settings-form"><h3>共享外观</h3><p class="help-text">这些默认设置会随正式配置同步。顶栏的浏览外观只覆盖当前浏览器。</p><label class="field"><span>站点名称</span><input name="title" maxlength="80" required value="${escape(s.title)}"></label><label class="field"><span>首页说明</span><input name="subtitle" maxlength="200" value="${escape(s.subtitle)}"></label><div class="field-row"><label class="field"><span>默认主题</span><select name="theme">${[
      ["system", "跟随系统"],
      ["light", "浅色"],
      ["dark", "深色"],
    ]
      .map(
        ([v, t]) =>
          `<option value="${v}" ${s.theme === v ? "selected" : ""}>${t}</option>`,
      )
      .join(
        "",
      )}</select></label><label class="field"><span>默认布局</span><select name="layout"><option value="grid" ${s.layout === "grid" ? "selected" : ""}>图标网格</option><option value="list" ${s.layout === "list" ? "selected" : ""}>列表</option></select></label></div><label class="field"><span>默认密度</span><select name="density"><option value="comfortable" ${s.density === "comfortable" ? "selected" : ""}>舒展</option><option value="compact" ${s.density === "compact" ? "selected" : ""}>紧凑</option></select></label><label class="check-field"><input type="checkbox" name="showDescriptions" ${s.showDescriptions ? "checked" : ""}>显示网站描述</label><p class="form-error" role="alert"></p><button class="primary" type="submit">应用外观设置</button></form>`;
    const form = $(panel, "form");
    const wallpaperFields = document.createElement("div");
    wallpaperFields.innerHTML = `<label class="field"><span>默认壁纸</span><select name="wallpaperMode"><option value="daily">仓库每日轮换</option><option value="fixed">固定仓库壁纸</option><option value="off">关闭壁纸</option></select></label><label class="field" id="shared-wallpaper-fixed"><span>固定图片</span><select name="wallpaperPath"></select></label>`;
    form.querySelector(".check-field").before(wallpaperFields);
    form.elements.wallpaperMode.value = preference(s.wallpaper).mode === "shared" ? "off" : preference(s.wallpaper).mode;
    const syncWallpaper = () => { wallpaperFields.querySelector("#shared-wallpaper-fixed").hidden = form.elements.wallpaperMode.value !== "fixed"; };
    fillWallpaperSelect(form.elements.wallpaperPath, [], s.wallpaper?.path || "");
    loadWallpaperIndex().then(items => { if (form.isConnected) fillWallpaperSelect(form.elements.wallpaperPath, items, form.elements.wallpaperPath.value); });
    form.elements.wallpaperMode.addEventListener("change", syncWallpaper);
    syncWallpaper();
    const values = () => ({
      title: form.elements.title.value,
      subtitle: form.elements.subtitle.value,
      theme: form.elements.theme.value,
      layout: form.elements.layout.value,
      density: form.elements.density.value,
      showDescriptions: form.elements.showDescriptions.checked,
      wallpaper: {mode: form.elements.wallpaperMode.value, path: form.elements.wallpaperMode.value === "fixed" ? form.elements.wallpaperPath.value : ""},
    });
    form.addEventListener("input", () => {
      if (working?.type !== "settings")
        working = {
          type: "settings",
          initial: clone(history.value.settings),
          values: values(),
        };
      else working.values = values();
      schedule();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        applySettings(values());
        toast("外观设置已应用到草稿。");
      } catch (error) {
        $(form, ".form-error").textContent = error.message;
      }
    });
  }
  function applySettings(values = working?.values) {
    if (!values) return;
    const next = clone(history.value);
    next.settings = clone(values);
    assertValid(next);
    working = null;
    commit(next);
    render();
    schedule();
  }
  function leaveSettings() {
    if (working?.type === "settings") {
      try {
        applySettings();
      } catch (error) {
        toast(error.message);
        return false;
      }
    }
    return true;
  }
  async function icons() {
    if (iconIndex) return iconIndex;
    const r = await fetch(new URL("icons.json", releaseURL));
    if (!r.ok) throw Error("图标索引暂不可用，请联网后重试。");
    const idx = await r.json();
    if (
      idx.repository !== "zzpice/assets" ||
      idx.revision !== boot.iconRevision ||
      !Array.isArray(idx.icons)
    )
      throw Error("图标索引版本不一致，请更新页面。");
    iconIndex = idx;
    return idx;
  }
  async function checkIcons(config) {
    const idx = await icons();
    const paths = new Set(idx.icons.map((i) => i.path));
    if (
      config.groups.some((g) =>
        g.sites.some((s) => s.icon && !paths.has(s.icon)),
      )
    )
      throw Error("配置包含未登记图标，请先更新 assets 索引或改用文字图标。");
  }
  async function pickIcon(value, choose) {
    let idx;
    try {
      idx = await icons();
    } catch (error) {
      toast(error.message);
      return;
    }
    const d = dialog(
      "form-dialog icon-picker",
      `<div class="dialog-heading"><h3>选择图标</h3><button class="quiet" aria-label="关闭图标选择">✕</button></div><div class="dialog-content"><p class="help-text">来自 zzpice/assets · 512×512 PNG · 原始来源及许可由资源库维护。</p><div class="icon-controls"><input type="search" aria-label="搜索图标" placeholder="搜索品牌或文件名"><select aria-label="图标用途"><option value="">全部用途</option>${[...new Set(idx.icons.map((i) => i.category))].map((c) => `<option value="${escape(c)}">${escape(categoryNames[c] || c)}</option>`).join("")}</select></div><div class="icon-picker-grid"></div></div>`,
    );
    let shown = 24;
    const draw = () => {
      const q = $(d, "input").value.trim().normalize("NFKC").toLowerCase(),
        category = $(d, "select").value;
      const filtered = idx.icons.filter(
        (i) =>
          (!category || i.category === category) &&
          (i.title + " " + i.path).normalize("NFKC").toLowerCase().includes(q),
      );
      const options = filtered
        .slice(0, shown)
        .map((i) => {
          const sprite = Boolean(boot.iconPaths[i.path]);
          const source = sprite
            ? new URL(boot.iconPaths[i.path], releaseURL).href
            : "https://raw.githubusercontent.com/zzpice/assets/" +
              idx.revision +
              "/" +
              i.path;
          return `<button class="icon-option" data-icon="${escape(i.path)}" aria-pressed="${i.path === value}"><span class="site-icon ${sprite ? "sprite" : ""}" data-icon="${escape(i.path)}"><img class="${sprite ? "atlas" : ""}" src="${escape(source)}" width="48" height="48" alt="" loading="lazy" data-fallback="${escape([...i.title][0])}"></span><span>${escape(i.title)}</span></button>`;
        })
        .join("");
      $(d, ".icon-picker-grid").innerHTML =
        options || '<p class="help-text">没有匹配的图标。</p>';
      if (filtered.length > shown)
        $(d, ".icon-picker-grid").insertAdjacentHTML(
          "beforeend",
          `<button class="icon-more" data-more>再显示 ${Math.min(24, filtered.length - shown)} 个 · 共 ${filtered.length} 个</button>`,
        );
      imageFallback(d);
    };
    const reset = () => {
      shown = 24;
      draw();
    };
    $(d, "input").addEventListener("input", reset);
    $(d, "select").addEventListener("change", reset);
    d.addEventListener("click", (event) => {
      const option = event.target.closest("button[data-icon]");
      if (option) {
        choose(option.dataset.icon);
        d.close();
      } else if (event.target.closest("[data-more]")) {
        shown += 24;
        draw();
      } else if (event.target.closest(".dialog-heading button")) d.close();
    });
    d.addEventListener("close", () => d.remove(), { once: true });
    draw();
    d.showModal();
    $(d, "input").focus();
  }

  function openSite(id = "", restored = null) {
    const group = history.value.groups.find((g) =>
      g.sites.some((s) => s.id === id),
    );
    const existing = group?.sites.find((s) => s.id === id);
    const original = existing
      ? {
          ...clone(existing),
          groupId: group.id,
          alternateUrls: existing.alternateUrls.join("\n"),
          tags: existing.tags.join(", "),
        }
      : {
          id: newID("site"),
          title: "",
          description: "",
          url: "",
          alternateUrls: "",
          icon: "",
          iconText: "",
          pinned: false,
          newTab: true,
          tags: "",
          notice: "",
          groupId:
            selected === "pinned" ? history.value.groups[0]?.id : selected,
        };
    const value = restored?.values || original;
    let iconValue = value.icon;
    const d = dialog(
      "form-dialog",
      `<form><div class="dialog-heading"><h3>${existing ? "编辑网站" : "添加网站"}</h3><button type="button" class="quiet" data-close aria-label="关闭网站编辑">✕</button></div><div class="dialog-content"><label class="field"><span>名称</span><input name="title" required maxlength="120" value="${escape(value.title)}" autofocus></label><label class="field"><span>网址</span><input name="url" type="url" required maxlength="2048" value="${escape(value.url)}" placeholder="https://example.com"><small>公开配置请勿包含访问令牌、密码或订阅凭据。</small></label><label class="field"><span>描述</span><textarea name="description" rows="2" maxlength="500">${escape(value.description)}</textarea></label><div class="field-row"><label class="field"><span>分类</span><select name="groupId">${currentGroupOptions(value.groupId)}</select></label><label class="field"><span>文字图标</span><input name="iconText" maxlength="20" value="${escape(value.iconText)}" placeholder="未选择图片时显示首字"></label></div><div class="icon-selection"><span class="site-icon" id="chosen-icon"></span><div><button type="button" id="choose-icon">选择 assets 图标</button> <button type="button" id="clear-icon" class="text-button">使用文字</button><small class="help-text" id="icon-path"></small></div></div><label class="field"><span>备用网址（每行一条）</span><textarea name="alternateUrls" rows="2">${escape(value.alternateUrls)}</textarea></label><label class="field"><span>标签（逗号分隔）</span><input name="tags" value="${escape(value.tags)}"></label><label class="field"><span>入口提示</span><input name="notice" maxlength="200" value="${escape(value.notice)}"><small>确认脱敏后的入口可用后，可清除迁移提示。</small></label><div class="field-row"><label class="check-field"><input type="checkbox" name="pinned" ${value.pinned ? "checked" : ""}>置顶</label><label class="check-field"><input type="checkbox" name="newTab" ${value.newTab ? "checked" : ""}>新标签页打开</label></div><p class="form-error" role="alert"></p></div><div class="dialog-actions">${existing ? '<button type="button" class="danger" id="delete-site">删除网站</button>' : ""}<button type="button" data-close>取消</button><button type="submit" class="primary">应用修改</button></div></form>`,
    );
    const form = $(d, "form");
    const values = () => ({
      id: original.id,
      ...(existing?.pinOrder !== undefined
        ? { pinOrder: existing.pinOrder }
        : {}),
      title: form.elements.title.value,
      description: form.elements.description.value,
      url: form.elements.url.value,
      alternateUrls: form.elements.alternateUrls.value,
      icon: iconValue,
      iconText: form.elements.iconText.value,
      pinned: form.elements.pinned.checked,
      newTab: form.elements.newTab.checked,
      tags: form.elements.tags.value,
      notice: form.elements.notice.value,
      groupId: form.elements.groupId.value,
    });
    working = {
      type: "site",
      siteId: id,
      initial: restored?.initial || original,
      values: clone(value),
    };
    const change = () => {
      working.values = values();
      schedule();
    };
    const drawIcon = () => {
      $(d, "#chosen-icon").classList.toggle(
        "sprite",
        Boolean(boot.iconPaths[iconValue]),
      );
      $(d, "#chosen-icon").dataset.icon = iconValue;
      $(d, "#chosen-icon").innerHTML = image({
        ...values(),
        id: original.id,
        title: values().title || "网",
      });
      $(d, "#icon-path").textContent = iconValue || "文字回退";
      imageFallback(d);
    };
    drawIcon();
    form.addEventListener("input", change);
    form.addEventListener("change", change);
    $(d, "#choose-icon").addEventListener("click", (event) => {
      event.currentTarget.focus({ preventScroll: true });
      pickIcon(iconValue, (path) => {
        iconValue = path;
        change();
        drawIcon();
      });
    });
    $(d, "#clear-icon").addEventListener("click", () => {
      iconValue = "";
      change();
      drawIcon();
    });
    function close(discard = false) {
      if (
        !discard &&
        !equal(values(), working.initial) &&
        !confirm(
          "这些输入尚未应用。放弃本次输入？已应用的其他修改仍保留在草稿中。",
        )
      )
        return;
      working = null;
      d.close();
      schedule();
    }
    for (const button of d.querySelectorAll("[data-close]"))
      button.addEventListener("click", () => close());
    d.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    $(d, "#delete-site")?.addEventListener("click", () => {
      if (!confirm("删除此网站？可通过撤销恢复。")) return;
      const next = clone(history.value);
      for (const g of next.groups) g.sites = g.sites.filter((s) => s.id !== id);
      working = null;
      commit(next);
      d.close();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const v = values(),
          site = {
            id: original.id,
            title: v.title.trim(),
            description: v.description.trim(),
            url: v.url.trim(),
            alternateUrls: v.alternateUrls
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean),
            icon: v.icon,
            iconText: v.iconText.trim(),
            pinned: existing?.pinned || false,
            ...(existing?.pinOrder !== undefined
              ? { pinOrder: existing.pinOrder }
              : {}),
            newTab: v.newTab,
            tags: v.tags
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean),
            notice: v.notice.trim(),
          };
        const next = clone(history.value);
        const target = next.groups.find((g) => g.id === v.groupId);
        if (!target) throw Error("请先选择分类");
        const old = next.groups.find((g) => g.sites.some((s) => s.id === id));
        if (old?.id === target.id)
          old.sites[old.sites.findIndex((s) => s.id === id)] = site;
        else {
          if (old) old.sites = old.sites.filter((s) => s.id !== id);
          target.sites.push(site);
        }
        const updated = setPinned(next, site.id, v.pinned);
        assertValid(updated);
        await checkIcons(updated);
        selected = target.id;
        working = null;
        commit(updated);
        d.close();
      } catch (error) {
        $(d, ".form-error").textContent = error.message;
      }
    });
    d.addEventListener("close", () => d.remove(), { once: true });
    d.showModal();
    $(d, "input[name=title]").focus();
  }
  function openGroup(id = "", restored = null) {
    const group = history.value.groups.find((g) => g.id === id);
    const original = { title: group?.title || "", target: "" };
    const value = restored?.values || original;
    const d = dialog(
      "form-dialog",
      `<form><div class="dialog-heading"><h3>${group ? "编辑分类" : "添加分类"}</h3><button type="button" class="quiet" data-close aria-label="关闭分类编辑">✕</button></div><div class="dialog-content"><label class="field"><span>分类名称</span><input name="title" maxlength="80" required value="${escape(value.title)}"></label>${group ? `<p class="help-text">${group.sites.length} 个网站 · 分类排序</p><div class="row-actions"><button type="button" id="group-up">↑ 上移分类</button><button type="button" id="group-down">↓ 下移分类</button></div>${group.sites.length ? `<label class="field"><span>删除时将网站移至</span><select name="target"><option value="">请选择其他分类</option>${currentGroupOptions(value.target, id)}</select><small>非空分类不能直接删除，网站会保留。</small></label>` : ""}` : ""}<p class="form-error" role="alert"></p></div><div class="dialog-actions">${group ? '<button class="danger" type="button" id="delete-group">删除分类</button>' : ""}<button type="button" data-close>取消</button><button type="submit" class="primary">应用分类</button></div></form>`,
    );
    const form = $(d, "form");
    const values = () => ({
      title: form.elements.title.value,
      target: form.elements.target?.value || "",
    });
    working = {
      type: "group",
      groupId: id,
      initial: restored?.initial || original,
      values: clone(value),
    };
    form.addEventListener("input", () => {
      working.values = values();
      schedule();
    });
    form.addEventListener("change", () => {
      working.values = values();
      schedule();
    });
    const close = () => {
      if (
        !equal(values(), working.initial) &&
        !confirm("放弃尚未应用的分类输入？")
      )
        return;
      working = null;
      d.close();
      schedule();
    };
    for (const b of d.querySelectorAll("[data-close]"))
      b.addEventListener("click", close);
    d.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    for (const [selector, delta] of [
      ["#group-up", -1],
      ["#group-down", 1],
    ])
      $(d, selector)?.addEventListener("click", () => {
        const index = history.value.groups.findIndex((g) => g.id === id);
        commit(moveGroup(history.value, id, index + delta));
      });
    $(d, "#delete-group")?.addEventListener("click", () => {
      try {
        const next = clone(history.value),
          g = next.groups.find((g) => g.id === id);
        if (g.sites.length) {
          const target = next.groups.find(
            (g) => g.id === values().target && g.id !== id,
          );
          if (!target) throw Error("请先选择接收网站的分类");
          target.sites.push(...g.sites);
          selected = target.id;
        }
        next.groups = next.groups.filter((g) => g.id !== id);
        working = null;
        commit(next);
        d.close();
      } catch (error) {
        $(d, ".form-error").textContent = error.message;
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const next = clone(history.value);
        if (group)
          next.groups.find((g) => g.id === id).title = values().title.trim();
        else {
          const newGroup = {
            id: newID("group"),
            title: values().title.trim(),
            sites: [],
          };
          next.groups.push(newGroup);
          selected = newGroup.id;
        }
        assertValid(next);
        working = null;
        commit(next);
        d.close();
      } catch (error) {
        $(d, ".form-error").textContent = error.message;
      }
    });
    d.addEventListener("close", () => d.remove(), { once: true });
    d.showModal();
    $(d, "input").focus();
  }
  async function chooseDraft(force = false) {
    let drafts;
    try {
      drafts = await loadDrafts();
    } catch (error) {
      storageError = error.message;
      status();
      return;
    }
    drafts = drafts.filter(
      (d) =>
        d.schemaVersion === 1 &&
        ((d.working && !equal(d.working.values, d.working.initial)) ||
          !equal(d.config, d.baseConfig)),
    );
    if (!drafts.length) {
      if (force) toast("没有其他未同步草稿。");
      return;
    }
    const own = drafts.find((d) => d.id === draftId);
    if (own) drafts = [own, ...drafts.filter((d) => d !== own)];
    const d = dialog(
      "form-dialog",
      `<div class="dialog-heading"><h3>恢复未同步草稿</h3></div><div class="dialog-content"><p>草稿可能来自其他标签页或旧版本。恢复后仍会检查 GitHub 冲突。</p><label class="field"><span>选择草稿</span><select>${drafts.map((record, i) => `<option value="${i}">${escape(new Date(record.savedAt).toLocaleString())} · ${escape(record.config.settings.title)}</option>`).join("")}</select></label><p class="form-error" role="alert"></p></div><div class="dialog-actions"><button id="fresh">${force ? "取消" : "使用正式配置"}</button><button id="restore" class="primary">恢复草稿</button></div>`,
    );
    await new Promise((resolve) => {
      const fresh = () => {
        if (!force && own) {
          draftId = crypto.randomUUID();
          try {
            sessionStorage.setItem("zzp-home-editor-v1", draftId);
          } catch {}
        }
        d.close();
        resolve();
      };
      $(d, "#fresh").addEventListener("click", fresh);
      d.addEventListener("cancel", (event) => {
        event.preventDefault();
        fresh();
      });
      $(d, "#restore").addEventListener("click", async () => {
        try {
          const record = drafts[Number($(d, "select").value)];
          assertValid(record.config);
          assertValid(record.baseConfig);
          if (!/^[a-f0-9]{40,64}$/.test(record.baseSha))
            throw Error("草稿基线无效");
          if (force && dirty())
            await saveDraft(crypto.randomUUID(), snapshot());
          base = clone(record.baseConfig);
          baseSha = record.baseSha;
          history = new History(record.config, record.history);
          selected = record.selected;
          working = clone(record.working);
          render();
          await persist();
          d.close();
          resolve();
        } catch (error) {
          $(d, ".form-error").textContent = "无法恢复此草稿。" + error.message;
        }
      });
      d.addEventListener("close", () => d.remove(), { once: true });
      d.showModal();
    });
    if (working?.type === "site") openSite(working.siteId, clone(working));
    else if (working?.type === "group")
      openGroup(working.groupId, clone(working));
    else if (working?.type === "settings") {
      selected = "settings";
      render();
    }
  }
  async function publish() {
    try {
      if (!leaveSettings()) return;
      assertValid(history.value);
      await checkIcons(history.value);
      await persist();
    } catch (error) {
      toast(error.message);
      return;
    }
    let remoteConflict = null,
      busy = false;
    const d = dialog(
      "form-dialog",
      `<form><div class="dialog-heading"><h3>保存到 GitHub</h3><button type="button" class="quiet" data-close aria-label="关闭发布">✕</button></div><div class="dialog-content"><p class="publish-note">配置直接保存到 GitHub 正式配置，随后自动部署。其他设备在部署完成并更新页面后获取修改。</p><label class="field"><span>GitHub Token</span><input type="password" name="credential" autocomplete="off" autocapitalize="off" spellcheck="false" required placeholder="仅本次操作使用"><small>推荐 fine-grained PAT：仅 zzp-home 仓库，Contents 读写权限。Token 不保存到草稿或浏览器存储。</small></label><div class="publish-links"><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">创建限权 Token ↗</a><a href="https://github.com/zzpice/zzp-home/actions" target="_blank" rel="noopener noreferrer">检查部署 ↗</a></div><p class="publish-status" role="status"></p><p class="form-error" role="alert"></p><div id="publish-result"></div><div id="conflict" hidden><p class="help-text">可以合并不重叠的字段。重叠修改会列出路径，请导出备份并在 GitHub 核对。</p><div class="row-actions"><button type="button" id="merge">合并云端修改</button><button type="button" id="remote">从云端重新开始</button></div><ul class="conflict-list"></ul><button type="button" id="conflict-export" class="text-button">导出当前草稿</button></div></div><div class="dialog-actions"><button type="button" data-close>关闭</button><button type="submit" class="primary">保存正式配置</button></div></form>`,
    );
    const form = $(d, "form");
    const close = () => {
      if (busy) return;
      form.elements.credential.value = "";
      d.close();
    };
    for (const b of d.querySelectorAll("[data-close]"))
      b.addEventListener("click", close);
    d.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      $(d, ".form-error").textContent = "";
      $(d, "#publish-result").replaceChildren();
      let publisher;
      try {
        publisher = new GitHubPublisher(form.elements.credential.value);
        form.elements.credential.value = "";
        for (const b of form.querySelectorAll("button,input"))
          b.disabled = true;
        $(d, ".publish-status").textContent = "正在保存正式配置…";
        const result = await publisher.publish(clone(history.value), baseSha);
        base = clone(result.remote.config);
        baseSha = result.remote.sha;
        history = new History(base);
        render();
        onPreview(clone(base), false);
        const localSaved = await persist().then(() => true, () => false);
        $(d, "#conflict").hidden = true;
        $(d, ".publish-status").textContent = result.alreadyInMain
          ? "配置已在 GitHub。部署完成后可检查更新。"
          : "已保存到 GitHub，等待自动部署。";
        if (!localSaved) $(d, ".publish-status").textContent += " 本机草稿存储失败，请导出备份。";
        const link = document.createElement("a");
        link.href = result.commit
          ? "https://github.com/zzpice/zzp-home/commit/" + result.commit
          : "https://github.com/zzpice/zzp-home/actions";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = result.commit ? "查看保存记录 ↗" : "查看部署 ↗";
        $(d, "#publish-result").replaceChildren(link);
      } catch (error) {
        $(d, ".publish-status").textContent = "保存未完成，本机草稿保留。";
        $(d, ".form-error").textContent = error.message;
        if (error instanceof ConflictError) {
          remoteConflict = error.remote;
          $(d, "#conflict").hidden = false;
        }
      } finally {
        publisher?.dispose();
        form.elements.credential.value = "";
        busy = false;
        for (const b of form.querySelectorAll("button,input"))
          b.disabled = false;
        status();
      }
    });
    $(d, "#merge").addEventListener("click", async () => {
      if (!remoteConflict) return;
      try {
        const merged = mergeConfig(base, history.value, remoteConflict.config);
        const list = $(d, ".conflict-list");
        list.replaceChildren();
        if (merged.conflicts.length) {
          for (const path of merged.conflicts) {
            const li = document.createElement("li");
            li.textContent = path;
            list.append(li);
          }
          $(d, ".form-error").textContent =
            "存在重叠修改，未覆盖任何配置。请核对以上路径。";
          return;
        }
        base = clone(remoteConflict.config);
        baseSha = remoteConflict.sha;
        history = new History(merged.value);
        render();
        await persist();
        $(d, "#conflict").hidden = true;
        $(d, ".form-error").textContent = "";
        $(d, ".publish-status").textContent =
          "已合并不冲突的修改。重新输入 Token 可保存正式配置。";
        remoteConflict = null;
      } catch (error) {
        $(d, ".form-error").textContent = error.message;
      }
    });
    $(d, "#remote").addEventListener("click", async () => {
      if (!remoteConflict) return;
      try {
        await saveDraft(crypto.randomUUID(), snapshot());
        base = clone(remoteConflict.config);
        baseSha = remoteConflict.sha;
        history = new History(base);
        working = null;
        render();
        await persist();
        $(d, "#conflict").hidden = true;
        $(d, ".form-error").textContent = "";
        $(d, ".publish-status").textContent =
          "已读取云端配置。原草稿已另存，可从“其他草稿”恢复。";
        remoteConflict = null;
      } catch (error) {
        $(d, ".form-error").textContent = error.message;
      }
    });
    $(d, "#conflict-export").addEventListener("click", () =>
      download(history.value, "zzp-home-conflict-draft.json"),
    );
    d.addEventListener("close", () => d.remove(), { once: true });
    d.showModal();
    form.elements.credential.focus();
  }
  main.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    // Safari does not focus buttons on pointer clicks. Give nested dialogs an
    // explicit opener so Escape restores useful keyboard focus consistently.
    button.focus({ preventScroll: true });
    const action = button.dataset.action,
      id = button.dataset.id;
    if (!["close", "export"].includes(action) && !leaveSettings()) return;
    try {
      switch (action) {
        case "close":
          try {
            await persist();
          } catch (error) {
            if (
              !confirm(
                error.message +
                  "\n仍要关闭编辑器？本次内容继续留在当前页面内存中；刷新前请重新打开并导出。",
              )
            )
              break;
          }
          main.close();
          break;
        case "undo":
          working = null;
          history.undo();
          render();
          schedule();
          break;
        case "redo":
          working = null;
          history.redo();
          render();
          schedule();
          break;
        case "preview":
          await persist();
          onPreview(clone(history.value));
          main.close();
          toast("正在预览本机草稿，正式配置尚未改变。");
          break;
        case "select-group":
          selected = id;
          render();
          break;
        case "pin":
        case "unpin":
          commit(setPinned(history.value, id, action === "pin"));
          break;
        case "pin-up":
        case "pin-down": {
          const index = pinnedSites(history.value).findIndex(
            (s) => s.id === id,
          );
          commit(
            movePinned(
              history.value,
              id,
              index + (action === "pin-up" ? -1 : 1),
            ),
          );
          $(main, `[data-pin-id="${id}"] [data-action="${action}"]`)?.focus();
          break;
        }
        case "add-site":
          openSite();
          break;
        case "edit-site":
          openSite(id);
          break;
        case "add-group":
          openGroup();
          break;
        case "edit-group":
          openGroup(id);
          break;
        case "site-up":
        case "site-down": {
          const g = history.value.groups.find((g) =>
            g.sites.some((s) => s.id === id),
          );
          const index = g.sites.findIndex((s) => s.id === id);
          commit(
            moveSite(
              history.value,
              id,
              g.id,
              index + (action === "site-up" ? -1 : 1),
            ),
          );
          $(main, `[data-site-id="${id}"] [data-action="${action}"]`)?.focus();
          break;
        }
        case "settings":
          selected = "settings";
          render();
          break;
        case "export":
          if (leaveSettings()) download(history.value);
          break;
        case "import":
          $(main, "#import-file").click();
          break;
        case "publish":
          await publish();
          break;
        case "drafts":
          await chooseDraft(true);
          break;
      }
    } catch (error) {
      toast(error.message);
    }
  });
  main.addEventListener("cancel", (event) => {
    event.preventDefault();
    $(main, "[data-action=close]").click();
  });
  main.addEventListener("keydown", (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === "z" &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)
    ) {
      event.preventDefault();
      if (!leaveSettings()) return;
      working = null;
      if (event.shiftKey) history.redo();
      else history.undo();
      render();
      schedule();
    }
  });
  $(main, "#import-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw Error("配置文件过大");
      let config;
      try {
        config = JSON.parse(await file.text());
      } catch {
        throw Error("文件不是有效 JSON");
      }
      if (config.appName === "Sun-Panel-Config")
        throw Error(
          "SunPanel 原始数据请先用 Go migrate 命令脱敏迁移，再导入正式配置。",
        );
      assertValid(config);
      await checkIcons(config);
      commit(config);
      toast("配置已导入本机草稿，尚未同步。");
    } catch (error) {
      toast(error.message);
    } finally {
      event.target.value = "";
    }
  });
  let drag = null,
    scrollFrame;
  const cleanup = () => {
    if (drag) drag.source.classList.remove("dragging");
    main
      .querySelectorAll(".drop-target")
      .forEach((e) => e.classList.remove("drop-target"));
    drag = null;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = null;
  };
  main.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-drag]");
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    drag = {
      type: handle.dataset.drag,
      id: handle.dataset.id,
      x: event.clientX,
      y: event.clientY,
      currentY: event.clientY,
      moved: false,
      source: handle.closest("[data-site-id],[data-group-id]"),
    };
  });
  main.addEventListener("pointermove", (event) => {
    if (!drag) return;
    drag.currentY = event.clientY;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 7) {
      drag.moved = true;
      drag.source.classList.add("dragging");
    }
    if (!drag.moved) return;
    main
      .querySelectorAll(".drop-target")
      .forEach((e) => e.classList.remove("drop-target"));
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest(
        drag.type === "pin"
          ? "[data-pin-id]"
          : drag.type === "site"
            ? "[data-site-id],[data-group-id],[data-target-group]"
            : "[data-group-id]",
      );
    target?.classList.add("drop-target");
    if (!scrollFrame) {
      const scroll = () => {
        if (!drag) return;
        const list = $(main, ".editor-list"),
          rect = list.getBoundingClientRect();
        if (drag.currentY < rect.top + 45) list.scrollTop -= 10;
        else if (drag.currentY > rect.bottom - 45) list.scrollTop += 10;
        scrollFrame = requestAnimationFrame(scroll);
      };
      scrollFrame = requestAnimationFrame(scroll);
    }
  });
  main.addEventListener("pointerup", (event) => {
    if (!drag) return;
    const state = drag;
    if (state.moved) {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      try {
        if (state.type === "group") {
          const g = target?.closest("[data-group-id]");
          if (g && g.dataset.groupId !== state.id) {
            let i = history.value.groups.findIndex(
              (x) => x.id === g.dataset.groupId,
            );
            const from = history.value.groups.findIndex(
                (x) => x.id === state.id,
              ),
              rect = g.getBoundingClientRect();
            const horizontal =
              getComputedStyle($(main, ".editor-groups")).display === "flex";
            if (
              horizontal
                ? event.clientX > rect.left + rect.width / 2
                : event.clientY > rect.top + rect.height / 2
            )
              i++;
            if (from < i) i--;
            commit(moveGroup(history.value, state.id, i));
          }
        } else if (state.type === "pin") {
          const row = target?.closest("[data-pin-id]");
          if (row && row.dataset.pinId !== state.id) {
            const pins = pinnedSites(history.value);
            let index = pins.findIndex((s) => s.id === row.dataset.pinId);
            const rect = row.getBoundingClientRect();
            if (event.clientY > rect.top + rect.height / 2) index++;
            if (pins.findIndex((s) => s.id === state.id) < index) index--;
            commit(movePinned(history.value, state.id, index));
          }
        } else {
          const row = target?.closest("[data-site-id]"),
            group = target?.closest("[data-group-id]"),
            list = target?.closest("[data-target-group]");
          const groupId =
            group?.dataset.groupId ||
            row?.dataset.targetGroup ||
            list?.dataset.targetGroup;
          if (groupId) {
            const g = history.value.groups.find((x) => x.id === groupId),
              from = history.value.groups.find((x) =>
                x.sites.some((s) => s.id === state.id),
              );
            let index = g.sites.length;
            if (row) {
              index = g.sites.findIndex((s) => s.id === row.dataset.siteId);
              const rect = row.getBoundingClientRect();
              if (event.clientY > rect.top + rect.height / 2) index++;
            }
            if (
              from.id === g.id &&
              from.sites.findIndex((s) => s.id === state.id) < index
            )
              index--;
            commit(moveSite(history.value, state.id, g.id, index));
            selected = g.id;
            render();
          }
        }
        toast("顺序已更新，可撤销。");
      } catch (error) {
        toast(error.message);
      }
    }
    cleanup();
  });
  main.addEventListener("pointercancel", cleanup);
  render();
  return {
    async open() {
      if (!main.open) main.showModal();
      render();
      if (!initialized) {
        initialized = true;
        await chooseDraft();
      }
    },
    hasChanges: dirty,
    async prepareUpdate() {
      await persist();
    },
  };
}
