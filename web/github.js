import { assertValid, equal, migrateConfig } from "./model.js";
export const REPOSITORY = "zzpice/zzp-home";
const ROOT = "/repos/" + REPOSITORY;
const FILE = "/contents/data/navigation.json";
export class APIError extends Error {
  constructor(status) {
    super(
      {
        401: "GitHub 授权失败，请检查 Token 是否有效或已过期。",
        403: "GitHub 拒绝操作：请检查仓库权限、Token 权限、访问限制及分支规则。",
        404: "GitHub 资源不可访问，请检查仓库与 Token 授权范围。",
        409: "GitHub 分支或文件已变化，请检查云端状态后重试。",
        422: "GitHub 拒绝此操作，请检查 main 分支的写入规则。",
        429: "GitHub 请求过于频繁，请稍后重试。",
      }[status] || "GitHub 服务暂时不可用，请稍后重试。",
    );
    this.status = status;
  }
}
export class ConflictError extends Error {
  constructor(remote) {
    super("正式配置已变化。已停止保存，请先合并云端修改。");
    this.remote = remote;
  }
}
function fromBase64(value) {
  return new TextDecoder().decode(
    Uint8Array.from(atob(value.replace(/\s/g, "")), (c) => c.charCodeAt(0)),
  );
}
export function toBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let text = "";
  for (let i = 0; i < bytes.length; i += 32768)
    text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
export class GitHubPublisher {
  constructor(token, fetcher = (...args) => fetch(...args)) {
    this.token = token.trim();
    this.fetcher = fetcher;
    if (
      !this.token ||
      this.token.length > 255 ||
      /[^a-zA-Z0-9_]/.test(this.token)
    )
      throw Error("请输入有效的 GitHub Token。");
  }
  dispose() {
    this.token = "";
  }
  async request(path, { method = "GET", body } = {}) {
    if (!path.startsWith(ROOT + "/") && path !== ROOT)
      throw Error("不允许向其他仓库发送授权");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await this.fetcher("https://api.github.com" + path, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + this.token,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) throw new APIError(response.status);
      if (response.status === 204) return null;
      return await response.json();
    } catch (error) {
      if (error instanceof APIError) throw error;
      throw Error(
        "网络中断或 GitHub 无响应。本机草稿已保留；重新输入 Token 后可重试。",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  async content(ref) {
    const file = await this.request(
      ROOT + FILE + "?ref=" + encodeURIComponent(ref),
    );
    if (
      file.type !== "file" ||
      file.encoding !== "base64" ||
      typeof file.content !== "string" ||
      file.content.length > 2_000_000 ||
      !/^[a-f0-9]{40,64}$/.test(file.sha)
    )
      throw Error("GitHub 配置文件格式无效");
    const config = assertValid(migrateConfig(JSON.parse(fromBase64(file.content))));
    return { sha: file.sha, config };
  }
  async remote() {
    const repository = await this.request(ROOT);
    if (repository.permissions?.push !== true) throw new APIError(403);
    return this.content("main");
  }
  async publish(config, baseSha) {
    assertValid(config);
    const remote = await this.remote();
    // A retry after a lost response recognizes the content already saved.
    if (equal(remote.config, config)) return { alreadyInMain: true, remote };
    if (remote.sha !== baseSha) throw new ConflictError(remote);
    let written;
    try {
      written = await this.request(ROOT + FILE, {
        method: "PUT",
        body: {
          message: "Update navigation configuration",
          branch: "main",
          sha: remote.sha,
          content: toBase64(JSON.stringify(config, null, 2) + "\n"),
        },
      });
    } catch (error) {
      if (error.status !== 409) throw error;
      const latest = await this.content("main");
      if (equal(latest.config, config))
        return { alreadyInMain: true, remote: latest };
      throw new ConflictError(latest);
    }
    if (
      !/^[a-f0-9]{40,64}$/.test(written.content?.sha) ||
      !/^[a-f0-9]{40,64}$/.test(written.commit?.sha)
    )
      throw Error("GitHub 保存结果无效。本机草稿已保留，请重试确认。");
    return {
      remote: { sha: written.content.sha, config },
      commit: written.commit.sha,
    };
  }
}
