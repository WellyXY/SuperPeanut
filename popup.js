const count = document.querySelector("#hc-count");
const message = document.querySelector("#message");
const AGENT_ENDPOINT = "https://sany-agent-temp.racoonn.me";

async function updateCount() {
  try {
    const hcs = await SanyStore.getHcs();
    count.textContent = hcs.length;
  } catch (error) {
    count.textContent = "离线";
    message.textContent = `数据服务暂不可用：${error?.message || "连接失败"}`;
  }
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
  message.textContent = "正在读取 Excel，Peanut 将自动识别表格结构…";
  try {
    const workbook = await SanyXlsx.parseWorkbookData(await file.arrayBuffer());
    const response = await fetch(`${AGENT_ENDPOINT}/roles/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: file.name, sheets: SanyXlsx.agentSheets(workbook) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `agent returned ${response.status}`);
    const hcs = await SanyStore.replaceImportedRows(payload.roles || []);
    message.textContent = `Peanut 已整理并导入 ${hcs.length} 个岗位，LinkedIn 面板会自动同步。`;
    await updateCount();
  } catch (error) {
    message.textContent = error?.message || "导入失败，请检查文件格式。";
  }
});

updateCount();
