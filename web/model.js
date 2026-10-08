// Pure shared editor/search model; no DOM, storage, network, or credentials.
export const clone = (value) =>
  value === undefined ? undefined : structuredClone(value);
export function equal(a, b) {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
  );
}
export const secretKey = (key) =>
  /^(access[_-]?token|refresh[_-]?token|token|auth|authorization|password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|apikey|key|passkey|passcode|credential|api)$/i.test(
    key,
  );
export const containsCredential = (text) =>
  /(github_pat_[a-z0-9_]{15,}|gh[pousr]_[a-z0-9]{15,}|bearer\s+[a-z0-9._-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(
    text,
  );
export function urlProblem(raw) {
  if (
    typeof raw !== "string" ||
    new TextEncoder().encode(raw).length > 2048 ||
    raw.trim() !== raw ||
    /[\r\n\t]/.test(raw)
  )
    return "链接长度或空白无效";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "请填写完整的 HTTP / HTTPS 链接";
  }
  if (!["https:", "http:"].includes(url.protocol) || !url.hostname)
    return "仅支持 HTTP / HTTPS 链接";
  if (url.username || url.password) return "链接包含认证信息";
  let decoded = raw;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded.replace(/\+/g, " "));
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  if (containsCredential(decoded)) return "链接包含疑似凭据";
  if (
    [
      ...url.searchParams.keys(),
      ...new URLSearchParams(url.hash.slice(1).replace(/^\?/, "")).keys(),
    ].some(secretKey)
  )
    return "链接包含认证参数，请移除后再保存";
  if (/\/(sub|subscribe|subscription)\/[a-z0-9_-]{16,}/i.test(decoded))
    return "链接包含疑似订阅凭据";
  return "";
}
export function validateConfig(c) {
  const errors = [];
  const object = (v, keys, path) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      errors.push(path + " 必须是对象");
      return false;
    }
    if (Object.keys(v).some((k) => !keys.includes(k)))
      errors.push(path + " 包含未知字段");
    return true;
  };
  const text = (v, max, required, path) => {
    if (
      typeof v !== "string" ||
      [...v].length > max ||
      (required && !v.trim()) ||
      containsCredential(v)
    )
      errors.push(path + " 无效或含疑似凭据");
  };
  if (!object(c, ["schemaVersion", "settings", "groups"], "配置"))
    return errors;
  if (c.schemaVersion !== 1) errors.push("仅支持 schemaVersion 1");
  if (
    object(
      c.settings,
      ["title", "subtitle", "theme", "layout", "density", "showDescriptions"],
      "外观",
    )
  ) {
    text(c.settings.title, 80, true, "站点名称");
    text(c.settings.subtitle, 200, false, "副标题");
    if (
      !["system", "light", "dark"].includes(c.settings.theme) ||
      !["grid", "list"].includes(c.settings.layout) ||
      !["comfortable", "compact"].includes(c.settings.density) ||
      typeof c.settings.showDescriptions !== "boolean"
    )
      errors.push("外观设置无效");
  }
  if (!Array.isArray(c.groups) || c.groups.length > 100) {
    errors.push("分类必须是数组且最多 100 个");
    return errors;
  }
  const ids = new Set();
  let count = 0;
  const id = (v, path) => {
    if (
      typeof v !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(v) ||
      ids.has(v)
    )
      errors.push(path + " ID 无效或重复");
    ids.add(v);
  };
  for (const g of c.groups) {
    if (!object(g, ["id", "title", "sites"], "分类")) continue;
    id(g.id, "分类");
    if (["pinned", "settings"].includes(g.id))
      errors.push("分类 ID 与保留视图冲突");
    text(g.title, 80, true, "分类名称");
    if (!Array.isArray(g.sites)) {
      errors.push("sites 必须是数组");
      continue;
    }
    for (const s of g.sites) {
      count++;
      if (
        !object(
          s,
          [
            "id",
            "title",
            "description",
            "url",
            "alternateUrls",
            "icon",
            "iconText",
            "pinned",
            "newTab",
            "tags",
            "notice",
          ],
          "网站",
        )
      )
        continue;
      id(s.id, "网站");
      text(s.title, 120, true, "网站名称");
      text(s.description, 500, false, "网站描述");
      text(s.iconText, 20, false, "文字图标");
      text(s.notice, 200, false, "提示");
      const problem = urlProblem(s.url);
      if (problem) errors.push("网站 " + s.id + "：" + problem);
      if (!Array.isArray(s.alternateUrls) || s.alternateUrls.length > 10)
        errors.push("备用链接必须是数组且最多 10 条");
      else
        for (const u of s.alternateUrls) {
          const p = urlProblem(u);
          if (p) errors.push("备用链接：" + p);
        }
      if (!Array.isArray(s.tags) || s.tags.length > 20)
        errors.push("标签必须是数组且最多 20 个");
      else for (const tag of s.tags) text(tag, 40, true, "标签");
      if (
        typeof s.icon !== "string" ||
        (s.icon && !/^icons\/[a-z0-9-]+\/[a-z0-9-]+\.png$/.test(s.icon))
      )
        errors.push("必须选择 assets 图标或文字回退");
      if (typeof s.pinned !== "boolean" || typeof s.newTab !== "boolean")
        errors.push("置顶 / 打开方式必须是布尔值");
    }
  }
  if (count > 2000) errors.push("网站最多 2000 个");
  return errors;
}
export function assertValid(c) {
  const errors = validateConfig(c);
  if (errors.length) throw Error(errors.slice(0, 5).join("；"));
  return c;
}
export const allSites = (c) => c.groups.flatMap((g) => g.sites);
export function matches(site, query) {
  const hay = [
    site.title,
    site.description,
    site.url,
    ...site.alternateUrls,
    ...site.tags,
  ]
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase();
  return query
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((t) => hay.includes(t));
}
export const newID = (prefix) => prefix + "-" + crypto.randomUUID();
export function moveSite(c, id, targetGroup, index) {
  const result = clone(c);
  const target = result.groups.find((g) => g.id === targetGroup);
  if (!target) throw Error("分类不存在");
  let site;
  for (const g of result.groups) {
    const i = g.sites.findIndex((s) => s.id === id);
    if (i >= 0) {
      [site] = g.sites.splice(i, 1);
      break;
    }
  }
  if (!site) throw Error("网站不存在");
  target.sites.splice(
    Math.max(0, Math.min(index, target.sites.length)),
    0,
    site,
  );
  return result;
}
export function moveGroup(c, id, index) {
  const result = clone(c);
  const i = result.groups.findIndex((g) => g.id === id);
  if (i < 0) throw Error("分类不存在");
  const [group] = result.groups.splice(i, 1);
  result.groups.splice(
    Math.max(0, Math.min(index, result.groups.length)),
    0,
    group,
  );
  return result;
}
export class History {
  constructor(value, saved) {
    this.entries = saved?.entries?.length
      ? saved.entries.slice(-60).map(clone)
      : [clone(value)];
    this.index = Number.isInteger(saved?.index)
      ? Math.max(0, Math.min(saved.index, this.entries.length - 1))
      : 0;
    for (const c of this.entries) assertValid(c);
  }
  get value() {
    return this.entries[this.index];
  }
  get canUndo() {
    return this.index > 0;
  }
  get canRedo() {
    return this.index < this.entries.length - 1;
  }
  commit(value) {
    assertValid(value);
    if (equal(value, this.value)) return false;
    this.entries.splice(this.index + 1);
    this.entries.push(clone(value));
    if (this.entries.length > 60) this.entries.shift();
    this.index = this.entries.length - 1;
    return true;
  }
  undo() {
    if (this.canUndo) this.index--;
    return this.value;
  }
  redo() {
    if (this.canRedo) this.index++;
    return this.value;
  }
  serialize() {
    return { entries: this.entries, index: this.index };
  }
}

