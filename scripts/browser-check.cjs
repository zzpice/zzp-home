// Real browsers exercise the built Pages artifact; GitHub writes are simulated.
const { chromium, webkit } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const { execFileSync } = require("node:child_process");
const repo = path.resolve(__dirname, ".."),
  root = path.resolve(process.env.SITE_ROOT || path.join(repo, "build/pages"));
const config = JSON.parse(
    fs.readFileSync(path.join(repo, "data/navigation.json")),
  ),
  projects = JSON.parse(fs.readFileSync(path.join(repo, "data/projects.json")));
const count = config.groups.reduce((n, g) => n + g.sites.length, 0);
let serving = root,
  broken = "",
  origin;
const networkRequests = [];
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};
const server = http.createServer((req, res) => {
  networkRequests.push(new URL(req.url, "http://localhost").pathname);
  const pathname = decodeURIComponent(
    new URL(req.url, "http://localhost").pathname,
  ).replace(/^\/preview\//, "/");
  let file = path.resolve(serving, "." + pathname);
  if (!file.startsWith(serving + path.sep) && file !== serving)
    return res.writeHead(404).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory())
    file = path.join(file, "index.html");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile())
    return res.writeHead(404).end();
  res.setHeader(
    "Content-Type",
    types[path.extname(file)] || "application/octet-stream",
  );
  res.setHeader("Cache-Control", "no-cache");
  res.end(
    broken && file.endsWith(broken)
      ? "wrong release bytes"
      : fs.readFileSync(file),
  );
});
const boot = (p) =>
  p.locator("#bootstrap").evaluate((el) => JSON.parse(el.textContent));
