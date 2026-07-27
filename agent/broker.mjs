import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const PORT = 8790;
const ROOT = new URL("..", import.meta.url).pathname;
const SCHEMA = join(ROOT, "agent", "match-schema.json");
const CV_SCHEMA = join(ROOT, "agent", "cv-schema.json");
const ROLE_SCHEMA = join(ROOT, "agent", "role-schema.json");

function send(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  });
  response.end(JSON.stringify(value));
}

function runCodex(prompt, outputFile, schema = null, reasoning = "low") {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const args = ["exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-c", `model_reasoning_effort=\"${reasoning}\"`, "-c", "service_tier=\"fast\"", "-c", "features.fast_mode=true"];
    if (schema) args.push("--output-schema", schema);
    args.push("-o", outputFile, "-");
    const child = spawn("codex", args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      console.log(`[codex] tier=fast reasoning=${reasoning} elapsed=${((Date.now() - startedAt) / 1000).toFixed(1)}s exit=${code}`);
      code === 0 ? resolve() : reject(new Error(stderr || `codex exited ${code}`));
    });
    child.stdin.end(prompt);
  });
}

function commandText(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `${command} exited ${code}`)));
  });
}

async function extractCvText(file, temp) {
  const name = String(file?.name || "resume");
  const extension = name.toLowerCase().match(/\.(pdf|docx|txt|md)$/)?.[1];
  if (!extension) throw new Error("仅支持 PDF、DOCX、TXT 或 Markdown 格式的 CV");
  const binary = Buffer.from(String(file?.base64 || ""), "base64");
  if (!binary.length || binary.length > 4_000_000) throw new Error("CV 为空或超过 4MB");
  const input = join(temp, `resume.${extension}`);
  await writeFile(input, binary);
  if (extension === "pdf") {
    const output = join(temp, "resume.txt");
    await commandText("pdftotext", ["-layout", input, output]);
    return readFile(output, "utf8");
  }
  if (extension === "docx") return commandText("textutil", ["-convert", "txt", "-stdout", input]);
  return binary.toString("utf8");
}