// Conservative three-way merge. Stable IDs merge independent field changes;
// overlapping edits, delete/edit, moves, and competing reorderings are surfaced.
export function mergeConfig(base, local, remote) {
  const conflicts = [];
  const walk = (b, l, r, path) => {
    if (equal(l, r)) return clone(l);
    if (equal(l, b)) return clone(r);
    if (equal(r, b)) return clone(l);
    if (l === undefined || r === undefined || b === undefined) {
      conflicts.push(path);
      return clone(l);
    }
    if (
      Array.isArray(b) &&
      Array.isArray(l) &&
      Array.isArray(r) &&
      [...b, ...l, ...r].every(
        (x) => x && typeof x === "object" && typeof x.id === "string",
      )
    ) {
      const bm = new Map(b.map((x) => [x.id, x])),
        lm = new Map(l.map((x) => [x.id, x])),
        rm = new Map(r.map((x) => [x.id, x]));
      const values = new Map();
      for (const id of new Set([...bm.keys(), ...lm.keys(), ...rm.keys()])) {
        const v = walk(bm.get(id), lm.get(id), rm.get(id), path + "/" + id);
        if (v !== undefined) values.set(id, v);
      }
      const existing = b.map((x) => x.id).filter((id) => values.has(id));
      const lo = l.map((x) => x.id).filter((id) => existing.includes(id));
      const ro = r.map((x) => x.id).filter((id) => existing.includes(id));
      let order = existing.slice();
      if (!equal(lo, existing) && !equal(ro, existing) && !equal(lo, ro))
        conflicts.push(path + "/order");
      else if (!equal(lo, existing)) order = lo.slice();
      else if (!equal(ro, existing)) order = ro.slice();
      for (const side of [l, r]) {
        let previous = null;
        for (const item of side) {
          if (!values.has(item.id)) continue;
          if (!order.includes(item.id)) {
            const pos = previous === null ? 0 : order.indexOf(previous) + 1;
            order.splice(pos, 0, item.id);
          }
          previous = item.id;
        }
      }
      for (const id of values.keys()) if (!order.includes(id)) order.push(id);
      return order.map((id) => values.get(id));
    }
    if (
      b &&
      l &&
      r &&
      typeof b === "object" &&
      typeof l === "object" &&
      typeof r === "object" &&
      !Array.isArray(b) &&
      !Array.isArray(l) &&
      !Array.isArray(r)
    ) {
      const value = {};
      for (const key of new Set([
        ...Object.keys(b),
        ...Object.keys(l),
        ...Object.keys(r),
      ])) {
        const v = walk(b[key], l[key], r[key], path + "/" + key);
        if (v !== undefined) value[key] = v;
      }
      return value;
    }
    conflicts.push(path);
    return clone(l);
  };
  const value = walk(base, local, remote, "config");
  if (!conflicts.length) {
    for (const error of validateConfig(value)) conflicts.push(error);
  }
  return { value, conflicts: [...new Set(conflicts)] };
}
