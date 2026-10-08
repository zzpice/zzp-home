const DB = "zzp-home-editor-v1";
const STORE = "drafts";
export function tabID() {
  let id;
  try {
    id = sessionStorage.getItem(DB);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(DB, id);
    }
  } catch {
    id = crypto.randomUUID();
  }
  return id;
}
async function database() {
  return new Promise((resolve, reject) => {
    let finished = false;
    const fail = (message) => {
      finished = true;
      reject(Error(message));
    };
    const request = indexedDB.open(DB, 1);
    const timer = setTimeout(
      () => fail("草稿存储被阻塞，请关闭旧标签页后重试"),
      4000,
    );
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      if (finished) {
        db.close();
        return;
      }
      finished = true;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => {
      clearTimeout(timer);
      fail("此浏览器无法保存草稿，请及时导出配置");
    };
    request.onblocked = () => {
      clearTimeout(timer);
      fail("草稿存储被阻塞，请及时导出配置");
    };
  });
}
async function transaction(mode, operation) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let result;
      const req = operation(tx.objectStore(STORE));
      req.onsuccess = () => {
        result = req.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(Error("草稿保存失败，请导出备份"));
      tx.onabort = tx.onerror;
    });
  } finally {
    db.close();
  }
}
export const saveDraft = (id, record) =>
  transaction("readwrite", (s) =>
    s.put({ ...record, id, savedAt: new Date().toISOString() }),
  );
export const deleteDraft = (id) =>
  transaction("readwrite", (s) => s.delete(id));
export async function loadDrafts() {
  return (await transaction("readonly", (s) => s.getAll())).sort((a, b) =>
    b.savedAt.localeCompare(a.savedAt),
  );
}
