import { assertValid, equal } from "./model.js";
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
        422: "GitHub 拒绝此操作，请检查分支规则及已有发布申请。",
        429: "GitHub 请求过于频繁，请稍后重试。",
      }[status] || "GitHub 服务暂时不可用，请稍后重试。",
    );
    this.status = status;
  }
}
export class ConflictError extends Error {
  constructor(remote) {
    super("正式配置已变化。已停止发布，请先合并云端修改。");
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
async function fingerprint(value) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
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
        "网络中断或 GitHub 无响应。草稿及发布进度已保留；重新输入 Token 后可重试。",
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
    const config = assertValid(JSON.parse(fromBase64(file.content)));
    return { sha: file.sha, config };
  }
  async remote() {
    const repository = await this.request(ROOT);
    if (repository.permissions?.push !== true) throw new APIError(403);
    const ref = await this.request(ROOT + "/git/ref/heads/main");
    const head = ref.object?.sha;
    if (!/^[a-f0-9]{40,64}$/.test(head)) throw Error("GitHub main 引用无效");
    return { ...(await this.content(head)), head };
  }
  async publish(config, baseSha, previous, onProgress = async () => {}) {
    assertValid(config);
    const remote = await this.remote();
    if (equal(remote.config, config)) return { alreadyInMain: true, remote };
    if (remote.sha !== baseSha) throw new ConflictError(remote);
    const content = JSON.stringify(config, null, 2) + "\n";
    const hash = await fingerprint(content);
    const validPrevious =
      previous?.fingerprint === hash &&
      /^nav\/edit-[a-f0-9-]{36}$/.test(previous.branch) &&
      /^[a-f0-9]{40,64}$/.test(previous.baseHead) &&
      previous.baseSha === baseSha;
    let progress = validPrevious
      ? {
          branch: previous.branch,
          baseHead: previous.baseHead,
          baseSha: previous.baseSha,
          fingerprint: hash,
          phase: previous.phase,
          ...(previous.commit ? { commit: previous.commit } : {}),
        }
      : {
          branch: "nav/edit-" + crypto.randomUUID(),
          baseHead: remote.head,
          baseSha: remote.sha,
          fingerprint: hash,
          phase: "branch",
        };
    const save = async (patch) => {
      progress = { ...progress, ...patch };
      await onProgress({ ...progress });
    };
    await save({ phase: "branch" });
    try {
      await this.request(ROOT + "/git/ref/heads/" + progress.branch);
    } catch (error) {
      if (error.status !== 404) throw error;
      await this.request(ROOT + "/git/refs", {
        method: "POST",
        body: { ref: "refs/heads/" + progress.branch, sha: progress.baseHead },
      });
    }
    await save({ phase: "commit" });
    const branchFile = await this.content(progress.branch);
    if (equal(branchFile.config, config)) {
      const ref = await this.request(
        ROOT + "/git/ref/heads/" + progress.branch,
      );
      await save({ commit: ref.object.sha });
    } else {
      if (branchFile.sha !== progress.baseSha)
        throw Error("编辑分支已被其他操作修改。请保留草稿并重新创建发布申请。");
      const written = await this.request(ROOT + FILE, {
        method: "PUT",
        body: {
          message: "Update navigation configuration",
          branch: progress.branch,
          sha: branchFile.sha,
          content: toBase64(content),
        },
      });
      await save({ commit: written.commit.sha });
    }
    await save({ phase: "pull-request" });
    const existing = await this.request(
      ROOT +
        "/pulls?state=all&head=" +
        encodeURIComponent("zzpice:" + progress.branch) +
        "&base=main",
    );
    let pr = existing[0];
    if (!pr)
      pr = await this.request(ROOT + "/pulls", {
        method: "POST",
        body: {
          title: "更新个人导航配置",
          head: progress.branch,
          base: "main",
          body: "通过 zzp.moe 网页编辑器提交导航与共享外观配置。\n\n合并前请检查配置差异及自动化检查；合并后由 GitHub Actions 构建并部署。",
        },
      });
    if (
      !/^https:\/\/github\.com\/zzpice\/zzp-home\/pull\/\d+$/.test(pr.html_url)
    )
      throw Error("GitHub 返回了异常的发布申请地址");
    await save({
      phase: "submitted",
      prUrl: pr.html_url,
      number: pr.number,
      state: pr.state,
    });
    return progress;
  }
}