function errorsOn(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  return errors;
}
async function openEditor(page, fresh = true) {
  await page.locator("#edit").click();
  await page.locator(".editor-dialog[open]").waitFor();
  if (fresh) {
    await page.waitForTimeout(100);
    if (await page.locator("#fresh").isVisible())
      await page.locator("#fresh").click();
  }
}
async function addSite(page, title = "浏览器测试入口") {
  await page.locator("[data-action=add-site]").click();
  const f = page.locator(".form-dialog[open] form");
  await f.locator("[name=title]").fill(title);
  await f.locator("[name=url]").fill("https://example.com/navigation-test");
  await f.locator("[name=description]").fill("共享配置测试");
  return f;
}
async function exportDraft(page) {
  const waiting = page.waitForEvent("download");
  await page.locator("[data-action=export]").click();
  return JSON.parse(fs.readFileSync(await (await waiting).path(), "utf8"));
}
async function drafts(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("zzp-home-editor-v1", 1);
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction("drafts"),
            req = tx.objectStore("drafts").getAll();
          req.onsuccess = () => resolve(req.result);
          tx.oncomplete = () => db.close();
          req.onerror = reject;
        };
        open.onerror = reject;
      }),
  );
}
async function controlled(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}
async function noOverflow(page) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "horizontal page overflow",
  );
  for (const selector of [".editor-dialog[open]", ".form-dialog[open]"])
    if (await page.locator(selector).count())
      assert.ok(
        await page
          .locator(selector)
          .last()
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        selector + " overflow",
      );
}
async function browse(browser, label) {
  for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: "light",
        hasTouch: width < 500,
      }),
      page = await context.newPage(),
      errors = errorsOn(page),
      calls = [];
    page.on("request", (r) => {
      if (r.url().includes("api.github.com")) calls.push(r.url());
    });
    try {
      await page.goto(origin + "/");
      await page.locator("#edit:visible").waitFor();
      assert.equal(await page.locator(".group .site-card").count(), count);
      assert.equal(
        await page
          .locator(".site-icon img")
          .evaluateAll((imgs) => new Set(imgs.map((i) => i.src)).size),
        1,
        "single shared atlas",
      );
      assert.equal(
        await page
          .locator(".site-icon img")
          .first()
          .evaluate((i) => i.naturalWidth > 0),
        true,
      );
      await noOverflow(page);
      await page.locator("#search").fill("Emby");
      assert.equal(await page.locator(".site-card:visible").count(), 3);
      await page.locator("#search").fill("this-has-no-match");
      assert.equal(await page.locator("#empty").isVisible(), true);
      await page.locator("#clear-filter").click();
      await page.locator("#groups a[data-group=network]").click();
      assert.equal(await page.locator(".site-card:visible").count(), 18);
      await page.locator("#sort").selectOption("name");
      const route = page.url();
      await page.reload();
      assert.equal(page.url(), route);
      assert.equal(await page.locator("#sort").inputValue(), "name");
      assert.equal(await page.locator(".site-card:visible").count(), 18);
      await page.locator("#appearance").selectOption("dark");
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "dark",
      );
      await page.reload();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "dark",
      );
      await page.locator("#appearance").selectOption("system");
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme });
        await page.waitForFunction(
          (c) => document.documentElement.dataset.theme === c,
          colorScheme,
        );
      }
      await page.locator("#appearance").selectOption("shared");
      await page.locator("#layout").click();
      assert.equal(
        await page.locator("html").getAttribute("data-layout"),
        "list",
      );
      await noOverflow(page);
      await page.goto(origin + "/projects/");
      assert.equal(await page.locator(".project-card").count(), 3);
      assert.equal(await page.locator(".resource-card").count(), 4);
      const links = await page
        .locator("main a[href]")
        .evaluateAll((ns) => ns.map((el) => el.href));
      for (const p of projects)
        for (const url of [p.url, ...p.links.map((l) => l.url)])
          assert.ok(links.includes(url), "preserved project URL " + url);
      await noOverflow(page);
      assert.equal(
        calls.length,
        0,
        "ordinary browsing does not use GitHub API",
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
  const context = await browser.newContext({ javaScriptEnabled: false }),
    p = await context.newPage();
  await p.goto(origin + "/");
  assert.equal(await p.locator(".group a.site-link").count(), count);
  await context.close();
  console.log(
    label +
      ": navigation, project links, themes, no-JS and 320/390/768/1440px passed",
  );
}
async function edit(browser, label, width) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    hasTouch: width < 500,
  });
  await context.route("https://raw.githubusercontent.com/**", (route) =>
    route.abort(),
  );
  const page = await context.newPage(),
    errors = errorsOn(page);
  try {
    await page.goto(origin + "/");
    await openEditor(page);
    assert.equal(await page.locator(".edit-site-row").count(), 13);
    await page.locator("[data-action=add-site]").click();
    assert.equal(
      await page
        .locator(".form-dialog[open] [name=title]")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .locator("[data-action=add-site]")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    const unsafe = await addSite(page, "凭据输入测试");
    await unsafe
      .locator("[name=url]")
      .fill("https://example.com/?token=browser_private_query");
    await page.waitForFunction(() =>
      document.querySelector(".storage-warning").textContent.includes("凭据"),
    );
    assert.equal(
      JSON.stringify(await drafts(page)).includes("browser_private_query"),
      false,
    );
    await unsafe.locator("[data-close]").first().click();
    await page.waitForFunction(
      () => document.querySelector(".storage-warning").hidden,
    );
    const f = await addSite(page);
    await page.locator("#choose-icon").click();
    await page.locator(".icon-picker input[type=search]").fill("youtube");
    await page
      .locator('.icon-option[data-icon="icons/media/youtube.png"]')
      .click();
    await f.locator("[name=pinned]").check();
    await noOverflow(page);
    await f.locator("[type=submit]").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".edit-site-row").length === 14,
    );
    const addedID = await page
      .locator(".edit-site-row")
      .last()
      .getAttribute("data-site-id");
    await page.locator("[data-action=undo]").click();
    assert.equal(await page.locator(".edit-site-row").count(), 13);
    await page.locator("[data-action=redo]").click();
    assert.equal(await page.locator(".edit-site-row").count(), 14);
    await page
      .locator(`[data-site-id="${addedID}"] [data-action=edit-site]`)
      .click();
    await page
      .locator(".form-dialog[open] [name=description]")
      .fill("更新描述");
    await page.locator(".form-dialog[open] [type=submit]").click();
    let exported = await exportDraft(page);
    assert.equal(exported.groups[0].sites.at(-1).description, "更新描述");
    assert.equal(
      exported.groups[0].sites.at(-1).icon,
      "icons/media/youtube.png",
    );
    assert.equal(exported.groups[0].sites.at(-1).pinned, true);
    await page.locator(".edit-site-row").first().scrollIntoViewIfNeeded();
    const first = page.locator(".edit-site-row").nth(0),
      second = page.locator(".edit-site-row").nth(1),
      firstID = await first.getAttribute("data-site-id"),
      a = await first.locator(".drag-handle").boundingBox(),
      b = await second.boundingBox();
    if (label === "Chromium" && width === 390) {
      const session = await context.newCDPSession(page);
      const start = { x: a.x + a.width / 2, y: a.y + a.height / 2, id: 1 };
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [start],
      });
      for (let i = 1; i <= 8; i++)
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            {
              x: start.x + ((b.x + 20 - start.x) * i) / 8,
              y: start.y + ((b.y + b.height - 3 - start.y) * i) / 8,
              id: 1,
            },
          ],
        });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await session.detach();
    } else {
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + 20, b.y + b.height - 3, { steps: 8 });
      await page.mouse.up();
    }
    assert.equal(
      await page.locator(".edit-site-row").nth(1).getAttribute("data-site-id"),
      firstID,
    );
    await page.locator("[data-action=undo]").click();
    const handle = await page
        .locator(".edit-site-row")
        .first()
        .locator(".drag-handle")
        .boundingBox(),
      target = page.locator(".editor-group[data-group-id=self-hosted]");
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: 10,
    });
    await page.mouse.up();
    exported = await exportDraft(page);
    assert.ok(exported.groups[1].sites.some((s) => s.id === firstID));
    await page.locator("[data-action=undo]").click();
    await page
      .locator(".editor-group[data-group-id=daily] [data-action=select-group]")
      .click();
    const groupHandle = await page
      .locator(".editor-group[data-group-id=daily] [data-drag=group]")
      .boundingBox();
    const nextGroup = page.locator(".editor-group[data-group-id=self-hosted]");
    await nextGroup.scrollIntoViewIfNeeded();
    const groupBox = await nextGroup.boundingBox();
    await page.mouse.move(
      groupHandle.x + groupHandle.width / 2,
      groupHandle.y + groupHandle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      width < 500
        ? groupBox.x + groupBox.width - 4
        : groupBox.x + groupBox.width / 2,
      width < 500
        ? groupBox.y + groupBox.height / 2
        : groupBox.y + groupBox.height - 4,
      { steps: 8 },
    );
    await page.mouse.up();
    assert.equal((await exportDraft(page)).groups[1].id, "daily");
    await page.locator("[data-action=undo]").click();
    await page.locator("[data-action=add-group]").click();
    await page.locator(".form-dialog[open] [name=title]").fill("测试分类");
    await page.locator(".form-dialog[open] [type=submit]").click();
    assert.equal(await page.locator(".editor-group").count(), 8);
    await page.locator(".editor-group.active [data-action=edit-group]").click();
    await page.locator(".form-dialog[open] [name=title]").fill("重命名分类");
    await page.locator(".form-dialog[open] [type=submit]").click();
    assert.ok(
      (await page.locator(".editor-group.active").innerText()).includes(
        "重命名分类",
      ),
    );
    await page.locator(".editor-group.active [data-action=edit-group]").click();
    await page.locator("#delete-group").click();
    assert.equal(await page.locator(".editor-group").count(), 7);
    await page
      .locator(
        ".editor-group[data-group-id=community] [data-action=edit-group]",
      )
      .click();
    await page.locator("#delete-group").click();
    assert.match(
      await page.locator(".form-dialog[open] .form-error").textContent(),
      /接收/,
    );
    await page
      .locator(".form-dialog[open] [name=target]")
      .selectOption("media");
    await page.locator("#delete-group").click();
    const transferred = await exportDraft(page);
    assert.equal(transferred.groups.length, 6);
    assert.equal(transferred.groups.flatMap((g) => g.sites).length, count + 1);
    assert.equal(
      transferred.groups.find((g) => g.id === "media").sites.length,
      26,
    );
    await page.locator("[data-action=undo]").click();
    assert.equal(await page.locator(".editor-group").count(), 7);
    await page.locator("[data-action=settings]").click();
    await page.locator(".settings-form [name=subtitle]").fill("共享外观测试");
    await page.locator(".settings-form [name=theme]").selectOption("dark");
    await page.locator(".settings-form [name=density]").selectOption("compact");
    await page.locator(".settings-form [type=submit]").click();
    exported = await exportDraft(page);
    assert.equal(exported.settings.theme, "dark");
    assert.equal(exported.settings.density, "compact");
    const bad = structuredClone(exported);
    bad.groups[0].sites[0].url = "https://example.com/?token=unsafe";
    await page.locator("#import-file").setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(bad)),
    });
    await page.waitForFunction(() =>
      document.querySelector("#toast").textContent.includes("认证"),
    );
    const imported = structuredClone(exported);
    imported.settings.subtitle = "导入成功";
    await page.locator("#import-file").setInputFiles({
      name: "navigation.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(imported)),
    });
    await page.waitForFunction(() =>
      document.querySelector("#toast").textContent.includes("已导入"),
    );
    assert.equal((await exportDraft(page)).settings.subtitle, "导入成功");
    await page.locator("[data-action=preview]").click();
    await page.locator("#preview-badge").waitFor();
    assert.equal(await page.locator(".group .site-card").count(), count + 1);
    await noOverflow(page);
    await page.locator("#preview-badge button").click();
    assert.equal(await page.locator(".group .site-card").count(), count);
    await openEditor(page);
    await page.locator("[data-action=close]").click();
    await page.reload();
    await openEditor(page, false);
    await page.locator("#restore").click();
    assert.equal((await exportDraft(page)).settings.subtitle, "导入成功");
    await page
      .locator(".editor-group[data-group-id=daily] [data-action=select-group]")
      .click();
    await page
      .locator(`[data-site-id="${addedID}"] [data-action=edit-site]`)
      .click();
    await page.locator("#delete-site").click();
    assert.equal(
      (await exportDraft(page)).groups.flatMap((g) => g.sites).length,
      count,
    );
    await noOverflow(page);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
  console.log(
    label +
      ": CRUD, icons, pointer sorting, groups, undo/redo, settings, import/export and recovery at " +
      width +
      "px passed",
  );
}
async function publish(browser) {
  const context = await browser.newContext({ serviceWorkers: "block" }),
    page = await context.newPage(),
    errors = errorsOn(page);
  let mode = "denied",
    branch = false,
    submitted = false,
    original,
    edited;
  const writes = [],
    head = "b".repeat(40),
    commit = "c".repeat(40);
  await context.route("https://api.github.com/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      endpoint = url.pathname.replace("/repos/zzpice/zzp-home", ""),
      method = req.method(),
      body = req.postDataJSON();
    const answer = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers":
            "authorization,accept,content-type,x-github-api-version",
          "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
        },
        body: JSON.stringify(data),
      });
    if (method === "OPTIONS") return answer({});
    if (mode === "offline") return route.abort();
    if (mode === "unauthorized") return answer({}, 401);
    if (method !== "GET") writes.push({ endpoint, body });
    if (!endpoint) return answer({ permissions: { push: mode !== "denied" } });
    if (endpoint === "/git/ref/heads/main")
      return answer({ object: { sha: head } });
    if (endpoint.startsWith("/git/ref/heads/nav/edit-"))
      return answer(
        branch ? { object: { sha: commit } } : {},
        branch ? 200 : 404,
      );
    if (endpoint === "/git/refs") {
      branch = true;
      return answer({}, 201);
    }
    if (endpoint === "/contents/data/navigation.json") {
      if (method === "PUT") {
        assert.match(body.branch, /^nav\/edit-/);
        assert.notEqual(body.branch, "main");
        edited = JSON.parse(Buffer.from(body.content, "base64").toString());
        return answer({ commit: { sha: commit } });
      }
      return answer({
        type: "file",
        encoding: "base64",
        sha: original.blobSha,
        content: Buffer.from(
          JSON.stringify(
            url.searchParams.get("ref") === head || !edited
              ? original.config
              : edited,
          ),
        ).toString("base64"),
      });
    }
    if (endpoint === "/pulls") {
      const pr = {
        html_url: "https://github.com/zzpice/zzp-home/pull/123",
        number: 123,
        state: "open",
      };
      if (method === "POST") {
        submitted = true;
        return answer(pr, 201);
      }
      return answer(submitted ? [pr] : []);
    }
    throw Error("unexpected endpoint " + endpoint);
  });
  try {
    await page.goto(origin + "/");
    original = await boot(page);
    await openEditor(page);
    const f = await addSite(page);
    await f.locator("[type=submit]").click();
    await page.locator("[data-action=publish]").click();
    const modal = page.locator(".form-dialog[open]"),
      token = "example_ui_test_credential";
    for (const [next, message] of [
      ["denied", "拒绝"],
      ["unauthorized", "授权失败"],
      ["offline", "网络中断"],
    ]) {
      mode = next;
      await modal.locator("[name=credential]").fill(token);
      await modal.locator("[type=submit]").click();
      try {
        await page.waitForFunction(
          (m) =>
            document
              .querySelector(".form-dialog[open] .form-error")
              .textContent.includes(m),
          message,
        );
      } catch (error) {
        console.error("publish simulation failed", {
          mode,
          message,
          actual: await modal.locator(".form-error").textContent(),
          errors,
        });
        throw error;
      }
      assert.equal(await modal.locator("[name=credential]").inputValue(), "");
      assert.equal(writes.length, 0);
      assert.equal(JSON.stringify(await drafts(page)).includes(token), false);
    }
    mode = "allowed";
    await modal.locator("[name=credential]").fill(token);
    await modal.locator("[type=submit]").click();
    await modal.locator("#publish-result a").waitFor();
    assert.equal(
      await modal.locator("#publish-result a").getAttribute("href"),
      "https://github.com/zzpice/zzp-home/pull/123",
    );
    assert.equal(
      writes.filter((x) => x.endpoint === "/contents/data/navigation.json")
        .length,
      1,
    );
    assert.equal(writes.filter((x) => x.endpoint === "/pulls").length, 1);
    assert.equal(JSON.stringify(await drafts(page)).includes(token), false);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
  console.log(
    "Chromium: GitHub permissions, 401/403/network errors, memory-only credentials and branch/PR publication passed (simulated API)",
  );
}
async function offline(browser) {
  const context = await browser.newContext(),
    page = await context.newPage(),
    errors = errorsOn(page);
  try {
    await page.goto(origin + "/preview/");
    await controlled(page);
    const beginning = networkRequests.length;
    await page.reload();
    await page.locator("#appearance:visible").waitFor();
    assert.deepEqual(
      networkRequests.slice(beginning).filter((p) => p !== "/preview/sw.js"),
      [],
      "warm navigation should use the cached shell",
    );
    await context.setOffline(true);
    await page.reload();
    assert.equal(await page.locator(".group .site-card").count(), count);
    await page.locator("#search").fill("Emby");
    assert.equal(await page.locator(".site-card:visible").count(), 3);
    await page.goto(origin + "/preview/projects/");
    assert.equal(await page.locator(".project-card").count(), 3);
    await page.goto(origin + "/preview/");
    await openEditor(page);
    const f = await addSite(page, "离线编辑");
    await f.locator("[type=submit]").click();
    assert.equal(
      (await exportDraft(page)).groups.flatMap((g) => g.sites).length,
      count + 1,
    );
    await context.setOffline(false);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
  console.log(
    "Chromium: warm navigation without resource downloads, scoped subpath worker, offline home/projects/search/editor passed",
  );
}

async function unavailableStorageAndIcon(browser, label) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.addInitScript(() => {
    IDBFactory.prototype.open = function () {
      const request = {};
      setTimeout(() => request.onerror?.(), 0);
      return request;
    };
  });
  await context.route("**/icons/atlas.png", (route) => route.abort());
  const page = await context.newPage(),
    errors = errorsOn(page);
  try {
    await page.goto(origin + "/");
    await page.waitForFunction(() => {
      const first = document.querySelector(".site-icon");
      return !first.querySelector("img") && first.textContent.trim();
    });
    assert.equal(await page.locator(".group .site-card").count(), count);
    assert.ok(await page.locator(".site-icon").first().textContent());
    await openEditor(page);
    await page.locator(".storage-warning:visible").waitFor();
    assert.match(
      await page.locator(".storage-warning").textContent(),
      /无法保存/,
    );
    const form = await addSite(page, "存储失败时可导出的入口");
    await form.locator("[type=submit]").click();
    const exported = await exportDraft(page);
    assert.equal(exported.groups.flatMap((g) => g.sites).length, count + 1);
    await page.locator("[data-action=close]").click();
    await openEditor(page);
    assert.equal(
      (await exportDraft(page)).groups.flatMap((g) => g.sites).length,
      count + 1,
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
  console.log(
    label +
      ": icon text fallback, unavailable draft storage, retained memory and export passed",
  );
}
function nextRelease() {
  const scratch = fs.mkdtempSync(path.join(repo, "build/update-check-")),
    source = path.join(scratch, "source"),
    output = path.join(scratch, "pages");
  fs.mkdirSync(source);
  for (const name of ["data", "web", "icons", "internal", ".cache"]) {
    const file = path.join(repo, name);
    if (fs.existsSync(file))
      fs.cpSync(file, path.join(source, name), { recursive: true });
  }
  const next = structuredClone(config);
  next.settings.subtitle = "缓存升级检查 · 新的正式配置";
  fs.writeFileSync(
    path.join(source, "data/navigation.json"),
    JSON.stringify(next, null, 2) + "\n",
  );
  const args = [
      "run",
      "./cmd/zzp-home",
      "build",
      "-root",
      source,
      "-out",
      output,
    ],
    assets = process.env.ASSETS_DIR || path.resolve(repo, "../assets");
  if (fs.existsSync(path.join(assets, "catalog.json")))
    args.push("-assets", assets);
  execFileSync(process.env.GO_BIN || "go", args, { cwd: repo, stdio: "pipe" });
  return { scratch, output };
}
async function updates(browser) {
  const fixture = nextRelease(),
    context = await browser.newContext(),
    page = await context.newPage(),
    errors = errorsOn(page);
  try {
    await page.goto(origin + "/");
    await controlled(page);
    const previous = (await boot(page)).release;
    const repaired = await page.evaluate(async () => {
      const name = (await caches.keys()).find((x) =>
          x.startsWith("zzp-home-shell-"),
        ),
        cache = await caches.open(name),
        url = new URL("index.html", location.href).href;
      await cache.put(url, new Response("corrupt cached bytes"));
      return (await fetch(url)).text();
    });
    assert.ok(repaired.includes('id="bootstrap"'));
    const other = await context.newPage();
    const otherErrors = errorsOn(other);
    await other.goto(origin + "/");
    for (const tab of [page, other])
      await tab.evaluate(() => {
        window.updateMessages = [];
        navigator.serviceWorker.addEventListener("message", (e) =>
          window.updateMessages.push(e.data?.type),
        );
      });
    await openEditor(other);
    await addSite(other, "尚未应用但已保存的输入");
    await other.waitForFunction(() =>
      document
        .querySelector(".draft-status")
        .textContent.includes("草稿已保存"),
    );
    serving = fixture.output;
    broken = "app.js";
    await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      window.workerStates = [];
      r.addEventListener("updatefound", () => {
        const w = r.installing;
        w.addEventListener("statechange", () =>
          window.workerStates.push(w.state),
        );
      });
      await r.update();
    });
    await page.waitForFunction(() => window.workerStates.includes("redundant"));
    assert.equal((await boot(page)).release, previous);
    assert.equal(
      await page.evaluate(
        async () => !!(await navigator.serviceWorker.getRegistration()).waiting,
      ),
      false,
    );
    broken = "";
    await page.evaluate(async () =>
      (await navigator.serviceWorker.getRegistration()).update(),
    );
    await page.waitForFunction(
      async () => !!(await navigator.serviceWorker.getRegistration()).waiting,
    );
    await page.locator("#update-banner:visible").waitFor();
    await page.locator("#apply-update").click();
    try {
      await page.waitForFunction(
        () =>
          document.querySelector("#toast").textContent.includes("其他标签页"),
        null,
        { timeout: 10000 },
      );
    } catch (error) {
      console.error(
        "update guard diagnostic",
        await page.evaluate(async () => ({
          toast: document.querySelector("#toast").textContent,
          inert: document.body.inert,
          states: window.workerStates,
          messages: window.updateMessages,
          buttonDisabled: document.querySelector("#apply-update").disabled,
          waiting: !!(await navigator.serviceWorker.getRegistration()).waiting,
          release: JSON.parse(document.querySelector("#bootstrap").textContent)
            .release,
        })),
        {
          errors,
          otherErrors,
          otherOpen: !other.isClosed(),
          otherMessages: await other.evaluate(() => window.updateMessages),
        },
      );
      throw error;
    }
    assert.equal((await boot(page)).release, previous);
    assert.equal(
      await other.locator(".form-dialog[open] [name=title]").inputValue(),
      "尚未应用但已保存的输入",
    );
    assert.equal(await other.locator("body").evaluate((el) => el.inert), false);
    await other.close();
    await page.locator("#apply-update").click();
    await page.waitForFunction(
      (previous) =>
        JSON.parse(document.querySelector("#bootstrap").textContent).release !==
        previous,
      previous,
    );
    assert.equal(
      (await boot(page)).config.settings.subtitle,
      "缓存升级检查 · 新的正式配置",
    );
    await openEditor(page, false);
    await page.locator("#restore").click();
    await page.locator(".form-dialog[open] [name=title]").waitFor();
    assert.equal(
      await page.locator(".form-dialog[open] [name=title]").inputValue(),
      "尚未应用但已保存的输入",
    );
    await page.locator(".form-dialog[open] [data-close]").first().click();
    await page.locator("[data-action=close]").click();
    const before = await drafts(page);
    assert.ok(before.length > 0);
    await page.evaluate(async () =>
      (await caches.open("unrelated-cache")).put(
        "/unrelated",
        new Response("keep"),
      ),
    );
    await page.goto(origin + "/recovery.html");
    await page.locator("#recover").click();
    await page.waitForURL("**/?recovered=*");
    assert.equal((await drafts(page)).length, before.length);
    assert.ok(await page.evaluate(() => caches.has("unrelated-cache")));
    assert.deepEqual(errors, []);
  } finally {
    serving = root;
    broken = "";
    await context.close();
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
  }
  console.log(
    "Chromium: corrupt-cache repair, partial-update rejection, multi-tab guard, atomic upgrade, unapplied-input recovery and scoped cache reset passed",
  );
}
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
  try {
    for (const [name, engine] of [
      ["Chromium", chromium],
      ["WebKit", webkit],
    ]) {
      const browser = await engine.launch();
      try {
        const only = process.env.BROWSER_CHECK;
        if (!only || only === "browse") await browse(browser, name);
        if (!only || only === "edit") {
          await edit(browser, name, 1440);
          await edit(browser, name, 390);
        }
        if (!only || only === "failures")
          await unavailableStorageAndIcon(browser, name);
        if (name === "Chromium") {
          if (!only || only === "publish") await publish(browser);
          if (!only || only === "offline") await offline(browser);
          if (!only || only === "updates") await updates(browser);
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
