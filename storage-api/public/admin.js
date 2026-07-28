const app = document.querySelector("#app");
const pageTitle = document.querySelector("#page-title");
const searchInput = document.querySelector("#global-search");
const generatedAt = document.querySelector("#generated-at");
const refreshButton = document.querySelector("#refresh-button");

let snapshot = null;
let search = "";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const number = (value) => new Intl.NumberFormat("zh-TW").format(Number(value || 0));
const date = (value) => value ? new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "尚無";
const includesSearch = (...values) => !search || values.join(" ").toLowerCase().includes(search);
const currentRoute = () => decodeURIComponent((location.hash || "#dashboard").slice(1));
const linkTo = (route) => `#${encodeURIComponent(route)}`;

function dedupeCandidates(rows) {
  const candidates = new Map();
  rows.forEach((item) => {
    const key = String(item.linkedinUrl || `${item.name}|${item.location}`).trim().toLowerCase();
    const current = candidates.get(key);
    if (!current || Number(item.score || 0) > Number(current.score || 0)) candidates.set(key, item);
  });
  return [...candidates.values()];
}

function tableEmpty(message) { return `<div class="empty">${escapeHtml(message)}</div>`; }
function metric(label, value, note) { return `<article class="metric"><span>${escapeHtml(label)}</span><strong>${number(value)}</strong><small>${escapeHtml(note)}</small></article>`; }

function trendDate(value) {
  const [, month, day] = String(value || "").split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : "";
}

function trendCard(label, key, note, cumulative = false, headlineValue = null) {
  const rows = snapshot.trends || [];
  const values = rows.map((row) => Number(row[key] || 0));
  const headline = headlineValue == null
    ? (cumulative ? values.at(-1) || 0 : values.reduce((sum, value) => sum + value, 0))
    : Number(headlineValue);
  const peak = Math.max(1, ...values);
  const width = 420;
  const height = 92;
  const inset = 8;
  const points = values.map((value, index) => {
    const x = values.length > 1 ? index * (width / (values.length - 1)) : width / 2;
    const y = height - inset - (value / peak) * (height - inset * 2);
    return { x, y, value, date: rows[index]?.date || "" };
  });
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = points.length ? `${line} L${width},${height} L0,${height} Z` : "";
  const dots = points.map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3"><title>${escapeHtml(trendDate(point.date))}: ${number(point.value)}</title></circle>`).join("");
  return `<article class="trend-card"><div class="trend-head"><div><span>${escapeHtml(label)}</span><strong>${number(headline)}</strong></div><small>${escapeHtml(note)}</small></div><svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(`${label}近 7 天趨勢`)}"><path class="trend-area" d="${area}"></path><path class="trend-line" d="${line}"></path>${dots}</svg><div class="trend-dates"><span>${escapeHtml(trendDate(rows[0]?.date))}</span><span>近 7 天</span><span>${escapeHtml(trendDate(rows.at(-1)?.date))}</span></div></article>`;
}

function dashboardView() {
  const d = snapshot.dashboard;
  const recent = snapshot.matches.slice(0, 6);
  return `<div class="trends">
    ${trendCard("Match", "matches", "7 日總計")}
    ${trendCard("Agent messages", "agentMessages", "使用者送出的訊息")}
    ${trendCard("匹配 HC", "matchedHcs", "7 日去重總數", false, d.matchedHcs7d)}
    ${trendCard("Extension users", "extensionUsers", "目前累計使用者", true)}
  </div>
  <section class="section"><div class="section-head"><h2>最近匹配</h2><span>累計 ${number(d.totalMatches)} 次</span></div>${matchesTable(recent)}</section>
  <section class="section"><div class="section-head"><h2>最常匹配 HC</h2><span>按候選人數排序</span></div>${hcsTable(snapshot.hcs.slice(0, 8))}</section>`;
}

function hcsTable(rows) {
  if (!rows.length) return tableEmpty("沒有符合條件的 HC");
  return `<div class="table-wrap"><table><thead><tr><th>HC</th><th>產品線</th><th>優先級</th><th>Users</th><th>候選人</th><th>最近匹配</th></tr></thead><tbody>${rows.map((hc) => `<tr data-route="hc/${encodeURIComponent(hc.key)}"><td><div class="primary">${escapeHtml(hc.title)}</div><div class="secondary">${escapeHtml(hc.location)}</div></td><td>${escapeHtml(hc.businessUnit)}</td><td><span class="tag">${escapeHtml(hc.priority)}</span></td><td class="numeric">${number(hc.userCount)}</td><td class="numeric">${number(hc.matchCount)}</td><td class="numeric">${date(hc.lastMatchedAt)}</td></tr>`).join("")}</tbody></table></div>`;
}

