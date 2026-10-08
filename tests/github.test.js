import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { clone } from "../web/model.js";
import {
  GitHubPublisher,
  ConflictError,
  APIError,
  toBase64,
} from "../web/github.js";
const config = JSON.parse(
  fs.readFileSync(new URL("../data/navigation.json", import.meta.url)),
);
const SHA = "a".repeat(40),
  HEAD = "b".repeat(40),
  COMMIT = "c".repeat(40);
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function fake({
  permission = true,
  changed = false,
  fail = "",
  lose = false,
} = {}) {
  const calls = [];
  let branch = false,
    branchConfig = clone(config),
    pr = null,
    failed = false;
  const fetcher = async (url, options) => {
    const u = new URL(url),
      path = u.pathname.replace("/repos/zzpice/zzp-home", "");
    calls.push({ path, method: options.method, body: options.body });
    assert.ok(options.headers.Authorization.startsWith("Bearer "));
    assert.equal(u.origin, "https://api.github.com");
    if (fail && path === fail) return response({}, 401);
    if (path === "") return response({ permissions: { push: permission } });
    if (path === "/git/ref/heads/main")
      return response({ object: { sha: HEAD } });
    if (path.startsWith("/git/ref/heads/nav/edit-"))
      return branch ? response({ object: { sha: COMMIT } }) : response({}, 404);
    if (path === "/git/refs") {
      branch = true;
      return response({ object: { sha: HEAD } }, 201);
    }
    if (path === "/contents/data/navigation.json") {
      if (options.method === "PUT") {
        branchConfig = JSON.parse(
          Buffer.from(JSON.parse(options.body).content, "base64").toString(),
        );
        if (lose && !failed) {
          failed = true;
          throw Error("lost response");
        }
        return response({ commit: { sha: COMMIT } });
      }
      const ref = u.searchParams.get("ref");
      return response({
        type: "file",
        encoding: "base64",
        sha: changed && ref === HEAD ? "d".repeat(40) : SHA,
        content: toBase64(JSON.stringify(ref === HEAD ? config : branchConfig)),
      });
    }
    if (path === "/pulls") {
      if (options.method === "GET") return response(pr ? [pr] : []);
      pr = {
        html_url: "https://github.com/zzpice/zzp-home/pull/123",
        number: 123,
        state: "open",
      };
      return response(pr, 201);
    }
    throw Error("unexpected path " + path);
  };
  return { fetcher, calls };
}
test("publish only writes config on an isolated branch and creates PR", async () => {
  const api = fake(),
    client = new GitHubPublisher("example_test_credential", api.fetcher);
  const draft = clone(config);
  draft.settings.subtitle = "Updated";
  let pending;
  const result = await client.publish(draft, SHA, null, async (p) => {
    pending = p;
  });
  assert.equal(result.prUrl, "https://github.com/zzpice/zzp-home/pull/123");
  const write = api.calls.find((c) => c.method === "PUT");
  assert.ok(JSON.parse(write.body).branch.startsWith("nav/edit-"));
  assert.notEqual(JSON.parse(write.body).branch, "main");
  assert.equal(pending.phase, "submitted");
  assert.equal(JSON.stringify(pending).includes("credential"), false);
  client.dispose();
  assert.equal(client.token, "");
});
test("actual permission denial stops before any remote writes", async () => {
  const api = fake({ permission: false }),
    client = new GitHubPublisher("example", api.fetcher);
  await assert.rejects(
    () => client.publish(config, SHA),
    (e) => e instanceof APIError && e.status === 403,
  );
  assert.equal(api.calls.filter((c) => c.method !== "GET").length, 0);
});
test("changed main config surfaces conflict without any write", async () => {
  const api = fake({ changed: true }),
    client = new GitHubPublisher("example", api.fetcher);
  const draft = clone(config);
  draft.settings.title = "Changed";
  await assert.rejects(() => client.publish(draft, SHA), ConflictError);
  assert.equal(api.calls.filter((c) => c.method !== "GET").length, 0);
});
test("lost commit response resumes idempotently without duplicate commits or PRs", async () => {
  const api = fake({ lose: true }),
    client = new GitHubPublisher("example", api.fetcher);
  const draft = clone(config);
  draft.settings.subtitle = "New";
  let saved;
  await assert.rejects(
    () =>
      client.publish(draft, SHA, null, async (p) => {
        saved = p;
      }),
    /网络/,
  );
  const result = await client.publish(draft, SHA, saved, async (p) => {
    saved = p;
  });
  assert.equal(result.phase, "submitted");
  await client.publish(draft, SHA, saved);
  assert.equal(api.calls.filter((c) => c.method === "PUT").length, 1);
  assert.equal(
    api.calls.filter((c) => c.path === "/pulls" && c.method === "POST").length,
    1,
  );
  assert.equal(api.calls.filter((c) => c.path === "/git/refs").length, 1);
});
test("401 and network interruption are clear, safe errors", async () => {
  const api = fake({ fail: "/git/ref/heads/main" }),
    client = new GitHubPublisher("example", api.fetcher);
  await assert.rejects(
    () => client.publish(config, SHA),
    (e) => e.status === 401 && !e.message.includes("example"),
  );
  const disconnected = new GitHubPublisher("example", async () => {
    throw Error("network contains sensitive data");
  });
  await assert.rejects(() => disconnected.remote(), /网络中断/);
});

test("unchanged configuration is already in main and never creates an empty PR", async () => {
  const api = fake(),
    client = new GitHubPublisher("example", api.fetcher);
  const result = await client.publish(config, SHA);
  assert.equal(result.alreadyInMain, true);
  assert.equal(api.calls.filter((c) => c.method !== "GET").length, 0);
});

test("repository rule rejection preserves branch progress and never falls back to main", async () => {
  const api = fake(),
    client = new GitHubPublisher("example", (url, options) => {
      if (new URL(url).pathname.endsWith("/git/refs")) return response({}, 422);
      return api.fetcher(url, options);
    }),
    draft = clone(config);
  draft.settings.subtitle = "Needs approval";
  let progress;
  await assert.rejects(
    () =>
      client.publish(draft, SHA, null, async (p) => {
        progress = p;
      }),
    (e) => e instanceof APIError && e.status === 422,
  );
  assert.match(progress.branch, /^nav\/edit-/);
  assert.equal(progress.phase, "branch");
  assert.equal(api.calls.filter((c) => c.method === "PUT").length, 0);
});
