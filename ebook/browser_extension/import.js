const fileInput = document.querySelector("#file");
const importButton = document.querySelector("#import");
const status = document.querySelector("#status");

importButton.addEventListener("click", async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    status.textContent = "[FAILED] Hãy chọn file JSON trước.";
    return;
  }

  const importedKeys = [];
  try {
    importButton.disabled = true;
    fileInput.disabled = true;
    status.textContent = `[IMPORT] Đang đọc ${file.name}…`;
    const payload = JSON.parse(await file.text());
    if (payload?.version !== 1 || typeof payload.category_url !== "string" || !Array.isArray(payload.details)) {
      throw new Error("File JSON không đúng định dạng export DTV");
    }

    const runId = `import_${Date.now().toString(36)}`;
    const seen = new Set();
    let batch = {};
    for (const detail of payload.details) {
      if (!detail || typeof detail.url !== "string" || typeof detail.html !== "string") continue;
      let parsed;
      try {
        parsed = new URL(detail.url);
      } catch {
        continue;
      }
      if (parsed.hostname !== "dtv-ebook.com.vn" || !/_\d+\.html$/.test(parsed.pathname)) continue;
      const url = parsed.href.split("#")[0];
      if (seen.has(url)) continue;
      seen.add(url);
      const key = `detail_${runId}_${importedKeys.length}`;
      importedKeys.push(key);
      batch[key] = { title: String(detail.title || ""), url, html: detail.html };
      if (Object.keys(batch).length >= 10) {
        await chrome.storage.local.set(batch);
        batch = {};
        status.textContent = `[IMPORT] Đã nạp ${importedKeys.length}/${payload.details.length} truyện…`;
      }
    }
    if (Object.keys(batch).length) await chrome.storage.local.set(batch);
    if (!importedKeys.length) throw new Error("File JSON không chứa trang chi tiết hợp lệ");

    const result = await chrome.runtime.sendMessage({
      type: "import",
      categoryUrl: payload.category_url,
      runId,
      detailKeys: importedKeys,
      seen: [...seen],
    });
    if (result?.error) throw new Error(result.error);
    status.textContent = `[IMPORT] Đã nạp ${importedKeys.length} truyện. Tab crawler đang tìm phần còn thiếu.`;
  } catch (error) {
    if (importedKeys.length) await chrome.storage.local.remove(importedKeys);
    status.textContent = `[FAILED] ${error?.message || error}`;
    importButton.disabled = false;
    fileInput.disabled = false;
  }
});
