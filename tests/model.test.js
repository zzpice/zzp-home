import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  equal,
  validateConfig,
  assertValid,
  clone,
  moveSite,
  moveGroup,
  History,
  mergeConfig,
  matches,
  urlProblem,
} from "../web/model.js";
const baseline = JSON.parse(
  fs.readFileSync(new URL("../data/navigation.json", import.meta.url)),
);
test("migration inventory, same-name endpoints, alternate links and pins", () => {
  assert.deepEqual(validateConfig(baseline), []);
  const sites = baseline.groups.flatMap((g) => g.sites);
  assert.equal(sites.length, 91);
  assert.equal(sites.filter((s) => s.pinned).length, 11);
  assert.equal(
    sites.reduce((n, s) => n + s.alternateUrls.length, 0),
    2,
  );
  assert.equal(sites.filter((s) => s.title === "Emby").length, 2);
});
test("credential parameters, encoded credentials and unsafe protocols are blocked", () => {
  for (const url of [
    "javascript:alert(1)",
    "https://u:p@example.com/",
    "https://example.com/?%61pi=x",
    "https://example.com/#token=test",
    "https://example.com/?api_key=test",
    "https://example.com/sub/abcdefghijklmnop",
  ])
    assert.ok(urlProblem(url), url);
  assert.equal(urlProblem("http://192.168.100.57:3000"), "");
  assert.equal(urlProblem("https://example.com/?locale=zh_CN"), "");
  const c = clone(baseline);
  c.extra = "not supported";
  assert.throws(() => assertValid(c));
  for (const reserved of ["pinned", "settings"]) {
    const c = clone(baseline);
    c.groups[0].id = reserved;
    assert.throws(() => assertValid(c));
  }
  assert.ok(urlProblem("https://example.com/" + "中".repeat(700)));
});
test("search uses all terms, description, alternate URL and normalized width", () => {
  const site = {
    title: "Abc",
    description: "网站",
    url: "https://example.com",
    alternateUrls: ["https://alternate.example"],
    tags: ["PT"],
  };
  assert.ok(matches(site, "ＡＢＣ 网站"));
  assert.ok(matches(site, "alternate pt"));
  assert.equal(matches(site, "missing"), false);
});
test("move across groups, reorder, undo, redo and redo invalidation preserve identity", () => {
  const c = clone(baseline);
  const id = c.groups[0].sites[0].id;
  const moved = moveSite(c, id, c.groups[1].id, 1);
  assert.equal(moved.groups[1].sites[1].id, id);
  assert.equal(c.groups[0].sites[0].id, id);
  const h = new History(c);
  h.commit(moved);
  h.undo();
  assert.deepEqual(h.value, c);
  h.redo();
  assert.deepEqual(h.value, moved);
  h.undo();
  h.commit(moveGroup(c, c.groups[0].id, 3));
  assert.equal(h.canRedo, false);
  assert.equal(h.value.groups[3].id, c.groups[0].id);
});
test("three-way merge combines independent changes and detects overlap/delete/edit/reorder", () => {
  const local = clone(baseline),
    remote = clone(baseline);
  local.groups[0].sites[0].title = "Local";
  remote.groups[0].sites[1].title = "Remote";
  let merged = mergeConfig(baseline, local, remote);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.value.groups[0].sites[0].title, "Local");
  assert.equal(merged.value.groups[0].sites[1].title, "Remote");
  remote.groups[0].sites[0].title = "Other";
  assert.ok(mergeConfig(baseline, local, remote).conflicts.length);
  const removed = clone(baseline);
  removed.groups[0].sites.shift();
  assert.ok(mergeConfig(baseline, removed, remote).conflicts.length);
  const l = moveGroup(baseline, baseline.groups[0].id, 2),
    r = moveGroup(baseline, baseline.groups[0].id, 4);
  assert.ok(
    mergeConfig(baseline, l, r).conflicts.some((p) => p.endsWith("/order")),
  );
});
test("concurrent independent additions retain all stable IDs", () => {
  const l = clone(baseline),
    r = clone(baseline);
  l.groups[0].sites.push({ ...clone(l.groups[0].sites[0]), id: "added-local" });
  r.groups[0].sites.push({
    ...clone(r.groups[0].sites[0]),
    id: "added-remote",
  });
  const result = mergeConfig(baseline, l, r);
  assert.deepEqual(result.conflicts, []);
  assert.equal(
    result.value.groups[0].sites.length,
    baseline.groups[0].sites.length + 2,
  );
  assert.deepEqual(validateConfig(result.value), []);
});

test("object field order is immaterial, while array order remains meaningful", () => {
  const a = {
    settings: { theme: "dark", title: "ZZP" },
    groups: [{ id: "a" }, { id: "b" }],
  };
  const b = {
    groups: [{ id: "a" }, { id: "b" }],
    settings: { title: "ZZP", theme: "dark" },
  };
  assert.ok(equal(a, b));
  b.groups.reverse();
  assert.equal(equal(a, b), false);
});
