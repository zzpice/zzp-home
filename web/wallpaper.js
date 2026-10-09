const ASSETS = "https://zzpice.github.io/assets/";
const INDEX_URL = ASSETS + "wallpapers/index.json";
const INDEX_KEY = "zzp-home-wallpaper-index";
const PREF_KEY = "zzp-home-wallpaper";
const LAST_KEY = "zzp-home-wallpaper-last";
const CACHE = "zzp-home-wallpaper-v1";
const TTL = 6 * 60 * 60 * 1000;
export const wallpaperPath = /^wallpapers\/[a-z0-9][a-z0-9-]*\/[1-9][0-9]*x[1-9][0-9]*\/[a-z0-9][a-z0-9-]*\.(png|jpe?g|gif|webp|avif)$/;
const previewPath = /^app\/previews\/[a-z0-9-]+\.webp$/;
export function dayNumber(now = Date.now()) { return Math.floor((now + 8 * 60 * 60 * 1000) / 86400000); }
export function backgroundCandidates(items) {
  const landscape = items.filter(item => item.width >= 1600 && item.height >= 900 && item.width / item.height >= 1.4 && item.width / item.height <= 3.6);
  const desktop = landscape.filter(item => item.device === "desktop");
  return (desktop.length ? desktop : landscape).slice().sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
export function dailyWallpaper(items, now = Date.now()) {
  const pool = backgroundCandidates(items);
  return pool.length ? pool[((dayNumber(now) % pool.length) + pool.length) % pool.length] : null;
}
export function preference(value) {
  return value && ["shared", "daily", "fixed", "off"].includes(value.mode) && (value.mode !== "fixed" || wallpaperPath.test(value.path)) ? {mode: value.mode, path: value.path || ""} : {mode: "shared", path: ""};
}
function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
export function validateIndex(value) {
  if (value?.version !== 1 || !Array.isArray(value.wallpapers) || value.wallpapers.length > 10000) throw Error("壁纸目录无效");
  const paths = new Set();
  return value.wallpapers.filter(item => {
    if (!item || !wallpaperPath.test(item.path) || paths.has(item.path) || !Number.isInteger(item.width) || !Number.isInteger(item.height) || item.width <= 0 || item.height <= 0 || !/^[a-f0-9]{40}$/.test(item.sha)) return false;
    if (item.background && !previewPath.test(item.background)) return false;
    if (item.thumbnail && !previewPath.test(item.thumbnail)) return false;
    paths.add(item.path); return true;
  });
}
let pending;
let indexAvailable = false;
async function json(url, timeout = 6000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {signal: controller.signal, cache: "no-cache", credentials: "omit", redirect: "error"});
    if (!response.ok) throw Error("加载失败");
    return await response.json();
  } finally { clearTimeout(timer); }
}
export async function loadWallpaperIndex(force = false) {
  const saved = read(INDEX_KEY);
  let cached;
  try { cached = validateIndex(saved?.data); } catch {}
  if (cached) indexAvailable = true;
  if (!force && cached && Date.now() - saved.at < TTL && Date.now() >= saved.at) return cached;
  if (!pending) pending = (async () => {
    try {
      const data = await json(INDEX_URL);
      const items = validateIndex(data); indexAvailable = true; write(INDEX_KEY, {at: Date.now(), data}); return items;
    } catch { return cached || []; }
    finally { pending = null; }
  })();
  return pending;
}
export function fillWallpaperSelect(select, items, selected = "") {
  select.replaceChildren(new Option("选择仓库壁纸", ""));
  for (const item of items) select.add(new Option(`${item.title || item.path.split("/").pop()} · ${item.width}×${item.height}`, item.path));
  if (selected && !items.some(item => item.path === selected)) select.add(new Option("原选择暂不可用（回退每日壁纸）", selected));
  select.value = selected;
}
export function startWallpapers(defaults) {
  const image = document.querySelector("#wallpaper-image"), mode = document.querySelector("#wallpaper-mode"), fixed = document.querySelector("#wallpaper-fixed"), status = document.querySelector("#wallpaper-status");
  let shared = defaults || {mode: "off", path: ""}, local = preference(read(PREF_KEY)), generation = 0, objectURL, lastSelection;
  function syncControls() { mode.value = local.mode; mode.options[0].textContent = "共享默认 · " + ({daily: "仓库每日轮换", fixed: "固定仓库壁纸", off: "关闭壁纸"}[shared.mode] || "关闭壁纸"); document.querySelector("#fixed-wallpaper-field").hidden = local.mode !== "fixed"; }
  const effective = () => local.mode === "shared" ? preference(shared) : local;
  function hide() { image.hidden = true; document.documentElement.removeAttribute("data-wallpaper"); if (objectURL) URL.revokeObjectURL(objectURL); objectURL = null; }
  async function display(url, seq, save = true) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    let response, blobURL;
    try {
      let cache;
      try { cache = await caches.open(CACHE); response = await cache.match(url); } catch {}
      if (!response) response = await fetch(url, {signal: controller.signal, credentials: "omit", redirect: "error", cache: "force-cache"});
      if (!response.ok || response.type === "opaque") throw Error("图片不可用");
      const blob = await response.clone().blob();
      if (!blob.type.startsWith("image/") || blob.size > 20 * 1048576) throw Error("图片不可用");
      blobURL = URL.createObjectURL(blob);
      const probe = new Image(); probe.src = blobURL; await probe.decode();
      if (seq !== generation) { URL.revokeObjectURL(blobURL); return false; }
      if (objectURL) URL.revokeObjectURL(objectURL); objectURL = blobURL;
      image.src = blobURL; image.hidden = false; document.documentElement.dataset.wallpaper = "on";
      if (save) {
        write(LAST_KEY, {url});
        if (cache) { try { await cache.put(url, response); const keys = await cache.keys(); for (const key of keys.slice(0, Math.max(0, keys.length - 2))) await cache.delete(key); } catch {} }
      }
      return true;
    } catch { if (blobURL) URL.revokeObjectURL(blobURL); return false; }
    finally { clearTimeout(timer); }
  }
  function safeLast(url) {
    if (typeof url !== "string") return false;
    try { const parsed = new URL(url); return parsed.origin === new URL(ASSETS).origin && previewPath.test(parsed.pathname.replace(/^\/assets\//, "")); } catch { return false; }
  }
  async function refresh() {
    const seq = ++generation, selected = effective(); syncControls();
    if (selected.mode === "off") { hide(); status.textContent = "已使用原有背景。"; return; }
    const items = await loadWallpaperIndex();
    if (seq !== generation) return;
    fillWallpaperSelect(fixed, items, local.path);
    const selectionKey = JSON.stringify([selected, dayNumber(), items.map(item => [item.path, item.sha, item.background, item.thumbnail])]);
    if (selectionKey === lastSelection && !image.hidden) return;
    let item = selected.mode === "fixed" ? items.find(item => item.path === selected.path) : null;
    item ||= dailyWallpaper(items);
    if (seq !== generation) return;
    // Only the selected 1920px derivative is requested; originals stay in assets.
    const path = item?.background || item?.thumbnail;
    if (path && await display(ASSETS + path, seq)) {
      if (seq === generation) { lastSelection = selectionKey; status.textContent = (selected.mode === "fixed" && item.path !== selected.path ? "原壁纸已移除，已回退。" : "") + "当前：" + item.title + (selected.mode === "fixed" && item.path === selected.path ? "" : " · 每日轮换（UTC+8）"); }
      return;
    }
    if (seq !== generation) return;
    // A deleted path discovered in a fresh catalog cannot survive as the fallback.
    const last = read(LAST_KEY)?.url;
    const known = !indexAvailable || items.some(item => ASSETS + (item.background || item.thumbnail) === last);
    if (known && safeLast(last) && await display(last, seq, false)) { status.textContent = "使用上次已缓存的壁纸。"; return; }
    if (seq === generation) { hide(); status.textContent = "壁纸暂不可用，已使用原有背景。"; }
  }
  mode.addEventListener("change", async () => {
    if (mode.value === "fixed" && !fixed.value) {
      const items = await loadWallpaperIndex();
      if (mode.value !== "fixed") return;
      fillWallpaperSelect(fixed, items);
      fixed.value = items[0]?.path || "";
    }
    local = preference({mode: mode.value, path: fixed.value}); write(PREF_KEY, local); refresh();
  });
  fixed.addEventListener("change", () => { local = preference({mode: "fixed", path: fixed.value}); write(PREF_KEY, local); refresh(); });
  window.addEventListener("storage", event => { if ([PREF_KEY, INDEX_KEY].includes(event.key) || event.key === null) { local = preference(read(PREF_KEY)); refresh(); } });
  window.addEventListener("online", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  syncControls();
  if ("requestIdleCallback" in window) requestIdleCallback(refresh, {timeout: 1500}); else setTimeout(refresh, 100);
  return {updateDefaults(value) { shared = value || {mode: "off", path: ""}; refresh(); }};
}
