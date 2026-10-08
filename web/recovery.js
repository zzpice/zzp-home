document.querySelector("#recover").addEventListener("click", async (event) => {
  event.currentTarget.disabled = true;
  const result = document.querySelector("#result");
  try {
    const base = new URL("./", location.href).href;
    const registrations =
      (await navigator.serviceWorker?.getRegistrations()) || [];
    await Promise.all(
      registrations
        .filter(
          (r) =>
            r.scope === base &&
            [r.active, r.waiting, r.installing].some(
              (w) => w?.scriptURL === new URL("sw.js", base).href,
            ),
        )
        .map((r) => r.unregister()),
    );
    if ("caches" in window)
      await Promise.all(
        (await caches.keys())
          .filter((x) => x.startsWith("zzp-home-shell-"))
          .map((x) => caches.delete(x)),
      );
    location.replace(base + "?recovered=" + Date.now());
  } catch {
    result.textContent = "恢复未完成，请联网后重试；草稿仍然保留。";
    event.currentTarget.disabled = false;
  }
});
