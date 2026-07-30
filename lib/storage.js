(function () {
  const CURRENT_YEAR = new Date().getFullYear();
  const STORAGE_ENDPOINT = "https://superpeanut-storage-production.up.railway.app";
  const KEY = { workspace: "superpeanut_workspace_key" };
  let cachedState = null;
  let loadingState = null;

  const field = (row, names, fallback = "") => {
    for (const name of names) {
      if (row?.[name] !== undefined && row?.[name] !== null && String(row[name]).trim() !== "") return row[name];
    }
    return fallback;
  };

  const cleanText = (value) => String(value ?? "")
    .normalize("NFC")
    .replace(/\uFFFD+/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .trim();

  const stableId = (input) => {
    let hash = 5381;
    for (let index = 0; index < input.length; index += 1) hash = (hash * 33) ^ input.charCodeAt(index);
    return `hc_${(hash >>> 0).toString(36)}`;
  };

  function normalizeRole(row, index = 0) {
    const title = cleanText(field(row, ["title", "岗位名称", "岗位", "role"], "未命名岗位"));
    const location = cleanText(field(row, ["location", "国家/城市", "地点", "城市"], "未填写地点"));
    const company = cleanText(field(row, ["company", "Company", "公司", "公司名称", "雇主", "Employer"], ""));
    const unit = cleanText(field(row, ["businessUnit", "事业部/产品线", "事业部", "产品线"], "不限产品"));
    const rawOpenCount = field(row, ["openCount", "HC", "hc", "headcount"], 1);
    return {
      id: cleanText(field(row, ["id"], stableId(`${company}|${title}|${location}|${unit}|${index}`))),
      priority: cleanText(field(row, ["priority", "优先级"], "S")).toUpperCase(),
      businessUnit: unit,
      company,
      function: cleanText(field(row, ["function", "职能", "functionName"], "General")),
      region: cleanText(field(row, ["region", "大区"], "全球")),
      title,
      location,
      nationality: cleanText(field(row, ["nationality", "国籍要求", "国籍"], "")),
      openCount: Number.isFinite(Number(rawOpenCount)) ? Math.max(0, Number(rawOpenCount)) : 1,
      note: cleanText(field(row, ["note", "备注", "JD", "jd"], "")),
      hiringManager: cleanText(field(row, ["hiringManager", "HM", "招聘负责人"], "")),
      updatedAt: cleanText(field(row, ["updatedAt", "更新日期", "更新时间"], new Date().toISOString().slice(0, 10))),
    };
  }

  function normalizeRoles(rows) {
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => row && Object.values(row).some((value) => String(value ?? "").trim()))
      .map(normalizeRole)
      .filter((role) => role.title !== "未命名岗位");
  }

  const roleIdentity = (role, includeCompany = true) => [
    includeCompany ? cleanText(role?.company).toLowerCase() : "",
    cleanText(role?.title).toLowerCase(),
    cleanText(role?.location).toLowerCase(),
  ].join("|");

  async function workspaceKey() {
    const result = await chrome.storage.local.get(KEY.workspace);
    if (typeof result[KEY.workspace] === "string" && /^[A-Za-z0-9_-]{43}$/.test(result[KEY.workspace])) return result[KEY.workspace];
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const key = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    await chrome.storage.local.set({ [KEY.workspace]: key });
    return key;
  }

  async function request(path, body) {
    const response = await fetch(`${STORAGE_ENDPOINT}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-superpeanut-workspace": await workspaceKey() },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Railway storage returned ${response.status}`);
    return payload;
  }

  async function loadState(force = false) {
    if (cachedState && !force) return cachedState;
    if (!loadingState) loadingState = request("/v1/state/read").then((payload) => {
      cachedState = { hcs: normalizeRoles(payload.state?.hcs), history: Array.isArray(payload.state?.history) ? payload.state.history : [], messages: Array.isArray(payload.state?.messages) ? payload.state.messages : [] };
      return cachedState;
    }).finally(() => { loadingState = null; });
    return loadingState;
  }

  async function saveState(partial) {
    const current = await loadState();
    const next = {
      hcs: partial.hcs === undefined ? current.hcs : normalizeRoles(partial.hcs),
      history: partial.history === undefined ? current.history : (Array.isArray(partial.history) ? partial.history : []),
      messages: partial.messages === undefined ? current.messages : (Array.isArray(partial.messages) ? partial.messages : []),
    };
    const payload = await request("/v1/state/write", { state: next });
    cachedState = { hcs: normalizeRoles(payload.state?.hcs), history: Array.isArray(payload.state?.history) ? payload.state.history : [], messages: Array.isArray(payload.state?.messages) ? payload.state.messages : [] };
    return cachedState;
  }

  async function getHcs() { return (await loadState()).hcs; }
  async function saveHcs(hcs) { return (await saveState({ hcs })).hcs; }
  async function replaceImportedRows(rows) {
    const normalized = normalizeRoles(rows);
    if (!normalized.length) throw new Error("未找到可用岗位。请确认表格包含“岗位名称”和“国家/城市”列。");
    return saveHcs(normalized);
  }
  async function mergeImportedRows(rows) {
    const incoming = normalizeRoles(rows);
    if (!incoming.length) throw new Error("Peanut 未能从 Excel 识别有效岗位，请检查文件内容。");
    const current = await getHcs();
    const merged = [...current];
    for (const role of incoming) {
      const exactIdentity = roleIdentity(role);
      const looseIdentity = roleIdentity(role, false);
      const existingIndex = merged.findIndex((existing) =>
        roleIdentity(existing) === exactIdentity ||
        ((!existing.company || !role.company) && roleIdentity(existing, false) === looseIdentity)
      );
      if (existingIndex >= 0) {
        merged[existingIndex] = {
          ...merged[existingIndex],
          ...role,
          id: merged[existingIndex].id,
          company: role.company || merged[existingIndex].company || "",
        };
      } else {
        merged.push(role);
      }
    }
    return saveHcs(merged);
  }
  async function getHistory() { return (await loadState()).history; }
  async function appendHistory(record) {
    const previous = (await loadState()).history;
    const deduped = previous.filter((item) => !(item.candidate?.url && item.candidate.url === record.candidate?.url) && !(item.candidate?.source === "cv" && record.candidate?.source === "cv" && item.candidate?.name === record.candidate?.name));
    const history = [{ ...record, id: `report_${Date.now()}`, createdAt: new Date().toISOString() }, ...deduped].slice(0, 200);
    return (await saveState({ history })).history;
  }
  async function clearHistory() { await saveState({ history: [] }); }
  async function getAgentMessages() { return (await loadState()).messages; }
  async function saveAgentMessages(messages) { return (await saveState({ messages: messages.slice(-60) })).messages; }

  globalThis.SanyStore = { CURRENT_YEAR, KEY, normalizeRole, normalizeRoles, getHcs, saveHcs, replaceImportedRows, mergeImportedRows, getHistory, appendHistory, clearHistory, getAgentMessages, saveAgentMessages };
})();
