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
  fs.readFileSync(new URL("./fixtures/navigation.json", import.meta.url)),
);
const SHA = "a".repeat(40),
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
  race = false,
  reject = 0,
} = {}) {
  const calls = [];
  let remoteConfig = clone(config),
    sha = changed ? "d".repeat(40) : SHA;
  const fetcher = async (url, options) => {
    const u = new URL(url),
      path = u.pathname.replace("/repos/zzpice/zzp-home", "");
    calls.push({ path, method: options.method, body: options.body });
    assert.ok(options.headers.Authorization.startsWith("Bearer "));
    assert.equal(u.origin, "https://api.github.com");
    assert.equal(options.redirect, "error");
    if (fail && path === fail) return response({}, 401);
    if (path === "") return response({ permissions: { push: permission } });
    if (path === "/contents/data/navigation.json") {
      if (options.method === "PUT") {
        if (reject) return response({}, reject);
        if (race) {
          remoteConfig.settings.title = "Other device";
          sha = "d".repeat(40);
          return response({}, 409);
        }
        const body = JSON.parse(options.body);
        assert.equal(body.branch, "main");
        assert.equal(body.sha, sha);
        remoteConfig = JSON.parse(
          Buffer.from(body.content, "base64").toString(),
        );
        sha = COMMIT;
        if (lose) throw Error("lost response");
        return response({ content: { sha }, commit: { sha: COMMIT } });
      }
      assert.equal(u.searchParams.get("ref"), "main");
      return response({
        type: "file",
        encoding: "base64",
        sha,
        content: toBase64(JSON.stringify(remoteConfig)),
      });
    }
    throw Error("unexpected path " + path);
  };
  return { fetcher, calls };
}
test("save writes only navigation to main with expected file SHA", async () => {
  const api = fake(),
    client = new GitHubPublisher("example_test_credential", api.fetcher);
  const draft = clone(config);
  draft.settings.subtitle = "Updated";
  const result = await client.publish(draft, SHA);
  assert.equal(result.commit, COMMIT);
  assert.deepEqual(result.remote.config, draft);
  assert.equal(result.remote.sha, COMMIT);
  assert.equal(api.calls.filter((c) => c.method === "PUT").length, 1);
  assert.equal(
    api.calls.some((c) => /pulls|git\//.test(c.path)),
    false,
  );
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
test("lost save response retries without a duplicate commit or persisted progress", async () => {
  const api = fake({ lose: true }),
    client = new GitHubPublisher("example", api.fetcher);
  const draft = clone(config);
  draft.settings.subtitle = "New";
  await assert.rejects(() => client.publish(draft, SHA), /网络/);
  const result = await client.publish(draft, SHA);
  assert.equal(result.alreadyInMain, true);
  assert.equal(api.calls.filter((c) => c.method === "PUT").length, 1);
});
test("401 and network interruption are clear, safe errors", async () => {
  const api = fake({ fail: "/contents/data/navigation.json" }),
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

test("unchanged configuration is already in main and never creates an empty commit", async () => {
  const api = fake(),
    client = new GitHubPublisher("example", api.fetcher);
  const result = await client.publish(config, SHA);
  assert.equal(result.alreadyInMain, true);
  assert.equal(api.calls.filter((c) => c.method !== "GET").length, 0);
});

test("concurrent save after preflight surfaces newest config without overwriting it", async () => {
  const api = fake({ race: true }),
    client = new GitHubPublisher("example", api.fetcher);
  const draft = clone(config);
  draft.settings.subtitle = "Local edit";
  await assert.rejects(
    () => client.publish(draft, SHA),
    (e) =>
      e instanceof ConflictError &&
      e.remote.config.settings.title === "Other device",
  );
  assert.equal(api.calls.filter((c) => c.method === "PUT").length, 1);
});
test("repository rules reject the write without branch creation or fallback", async () => {
  for (const code of [403, 422]) {
    const api = fake({ reject: code }),
      client = new GitHubPublisher("example", api.fetcher);
    const draft = clone(config);
    draft.settings.subtitle = "Needs permission";
    await assert.rejects(
      () => client.publish(draft, SHA),
      (e) => e instanceof APIError && e.status === code,
    );
    assert.equal(api.calls.filter((c) => c.method !== "GET").length, 1);
  }
});
