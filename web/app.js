import { allSites, matches, assertValid } from "./model.js";
const boot = JSON.parse(document.querySelector("#bootstrap").textContent);
const official = assertValid(boot.config);
const baseURL = new URL("../../", import.meta.url);
const releaseURL = new URL("./", import.meta.url);
const $ = (selector) => document.querySelector(selector);
let current = official,
  editor,
  registration,
  preview = false,
  allowUpdate = false;
let group = new URL(location.href).searchParams.get("group") || "";
let query = new URL(location.href).searchParams.get("q") || "";
let sort =
  new URL(location.href).searchParams.get("sort") === "name"
    ? "name"
    : "manual";
let themeMode = document.documentElement.dataset.themeMode || "shared";
const system = matchMedia("(prefers-color-scheme: dark)");
let toastTimer;
export function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 6500);
}
function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function applyTheme() {
  const mode = themeMode === "shared" ? current.settings.theme : themeMode;
  const dark = mode === "dark" || (mode === "system" && system.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themeMode = themeMode;
  document.querySelector('meta[name="theme-color"]').content = dark
    ? "#14171d"
    : "#f5f6f8";
  $("#appearance").value = themeMode;
  $("#appearance option[value=shared]").textContent =
    "共享默认" +
    { system: " · 系统", dark: " · 深色", light: " · 浅色" }[
      current.settings.theme
    ];
}
$("#appearance").hidden = false;
applyTheme();
$("#appearance").addEventListener("change", (event) => {
  themeMode = event.target.value;
  try {
    if (themeMode === "shared") localStorage.removeItem("zzp-home-theme");
    else localStorage.setItem("zzp-home-theme", themeMode);
  } catch {}
  applyTheme();
});
system.addEventListener("change", applyTheme);
window.addEventListener("storage", (event) => {
  if (event.key === "zzp-home-theme" || event.key === null) {
    themeMode = ["light", "dark", "system"].includes(event.newValue)
      ? event.newValue
      : "shared";
    applyTheme();
  }
});
function initial(site) {
  return site.iconText || [...site.title.trim()][0];
}
function icon(site) {
  const tone = [...site.id].reduce((n, c) => n + c.codePointAt(0), 0) % 6;
  const span = node("span", "site-icon tone-" + tone);
  if (site.icon) {
    const img = node("img");
    img.width = img.height = 48;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    if (boot.iconPaths[site.icon]) {
      span.classList.add("sprite");
      span.dataset.icon = site.icon;
      img.className = "atlas";
    }
    img.src = boot.iconPaths[site.icon]
      ? new URL(boot.iconPaths[site.icon], releaseURL)
      : "https://raw.githubusercontent.com/zzpice/assets/" +
        boot.iconRevision +
        "/" +
        site.icon;
    img.addEventListener(
      "error",
      () => {
        span.classList.remove("sprite");
        span.replaceChildren(node("span", "", initial(site)));
      },
      { once: true },
    );
    span.append(img);
  } else span.append(node("span", "", initial(site)));
  return span;
}
function card(site) {
  const article = node("article", "site-card");
  article.dataset.site = site.id;
  const a = node("a", "site-link");
  a.href = site.url;
  a.target = site.newTab ? "_blank" : "_self";
  a.rel = "noopener noreferrer";
  if (site.notice) a.title = site.notice;
  a.append(icon(site));
  const copy = node("span", "site-copy");
  copy.append(
    node("strong", "", site.title),
    node("span", "description", site.description),
  );
  if (site.notice) copy.append(node("small", "notice", "需确认入口"));
  a.append(copy);
  const arrow = node("span", "external", "↗");
  arrow.setAttribute("aria-hidden", "true");
  a.append(arrow);
  article.append(a);
  if (site.alternateUrls.length) {
    const details = node("details", "alternates");
    details.append(node("summary", "", "备用入口"));
    for (const u of site.alternateUrls) {
      const link = node("a", "", u + " ↗");
      link.href = u;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      details.append(link);
    }
    article.append(details);
  }
  return article;
}
function section(id, title, sites, extra = "") {
  const el = node("section", "site-section " + extra);
  el.id = id;
  const heading = node("div", "section-heading");
  heading.append(
    node("h2", "", title),
    node("span", "", sites.length + " 个网站"),
  );
  el.append(heading);
  const grid = node("div", "site-grid");
  for (const s of sites) grid.append(card(s));
  el.append(grid);
  return el;
}
function renderConfig(config, isPreview = false) {
  current = assertValid(config);
  preview = isPreview;
  const root = document.documentElement;
  root.dataset.layout = current.settings.layout;
  root.dataset.density = current.settings.density;
  root.dataset.descriptions = String(current.settings.showDescriptions);
  applyTheme();
  if (boot.page !== "home") return;
  $(".brand strong").textContent = current.settings.title;
  $(".introduction>p:last-child").textContent = current.settings.subtitle;
  const sites = allSites(current),
    pinned = sites.filter((s) => s.pinned);
  const content = $("#navigation-content");
  content.replaceChildren();
  if (pinned.length)
    content.append(section("pinned", "置顶", pinned, "pinned-section"));
  const nav = $("#groups");
  nav.replaceChildren();
  for (const [id, title, count] of [
    ["", "全部网站", sites.length],
    ["pinned", "☆ 置顶", pinned.length],
    ...current.groups.map((g) => [g.id, g.title, g.sites.length]),
  ]) {
    const a = node("a");
    a.href = id
      ? "?group=" + id + "#" + (id === "pinned" ? "pinned" : "g-" + id)
      : baseURL.href;
    a.dataset.group = id;
    a.append(node("span", "", title), node("small", "", String(count)));
    nav.append(a);
  }
  for (const g of current.groups) {
    const el = section("g-" + g.id, g.title, g.sites, "group");
    el.dataset.group = g.id;
    content.append(el);
  }
  let badge = $("#preview-badge");
  if (isPreview && !badge) {
    badge = node("div", "publish-note");
    badge.id = "preview-badge";
    badge.append(node("span", "", "正在预览本机草稿。 "));
    const b = node("button", "text-button", "返回正式配置");
    b.addEventListener("click", () => renderConfig(official, false));
    badge.append(b);
    $(".browse-toolbar").before(badge);
  } else if (!isPreview) badge?.remove();
  filter();
  connection();
}
function filter(updateURL = false) {
  if (boot.page !== "home") return;
  if (
    group &&
    group !== "pinned" &&
    !current.groups.some((g) => g.id === group)
  )
    group = "";
  const sites = allSites(current),
    lookup = new Map(sites.map((s) => [s.id, s])),
    order = new Map(sites.map((s, i) => [s.id, i]));
  let total = 0;
  for (const el of document.querySelectorAll(
    "#navigation-content .site-section",
  )) {
    const pinned = el.id === "pinned";
    const eligible = pinned
      ? group === "pinned" || (!group && !query)
      : !group || group === el.dataset.group;
    const cards = [...el.querySelectorAll(".site-card")];
    let count = 0;
    for (const card of cards) {
      const hit = eligible && matches(lookup.get(card.dataset.site), query);
      card.hidden = !hit;
      if (hit) count++;
    }
    const grid = el.querySelector(".site-grid");
    cards
      .sort((a, b) =>
        sort === "name"
          ? lookup
              .get(a.dataset.site)
              .title.localeCompare(lookup.get(b.dataset.site).title, "zh-CN")
          : order.get(a.dataset.site) - order.get(b.dataset.site),
      )
      .forEach((card) => grid.append(card));
    el.hidden = !eligible || count === 0;
    el.querySelector(".section-heading>span").textContent = count + " 个网站";
    if (!pinned || group === "pinned") total += count;
  }
  for (const link of $("#groups").querySelectorAll("a")) {
    link.classList.toggle("active", link.dataset.group === group);
    if (link.dataset.group === group) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
  $("#result-count").textContent =
    (preview ? "草稿预览 · " : "") +
    total +
    " 个网站" +
    (query ? " · 搜索结果" : "");
  $("#empty").hidden = total > 0;
  $("#clear-filter").hidden = !group && !query;
  $("#search").value = query;
  $("#sort").value = sort;
  if (updateURL) {
    const url = new URL(location.href);
    for (const [k, v] of Object.entries({
      group,
      q: query,
      sort: sort === "name" ? "name" : "",
    })) {
      if (v) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    }
    url.searchParams.delete("edit");
    url.hash = "";
    history.replaceState(null, "", url);
  }
}
function connection() {
  const el = $("#connection-status");
  el.textContent = navigator.onLine
    ? preview
      ? "本机草稿预览"
      : "正式配置 · " + boot.release.slice(0, 8)
    : "离线 · 使用本地缓存";
}
window.addEventListener("online", connection);
window.addEventListener("offline", connection);
connection();
if (boot.page === "home") {
  filter();
  $("#search").addEventListener("input", (event) => {
    query = event.target.value;
    filter(true);
  });
  $("#sort").addEventListener("change", (event) => {
    sort = event.target.value;
    filter(true);
  });
  $("#groups").addEventListener("click", (event) => {
    const a = event.target.closest("a[data-group]");
    if (!a) return;
    event.preventDefault();
    group = a.dataset.group;
    filter(true);
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  $("#clear-filter").addEventListener("click", () => {
    query = group = "";
    filter(true);
    $("#search").focus();
  });
  $("#layout").hidden = false;
  $("#layout").addEventListener("click", () => {
    document.documentElement.dataset.layout =
      document.documentElement.dataset.layout === "grid" ? "list" : "grid";
  });
  $("#edit").hidden = false;
  async function openEditor() {
    $("#edit").focus({ preventScroll: true });
    try {
      if (!editor) {
        const module = await import("./editor.js");
        editor = await module.createEditor({
          boot,
          baseURL,
          releaseURL,
          toast,
          onPreview: (c) => renderConfig(c, true),
        });
      }
      await editor.open();
    } catch (error) {
      toast(error.message || "编辑器加载失败，请联网后重试。");
    }
  }
  $("#edit").addEventListener("click", openEditor);
  if (new URL(location.href).searchParams.get("edit") === "1") openEditor();
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "/" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !document.querySelector("dialog[open]") &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)
    ) {
      event.preventDefault();
      $("#search").focus();
    }
    if (event.key === "Escape" && document.activeElement === $("#search")) {
      $("#search").value = query = "";
      filter(true);
    }
  });
  // The prerendered image may have failed before module execution.
  for (const img of document.querySelectorAll(".site-icon img")) {
    const fallback = () => {
      const site = allSites(current).find(
        (s) => s.id === img.closest("[data-site]")?.dataset.site,
      );
      if (site)
        img.parentElement.replaceChildren(node("span", "", initial(site)));
    };
    img.addEventListener("error", fallback, { once: true });
    if (img.complete && !img.naturalWidth) fallback();
  }
}
window.addEventListener("beforeunload", (event) => {
  if (editor?.hasChanges() && !allowUpdate) {
    event.preventDefault();
    event.returnValue = "";
  }
});
let unlockTimer;
function lock(value) {
  document.body.inert = value;
  for (const dialog of document.querySelectorAll("dialog"))
    dialog.inert = value;
  clearTimeout(unlockTimer);
  if (value) unlockTimer = setTimeout(() => lock(false), 10000);
}
async function register() {
  if (!("serviceWorker" in navigator)) return;
  try {
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) location.reload();
      else hadController = true;
    });
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "CAN_UPDATE") {
        const ready = allowUpdate || !editor?.hasChanges();
        if (ready) lock(true);
        event.ports[0]?.postMessage(ready);
      }
      if (event.data?.type === "UPDATE_CANCELLED") {
        lock(false);
        allowUpdate = false;
      }
    });
    registration = await navigator.serviceWorker.register(
      new URL("sw.js", baseURL),
      { scope: baseURL.pathname, updateViaCache: "none" },
    );
    const show = () => {
      $("#update-banner").hidden = !(
        registration.waiting && navigator.serviceWorker.controller
      );
    };
    show();
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (["installed", "redundant", "activated"].includes(worker.state))
          show();
      });
    });
    $("#check-update").hidden = false;
    $("#check-update").addEventListener("click", async () => {
      try {
        await registration.update();
        if (registration.waiting) show();
        else toast("已检查更新；新版本会在完整下载后提示。");
      } catch {
        toast("暂时无法检查更新，当前缓存仍可使用。");
      }
    });
  } catch {
    /* Online browsing remains available; no false offline-ready promise. */
  }
}
$("#defer-update").addEventListener("click", () => {
  $("#update-banner").hidden = true;
});
$("#apply-update").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    if (editor) await editor.prepareUpdate();
    // Select the registration for this document, including subpath deployments.
    const latest = await navigator.serviceWorker.getRegistration();
    const waiting = latest?.waiting;
    if (!waiting) throw Error("候选版本已变化，请检查更新后重试。");
    registration = latest;
    allowUpdate = true;
    const answer = await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        reject(Error("更新检查超时，请稍后重试。"));
      }, 6000);
      channel.port1.onmessage = (e) => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(e.data);
      };
      waiting.postMessage({ type: "APPLY_UPDATE" }, [channel.port2]);
    });
    if (!answer.allowed)
      throw Error(
        "其他标签页仍有编辑或未响应。请先保存并关闭那些标签页，再更新。",
      );
  } catch (error) {
    allowUpdate = false;
    lock(false);
    button.disabled = false;
    toast(error.message);
  }
});
if ("requestIdleCallback" in window)
  requestIdleCallback(register, { timeout: 2000 });
else setTimeout(register, 1000);