createServer(async (request, response) => {
  if (request.method === "OPTIONS") return send(response, 204, {});
  if (request.method !== "POST" || !["/match", "/chat", "/resume", "/role"].includes(request.url)) return send(response, 404, { error: "not found" });
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 6_000_000) return send(response, 413, { error: "payload too large" });
  }
  try {
    const input = JSON.parse(body);
    if (request.url === "/role") {
      const jobText = String(input?.jobText || "").trim();
      if (jobText.length < 8) throw new Error("请粘贴更完整的岗位内容");
      const temp = await mkdtemp(join(tmpdir(), "sany-role-"));
      try {
        const output = join(temp, "role.json");
        const today = new Date().toISOString().slice(0, 10);
        const prompt = `You are a recruiting operations data-entry agent. Convert the pasted raw job requirement into exactly one structured HC record using the supplied JSON schema. Use only facts in the source; do not invent requirements. Write human-readable fields in Simplified Chinese while preserving proper nouns. title is the job title. location must preserve every explicit country/city/base location. businessUnit is the stated product line or business unit; use "不限产品" only when absent. function is the job function such as Sales & Marketing, Technical, Service, HR, Finance, or General. region is the explicit region, or infer only from an explicitly stated country; otherwise use "全球". priority must be SSS, SS, or S; if absent use S. openCount must use the explicit HC count, otherwise 1. nationality and hiringManager must be empty strings when absent. updatedAt is the explicit release/update date normalized as YYYY-MM-DD; if absent use today's date ${today}. note must retain ALL material source content and requirements, including location details, product scope, experience, language, customer, compensation, restrictions, and free-form remarks. Clean formatting and duplicates but do not shorten away details. Return JSON only through the schema.\n\nRaw job requirement:\n${jobText.slice(0, 80000)}`;
        await runCodex(prompt, output, ROLE_SCHEMA, "low");
        const result = JSON.parse(await readFile(output, "utf8"));
        return send(response, 200, result);
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    }
    if (request.url === "/resume") {
      const temp = await mkdtemp(join(tmpdir(), "sany-resume-"));
      try {
        const cvText = String(await extractCvText(input?.file, temp)).replace(/\u0000/g, " ").trim();
        if (cvText.length < 40) throw new Error("无法从 CV 中读取足够文字；请上传可复制文字的 PDF、DOCX 或 TXT");
        const output = join(temp, "candidate.json");
        const prompt = `Extract a recruiter-ready candidate profile from this CV. Use only facts present in the CV. Write all string fields in Simplified Chinese except proper nouns. Do not infer or estimate age, nationality, ethnicity, gender, disability, family status, compensation, language proficiency, or missing dates. If a fact is absent, use an empty string or null. careerYears may be computed only from explicit employment dates, otherwise null. Keep evidenceText factual and concise.\n\nCV:\n${cvText.slice(0, 50000)}`;
        await runCodex(prompt, output, CV_SCHEMA, "low");
        const result = JSON.parse(await readFile(output, "utf8"));
        const candidate = result.candidate;
        candidate.url = "";
        candidate.avatar = "";
        candidate.canMatch = Boolean(candidate.name);
        candidate.reason = candidate.canMatch ? "" : "CV 中未能识别候选人姓名。";
        candidate.source = "cv";
        return send(response, 200, { candidate, extractedCharacters: cvText.length });
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    }
    if (request.url === "/chat") {
      if (!String(input?.question || "").trim()) throw new Error("question is required");
      const temp = await mkdtemp(join(tmpdir(), "sany-chat-"));
      const output = join(temp, "answer.txt");
      const context = {
        currentCandidate: input.candidate || null,
        activeHcs: Array.isArray(input.roles) ? input.roles : [],
        recentCandidates: Array.isArray(input.history) ? input.history.slice(0, 8) : [],
        conversation: Array.isArray(input.messages) ? input.messages.slice(-6) : [],
      };
      const prompt = `You are SANY Talent Match's recruiter copilot. Answer the recruiter's question using only the supplied candidate, HC/JD, and recent matching records. Be concise, practical, and explicit about evidence versus unknown facts. You may recommend follow-up questions, compare roles, or explain prior matches. Do not make hiring decisions. Never use or infer protected attributes (including age) for recommendations. Reply in the recruiter's language (Chinese if the question is Chinese).\n\nContext:\n${JSON.stringify(context)}\n\nRecruiter question:\n${String(input.question).trim()}`;
      await runCodex(prompt, output, null, "low");
      const answer = (await readFile(output, "utf8")).trim();
      await rm(temp, { recursive: true, force: true });
      return send(response, 200, { answer: answer || "目前沒有足夠資料回答這個問題。" });
    }
    if (!input?.candidate?.name || !Array.isArray(input?.roles)) throw new Error("candidate and roles are required");
    const temp = await mkdtemp(join(tmpdir(), "sany-match-"));
    const output = join(temp, "result.json");
    const prompt = `You are the Match Reasoner in a recruiter copilot. Analyze ONLY the supplied candidate profile and the COMPLETE supplied HC file. Inspect every role before deciding; never rely on a partial shortlist. Each role's role.location AND role.note are authoritative JD text. Geographic scope, country, city, local-market requirements, relocation constraints, and exceptions may appear in role.note, so read it before judging location. Location is a NON-NEGOTIABLE gate: return a report only when the candidate's current location is directly covered by the role.location or an explicit geographic scope in role.note, or the supplied profile explicitly states willingness/availability to relocate to that role's stated location. A city or metropolitan area within the role's explicitly named country counts as a direct match (for example Greater Buenos Aires for Argentina); same region, nearby country, language overlap, or an unverified assumption do not. If role.location and role.note conflict, resolve the conflict conservatively and do not recommend it until clarified. If no role passes this gate, return {"reports":[]} exactly. Never choose a wrong-location role merely because it is the strongest functional match. If one or more roles pass, return the required JSON schema with EXACTLY ONE report: the single strongest role only. Do not return runner-ups or compare multiple roles in the answer. Write every human-readable field in Simplified Chinese.

Produce a recruiter-ready decision memo using this visible, auditable framework — never generic scoring prose and never hidden chain-of-thought:
1) Hard gates first: location, explicitly evidenced working language, any role-specific non-sensitive eligibility requirement, and explicit conflict / restriction in the JD. A failed location gate means no report. Do not infer language ability from a multinational employer. Do not treat age, nationality, ethnicity, gender, disability, family status, or other protected attributes as a gate, score input, recommendation input, or inferred fact. If the JD mentions one, write "需招聘人员依当地法规人工确认" only.
2) Soft assessment second: stability (tenure, short stints, unexplained overlap/gaps only if actually visible), benchmark brand / distributor pedigree, exact product-line fit rather than generic machinery labels, customer-resource transferability, and career-path coherence. Never invent customers, brands, products, sales figures, tenure, gaps, or language level.
3) Role positioning third: compare title / seniority, leadership scope, and verified compensation or level information. Flag meaningful title inversion or unknown compensation; never make up salary ranges, market pay, or expected increase.
4) Recommendation last: choose exactly one of 强烈推荐 / 推荐 / 备选 / 观察 / 不推. The verdict must be consistent with the hard gates and evidence. Use the score solely as a prioritization signal, not a hiring decision.

Required report shape within the schema: summary is one direct decision conclusion of at most 45 Chinese characters. candidateOverview is the factual profile image: industry experience, current title/company, education, and current Base when available (do not estimate or display age). highlights must cover the best available evidence under concise labels such as 行业经验总结, 最近一份工作的优势, 过往经历加分点, 教育背景, Base 地点分析. requirementFit is the auditable hard-gate and key-requirement table; include location first, then only material items such as language, product line, customer type, stability, brand pedigree, and seniority. Use only 已验证 / 部分验证 / 待确认 / 不匹配 and state the evidence or missing fact. keyVariable names the one decision-critical uncertainty or blocker. compensationAssessment says only verified information; otherwise say it is unassessed and name the exact total-compensation / title calibration question. recommendation is an unambiguous recruiter action. nextSteps gives 2–4 phone-screen questions in sequence: hard gate, motivation, total compensation/title, then business capability where applicable.

Every report MUST include two tags using exactly the enum values in the schema. roleMatchTag is the value only, never a label or sentence: 直接匹配, 可迁移, 需核实, or 匹配较弱. locationMatchTag must be 地点一致 when a report is returned; never use 可通勤, 需要搬迁, or 待确认 unless explicit evidence supports it, and never return a report with an unverified location. Do not invent facts. Every evidence item must identify a concrete fact from the supplied profile. Put absent or unverified JD requirements in risks, never evidence. Treat location, domain/functional fit, seniority, and transferable leadership separately. A score is a recruiter prioritization signal, not a hiring decision. Age, graduation-derived age, nationality, gender, ethnicity, disability, and other protected attributes must never affect the score, ranking, or verdict. Do not calculate, estimate, or display age. Where profile information is missing, say unknown and recommend an interview check. Use the exact supplied roleId values only.\n\nCandidate:\n${JSON.stringify(input.candidate)}\n\nRoles:\n${JSON.stringify(input.roles)}`;
    await runCodex(prompt, output, SCHEMA, "low");
    const result = JSON.parse(await readFile(output, "utf8"));
    await rm(temp, { recursive: true, force: true });
    send(response, 200, result);
  } catch (error) {
    send(response, 500, { error: error.message || "agent match failed" });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`SANY agent broker: http://127.0.0.1:${PORT}`));