function hcsView() {
  const rows = snapshot.hcs.filter((hc) => includesSearch(hc.title, hc.location, hc.businessUnit, hc.function, hc.note));
  return `<div class="metrics">${metric("去重 HC", rows.length, `原始 ${number(snapshot.dashboard.totalHcInstances)} 個 user instances`)}${metric("總 HC 數量", rows.reduce((sum, hc) => sum + Number(hc.totalOpenCount || 0), 0), "所有 user headcount 合計")}${metric("有候選人的 HC", rows.filter((hc) => Number(hc.matchCount) > 0).length, "至少完成一次匹配")}${metric("累計候選人", rows.reduce((sum, hc) => sum + Number(hc.matchCount || 0), 0), "去重後的候選人")}</div><section class="section"><div class="section-head"><h2>HC List</h2><span>${number(rows.length)} 個結果</span></div>${hcsTable(rows)}</section>`;
}

function usersView() {
  const rows = snapshot.users.filter((user) => includesSearch(user.label, user.id));
  return `<div class="metrics">${metric("總 Users", snapshot.dashboard.totalUsers, "每個 Railway workspace 為一位 user")}${metric("24 小時活躍", rows.filter((user) => Date.now() - new Date(user.lastSeenAt).valueOf() < 86400000).length, "曾同步 Extension 資料")}${metric("有 Match 紀錄", rows.filter((user) => Number(user.matchCount) > 0).length, "至少匹配一位候選人")}${metric("有 Agent 對話", rows.filter((user) => Number(user.agentCommentCount) > 0).length, "至少提出一次問題")}</div><section class="section"><div class="section-head"><h2>User List</h2><span>${number(rows.length)} 位</span></div><div class="table-wrap"><table><thead><tr><th>User</th><th>最後使用</th><th>HC</th><th>Match 次數</th><th>候選人</th><th>Agent comments</th></tr></thead><tbody>${rows.map((user) => `<tr data-route="matches?user=${user.id}"><td><div class="primary">${escapeHtml(user.label)}</div><div class="secondary">建立於 ${date(user.createdAt)}</div></td><td>${date(user.lastSeenAt)}</td><td class="numeric">${number(user.hcCount)}</td><td class="numeric">${number(user.matchCount)}</td><td class="numeric">${number(user.candidateCount)}</td><td class="numeric">${number(user.agentCommentCount)}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function matchesTable(rows) {
  if (!rows.length) return tableEmpty("沒有符合條件的候選人");
  return `<div class="table-wrap"><table><thead><tr><th>候選人</th><th>User</th><th>適合 HC</th><th>分數</th><th>時間</th></tr></thead><tbody>${rows.map((item) => `<tr data-route="match/${encodeURIComponent(item.id)}"><td><div class="primary">${escapeHtml(item.name || "未命名候選人")}</div><div class="secondary">${escapeHtml(item.headline || item.location || "未提供介紹")}</div></td><td>${escapeHtml(item.userLabel)}</td><td>${item.noFit ? '<span class="tag danger">沒有匹配</span>' : escapeHtml(item.matchedHcTitle || "未記錄")}</td><td class="numeric">${item.score == null ? "未評分" : number(item.score)}</td><td class="numeric">${date(item.createdAt)}</td></tr>`).join("")}</tbody></table></div>`;
}

function matchesView(route) {
  const query = new URLSearchParams(route.split("?")[1] || "");
  const userId = query.get("user");
  const rows = dedupeCandidates(snapshot.matches.filter((item) => (!userId || String(item.userId) === userId) && includesSearch(item.name, item.headline, item.location, item.matchedHcTitle, item.userLabel)));
  return `<div class="metrics">${metric("匹配紀錄", rows.length, userId ? `只顯示 User ${String(userId).padStart(4, "0")}` : "全部 Users")}${metric("有適合 HC", rows.filter((item) => !item.noFit).length, "Agent 產生有效推薦")}${metric("沒有匹配", rows.filter((item) => item.noFit).length, "保留作為查詢紀錄")}${metric("LinkedIn links", rows.filter((item) => item.linkedinUrl).length, "可直接進入 Profile")}</div><section class="section"><div class="section-head"><h2>Matched Candidates</h2><span>${number(rows.length)} 筆</span></div>${matchesTable(rows)}</section>`;
}

function hcDetail(key) {
  const hc = snapshot.hcs.find((item) => item.key === key);
  if (!hc) return tableEmpty("找不到這個 HC");
  const candidates = dedupeCandidates(snapshot.matches.filter((item) => item.hcKey === key));
  return `<section class="detail-header"><div><button class="back" data-route="hcs">返回 HC List</button><h2>${escapeHtml(hc.title)}</h2><p>${escapeHtml(hc.location)} · ${escapeHtml(hc.businessUnit)} · ${escapeHtml(hc.function)}</p><p>${escapeHtml(hc.note || "未提供 JD 備註")}</p></div><div class="detail-score"><strong>${number(hc.matchCount)}</strong><span>匹配候選人</span></div></section><section class="section"><div class="section-head"><h2>候選人介紹</h2><span>${number(candidates.length)} 位</span></div>${candidateCards(candidates)}</section>`;
}

function candidateCards(rows) {
  if (!rows.length) return tableEmpty("這個 HC 尚未匹配到候選人");
  return `<div class="candidate-grid">${rows.map((item) => `<article class="candidate"><div class="candidate-head"><div><h3>${escapeHtml(item.name || "未命名候選人")}</h3><div class="secondary">${escapeHtml(item.headline || item.location || "未提供職位")}</div></div><span class="tag ${item.noFit ? "danger" : ""}">${item.score == null ? "未評分" : `${number(item.score)} 分`}</span></div><p>${escapeHtml(item.introduction || item.summary || "目前沒有更多候選人介紹。")}</p><div class="secondary">${escapeHtml(item.userLabel)} · ${date(item.createdAt)}</div>${item.linkedinUrl ? `<a href="${escapeHtml(item.linkedinUrl)}" target="_blank" rel="noreferrer">開啟 LinkedIn Profile</a>` : ""}</article>`).join("")}</div>`;
}

function matchDetail(id) {
  const item = snapshot.matches.find((match) => match.id === id);
  if (!item) return tableEmpty("找不到這筆匹配紀錄");
  return `<section class="detail-header"><div><button class="back" data-route="matches">返回 Matched Candidates</button><h2>${escapeHtml(item.name || "未命名候選人")}</h2><p>${escapeHtml(item.headline || item.location || "未提供職位和地點")}</p><p>${escapeHtml(item.introduction || item.summary || "目前沒有更多候選人介紹。")}</p>${item.linkedinUrl ? `<p><a href="${escapeHtml(item.linkedinUrl)}" target="_blank" rel="noreferrer">開啟 LinkedIn Profile</a></p>` : ""}</div><div class="detail-score"><strong>${item.score == null ? "N/A" : number(item.score)}</strong><span>${escapeHtml(item.matchedHcTitle || "沒有匹配 HC")}</span></div></section>`;
}

function render() {
  if (!snapshot) return;
  const route = currentRoute();
  document.querySelectorAll("nav button").forEach((button) => button.classList.toggle("is-active", route.startsWith(button.dataset.route)));
  if (route === "dashboard") { pageTitle.textContent = "Dashboard"; app.innerHTML = dashboardView(); }
  else if (route === "hcs") { pageTitle.textContent = "HC List"; app.innerHTML = hcsView(); }
  else if (route === "users") { pageTitle.textContent = "Users"; app.innerHTML = usersView(); }
  else if (route.startsWith("hc/")) { pageTitle.textContent = "HC Detail"; app.innerHTML = hcDetail(decodeURIComponent(route.slice(3))); }
  else if (route.startsWith("match/")) { pageTitle.textContent = "Candidate Detail"; app.innerHTML = matchDetail(decodeURIComponent(route.slice(6))); }
  else { pageTitle.textContent = "Matched Candidates"; app.innerHTML = matchesView(route); }
}

async function load() {
  refreshButton.disabled = true;
  try {
    const response = await fetch("/api/admin/snapshot", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    snapshot = payload;
    generatedAt.textContent = `更新 ${date(payload.generatedAt)}`;
    render();
  } catch (error) {
    app.innerHTML = `<div class="error"><strong>後台資料讀取失敗</strong><p>${escapeHtml(error.message || "未知錯誤")}</p></div>`;
  } finally { refreshButton.disabled = false; }
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-route]");
  if (!target) return;
  location.hash = target.dataset.route;
});
window.addEventListener("hashchange", render);
searchInput.addEventListener("input", () => { search = searchInput.value.trim().toLowerCase(); render(); });
refreshButton.addEventListener("click", load);
if (!location.hash) location.hash = "dashboard";
load();
