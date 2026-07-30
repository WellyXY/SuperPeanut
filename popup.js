const count = document.querySelector("#hc-count");
const message = document.querySelector("#message");
const loginView = document.querySelector("#login-view");
const registerView = document.querySelector("#register-view");
const workspaceView = document.querySelector("#workspace-view");
const loginMessage = document.querySelector("#login-message");
const AGENT_ENDPOINT = "https://sany-agent-temp.racoonn.me";

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("is-error", isError);
}

function showAccount(account) {
  loginView.hidden = Boolean(account);
  registerView.hidden = true;
  workspaceView.hidden = !account;
  if (account) {
    document.querySelector("#account-name").textContent = account.displayName || account.username;
    document.querySelector("#account-id").textContent = `@${account.username} · User ${String(account.id).padStart(4, "0")}`;
  }
}

function showAuth(mode) {
  workspaceView.hidden = true;
  loginView.hidden = mode !== "login";
  registerView.hidden = mode !== "register";
}

async function ensureCompanySkills(roles) {
  const existing = await SanyStore.getCompanySkills();
  const known = new Set(existing.map((skill) => SanyStore.normalizeCompany(skill.company)));
  const groups = new Map();
  for (const role of roles) {
    const company = SanyStore.normalizeCompany(role?.company);
    if (!company || known.has(company)) continue;
    if (!groups.has(company)) groups.set(company, []);
    groups.get(company).push({ ...role, company });
  }
  if (!groups.size) return 0;
  const missing = [...groups].map(([company, companyRoles]) => ({ company, roles: companyRoles }));
  const generated = [];
  for (let index = 0; index < missing.length; index += 10) {
    const batch = missing.slice(index, index + 10);
    const response = await fetch(`${AGENT_ENDPOINT}/skills/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companies: batch }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `agent returned ${response.status}`);
    const batchSkills = SanyStore.normalizeSkills(payload.skills || []);
    if (batchSkills.length !== batch.length) throw new Error("部分公司未能生成有效 Skill");
    generated.push(...batchSkills);
  }
  if (generated.length !== groups.size) throw new Error("部分公司未能生成有效 Skill");
  const byCompany = new Map(existing.map((skill) => [SanyStore.normalizeCompany(skill.company), skill]));
  generated.forEach((skill) => byCompany.set(SanyStore.normalizeCompany(skill.company), skill));
  await SanyStore.saveCompanySkills([...byCompany.values()]);
  return generated.length;
}

async function updateCount() {
  try {
    const hcs = await SanyStore.getHcs();
    count.textContent = hcs.length;
  } catch (error) {
    count.textContent = "离线";
    setMessage(`数据服务暂不可用：${error?.message || "连接失败"}`, true);
  }
}

document.querySelector("#open-panel").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://www.linkedin.com/")) {
    setMessage("请先打开 LinkedIn 候选人个人主页，再使用悬浮工作台。", true);
    return;
  }
  await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" }).catch(() => null);
  window.close();
});

document.querySelector("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  setMessage("正在读取 Excel，Peanut 将自动识别表格结构…");
  try {
    const workbook = await SanyXlsx.parseWorkbookData(await file.arrayBuffer());
    const response = await fetch(`${AGENT_ENDPOINT}/roles/import/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: file.name, sheets: SanyXlsx.agentSheets(workbook) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `agent returned ${response.status}`);
    let importPayload = payload;
    if (payload.jobId) {
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const poll = await fetch(`${AGENT_ENDPOINT}/roles/import/jobs/${payload.jobId}`);
        const job = await poll.json().catch(() => ({}));
        if (!poll.ok) throw new Error(job.error || `agent returned ${poll.status}`);
        if (job.status === "failed") throw new Error(job.error || "导入失败");
        if (job.status === "completed") { importPayload = job.result || {}; break; }
      }
      if (importPayload === payload) throw new Error("导入处理超过 5 分钟，请稍后重试");
    }
    const previous = await SanyStore.getHcs();
    const importedCount = Array.isArray(importPayload.roles) ? importPayload.roles.length : 0;
    const hcs = await SanyStore.mergeImportedRows(importPayload.roles || []);
    const missingCompanyCount = hcs.filter((role) => !String(role?.company || "").trim()).length;
    let generated = 0;
    let skillError = null;
    try {
      generated = await ensureCompanySkills(hcs);
    } catch (error) {
      skillError = error;
    }
    if (missingCompanyCount) {
      setMessage(`Peanut 已处理 ${importedCount} 个岗位；${missingCompanyCount} 个 HC 未填写公司，请在 HC 库补充，否则无法匹配。${skillError ? ` 其他公司的 Skill 生成失败：${skillError.message || "Agent 暂时不可用"}。` : " 已填写公司的岗位可正常匹配。"}`, true);
    } else if (skillError) {
      setMessage(`HC 已导入，但公司匹配 Skill 生成失败：${skillError.message || "Agent 暂时不可用"}。`, true);
    } else {
      setMessage(`Peanut 已处理 ${importedCount} 个岗位；新增 ${Math.max(0, hcs.length - previous.length)} 个，原有 HC 已保留${generated ? `，并生成 ${generated} 个公司 Skill` : ""}。`);
    }
    await updateCount();
  } catch (error) {
    setMessage(error?.message || "导入失败，请检查文件格式。", true);
  }
});

loginView.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginView.querySelector('button[type="submit"]');
  button.disabled = true;
  loginMessage.textContent = "正在登录…";
  loginMessage.classList.remove("is-error");
  try {
    const account = await SanyStore.login(document.querySelector("#login-username").value, document.querySelector("#login-password").value);
    showAccount(account);
    await updateCount();
  } catch (error) {
    loginMessage.textContent = error?.message || "登录失败";
    loginMessage.classList.add("is-error");
  } finally { button.disabled = false; }
});

registerView.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = registerView.querySelector('button[type="submit"]');
  const registerMessage = document.querySelector("#register-message");
  button.disabled = true;
  registerMessage.textContent = "正在建立账号…";
  registerMessage.classList.remove("is-error");
  try {
    const account = await SanyStore.register(
      document.querySelector("#register-name").value,
      document.querySelector("#register-username").value,
      document.querySelector("#register-password").value,
    );
    showAccount(account);
    await updateCount();
  } catch (error) {
    registerMessage.textContent = error?.message || "注册失败";
    registerMessage.classList.add("is-error");
  } finally { button.disabled = false; }
});

document.querySelector("#show-register").addEventListener("click", () => showAuth("register"));
document.querySelector("#show-login").addEventListener("click", () => showAuth("login"));

document.querySelector("#logout-button").addEventListener("click", async () => {
  await SanyStore.logout();
  showAuth("login");
  document.querySelector("#login-password").value = "";
  loginMessage.textContent = "";
});

SanyStore.currentAccount().then((account) => {
  showAccount(account);
  if (account) updateCount();
});
