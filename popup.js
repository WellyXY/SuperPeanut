const count = document.querySelector("#hc-count");
const message = document.querySelector("#message");

async function updateCount() {
  const hcs = await SanyStore.getHcs();
  count.textContent = hcs.length;
}

document.querySelector("#open-panel").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://www.linkedin.com/")) {
    message.textContent = "请先打开 LinkedIn 候选人个人主页，再使用悬浮工作台。";
    return;
  }
  await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" }).catch(() => null);
  window.close();
});

document.querySelector("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  message.textContent = "正在读取 XLSX 文件…";
  try {
    const rows = await SanyXlsx.parseWorkbook(await file.arrayBuffer());
    const hcs = await SanyStore.replaceImportedRows(rows);
    message.textContent = `已导入 ${hcs.length} 个岗位，LinkedIn 面板会自动同步。`;
    await updateCount();
  } catch (error) {
    message.textContent = error?.message || "导入失败，请检查文件格式。";
  }
});

updateCount();
