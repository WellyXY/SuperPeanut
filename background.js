chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OPEN_LINKEDIN" && message.url) {
    chrome.tabs.create({ url: message.url }).then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !tab.url?.startsWith("https://www.linkedin.com/")) return;
  await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" }).catch(() => null);
});
