(async function () {
  // The public tunnel forwards requests to the signed-in local Codex broker.
  const AGENT_ENDPOINT = "https://sany-agent-temp.racoonn.me";
  const HC_SORT_KEY = "superpeanut_hc_sort";
  const PET_POSITION_KEY = "superpeanut_pet_position";
  const PEANUT_SPRITESHEET = chrome.runtime.getURL("assets/peanut-spritesheet.webp");
  const MOCHI_RUNNING = chrome.runtime.getURL("assets/mochi-running.webp");
  const MOCHI_IDLE = chrome.runtime.getURL("assets/mochi-idle.webp");
  const PEANUT_IDLE_FRAMES = ["00", "01", "02", "03", "04", "05"].map((frame) => chrome.runtime.getURL(`assets/peanut-idle-${frame}.png`));
  let invalidatedReloadScheduled = false;
  const recoverFromInvalidatedContext = (error) => {
    if (!/extension context invalidated/i.test(String(error?.message || error))) return false;
    if (!invalidatedReloadScheduled) {
      invalidatedReloadScheduled = true;
      window.setTimeout(() => window.location.reload(), 30);
    }
    return true;
  };
  window.addEventListener("unhandledrejection", (event) => {
    if (recoverFromInvalidatedContext(event.reason)) event.preventDefault();
  });
  if (window.__sanyTalentMatchMounted) return;
  window.__sanyTalentMatchMounted = true;

  const root = document.createElement("div");
  root.id = "sany-talent-match-root";
  const shadow = root.attachShadow({ mode: "open" });
  document.documentElement.append(root);

  const state = {
    hcs: [],
    history: [],
    candidate: null,
    tab: "match",
    isOpen: false,
    isMatching: false,
    isReadingProfile: false,
    currentReport: null,
    hcSearch: "",
    hcCompany: "all",
    hcRegion: "all",
    hcSort: "date",
    hcProductLine: "all",
    hcProductLinesExpanded: false,
    modal: null,
    flash: "",
    networkNotice: "",
    networkDebug: null,
    agentMessages: [],
    companySkills: [],
    agentDraft: "",
    isAgentReplying: false,
    agentStreamingId: null,
    isUploadingCv: false,
    isParsingRole: false,
    isGeneratingSkills: false,
    flashTone: "",
    petPosition: null,
    petDrag: null,
    suppressPetClickUntil: 0,
  };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const escapeAttribute = escapeHtml;
  const short = (value, max = 92) => {
    const text = String(value ?? "").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };
  const formatDate = (value) => {
    if (!value) return "刚刚";
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? String(value) : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  };
  const priorityClass = (priority) => String(priority || "S").toLowerCase();
  const clampPetPosition = (position = {}) => {
    const value = position && typeof position === "object" ? position : {};
    const width = 142;
    const height = 111;
    const padding = 8;
    const fallbackX = window.innerWidth - width - 18;
    const fallbackY = window.innerHeight - height - 18;
    const x = Number.isFinite(Number(value.x)) ? Number(value.x) : fallbackX;
    const y = Number.isFinite(Number(value.y)) ? Number(value.y) : fallbackY;
    return { x: Math.max(padding, Math.min(x, window.innerWidth - width - padding)), y: Math.max(padding, Math.min(y, window.innerHeight - height - padding)) };
  };
  const panelPositionForPet = (pet) => {
    const panelWidth = Math.min(450, window.innerWidth - 16);
    const panelHeight = Math.min(780, window.innerHeight - 36);
    return { x: Math.max(8, Math.min(pet.x - panelWidth - 12, window.innerWidth - panelWidth - 8)), y: Math.max(8, Math.min(pet.y + 111 - panelHeight, window.innerHeight - panelHeight - 8)) };
  };

  async function injectStyles() {
    const css = await fetch(chrome.runtime.getURL("content.css")).then((response) => response.text());
    const style = document.createElement("style");
    style.textContent = css;
    shadow.append(style);
  }

  function firstText(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const text = element?.textContent?.trim();
      if (text) return text;
    }
    return "";
  }

  function metaContent(selector) {
    return document.querySelector(selector)?.getAttribute("content")?.trim() || "";
  }

  function linkedInPerson() {
    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
    for (const script of scripts) {
      try {
        const payload = JSON.parse(script.textContent || "{}");
        const candidates = Array.isArray(payload) ? payload : payload["@graph"] || [payload];
        const person = candidates.find((item) => item?.["@type"] === "Person" || item?.["@type"]?.includes?.("Person"));
        if (person?.name) return person;
      } catch {
        // LinkedIn may render non-JSON tracking script blocks. Ignore them.
      }
    }
    return {};
  }

  function profileRoot() {
    const mains = [...document.querySelectorAll("main")];
    if (!mains.length) return document.body;
    return mains.sort((left, right) => {
      const score = (element) => {
        const text = element.innerText || "";
        return (text.includes("Contact info") ? 10_000 : 0) + text.length;
      };
      return score(right) - score(left);
    })[0];
  }

  function profileText() {
    return profileRoot()?.innerText || "";
  }

  function topCardData() {
    const text = profileText();
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    const isRelationship = /^(?:·\s*)?(?:[1-3](?:st|nd|rd)|[0-9]+th|following|followers?|connections?)$/i;
    const isUtility = /^(?:contact info|cover photo|profile photo|more|connect|message)$/i;
    const values = lines
      .slice(0, 18)
      .filter((line) => line !== "·" && !isRelationship.test(line) && !isUtility.test(line));
    return { name: values[0] || "", headline: values[1] || "", location: values[2] || "" };
  }

  const profileHeadingGroups = {
    about: ["About", "關於", "关于"],
    experience: ["Experience", "工作經歷", "工作经验", "經歷"],
    education: ["Education", "教育背景", "教育"],
    skills: ["Skills", "技能"],
    languages: ["Languages", "語言", "语言"],
  };
  const allProfileHeadings = Object.values(profileHeadingGroups).flat();

  function profileLines() {
    return profileText()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function sectionLines(lines, headings, additionalStops = []) {
    const start = lines.findIndex((line) => headings.includes(line));
    if (start < 0) return [];
    const stops = new Set([...allProfileHeadings, ...additionalStops]);
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (stops.has(lines[index])) { end = index; break; }
    }
    return lines.slice(start + 1, end).filter((line) => line !== "… more" && line !== "Show all");
  }

  function isDateRange(value) {
    const month = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\\d{1,2}\\s*月)";
    return new RegExp(`${month}\\s+\\d{4}\\s*[-–]\\s*(?:${month}\\s+\\d{4}|present|至今|\\d{4})`, "i").test(value);
  }

  function yearsFrom(value) {
    return [...String(value || "").matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((match) => Number(match[1]));
  }

  function looksLikeLocation(value) {
    const text = String(value || "");
    return text.length < 100 && (text.includes(",") || /(?:united states|china|japan|germany|mexico|canada|france|italy|brazil|india|united kingdom|taiwan|singapore|hong kong|\busa\b|中國|中国|日本|德國|德国|墨西哥|美國|美国|加拿大|法國|法国|義大利|意大利|巴西|印度)/i.test(text));
  }

  function parseExperience(lines) {
    const section = sectionLines(lines, profileHeadingGroups.experience);
    const records = [];
    let company = "";
    for (let index = 0; index < section.length; index += 1) {
      const next = section[index + 1] || "";
      if (/^\d+\s+(?:yrs?|years?)/i.test(next)) {
        company = section[index];
        continue;
      }
      if (!isDateRange(section[index])) continue;
      const title = section[index - 1] || "未列职位";
      let nextDateIndex = section.findIndex((line, nextIndex) => nextIndex > index && isDateRange(line));
      if (nextDateIndex < 0) nextDateIndex = section.length;
      let details = section.slice(index + 1, nextDateIndex);
      const location = looksLikeLocation(details[0]) ? details.shift() : "";
      if (details.length && details.at(-1).length < 90 && !/[.!?。！？]/.test(details.at(-1))) details = details.slice(0, -1);
      const startYear = yearsFrom(section[index])[0] || null;
      records.push({
        title,
        company: company || "未列公司",
        dateRange: section[index],
        startYear,
        location,
        summary: short(details.join(" "), 520),
      });
    }
    return records.slice(0, 12);
  }

  function parseEducation(lines) {
    const section = sectionLines(lines, profileHeadingGroups.education);
    const records = [];
    for (let index = 0; index < section.length; index += 1) {
      if (!/^\d{4}\s*(?:[-–]|至)\s*(?:\d{4}|present|至今)$/i.test(section[index])) continue;
      records.push({
        school: section[index - 2] || "未列院校",
        degree: section[index - 1] || "未列学位",
        dates: section[index],
        graduationYear: yearsFrom(section[index]).at(-1) || null,
      });
    }
    // LinkedIn frequently omits education dates in the rendered profile card.
    // The school and degree are still evidence and must not be discarded.
    if (!records.length) {
      const visible = section
        .filter((line) => !/^\d{4}\s*(?:[-–]|至)\s*(?:\d{4}|present|至今)$/i.test(line))
        .filter((line) => !/^(?:show all|show more|显示全部|查看全部|更多|see all)$/i.test(line))
        .filter((line) => line.length > 1 && line.length < 180);
      for (let index = 0; index + 1 < visible.length && records.length < 5; index += 2) {
        records.push({
          school: visible[index],
          degree: visible[index + 1],
          dates: "",
          graduationYear: null,
        });
      }
    }
    return records.slice(0, 5);
  }

  function parseSimpleList(lines, headings) {
    return sectionLines(lines, headings)
      .filter((line) => !/^(?:show all|显示全部|查看全部|endorse|認可|认可)$/i.test(line))
      .filter((line) => line.length < 90)
      .slice(0, 16);
  }

  function uniqueBy(items, key) {
    const seen = new Set();
    return items.filter((item) => {
      const identifier = key(item);
      if (!identifier || seen.has(identifier)) return false;
      seen.add(identifier);
      return true;
    });
  }

  function finalizeProfile({ about = "", experience = [], education = [], skills = [], languages = [] }) {
    const uniqueExperience = uniqueBy(experience, (item) => `${item.title}|${item.company}|${item.dateRange}`)
      .sort((left, right) => (right.startYear || 0) - (left.startYear || 0));
    const uniqueEducation = uniqueBy(education, (item) => `${item.school}|${item.degree}|${item.dates}`);
    const uniqueSkills = [...new Set(skills)].slice(0, 24);
    const uniqueLanguages = [...new Set(languages)].slice(0, 12);
    const startYears = uniqueExperience.map((item) => item.startYear).filter(Boolean);
    const careerYears = startYears.length ? Math.max(0, SanyStore.CURRENT_YEAR - Math.min(...startYears)) : null;
    const graduationYears = uniqueEducation.map((item) => item.graduationYear).filter(Boolean);
    const latestGraduation = graduationYears.length ? Math.max(...graduationYears) : null;
    const evidenceText = [
      about,
      ...uniqueExperience.flatMap((item) => [item.title, item.company, item.location, item.summary]),
      ...uniqueEducation.flatMap((item) => [item.school, item.degree]),
      ...uniqueSkills,
      ...uniqueLanguages,
    ].filter(Boolean).join(" ");
    return {
      about: short(about, 1100),
      experience: uniqueExperience,
      education: uniqueEducation,
      skills: uniqueSkills,
      languages: uniqueLanguages,
      careerYears,
      earliestWorkYear: startYears.length ? Math.min(...startYears) : null,
      graduationYear: latestGraduation,
      evidenceText,
      capturedAt: new Date().toISOString(),
    };
  }

  function profileFromLines(lines) {
    return finalizeProfile({
      about: sectionLines(lines, profileHeadingGroups.about, ["Activity", "活動", "动态"])[0] || "",
      experience: parseExperience(lines),
      education: parseEducation(lines),
      skills: parseSimpleList(lines, profileHeadingGroups.skills),
      languages: parseSimpleList(lines, profileHeadingGroups.languages),
    });
  }

  function structuredProfile() {
    return profileFromLines(profileLines());
  }

  function mergeProfileSnapshots(snapshots) {
    return finalizeProfile({
      about: snapshots.find((item) => item.about)?.about || "",
      experience: snapshots.flatMap((item) => item.experience || []),
      education: snapshots.flatMap((item) => item.education || []),
      skills: snapshots.flatMap((item) => item.skills || []),
      languages: snapshots.flatMap((item) => item.languages || []),
    });
  }

  function messageBackground(message) {
    return chrome.runtime.sendMessage(message).catch(() => ({ ok: false, error: "Chrome Network 读取不可用。" }));
  }

  function textFromNetwork(value) {
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (value && typeof value === "object") {
      for (const key of ["text", "name", "value", "localizedName"]) {
        if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
      }
    }
    return "";
  }

  function firstNetworkText(node, keys) {
    for (const key of keys) {
      const text = textFromNetwork(node?.[key]);
      if (text) return text;
    }
    return "";
  }

  function networkYear(value) {
    if (typeof value === "number" && value >= 1900 && value <= 2100) return value;
    if (typeof value === "string") return yearsFrom(value)[0] || null;
    if (value && typeof value === "object") return Number(value.year) || yearsFrom(value.date || "")[0] || null;
    return null;
  }

  function networkMonth(value) {
    if (!value || typeof value !== "object") return null;
    const month = Number(value.month);
    return month >= 1 && month <= 12 ? month : null;
  }

  function networkDateLabel(value) {
    const year = networkYear(value);
    if (!year) return "";
    const month = networkMonth(value);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return month ? `${months[month - 1]} ${year}` : String(year);
  }

  function networkDateRange(node) {
    const range = node?.dateRange || node?.timePeriod || node?.date || node;
    if (typeof range === "string" && yearsFrom(range).length) {
      return { label: range, startYear: yearsFrom(range)[0] || null };
    }
    if (!range || typeof range !== "object") return null;
    const start = range.startDate || range.start || node?.startDate || node?.start;
    const end = range.endDate || range.end || node?.endDate || node?.end;
    const startLabel = networkDateLabel(start);
    const endLabel = networkDateLabel(end) || (startLabel ? "Present" : "");
    if (!startLabel && !endLabel) return null;
    return { label: `${startLabel || "Unknown"} - ${endLabel || "Present"}`, startYear: networkYear(start) };
  }

  function normaliseNetworkText(value) {
    return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  }

  function walkNetworkJson(payload, visit) {
    const stack = [payload];
    let seen = 0;
    while (stack.length && seen < 9000) {
      const value = stack.pop();
      if (typeof value === "string") {
        const trimmed = value.trim();
        if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length > 1) {
          try { stack.push(JSON.parse(trimmed)); } catch { /* Non-JSON strings are leaf values. */ }
        }
        continue;
      }
      if (!value || typeof value !== "object") continue;
      seen += 1;
      if (!Array.isArray(value)) visit(value);
      const children = Array.isArray(value) ? value : Object.values(value);
      for (const child of children) if (child && typeof child === "object") stack.push(child);
    }
  }

  function parseNetworkJson(body) {
    try { return JSON.parse(body); } catch {
      const objectStart = body.indexOf("{");
      const arrayStart = body.indexOf("[");
      const start = objectStart < 0 ? arrayStart : arrayStart < 0 ? objectStart : Math.min(objectStart, arrayStart);
      if (start < 0) return null;
      try { return JSON.parse(body.slice(start)); } catch { return null; }
    }
  }

  function reactFlightPayloads(source) {
    const assignment = String(source || "");
    const start = assignment.indexOf("[");
    if (start < 0) return [];
    let depth = 0;
    let quote = "";
    let escaped = false;
    let end = -1;
    for (let index = start; index < assignment.length; index += 1) {
      const char = assignment[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === "[") depth += 1;
      if (char === "]") {
        depth -= 1;
        if (!depth) { end = index + 1; break; }
      }
    }
    if (end < 0) return [];
    let chunks;
    try { chunks = JSON.parse(assignment.slice(start, end)); } catch { return []; }
    const stream = chunks.filter((chunk) => typeof chunk === "string").join("");
    const payloads = [];
    for (const record of stream.split("\n")) {
      const separator = record.indexOf(":");
      if (separator < 0) continue;
      const payload = record.slice(separator + 1).replace(/^I/, "");
      const parsed = parseNetworkJson(payload);
      if (parsed) payloads.push(parsed);
    }
    return payloads;
  }

  function networkProfileFromResponses(responses, candidate) {
    const expectedName = normaliseNetworkText(candidate.name);
    const nameParts = String(candidate.name || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((part) => part.length > 1);
    const slugParts = decodeURIComponent(new URL(candidate.url).pathname).split("/").filter(Boolean).at(-1)?.toLowerCase().split("-").filter((part) => part.length > 2) || [];
    const profileNodes = [];
    const experience = [];
    const education = [];
    const skills = [];
    const documentProfiles = [];
    let acceptedResponses = 0;
    const payloads = [];

    for (const response of responses || []) {
      const body = String(response?.body || "");
      const lowerBody = body.toLowerCase();
      const namePresent = nameParts.length && nameParts.every((part) => lowerBody.includes(part));
      const slugPresent = slugParts.length && slugParts.every((part) => lowerBody.includes(part));
      const payload = parseNetworkJson(body);
      if (payload) {
        payloads.push(payload);
        if (namePresent || slugPresent) acceptedResponses += 1;
      }
      if (response?.type === "Document") {
        const document = new DOMParser().parseFromString(body, "text/html");
        const documentText = document.body?.innerText || document.body?.textContent || "";
        const lines = documentText.split("\n").map((line) => line.trim()).filter(Boolean);
        if (lines.length) documentProfiles.push(profileFromLines(lines));
        const rehydrate = document.querySelector("#rehydrate-data")?.textContent || "";
        const rehydratePayload = parseNetworkJson(rehydrate);
        if (rehydratePayload) payloads.push(rehydratePayload);
        payloads.push(...reactFlightPayloads(rehydrate));
        acceptedResponses += 1;
      }
    }

    // LinkedIn often returns the profile card, experiences and education in separate
    // GraphQL responses. Once the batch is tied to this profile, aggregate every
    // response from this single reload instead of requiring the name in each module.
    if (!acceptedResponses) return null;
    for (const payload of payloads) {
      walkNetworkJson(payload, (node) => {
        const firstName = firstNetworkText(node, ["firstName"]);
        const lastName = firstNetworkText(node, ["lastName"]);
        const fullName = `${firstName} ${lastName}`.trim();
        const nodeName = fullName || firstNetworkText(node, ["name", "fullName"]);
        const nodeNameNormalised = normaliseNetworkText(nodeName);
        const publicIdentifier = firstNetworkText(node, ["publicIdentifier", "vanityName"]).toLowerCase();
        const slugMatches = publicIdentifier && slugParts.length && slugParts.every((part) => publicIdentifier.includes(part));
        const nameMatches = nodeNameNormalised && expectedName && (nodeNameNormalised === expectedName || nodeNameNormalised.includes(expectedName));
        if (nameMatches || slugMatches) {
          const score = (firstName && lastName ? 4 : 0) + (node.summary || node.headline ? 2 : 0) + (publicIdentifier ? 2 : 0) + (slugMatches ? 8 : 0);
          profileNodes.push({
            score,
            headline: firstNetworkText(node, ["headline", "occupation"]),
            location: firstNetworkText(node, ["geoLocationName", "locationName", "location"]),
            about: firstNetworkText(node, ["summary", "about", "description"]),
          });
        }

        const company = firstNetworkText(node, ["companyName", "company", "employerName", "organizationName"]);
        const title = firstNetworkText(node, ["title", "positionTitle", "role"]);
        const period = networkDateRange(node);
        if (title && company && period?.startYear && title.length < 180 && company.length < 180) {
          experience.push({
            title,
            company,
            dateRange: period.label,
            startYear: period.startYear,
            location: firstNetworkText(node, ["locationName", "geoLocationName", "location"]),
            summary: short(firstNetworkText(node, ["description", "summary"]), 520),
          });
        }

        const school = firstNetworkText(node, ["schoolName", "school", "institutionName"]);
        if (school && period?.startYear && school.length < 180) {
          education.push({
            school,
            degree: firstNetworkText(node, ["degreeName", "degree", "fieldOfStudy", "field"]),
            dates: period.label,
            graduationYear: networkYear((node.dateRange || node.timePeriod || {}).endDate || (node.dateRange || node.timePeriod || {}).end) || null,
          });
        }

        const type = String(node.$type || node.type || node.entityType || "").toLowerCase();
        const skill = firstNetworkText(node, ["skillName"]);
        if (skill && /skill/.test(type)) skills.push(skill);
      });
    }

    const documentProfile = mergeProfileSnapshots(documentProfiles);
    if (!profileNodes.length && !experience.length && !education.length && !skills.length && !documentProfile.experience.length && !documentProfile.education.length) return null;
    const primary = profileNodes.sort((left, right) => right.score - left.score)[0] || {};
    return {
      headline: primary.headline,
      location: primary.location,
      profile: finalizeProfile({
        about: primary.about || documentProfile.about,
        experience: [...documentProfile.experience, ...experience],
        education: [...documentProfile.education, ...education],
        skills: [...documentProfile.skills, ...skills],
        languages: documentProfile.languages,
      }),
      acceptedResponses,
    };
  }

  function hasUsableNetworkProfile(candidate) {
    const profile = candidate?.profile;
    return Boolean(profile && (profile.experience?.length || profile.education?.length || profile.about));
  }

  function networkDiagnostic(responses, candidate) {
    const expectedName = String(candidate?.name || "").toLowerCase();
    const fields = ["firstName", "lastName", "publicIdentifier", "headline", "companyName", "title", "schoolName", "degreeName", "dateRange", "timePeriod", "entityUrn", "$type"];
    return (responses || []).slice(0, 24).map((response, index) => {
      const body = String(response?.body || "");
      const payload = parseNetworkJson(body);
      const samples = [];
      if (payload) {
        walkNetworkJson(payload, (node) => {
          if (samples.length >= 5) return;
          const sample = Object.fromEntries(fields
            .filter((field) => node[field] !== undefined)
            .map((field) => [field, short(textFromNetwork(node[field]) || JSON.stringify(node[field]), 140)]));
          if (Object.keys(sample).length >= 2) samples.push(sample);
        });
      }
      let documentSignals = null;
      if (response?.type === "Document") {
        const document = new DOMParser().parseFromString(body, "text/html");
        const text = document.body?.innerText || document.body?.textContent || "";
        const snippets = {};
        for (const needle of ["Experience", "Education", "Chief Engineer", "Caterpillar", "Oliver Buenaseda"]) {
          const position = text.indexOf(needle);
          snippets[needle] = position < 0 ? null : short(text.slice(Math.max(0, position - 180), position + 620), 800);
        }
        documentSignals = {
          visibleTextChars: text.length,
          scripts: [...document.querySelectorAll("script")].slice(0, 16).map((script) => ({ type: script.type || "text/javascript", id: script.id || "", chars: script.textContent?.length || 0 })),
          rehydrateWrapper: (() => {
            const source = document.querySelector("#rehydrate-data")?.textContent || "";
            return { prefix: short(source.slice(0, 1400), 1400), suffix: short(source.slice(-500), 500) };
          })(),
          snippets,
        };
      }
      let endpoint = response?.url || "";
      try { endpoint = new URL(endpoint).pathname; } catch { /* Keep the original URL if it cannot be parsed. */ }
      return {
        response: index + 1,
        endpoint,
        chars: body.length,
        topKeys: payload && !Array.isArray(payload) ? Object.keys(payload).slice(0, 12) : [],
        containsCandidateName: Boolean(expectedName && body.toLowerCase().includes(expectedName.split(" ")[0])),
        samples,
        documentSignals,
      };
    });
  }

  function scanCandidate() {
    const isProfileUrl = /^\/in\/[^/]+\/?/.test(window.location.pathname) || window.location.pathname.includes("/talent/profile/");
    const person = linkedInPerson();
    const topCard = topCardData();
    const profile = isProfileUrl ? structuredProfile() : { evidenceText: "", experience: [], education: [], skills: [], languages: [] };
    const name = firstText([
      "main h1.text-heading-xlarge",
      ".pv-text-details__left-panel h1",
      '[data-view-name="profile-card"] h1',
      "main h1",
    ]) || person.name || topCard.name || metaContent('meta[property="og:title"]').replace(/\s*[-|]\s*LinkedIn.*$/i, "");
    const headline = firstText([
      "main .text-body-medium",
      ".pv-text-details__left-panel .text-body-medium",
      '[data-view-name="profile-card"] .text-body-medium',
      "[data-generated-suggestion-target] .text-body-medium",
    ]) || person.jobTitle || topCard.headline || metaContent('meta[name="description"]');
    const location = firstText([
      ".pv-text-details__left-panel .text-body-small.inline",
      ".pv-text-details__left-panel .text-body-small.inline.t-black--light.break-words",
      '[data-view-name="profile-card"] .text-body-small.inline',
      "main .text-body-small.inline",
      ".pv-text-details__left-panel .text-body-small",
    ]) || person.address?.addressLocality || person.address?.addressCountry || topCard.location || "";
    const avatar = document.querySelector('main .pv-top-card img, main [data-view-name="profile-card"] img, main a[href*="/in/"] img')?.currentSrc
      || metaContent('meta[property="og:image"]') || "";
    const validName = Boolean(name && !/^(linkedin|messaging|通知|消息)$/i.test(name));
    const canMatch = isProfileUrl && validName;
    const reason = !isProfileUrl
      ? "目前不是候選人個人頁。請開啟 LinkedIn 個人主頁（網址通常包含 /in/）。"
      : !validName
        ? "LinkedIn 尚未載入候選人姓名。請稍候後按「重新讀取」。"
        : "";
    return {
      name: canMatch ? name : "等待候选人资料",
      headline: canMatch ? (headline || "LinkedIn 未显示候选人职位") : reason,
      location: canMatch ? (location || "LinkedIn 未显示当前位置") : "",
      avatar: canMatch ? avatar : "",
      url: window.location.href,
      profile,
      canMatch,
      reason,
    };
  }

  const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function profileScrollContainer() {
    const root = profileRoot();
    const style = root ? window.getComputedStyle(root) : null;
    return root && root.scrollHeight > root.clientHeight + 80 && /(?:auto|scroll|overlay)/.test(style?.overflowY || style?.overflow || "") ? root : window;
  }

  function scrollMetrics(scroller) {
    if (scroller === window) return { top: window.scrollY, height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), viewport: window.innerHeight };
    return { top: scroller.scrollTop, height: scroller.scrollHeight, viewport: scroller.clientHeight };
  }

  function scrollToProfilePosition(scroller, top) {
    if (scroller === window) window.scrollTo(0, top);
    else scroller.scrollTop = top;
  }

  async function readFullCandidateProfile() {
    const baseline = state.candidate?.canMatch ? state.candidate : scanCandidate();
    if (!baseline.canMatch || state.isReadingProfile) return baseline;
    state.isReadingProfile = true;
    state.networkNotice = "正在完整读取 LinkedIn 候选人资料…";
    render();
    const scroller = profileScrollContainer();
    const originalTop = scrollMetrics(scroller).top;
    const snapshots = [];
    try {
      scrollToProfilePosition(scroller, 0);
      await pause(240);
      snapshots.push(structuredProfile());
      for (let iteration = 0; iteration < 24; iteration += 1) {
        const metrics = scrollMetrics(scroller);
        const next = Math.min(Math.max(0, metrics.height - metrics.viewport), metrics.top + Math.max(680, Math.floor(metrics.viewport * 0.9)));
        if (next <= metrics.top + 4) break;
        scrollToProfilePosition(scroller, next);
        await pause(230);
        snapshots.push(structuredProfile());
      }
      state.candidate = { ...baseline, profile: mergeProfileSnapshots(snapshots) };
      const profile = state.candidate.profile;
      state.networkNotice = `已读取 ${profile.experience.length} 段工作经历、${profile.education.length} 条教育资料。`;
    } finally {
      scrollToProfilePosition(scroller, originalTop);
      state.isReadingProfile = false;
    }
    return state.candidate;
  }

  const stopWords = new Set(["manager", "experience", "years", "year", "with", "from", "that", "this", "the", "and", "for", "your", "our", "you", "are", "job", "work", "role", "职位", "岗位", "负责", "相关", "经验", "以上", "要求", "项目", "经理", "招聘"]);
  function tokenise(value) {
    const text = String(value || "").toLowerCase();
    const latin = text.match(/[a-z][a-z0-9+#]{1,}/g) || [];
    const chineseChunks = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
    const chinese = chineseChunks.flatMap((chunk) => {
      const pairs = [];
      for (let index = 0; index < chunk.length - 1; index += 1) pairs.push(chunk.slice(index, index + 2));
      return pairs;
    });
    return [...new Set([...latin, ...chinese].filter((word) => !stopWords.has(word) && word.length > 1))];
  }

  function requiredExperience(note) {
    const match = String(note || "").match(/(\d{1,2})\s*(?:\+|以上)?\s*(?:年|years?)/i);
    return match ? Number(match[1]) : null;
  }

  function locationAssessment(candidateLocation, roleLocation) {
    const candidateText = String(candidateLocation || "").toLowerCase();
    const roleText = String(roleLocation || "").toLowerCase();
    // A city / metro in this table is treated as direct evidence for its own
    // country only. This prevents a valid local candidate (e.g. Greater Buenos
    // Aires for an Argentina HC) from being discarded after the agent responds,
    // without relaxing the gate to neighbouring countries or broad regions.
    const countryAliases = [
      ["智利", "chile", "santiago", "santiago metropolitan"],
      ["阿根廷", "argentina", "buenos aires", "greater buenos aires", "caba"],
      ["美国", "united states", "usa", "u.s.", "new york", "chicago", "dallas", "houston", "miami", "los angeles"],
      ["加拿大", "canada", "toronto", "vancouver", "montreal"],
      ["墨西哥", "mexico", "mexico city", "ciudad de méxico", "monterrey"],
      ["巴西", "brazil", "brasil", "são paulo", "sao paulo", "rio de janeiro"],
      ["哥伦比亚", "colombia", "bogotá", "bogota", "medellín", "medellin"],
      ["秘鲁", "peru", "lima"], ["玻利维亚", "bolivia", "la paz", "santa cruz de la sierra"], ["乌拉圭", "uruguay", "montevideo"], ["巴拉圭", "paraguay", "asunción", "asuncion"], ["厄瓜多尔", "ecuador", "quito", "guayaquil"],
      ["英国", "united kingdom", "uk", "england", "london", "manchester", "birmingham"], ["德国", "germany", "deutschland", "berlin", "munich", "münchen", "hamburg"], ["法国", "france", "paris", "lyon"], ["意大利", "italy", "milan", "milano", "rome", "roma"], ["西班牙", "spain", "madrid", "barcelona"],
      ["澳大利亚", "australia", "sydney", "melbourne", "brisbane", "perth"], ["南非", "south africa", "johannesburg", "cape town", "durban"], ["尼日利亚", "nigeria", "lagos", "abuja"], ["喀麦隆", "cameroon", "douala", "yaoundé", "yaounde"],
      ["马来西亚", "malaysia", "kuala lumpur"], ["菲律宾", "philippines", "manila"], ["泰国", "thailand", "bangkok"], ["印度", "india", "mumbai", "delhi", "new delhi", "bangalore", "bengaluru"], ["中国", "china", "beijing", "shanghai", "guangzhou", "shenzhen"]
    ];
    const countryMatch = countryAliases.some((aliases) => aliases.some((alias) => candidateText.includes(alias)) && aliases.some((alias) => roleText.includes(alias)));
    const candidateTokens = tokenise(candidateLocation);
    const roleTokens = tokenise(roleLocation);
    const shared = roleTokens.filter((token) => candidateTokens.includes(token));
    if (countryMatch || shared.length) return { points: 35, match: true, text: `候选人地点 ${short(candidateLocation, 36)} 与 JD 地点 ${short(roleLocation, 36)} 一致` };
    if (!candidateLocation || candidateLocation.includes("未读取")) return { points: 0, match: false, text: "LinkedIn 未显示候选人当前位置，无法确认与 JD 地点是否一致" };
    return { points: 0, match: false, text: `候选人当前显示 ${short(candidateLocation, 36)}，与 JD 地点 ${short(roleLocation, 36)} 不一致` };
  }

  function effectiveJdLocation(role) {
    return `${role?.location || ""} ${role?.note || ""}`.trim();
  }

  function reportFor(role, candidate) {
    const profile = candidate.profile || {};
    const roleTokens = tokenise(`${role.title} ${role.function} ${role.note}`);
    const titleTokens = tokenise(role.title);
    const candidateTokens = tokenise(`${candidate.headline} ${profile.evidenceText || ""}`);
    const titleMatches = titleTokens.filter((token) => candidateTokens.includes(token));
    const keywordMatches = roleTokens.filter((token) => candidateTokens.includes(token));
    const titleScore = titleTokens.length ? Math.min(100, Math.round((titleMatches.length / Math.min(titleTokens.length, 7)) * 100)) : 0;
    const domainScore = roleTokens.length ? Math.min(100, Math.round((keywordMatches.length / Math.min(roleTokens.length, 18)) * 100)) : 0;
    const location = locationAssessment(candidate.location, effectiveJdLocation(role));
    const minExperience = requiredExperience(role.note);
    const experience = profile.careerYears || null;
    const experiencePoints = !minExperience ? 0 : !experience ? 0 : experience >= minExperience ? 15 : Math.max(1, Math.round((experience / minExperience) * 15));
    const score = Math.min(98, Math.max(0, Math.round(titleScore * 0.3 + domainScore * 0.35 + location.points + experiencePoints)));
    const missing = roleTokens.filter((token) => !candidateTokens.includes(token)).slice(0, 4);
    const level = score >= 75 ? "高优先推荐" : score >= 55 ? "建议沟通" : score >= 35 ? "可作为备选" : "匹配证据有限";
    const background = profile.experience?.length
      ? `已读取 ${profile.experience.length} 段经历。当前或最近岗位为 ${profile.experience[0].title}，${profile.experience[0].company}。`
      : "LinkedIn 未展示可解析的工作经历，建议人工检查资料完整度。";
    const relevantRoles = (profile.experience || [])
      .filter((item) => tokenise(`${item.title} ${item.summary}`).some((token) => roleTokens.includes(token)))
      .slice(0, 2);
    const pros = keywordMatches.length
      ? `直接证据：${keywordMatches.slice(0, 5).join("、")}。${relevantRoles.length ? `相关经历：${relevantRoles.map((item) => `${item.title} (${item.company})`).join("；")}。` : background}`
      : `${background} 未发现与 JD 的直接关键词证据。`;
    const gapText = missing.length
      ? `待验证：${missing.join("、")} 等 JD 关键点未在可见资料中明确出现。`
      : "JD 中的主要关键词已在可见资料中出现，仍建议在面试中验证深度与最近项目。";
    const educationSummary = profile.education?.[0] ? `${profile.education[0].degree}，${profile.education[0].school}` : "未显示教育背景";
    return {
      roleId: role.id,
      role: { title: role.title, company: role.company, location: role.location, priority: role.priority, function: role.function, businessUnit: role.businessUnit, note: role.note },
      score,
      level,
      summary: `${candidate.name} 与 ${role.title} 的匹配分为 ${score} 分。${background} ${location.text}。`,
      dimensions: [
        { label: "职能", value: titleScore },
        { label: "JD 关键词", value: domainScore },
        { label: "地点", value: location.points * 5 },
        { label: "年资", value: experiencePoints * 6 },
      ],
      pros,
      gaps: gapText,
      locationCheck: location.text,
      experienceCheck: minExperience ? (experience ? `可见工作经历约 ${experience} 年，JD 期望 ${minExperience}+ 年。` : `JD 期望 ${minExperience}+ 年，但可见经历不足以稳定估算。`) : (experience ? `已读取约 ${experience} 年可见工作经历，JD 未列出明确年资门槛。` : "JD 未列出明确年资门槛。"),
      matchedKeywords: keywordMatches.slice(0, 6),
      candidateFacts: {
        headline: candidate.headline,
        location: candidate.location,
        careerYears: experience,
        experienceCount: profile.experience?.length || 0,
        education: educationSummary,
        topRoles: (profile.experience || []).slice(0, 3).map((item) => `${item.title} · ${item.company}`),
      },
    };
  }

  // Retrieval only: this is deliberately cheap and never becomes the displayed
  // match score. It keeps the agent context focused without skipping all roles.
  function retrieveLikelyRoles(candidate, limit = 24) {
    const profile = candidate.profile || {};
    const candidateTokens = new Set(tokenise(`${candidate.headline} ${candidate.location} ${profile.evidenceText || ""} ${(profile.experience || []).map((item) => `${item.title} ${item.company} ${item.summary || ""}`).join(" ")}`));
    const priorityBoost = { SSS: 8, SS: 5, S: 2 };
    return state.hcs.map((role) => {
      const roleTokens = tokenise(`${role.title} ${role.function} ${role.businessUnit} ${role.note}`);
      const shared = roleTokens.filter((token) => candidateTokens.has(token)).length;
      const location = locationAssessment(candidate.location, effectiveJdLocation(role));
      return { role, retrievalScore: shared * 12 + location.points + (priorityBoost[role.priority] || 0) };
    }).sort((a, b) => b.retrievalScore - a.retrievalScore).slice(0, Math.min(limit, state.hcs.length)).map(({ role }) => role);
  }

  function agentReportFor(answer, role, candidate) {
    const profile = candidate.profile || {};
    const experience = profile.careerYears || null;
    const education = profile.education?.[0]
      ? `${profile.education[0].degree || ""} ${profile.education[0].school || ""}`.trim()
      : "未显示教育背景";
    return {
      roleId: role.id,
      role: { title: role.title, company: role.company, location: role.location, priority: role.priority, function: role.function, businessUnit: role.businessUnit, note: role.note },
      score: Math.max(0, Math.min(100, Number(answer.score) || 0)),
      level: answer.verdict || "需人工复核",
      summary: answer.summary || `${candidate.name} 与 ${role.title} 的匹配结果需要人工复核。`,
      dimensions: [],
      pros: (answer.evidence || []).slice(0, 2).join("；") || "未提供可验证依据。",
      gaps: (answer.risks || []).slice(0, 2).join("；") || "未提供风险说明。",
      roleMatchTag: answer.roleMatchTag || "职能匹配待确认",
      locationMatchTag: answer.locationMatchTag || "待确认",
      locationCheck: answer.locationAssessment || "Agent 未提供地点判断依据。",
      experienceCheck: answer.experienceAssessment || "年资需结合完整履历人工核验。",
      candidateOverview: (answer.candidateOverview || []).slice(0, 4),
      highlights: (answer.highlights || []).slice(0, 5),
      requirementFit: (answer.requirementFit || []).slice(0, 6),
      keyVariable: answer.keyVariable || "当前公开资料不足以确认关键变量。",
      compensationAssessment: answer.compensationAssessment || "公开资料未提供薪资或职级信息，暂无法评估，需在沟通中校准。",
      recommendation: answer.recommendation || answer.verdict || "建议招聘人员复核后推进。",
      nextSteps: (answer.nextSteps || []).slice(0, 4),
      candidateFacts: {
        headline: candidate.headline,
        location: candidate.location,
        careerYears: experience,
        experienceCount: profile.experience?.length || 0,
        education,
        topRoles: (profile.experience || []).slice(0, 4).map((item) => `${item.title} · ${item.company}`),
      },
    };
  }

  function candidateMatches(roleId) {
    const found = [];
    const seen = new Set();
    state.history.forEach((record) => {
      if (record.reports?.some((report) => report.roleId === roleId) && record.candidate?.url && !seen.has(record.candidate.url)) {
        seen.add(record.candidate.url);
        found.push(record.candidate);
      }
    });
    return found.slice(0, 4);
  }

  function reportDetails(report) {
    const overview = report.candidateOverview?.length
      ? `<section class="decision-block overview-block"><h3>候选人画像</h3><ul>${report.candidateOverview.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`
      : "";
    const highlights = report.highlights?.length
      ? `<section class="decision-block highlights-block"><h3>核心亮点</h3>${report.highlights.map((item) => `<div class="highlight-item"><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.detail)}</p></div>`).join("")}</section>`
      : `<section class="report-section evidence-section"><h3>依据</h3><p>${escapeHtml(short(report.pros, 260))}</p></section>`;
    const fit = report.requirementFit?.length
      ? `<section class="decision-block fit-block"><h3>硬性筛选与关键条件</h3><div class="fit-list">${report.requirementFit.map((item) => `<div class="fit-item"><div><b>${escapeHtml(item.requirement)}</b><span class="fit-status ${fitStatusClass(item.status)}">${escapeHtml(item.status)}</span></div><p>${escapeHtml(item.detail)}</p></div>`).join("")}</div></section>`
      : "";
    const nextSteps = report.nextSteps?.length
      ? `<section class="decision-block next-block"><h3>建议下一步</h3><ol>${report.nextSteps.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol></section>`
      : "";
    return `
      <div class="report-detail">
        ${overview}
        ${highlights}
        ${fit}
        <section class="decision-block key-block"><h3>关键变量</h3><p>${escapeHtml(report.keyVariable)}</p></section>
        <section class="decision-block compensation-block"><h3>薪资／职级可行性</h3><p>${escapeHtml(report.compensationAssessment)}</p></section>
        ${nextSteps}
        <section class="decision-block recommendation-block"><h3>招聘建议</h3><p>${escapeHtml(report.recommendation)}</p></section>
      </div>`;
  }

  function fitStatusClass(status) {
    return ({ "已验证": "verified", "部分验证": "partial", "待确认": "unknown", "不匹配": "mismatch" })[status] || "unknown";
  }

  function candidateSnapshot(candidate) {
    const profile = candidate.profile || {};
    if (!profile.experience?.length && !profile.education?.length) return "";
    const education = profile.education?.[0] ? `${profile.education[0].degree || ""} ${profile.education[0].school || ""}`.trim() : "未显示教育背景";
    const topRoles = (profile.experience || []).slice(0, 4).map((item) => `${item.title} · ${item.company}`).filter(Boolean);
    return `<section class="candidate-snapshot"><div class="snapshot-heading"><span>已读取候选人资料</span><span>${profile.experience?.length || 0} 段经历</span></div><div class="candidate-facts"><div><span>当前背景</span><b>${escapeHtml(short(candidate.headline || "未显示", 70))}</b></div><div><span>当前地点</span><b>${escapeHtml(short(candidate.location || "未显示", 55))}</b></div><div><span>工作经历</span><b>${profile.careerYears ? `${profile.careerYears}+ 年，${profile.experience?.length || 0} 段` : `${profile.experience?.length || 0} 段可见经历`}</b></div><div><span>教育背景</span><b>${escapeHtml(short(education, 55))}</b></div></div>${topRoles.length ? `<p class="evidence-roles">经历重点：${escapeHtml(topRoles.join("；"))}</p>` : ""}</section>`;
  }

  function reportCard(report, expanded = true) {
    const scoreClass = report.score >= 80 ? "high" : report.score < 55 ? "low" : "";
    const detail = expanded
      ? reportDetails(report)
      : `<details class="card-details"><summary>查看完整分析</summary>${reportDetails(report)}</details>`;
    return `<article class="match-card">
      <div class="role-line">
        <div><p class="role-name">${escapeHtml(report.role.title)}</p><p class="role-sub">${report.role.company ? `${escapeHtml(report.role.company)} · ` : ""}${escapeHtml(report.role.location)} · ${escapeHtml(report.role.businessUnit || report.role.function)}</p></div>
        <div class="score ${scoreClass}"><strong>${report.score}</strong><span>匹配分</span></div>
      </div>
      <div class="tag-row"><span class="tag ok">${escapeHtml(report.level)}</span><span class="tag role-match-tag">职能：${escapeHtml(report.roleMatchTag || "待确认")}</span><span class="tag jd-location-tag">JD 地点：${escapeHtml(report.role.location || "未填写")}</span><span class="tag location-match-tag">候选人地点：${escapeHtml(report.locationMatchTag || "待确认")}</span></div>
      <p class="card-summary">${escapeHtml(short(report.summary, 96))}</p>
      ${detail}
    </article>`;
  }

  function matchLoading() {
    return `<section class="match-loading" aria-live="polite" aria-label="正在分析候选人资料">
      <div class="loading-runway"><span class="runway-spark spark-one"></span><span class="runway-spark spark-two"></span><div class="peanut-sprite-runner" role="img" aria-label="正在奔跑的 Peanut"><div class="peanut-sprite" style="--peanut-spritesheet:url('${escapeAttribute(PEANUT_SPRITESHEET)}')"></div></div><div class="mochi-sprite-runner" role="img" aria-label="正在和 Peanut 一起奔跑的白狗 Mochi"><div class="mochi-sprite" style="--mochi-spritesheet:url('${escapeAttribute(MOCHI_RUNNING)}')"></div></div></div>
      <div class="loading-copy"><p>SuperPeanut 正在为你找最佳岗位</p><span>核对经历、地点与 JD 要求…</span></div>
      <div class="loading-steps"><span class="is-done">读取履历</span><span class="is-active">比对 JD</span><span>生成建议</span></div>
    </section>`;
  }

  function renderMatch() {
    const candidate = state.candidate || scanCandidate();
    const initial = candidate.canMatch ? candidate.name.slice(0, 1).toUpperCase() : "?";
    return `
      <section class="profile-card">
        <div class="profile-meta">
          ${candidate.avatar ? `<img class="profile-avatar" src="${escapeAttribute(candidate.avatar)}" alt="${escapeAttribute(candidate.name)} 的头像">` : `<div class="profile-initial">${escapeHtml(initial)}</div>`}
          <div><p class="profile-name">${escapeHtml(candidate.name)}</p><p class="profile-copy">${escapeHtml(candidate.headline)}</p></div>
        </div>
        ${candidate.location ? `<p class="profile-location">${escapeHtml(candidate.location)}</p>` : ""}
        ${state.networkNotice ? `<p class="capture-note">${escapeHtml(state.networkNotice)}</p>` : ""}
        ${state.networkDebug ? `<details class="network-debug"><summary>查看 Network 诊断（仅本机）</summary><pre>${escapeHtml(JSON.stringify(state.networkDebug, null, 2))}</pre><button class="button ghost debug-copy" data-action="copy-network-debug">复制诊断</button></details>` : ""}
        <div class="button-row"><button class="button primary" data-action="match" ${state.isMatching || state.isReadingProfile || !candidate.canMatch ? "disabled" : ""}>${state.isMatching ? "正在分析" : state.isReadingProfile ? "正在读取资料" : "一键匹配"}</button><button class="button ghost" data-action="rescan" ${state.isReadingProfile ? "disabled" : ""}>${state.isReadingProfile ? "读取中" : "完整读取"}</button></div>
      </section>
      ${candidateSnapshot(candidate)}
      ${!candidate.canMatch ? `<div class="empty" style="margin-top:14px">${escapeHtml(candidate.reason)}<br><br>插件不会在未读取到候选人资料时生成匹配报告。</div>` : !state.hcs.length ? `<div class="empty no-fit"><b>先建立你的 HC 库</b><br>此分发版不会预载岗位。请到「HC 库」新增岗位或导入 XLSX，之后即可开始匹配。</div>` : `<div class="section-top"><h2 class="section-title">${state.currentReport ? "最佳匹配岗位" : "准备分析"}</h2><span class="section-note">单一岗位决策报告</span></div>${state.isMatching ? matchLoading() : state.currentReport ? (state.currentReport.noFit ? `<div class="empty no-fit"><b>当前没有符合硬性条件的 HC</b><br>Agent 已检查完整 HC 文件与每条备注，但没有返回可推荐岗位。</div>` : `<div class="match-list">${state.currentReport.reports.slice(0, 1).map((report) => reportCard(report, true)).join("")}</div>`) : `<div class="empty">点击“一键匹配”后，将把已读取的候选人经历、地点与教育背景交给本机 Codex agent，生成单一最佳岗位的可复核决策报告。</div>`}`}`;
  }

  function renderHcCard(role) {
    const candidates = candidateMatches(role.id);
    const releaseDate = role.updatedAt ? escapeHtml(role.updatedAt) : "未设置";
    return `<article class="hc-card">
      <div class="hc-main">
        <div class="hc-card-top"><span class="priority ${priorityClass(role.priority)}">${escapeHtml(role.priority)}</span><span class="hc-release-date">Release · ${releaseDate}</span></div>
        <p class="hc-name" style="margin-top:7px">${escapeHtml(role.title)}</p><p class="hc-sub">${role.company ? `${escapeHtml(role.company)} · ` : ""}${escapeHtml(role.location)} · ${escapeHtml(role.function)} · ${role.openCount} HC</p>
        <div class="hc-actions"><button class="text-action" data-action="show-jd" data-role-id="${escapeAttribute(role.id)}">查看 JD</button><button class="text-action" data-action="edit-hc" data-role-id="${escapeAttribute(role.id)}">编辑</button><button class="text-action danger" data-action="delete-hc" data-role-id="${escapeAttribute(role.id)}">删除</button></div>
      </div>
      <div class="hc-hover"><p class="hc-hover-title">历史匹配候选人</p>${candidates.length ? candidates.map((candidate) => `<div class="candidate-link"><span>${escapeHtml(candidate.name)}</span><button data-action="open-linkedin" data-url="${escapeAttribute(candidate.url)}">打开 LinkedIn</button></div>`).join("") : `<div class="candidate-link"><span>尚未匹配过候选人</span></div>`}</div>
    </article>`;
  }

  function renderHcs() {
    const companies = [...new Set(state.hcs.map((role) => role.company || "未提供公司"))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    const regions = [...new Set(state.hcs.map((role) => role.region).filter(Boolean))].sort();
    const productLines = [...new Set(state.hcs.map((role) => role.businessUnit || "未设置产品线"))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    const missingCompanyCount = state.hcs.filter((role) => !String(role.company || "").trim()).length;
    const roles = state.hcs.filter((role) => {
      const matchesCompany = state.hcCompany === "all" || (role.company || "未提供公司") === state.hcCompany;
      const matchesRegion = state.hcRegion === "all" || role.region === state.hcRegion;
      const matchesProductLine = state.hcProductLine === "all" || (role.businessUnit || "未设置产品线") === state.hcProductLine;
      return matchesCompany && matchesRegion && matchesProductLine;
    }).sort((a, b) => {
      const aTime = Date.parse(a.updatedAt || "") || 0;
      const bTime = Date.parse(b.updatedAt || "") || 0;
      const titleOrder = String(a.title || "").localeCompare(String(b.title || ""), "zh-CN");
      if (state.hcSort === "priority") {
        const priorityRank = { SSS: 0, SS: 1, S: 2 };
        const rankA = priorityRank[String(a.priority || "").toUpperCase()] ?? 99;
        const rankB = priorityRank[String(b.priority || "").toUpperCase()] ?? 99;
        return rankA - rankB || bTime - aTime || titleOrder;
      }
      return bTime - aTime || titleOrder;
    });
    return `
      ${state.flash ? `<p class="notice ${state.flashTone === "error" ? "is-error" : ""}">${escapeHtml(state.flash)}</p>` : ""}
      ${missingCompanyCount ? `<p class="company-warning"><b>${missingCompanyCount} 个 HC 未填写公司</b><span>请编辑补充 Company；未填写公司的 HC 不会参与匹配。</span></p>` : ""}
      <div class="filter-row"><select class="select" data-control="hc-company" aria-label="按公司筛选"><option value="all">所有公司</option>${companies.map((company) => `<option value="${escapeAttribute(company)}" ${state.hcCompany === company ? "selected" : ""}>${escapeHtml(company)}</option>`).join("")}</select><select class="select" data-control="hc-region" aria-label="按大区筛选"><option value="all">全部大区</option>${regions.map((region) => `<option value="${escapeAttribute(region)}" ${state.hcRegion === region ? "selected" : ""}>${escapeHtml(region)}</option>`).join("")}</select><select class="select" data-control="hc-sort" aria-label="岗位排序"><option value="date" ${state.hcSort === "date" ? "selected" : ""}>日期：新→旧</option><option value="priority" ${state.hcSort === "priority" ? "selected" : ""}>优先级：SSS→S</option></select></div>
      <div class="product-filter"><div class="product-filter-head"><span class="product-filter-label">产品线</span><button class="product-filter-toggle" data-action="toggle-product-lines">${state.hcProductLinesExpanded ? "收起" : "展开全部"}</button></div><div class="product-filter-tags ${state.hcProductLinesExpanded ? "is-expanded" : ""}"><button class="product-filter-tag ${state.hcProductLine === "all" ? "is-active" : ""}" data-action="filter-product-line" data-product-line="all">全部</button>${productLines.map((line) => `<button class="product-filter-tag ${state.hcProductLine === line ? "is-active" : ""}" data-action="filter-product-line" data-product-line="${escapeAttribute(line)}">${escapeHtml(line)}</button>`).join("")}</div></div>
      <div class="button-row" style="margin-top:0"><button class="button primary" data-action="add-hc">新增岗位</button><button class="button ghost" data-action="trigger-upload">导入 XLSX</button><input type="file" id="hc-upload" accept=".xlsx,.xls" hidden></div>
      <div class="section-top"><h2 class="section-title">${roles.length} 个岗位</h2><span class="section-note">悬停查看历史候选人</span></div>
      <div class="hc-list">${roles.map(renderHcCard).join("") || `<div class="empty">尚未导入岗位。使用上方「导入 XLSX」或「新增岗位」建立你的 HC 库。</div>`}</div>`;
  }

  function renderHistory() {
    if (!state.history.length) return `<div class="empty">尚未生成候选人报告。打开 LinkedIn 个人主页后点击“一键匹配”，报告会自动保存在这里。</div>`;
    return `<div class="button-row" style="margin-top:0;margin-bottom:12px"><button class="button ghost" data-action="clear-history">清除全部记录</button></div><div class="history-list">${state.history.map((record) => {
      const first = record.reports?.[0];
      const candidate = record.candidate || {};
      const noFit = !first ? `<div class="history-no-fit">未推荐岗位：已保存本次完整分析，可在 Peanut 中继续追问原因或补充条件。</div>` : "";
      const detail = first ? `<details><summary>查看匹配报告</summary><div class="match-list" style="margin-top:8px">${(record.reports || []).slice(0, 3).map((report) => reportCard(report, true)).join("")}</div></details>` : "";
      return `<article class="history-card"><div class="history-line"><div class="history-person">${candidate.avatar ? `<img class="history-avatar" src="${escapeAttribute(candidate.avatar)}" alt="${escapeAttribute(candidate.name)} 的头像">` : ""}<div><p class="role-name">${escapeHtml(candidate.name || "未命名候选人")}</p><p class="history-sub">${escapeHtml(candidate.headline || "")} · ${escapeHtml(candidate.location || "")}</p></div></div>${first ? `<div class="score ${first.score >= 80 ? "high" : first.score < 55 ? "low" : ""}"><strong>${first.score}</strong><br>最高</div>` : ""}</div><div class="history-meta">${escapeHtml(formatDate(record.createdAt))} · ${record.reports?.length || 0} 个岗位已比较</div>${noFit}${candidate.url ? `<a class="linkedin-link" href="${escapeAttribute(candidate.url)}" target="_blank" rel="noopener noreferrer">打开 LinkedIn 个人主页 ↗</a>` : ""}${detail}</article>`;
    }).join("")}</div>`;
  }

  function renderAgent() {
    const messages = state.agentMessages;
    const candidate = state.candidate || scanCandidate();
    const hasCandidate = candidate?.canMatch;
    const contextName = hasCandidate ? candidate.name : "这位候选人";
    const candidateCard = hasCandidate
      ? `<section class="profile-card agent-candidate-card"><div class="agent-context-label"><span>当前对话候选人</span><span>LinkedIn 实时上下文</span></div><div class="profile-meta">${candidate.avatar ? `<img class="profile-avatar" src="${escapeAttribute(candidate.avatar)}" alt="${escapeAttribute(candidate.name)} 的头像">` : `<div class="profile-initial">${escapeHtml(candidate.name.slice(0, 1).toUpperCase())}</div>`}<div><p class="profile-name">${escapeHtml(candidate.name)}</p><p class="profile-copy">${escapeHtml(short(candidate.headline || "未显示当前职位", 86))}</p>${candidate.location ? `<p class="agent-candidate-location">${escapeHtml(candidate.location)}</p>` : ""}</div></div><div class="agent-candidate-footer"><span>可讨论匹配结果、经历证据与 JD</span>${candidate.url ? `<a href="${escapeAttribute(candidate.url)}" target="_blank" rel="noopener noreferrer">查看主页 ↗</a>` : ""}</div></section>`
      : `<section class="profile-card agent-intro"><div class="profile-meta"><div class="profile-initial">AI</div><div><p class="profile-name">招聘 Agent</p><p class="profile-copy">打开 LinkedIn 候选人主页后即可开始对话</p></div></div></section>`;
    return `${candidateCard}
      <div class="agent-thread">${messages.length ? messages.map((message) => `<div class="agent-message ${message.role === "user" ? "is-user" : "is-agent"} ${message.id === state.agentStreamingId ? "is-streaming" : ""}" data-message-id="${escapeAttribute(message.id || "")}"><span>${message.role === "user" ? "你" : "Peanut"}</span><p>${escapeHtml(message.content || (message.id === state.agentStreamingId ? "正在閱讀候選人、歷史匹配與 JD…" : ""))}</p></div>`).join("") : `<div class="empty">例如问：「${escapeHtml(contextName)} 最适合哪个 HC？还缺什么证据？」</div>`}</div>
      <form id="agent-chat-form" class="agent-compose"><textarea class="textarea" name="question" placeholder="Let's talk bout ${escapeAttribute(contextName)}" ${state.isAgentReplying || state.isUploadingCv ? "disabled" : ""}>${escapeHtml(state.agentDraft)}</textarea><div class="agent-compose-actions"><button class="button ghost cv-upload-button" type="button" data-action="trigger-cv-upload" ${state.isUploadingCv ? "disabled" : ""}>${state.isUploadingCv ? "正在读取 CV" : "上传 CV"}</button><button class="button primary" type="submit" ${state.isAgentReplying || state.isUploadingCv ? "disabled" : ""}>${state.isAgentReplying ? "分析中" : "送出"}</button></div><input type="file" id="cv-upload" accept=".pdf,.docx,.txt,.md" hidden></form>`;
  }

  function modalHtml() {
    if (!state.modal) return "";
    const role = state.modal.role;
    if (state.modal.type === "jd") {
      const candidates = candidateMatches(role.id);
      return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="JD 详情"><div class="modal-head"><div><h2>${escapeHtml(role.title)}</h2>${role.company ? `<p class="modal-kicker">${escapeHtml(role.company)}</p>` : ""}</div><button class="icon-button" data-action="close-modal" aria-label="关闭">×</button></div><div class="modal-body"><div class="tag-row"><span class="tag">${escapeHtml(role.location)}</span><span class="tag">${escapeHtml(role.region)}</span><span class="tag">${role.openCount} HC</span><span class="tag">${escapeHtml(role.nationality || "国籍不限")}</span></div><div class="section-top"><h3 class="section-title">完整 JD</h3></div><p class="jd-note">${escapeHtml(role.note || "暂无 JD 备注。")}</p><div class="section-top"><h3 class="section-title">历史匹配用户</h3></div>${candidates.length ? candidates.map((candidate) => `<div class="candidate-link"><span>${escapeHtml(candidate.name)}</span><button data-action="open-linkedin" data-url="${escapeAttribute(candidate.url)}">打开 LinkedIn</button></div>`).join("") : `<div class="empty">该岗位尚未产生匹配记录。</div>`}</div></section></div>`;
    }
    const isEdit = Boolean(role);
    const value = (key, fallback = "") => escapeAttribute(role?.[key] ?? fallback);
    if (!isEdit) {
      return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="新增岗位"><div class="modal-head"><div><h2>新增岗位</h2><p class="modal-kicker">粘贴原始需求，Peanut 自动整理字段</p></div><button class="icon-button" data-action="close-modal" aria-label="关闭">×</button></div><form class="modal-body" id="role-import-form"><label class="form-label">岗位原始内容<textarea required class="textarea role-paste-textarea" name="jobText" placeholder="直接粘贴完整 JD、聊天记录或岗位备注…" ${state.isParsingRole ? "disabled" : ""}>${escapeHtml(state.modal.draft || "")}</textarea><span class="form-help">Agent 会提取公司、岗位名称、地点、产品线、职能、优先级、HC、负责人及 Release 日期。</span></label>${state.modal.error ? `<p class="notice">${escapeHtml(state.modal.error)}</p>` : ""}<div class="form-actions"><button type="button" class="button ghost" data-action="close-modal" ${state.isParsingRole ? "disabled" : ""}>取消</button><button type="submit" class="button primary" ${state.isParsingRole ? "disabled" : ""}>${state.isParsingRole ? "Peanut 正在整理…" : "Agent 解析并新增"}</button></div></form></section></div>`;
    }
    return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="岗位编辑"><div class="modal-head"><h2>${isEdit ? "编辑岗位" : "新增岗位"}</h2><button class="icon-button" data-action="close-modal" aria-label="关闭">×</button></div><form class="modal-body" id="role-form" data-role-id="${escapeAttribute(role?.id || "")}"><div class="form-grid"><label class="form-label">公司<input class="input" name="company" value="${value("company")}" placeholder="未提供可留空"></label><label class="form-label">岗位名称<input required class="input" name="title" value="${value("title")}"></label><label class="form-label">国家 / 城市<input required class="input" name="location" value="${value("location")}"></label><label class="form-label">大区<input class="input" name="region" value="${value("region", "全球")}"></label><label class="form-label">优先级<select class="select" name="priority">${["SSS", "SS", "S"].map((item) => `<option ${value("priority", "S") === item ? "selected" : ""}>${item}</option>`).join("")}</select></label><label class="form-label">HC 数量<input required min="0" type="number" class="input" name="openCount" value="${value("openCount", 1)}"></label><label class="form-label">事业部 / 产品线<input class="input" name="businessUnit" value="${value("businessUnit", "不限产品")}"></label><label class="form-label">职能<input class="input" name="function" value="${value("function", "General")}"></label><label class="form-label">国籍要求<input class="input" name="nationality" value="${value("nationality")}"></label><label class="form-label">招聘负责人<input class="input" name="hiringManager" value="${value("hiringManager")}"></label><label class="form-label">JD / 备注<textarea class="textarea" name="note">${escapeHtml(role?.note || "")}</textarea><span class="form-help">可填写必须技能、行业、语言、地点与年资等要求。</span></label></div><div class="form-actions"><button type="button" class="button ghost" data-action="close-modal">取消</button><button type="submit" class="button primary">保存岗位</button></div></form></section></div>`;
  }

  function render() {
    const body = state.tab === "match" ? renderMatch() : state.tab === "hcs" ? renderHcs() : state.tab === "history" ? renderHistory() : renderAgent();
    const pet = clampPetPosition(state.petPosition);
    const panel = panelPositionForPet(pet);
    state.petPosition = pet;
    shadow.querySelector(".app")?.remove();
    const app = document.createElement("div");
    app.className = "app";
    app.innerHTML = `<div class="sany-shell ${state.isOpen ? "is-open" : ""}" style="--pet-x:${pet.x}px;--pet-y:${pet.y}px;--panel-x:${panel.x}px;--panel-y:${panel.y}px"><button class="sany-trigger" data-action="toggle" aria-label="拖动或打开 SuperPeanut"><span class="trigger-pet-pair"><span class="trigger-peanut" aria-hidden="true">${PEANUT_IDLE_FRAMES.map((frame) => `<i style="--peanut-idle-frame:url('${escapeAttribute(frame)}')"></i>`).join("")}</span><span class="trigger-mochi" aria-hidden="true" style="--mochi-idle:url('${escapeAttribute(MOCHI_IDLE)}')"></span></span><span class="trigger-hint">拖动 · 点击打开</span></button><aside class="sany-panel" aria-label="SuperPeanut 面板"><header class="panel-top"><div class="panel-head"><div class="brand"><div class="brand-mark">P</div><div><h1>SuperPeanut</h1><p>LinkedIn 招聘匹配工作台</p></div></div><button class="icon-button" data-action="close" aria-label="收起面板">×</button></div><nav class="tabs" aria-label="功能导航"><button class="tab ${state.tab === "match" ? "is-active" : ""}" data-action="tab" data-tab="match">候选人匹配</button><button class="tab ${state.tab === "hcs" ? "is-active" : ""}" data-action="tab" data-tab="hcs">HC 库</button><button class="tab ${state.tab === "history" ? "is-active" : ""}" data-action="tab" data-tab="history">查询记录</button><button class="tab ${state.tab === "agent" ? "is-active" : ""}" data-action="tab" data-tab="agent">Peanut</button></nav></header><main class="panel-body">${body}</main></aside>${modalHtml()}</div>`;
    shadow.append(app);
    if (state.tab === "agent") scrollAgentToLatest();
  }

  function scrollAgentToLatest() {
    window.requestAnimationFrame(() => {
      const panelBody = shadow.querySelector(".panel-body");
      if (panelBody) panelBody.scrollTop = panelBody.scrollHeight;
    });
  }

  function updateStreamingAgentMessage(messageId, content) {
    const message = state.agentMessages.find((item) => item.id === messageId);
    if (message) message.content = content;
    const paragraph = [...shadow.querySelectorAll(".agent-message")]
      .find((element) => element.dataset.messageId === messageId)
      ?.querySelector("p");
    if (paragraph) paragraph.textContent = content || "正在閱讀候選人、歷史匹配與 JD…";
    scrollAgentToLatest();
  }

  async function readAgentStream(response, onDelta) {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream") || !response.body) {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `agent returned ${response.status}`);
      onDelta(payload.answer || "");
      return;
    }
    if (!response.ok) throw new Error(`agent returned ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const event = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
        const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data) continue;
        const payload = JSON.parse(data);
        if (event === "delta") {
          answer += String(payload.text || "");
          onDelta(answer);
        } else if (event === "error") {
          throw new Error(payload.error || "Peanut 串流中断");
        }
      }
      if (done) break;
    }
    if (!answer) onDelta("目前沒有足夠資料回答這個問題。");
  }

  async function refreshData({ rescan = false } = {}) {
    try {
      [state.hcs, state.history, state.agentMessages, state.companySkills] = await Promise.all([SanyStore.getHcs(), SanyStore.getHistory(), SanyStore.getAgentMessages(), SanyStore.getCompanySkills()]);
    } catch (error) {
      state.networkNotice = `数据服务暂不可用：${error?.message || "连接失败"}。Peanut 仍可打开，请稍后重试。`;
    }
    if (rescan || !state.candidate) state.candidate = scanCandidate();
    render();
  }

  async function ensureCompanySkillsForRoles(roles) {
    const groups = new Map();
    for (const role of Array.isArray(roles) ? roles : []) {
      const company = SanyStore.normalizeCompany(role?.company);
      if (!company) continue;
      if (!groups.has(company)) groups.set(company, []);
      groups.get(company).push({ ...role, company });
    }
    const existingCompanies = new Set(state.companySkills.map((skill) => SanyStore.normalizeCompany(skill.company)));
    const missing = [...groups.entries()]
      .filter(([company]) => !existingCompanies.has(company))
      .map(([company, companyRoles]) => ({ company, roles: companyRoles }));
    if (!missing.length) return { generated: 0 };

    state.isGeneratingSkills = true;
    state.flashTone = "";
    state.flash = `正在为 ${missing.map((item) => item.company).join("、")} 生成匹配 Skill…`;
    render();
    try {
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
      if (generated.length !== missing.length) throw new Error("部分公司未能生成有效 Skill");
      const byCompany = new Map(state.companySkills.map((skill) => [SanyStore.normalizeCompany(skill.company), skill]));
      generated.forEach((skill) => byCompany.set(SanyStore.normalizeCompany(skill.company), skill));
      state.companySkills = await SanyStore.saveCompanySkills([...byCompany.values()]);
      return { generated: generated.length };
    } finally {
      state.isGeneratingSkills = false;
    }
  }

  async function runMatch() {
    if (state.isMatching || !state.hcs.length) return;
    const freshCandidate = scanCandidate();
    const cachedCandidate = state.candidate;
    state.candidate = cachedCandidate?.url === freshCandidate.url && cachedCandidate.profile?.experience?.length
      ? { ...freshCandidate, profile: cachedCandidate.profile }
      : freshCandidate;
    if (!state.candidate.canMatch) {
      state.currentReport = null;
      render();
      return;
    }
    if (!state.candidate.profile?.experience?.length) await readFullCandidateProfile();
    else state.networkNotice = `复用已读取的 ${state.candidate.profile.experience.length} 段工作经历，正在进行岗位分析。`;
    try {
      await ensureCompanySkillsForRoles(state.hcs);
    } catch (error) {
      state.networkNotice = `公司匹配 Skill 生成失败：${error.message || "Agent 暂时不可用"}。`;
      render();
      return;
    }
    await generateMatchReport();
  }

  async function generateMatchReport() {
    if (!state.candidate?.canMatch) return;
    state.isMatching = true;
    state.currentReport = null;
    render();
    try {
      const shortlistedRoles = state.hcs;
      const response = await fetch(`${AGENT_ENDPOINT}/match`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidate: state.candidate, roles: shortlistedRoles, skills: state.companySkills }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `agent returned ${response.status}`);
      const reports = (payload.reports || [])
        .map((answer) => {
          const role = state.hcs.find((item) => item.id === answer.roleId);
          return role ? agentReportFor(answer, role, state.candidate) : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, 1);
      const generatedAt = new Date().toISOString();
      const historyCandidate = {
        name: state.candidate.name,
        headline: state.candidate.headline,
        location: state.candidate.location,
        url: state.candidate.url,
        avatar: state.candidate.avatar,
        profile: state.candidate.profile,
      };
      if (!reports.length) {
        state.currentReport = { candidate: state.candidate, reports: [], noFit: true, generatedAt };
        state.history = await SanyStore.appendHistory({ candidate: historyCandidate, reports: [], noFit: true, generatedAt });
        state.networkNotice = `未生成推荐：Agent 已核对完整 HC 文件中的 ${shortlistedRoles.length} 个岗位（含每条备注），没有发现符合硬性条件的岗位。`;
        return;
      }
      state.currentReport = { candidate: state.candidate, reports, generatedAt };
      state.history = await SanyStore.appendHistory({
        candidate: historyCandidate,
        reports,
        generatedAt,
      });
      state.networkNotice = `已由本机 Codex agent 基于 ${state.candidate.profile?.experience?.length || 0} 段经历、${state.candidate.profile?.education?.length || 0} 条教育资料，完整核对 ${shortlistedRoles.length} 个 HC（含每条备注）后完成分析。`;
    } catch (error) {
      state.networkNotice = `本机 Codex agent 未能生成报告：${error.message || "未知错误"}。请确认临时通道仍在运行后重试。`;
    } finally {
      state.isMatching = false;
      render();
    }
  }

  function findRole(roleId) {
    return state.hcs.find((role) => role.id === roleId);
  }

  async function askAgent(question) {
    const text = String(question || "").trim();
    if (!text || state.isAgentReplying) return;
    const userMessage = { id: `msg_${crypto.randomUUID()}`, createdAt: new Date().toISOString(), role: "user", content: text };
    const streamingMessage = { id: `msg_${crypto.randomUUID()}`, createdAt: new Date().toISOString(), role: "agent", content: "" };
    state.agentMessages.push(userMessage, streamingMessage);
    state.agentDraft = "";
    state.isAgentReplying = true;
    state.agentStreamingId = streamingMessage.id;
    SanyStore.saveAgentMessages(state.agentMessages.filter((message) => message.id !== streamingMessage.id)).catch(() => null);
    render();
    try {
      const history = state.history.slice(0, 8).map((record) => ({
        candidate: record.candidate,
        reports: record.reports,
        generatedAt: record.generatedAt,
      }));
      const response = await fetch(`${AGENT_ENDPOINT}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({
          question: text,
          candidate: state.candidate,
          roles: state.hcs,
          history,
          messages: state.agentMessages.filter((message) => message.id !== streamingMessage.id),
        }),
      });
      await readAgentStream(response, (answer) => updateStreamingAgentMessage(streamingMessage.id, answer));
    } catch (error) {
      updateStreamingAgentMessage(streamingMessage.id, `暫時無法回答：${error.message || "本機 Agent 未啟動"}`);
    } finally {
      state.isAgentReplying = false;
      state.agentStreamingId = null;
      SanyStore.saveAgentMessages(state.agentMessages).catch(() => null);
      render();
    }
  }

  async function importRoleWithAgent(jobText) {
    const text = String(jobText || "").trim();
    if (!text || state.isParsingRole) return;
    state.isParsingRole = true;
    state.modal = { type: "edit", role: null, draft: text, error: "" };
    render();
    try {
      const response = await fetch(`${AGENT_ENDPOINT}/role`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobText: text }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `agent returned ${response.status}`);
      const index = state.hcs.length + Date.now();
      const draft = SanyStore.normalizeRole(payload.role || {}, index);
      state.hcs = await SanyStore.saveHcs([...state.hcs, draft]);
      state.modal = null;
      if (!draft.company) {
        state.flashTone = "error";
        state.flash = `已新增岗位：${draft.title}。1 个 HC 未填写公司，请补充后再匹配。`;
      } else {
        try {
          await ensureCompanySkillsForRoles(state.hcs);
          state.flashTone = "";
          state.flash = `已新增岗位：${draft.title}；${draft.company} 匹配 Skill 已就绪。`;
        } catch (error) {
          state.flashTone = "error";
          state.flash = `岗位已保存，但 ${draft.company} 匹配 Skill 生成失败：${error.message || "Agent 暂时不可用"}。`;
        }
      }
    } catch (error) {
      state.modal = { type: "edit", role: null, draft: text, error: `解析失败：${error.message || "Agent 暂时不可用"}` };
    } finally {
      state.isParsingRole = false;
      render();
    }
  }

  function fileToBase64(file) {
    return file.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      const chunkSize = 0x8000;
      let binary = "";
      for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
      return btoa(binary);
    });
  }

  async function importCvAsCandidate(file) {
    if (!file || state.isUploadingCv) return;
    if (file.size > 4_000_000) {
      state.networkNotice = "CV 超过 4MB，请压缩后重试。";
      render();
      return;
    }
    state.isUploadingCv = true;
    state.networkNotice = `正在读取 ${file.name}，Peanut 将把它作为新的候选人…`;
    render();
    try {
      const response = await fetch(`${AGENT_ENDPOINT}/resume`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: { name: file.name, base64: await fileToBase64(file) } }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `agent returned ${response.status}`);
      if (!payload.candidate?.canMatch) throw new Error("未能从 CV 识别候选人姓名或经历");
      state.candidate = payload.candidate;
      state.currentReport = null;
      state.agentMessages = [];
      SanyStore.saveAgentMessages([]).catch(() => null);
      state.networkNotice = `已从 CV 读取 ${payload.extractedCharacters || 0} 个字符，正在对完整 HC 库进行匹配。`;
    } catch (error) {
      state.networkNotice = `CV 读取失败：${error.message || "未知错误"}`;
    } finally {
      state.isUploadingCv = false;
    }
    if (state.candidate?.source === "cv" && state.candidate.canMatch) {
      try {
        await ensureCompanySkillsForRoles(state.hcs);
        await generateMatchReport();
      } catch (error) {
        state.networkNotice = `公司匹配 Skill 生成失败：${error.message || "Agent 暂时不可用"}。`;
        render();
      }
    } else render();
  }

  async function handleImport(file) {
    if (!file) return;
    state.flashTone = "";
    state.flash = "正在读取 Excel，Peanut 将自动识别表格结构…";
    render();
    try {
      const workbook = await SanyXlsx.parseWorkbookData(await file.arrayBuffer());
      const response = await fetch(`${AGENT_ENDPOINT}/roles/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, sheets: SanyXlsx.agentSheets(workbook) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `agent returned ${response.status}`);
      const beforeCount = state.hcs.length;
      const importedCount = Array.isArray(payload.roles) ? payload.roles.length : 0;
      const hcs = await SanyStore.mergeImportedRows(payload.roles || []);
      state.hcs = hcs;
      const missingCompanyCount = hcs.filter((role) => !String(role?.company || "").trim()).length;
      let skillError = null;
      try {
        await ensureCompanySkillsForRoles(hcs);
      } catch (error) {
        skillError = error;
      }
      if (missingCompanyCount) {
        state.flashTone = "error";
        state.flash = `Peanut 已处理 ${importedCount} 个岗位；${missingCompanyCount} 个 HC 未填写公司，请补充后再匹配。${skillError ? ` 其他公司的 Skill 生成失败：${skillError.message || "Agent 暂时不可用"}。` : " 已填写公司的岗位可正常匹配。"}`;
      } else if (skillError) {
        state.flashTone = "error";
        state.flash = `HC 已导入并保留原有岗位，但公司匹配 Skill 生成失败：${skillError.message || "Agent 暂时不可用"}。`;
      } else {
        state.flashTone = "";
        state.flash = `Peanut 已处理 ${importedCount} 个岗位；新增 ${Math.max(0, hcs.length - beforeCount)} 个，原有岗位已保留，公司匹配 Skill 已就绪。`;
      }
    } catch (error) {
      state.flashTone = "error";
      state.flash = error?.message || "导入失败，请检查 XLSX 格式。";
    }
    render();
  }

  shadow.addEventListener("click", async (event) => {
    const control = event.target.closest("[data-action]");
    if (!control) return;
    const action = control.dataset.action;
    if (action === "close-modal" && control.classList.contains("modal-backdrop") && event.target !== control) return;
    if (action === "toggle") { if (Date.now() < state.suppressPetClickUntil) return; state.isOpen = true; await refreshData({ rescan: true }); return; }
    if (action === "close") { state.isOpen = false; state.modal = null; render(); return; }
    if (action === "tab") {
      state.tab = control.dataset.tab;
      state.modal = null;
      state.flash = "";
      render();
      if (state.tab === "hcs") {
        try {
          const result = await ensureCompanySkillsForRoles(state.hcs);
          if (result.generated) {
            state.flashTone = "";
            state.flash = `已自动补齐 ${result.generated} 个公司匹配 Skill。`;
            render();
          }
        } catch (error) {
          state.flashTone = "error";
          state.flash = `公司匹配 Skill 补齐失败：${error.message || "Agent 暂时不可用"}。`;
          render();
        }
      }
      return;
    }
    if (action === "filter-product-line") { state.hcProductLine = control.dataset.productLine || "all"; render(); return; }
    if (action === "toggle-product-lines") { state.hcProductLinesExpanded = !state.hcProductLinesExpanded; render(); return; }
    if (action === "rescan") {
      state.candidate = scanCandidate();
      state.currentReport = null;
      if (!state.candidate.canMatch) { render(); return; }
      await readFullCandidateProfile();
      render();
      return;
    }
    if (action === "match") { await runMatch(); return; }
    if (action === "copy-network-debug") {
      await navigator.clipboard.writeText(JSON.stringify(state.networkDebug || [], null, 2)).catch(() => null);
      state.networkNotice = "诊断已复制到剪贴板；请直接贴回对话。";
      render();
      return;
    }
    if (action === "open-linkedin") { chrome.runtime.sendMessage({ type: "OPEN_LINKEDIN", url: control.dataset.url }); return; }
    if (action === "show-jd") { const role = findRole(control.dataset.roleId); if (role) { state.modal = { type: "jd", role }; render(); } return; }
    if (action === "edit-hc") { const role = findRole(control.dataset.roleId); if (role) { state.modal = { type: "edit", role }; render(); } return; }
    if (action === "add-hc") { state.modal = { type: "edit", role: null }; render(); return; }
    if (action === "close-modal") { state.modal = null; render(); return; }
    if (action === "trigger-upload") { shadow.querySelector("#hc-upload")?.click(); return; }
    if (action === "trigger-cv-upload") { shadow.querySelector("#cv-upload")?.click(); return; }
    if (action === "delete-hc") {
      const role = findRole(control.dataset.roleId);
      if (role && window.confirm(`删除“${role.title}”吗？`)) {
        state.hcs = await SanyStore.saveHcs(state.hcs.filter((item) => item.id !== role.id));
        state.flash = "岗位已删除。";
        render();
      }
      return;
    }
    if (action === "clear-history") {
      if (window.confirm("清除全部候选人查询记录吗？")) { await SanyStore.clearHistory(); state.history = []; render(); }
    }
  });

  shadow.addEventListener("pointerdown", (event) => {
    const trigger = event.target.closest?.(".sany-trigger");
    if (!trigger || event.button !== 0) return;
    const pet = clampPetPosition(state.petPosition);
    state.petDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, petX: pet.x, petY: pet.y, moved: false };
    trigger.setPointerCapture?.(event.pointerId);
    trigger.classList.add("is-dragging");
  });

  shadow.addEventListener("pointermove", (event) => {
    const drag = state.petDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clampPetPosition({ x: drag.petX + event.clientX - drag.startX, y: drag.petY + event.clientY - drag.startY });
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true;
    state.petPosition = next;
    const panel = panelPositionForPet(next);
    const shell = shadow.querySelector(".sany-shell");
    shell?.style.setProperty("--pet-x", `${next.x}px`);
    shell?.style.setProperty("--pet-y", `${next.y}px`);
    shell?.style.setProperty("--panel-x", `${panel.x}px`);
    shell?.style.setProperty("--panel-y", `${panel.y}px`);
  });

  shadow.addEventListener("pointerup", async (event) => {
    const drag = state.petDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.target.closest?.(".sany-trigger")?.classList.remove("is-dragging");
    if (drag.moved) { state.suppressPetClickUntil = Date.now() + 300; await chrome.storage.local.set({ [PET_POSITION_KEY]: state.petPosition }); }
    state.petDrag = null;
  });

  shadow.addEventListener("pointercancel", () => { state.petDrag = null; });

  shadow.addEventListener("change", async (event) => {
    const target = event.target;
    if (target?.id === "hc-upload") { await handleImport(target.files?.[0]); return; }
    if (target?.id === "cv-upload") { await importCvAsCandidate(target.files?.[0]); target.value = ""; return; }
    if (target?.dataset?.control === "hc-company") { state.hcCompany = target.value; render(); }
    if (target?.dataset?.control === "hc-region") { state.hcRegion = target.value; render(); }
    if (target?.dataset?.control === "hc-sort") { state.hcSort = target.value; await chrome.storage.local.set({ [HC_SORT_KEY]: state.hcSort }); render(); }
  });

  shadow.addEventListener("input", (event) => {
    const target = event.target;
    if (target?.name === "question" && target.closest("#agent-chat-form")) state.agentDraft = target.value;
  });

  shadow.addEventListener("keydown", (event) => {
    const target = event.target;
    const form = target?.closest?.("#agent-chat-form");
    if (!form || target?.name !== "question" || event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    form.requestSubmit();
  });

  shadow.addEventListener("submit", async (event) => {
    const form = event.target;
    if (form?.id === "agent-chat-form") {
      event.preventDefault();
      await askAgent(new FormData(form).get("question"));
      return;
    }
    if (form?.id === "role-import-form") {
      event.preventDefault();
      await importRoleWithAgent(new FormData(form).get("jobText"));
      return;
    }
    if (form?.id !== "role-form") return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const index = state.hcs.length + Date.now();
    const draft = SanyStore.normalizeRole({ ...values, id: form.dataset.roleId || undefined, updatedAt: new Date().toISOString().slice(0, 10) }, index);
    const hcs = form.dataset.roleId ? state.hcs.map((role) => role.id === form.dataset.roleId ? draft : role) : [...state.hcs, draft];
    state.hcs = await SanyStore.saveHcs(hcs);
    state.modal = null;
    if (!draft.company) {
      state.flashTone = "error";
      state.flash = `${form.dataset.roleId ? "岗位已更新" : "岗位已新增"}，但 Company 未填写；该 HC 不会参与匹配。`;
    } else {
      try {
        await ensureCompanySkillsForRoles(state.hcs);
        state.flashTone = "";
        state.flash = `${form.dataset.roleId ? "岗位已更新" : "岗位已新增"}；${draft.company} 匹配 Skill 已就绪。`;
      } catch (error) {
        state.flashTone = "error";
        state.flash = `岗位已保存，但 ${draft.company} 匹配 Skill 生成失败：${error.message || "Agent 暂时不可用"}。`;
      }
    }
    render();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "TOGGLE_OVERLAY") { state.isOpen = true; refreshData({ rescan: true }); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes[SanyStore.KEY.hcs] || changes[SanyStore.KEY.history])) refreshData();
  });

  let candidateCheckQueued = false;
  function refreshCandidateAfterLinkedInPaint() {
    if (candidateCheckQueued || state.candidate?.canMatch) return;
    candidateCheckQueued = true;
    setTimeout(() => {
      candidateCheckQueued = false;
      const candidate = scanCandidate();
      if (candidate.canMatch) {
        state.candidate = candidate;
        if (state.isOpen) render();
      }
    }, 700);
  }

  const pageObserver = new MutationObserver(() => refreshCandidateAfterLinkedInPaint());
  pageObserver.observe(document.documentElement, { childList: true, subtree: true });
  let petResizeTimer;
  window.addEventListener("resize", () => {
    window.clearTimeout(petResizeTimer);
    petResizeTimer = window.setTimeout(() => { state.petPosition = clampPetPosition(state.petPosition); render(); }, 120);
  });

  await injectStyles();
  const savedUi = await chrome.storage.local.get([HC_SORT_KEY, PET_POSITION_KEY]);
  if (["date", "priority"].includes(savedUi[HC_SORT_KEY])) state.hcSort = savedUi[HC_SORT_KEY];
  state.petPosition = clampPetPosition(savedUi[PET_POSITION_KEY]);
  await refreshData({ rescan: true });
  refreshCandidateAfterLinkedInPaint();
})().catch((error) => {
  if (/extension context invalidated/i.test(String(error?.message || error))) {
    window.location.reload();
    return;
  }
  console.error("SANY Talent Match failed to initialize", error);
});
