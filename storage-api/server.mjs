import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { Pool } from "pg";

const PORT = Number(process.env.PORT || 3000);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});
const EMPTY = { hcs: [], history: [], messages: [] };
const PUBLIC_ROOT = new URL("./public/", import.meta.url);

function workspaceHash(key) {
  return createHash("sha256").update(key).digest("hex");
}

function send(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS, GET",
    "access-control-allow-headers": "content-type, x-superpeanut-workspace",
    "access-control-max-age": "86400",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function sendAsset(response, file, contentType) {
  const body = await readFile(new URL(file, PUBLIC_ROOT));
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
}

function workspaceKey(request) {
  const key = String(request.headers["x-superpeanut-workspace"] || "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error("invalid workspace key");
  return key;
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_500_000) throw new Error("payload too large");
  }
  return body ? JSON.parse(body) : {};
}

function safeState(value) {
  const state = value && typeof value === "object" ? value : {};
  return {
    hcs: Array.isArray(state.hcs) ? state.hcs.slice(0, 500) : [],
    history: Array.isArray(state.history) ? state.history.slice(0, 200) : [],
    messages: Array.isArray(state.messages) ? state.messages.slice(-60) : [],
  };
}

function validTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

async function resolveUser(client, key) {
  const result = await client.query(`INSERT INTO users (workspace_key_hash)
    VALUES ($1)
    ON CONFLICT (workspace_key_hash) DO UPDATE SET last_seen_at = NOW()
    RETURNING id`, [workspaceHash(key)]);
  return result.rows[0].id;
}

async function writeHcs(client, userId, hcs) {
  const ids = [];
  for (let index = 0; index < hcs.length; index += 1) {
    const role = hcs[index] && typeof hcs[index] === "object" ? hcs[index] : {};
    const hcId = String(role.id || `hc_${Date.now()}_${index}`);
    ids.push(hcId);
    await client.query(`INSERT INTO hcs (
      user_id, hc_id, priority, business_unit, function_name, region, title, company, location,
      nationality, open_count, note, hiring_manager, release_date, payload, sort_order
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
    ON CONFLICT (user_id, hc_id) DO UPDATE SET
      priority = EXCLUDED.priority,
      business_unit = EXCLUDED.business_unit,
      function_name = EXCLUDED.function_name,
      region = EXCLUDED.region,
      title = EXCLUDED.title,
      company = EXCLUDED.company,
      location = EXCLUDED.location,
      nationality = EXCLUDED.nationality,
      open_count = EXCLUDED.open_count,
      note = EXCLUDED.note,
      hiring_manager = EXCLUDED.hiring_manager,
      release_date = EXCLUDED.release_date,
      payload = EXCLUDED.payload,
      sort_order = EXCLUDED.sort_order,
      updated_at = NOW()`, [
      userId,
      hcId,
      String(role.priority || "S"),
      String(role.businessUnit || "不限产品"),
      String(role.function || "General"),
      String(role.region || "全球"),
      String(role.title || "未命名岗位"),
      String(role.company || ""),
      String(role.location || "未填写地点"),
      String(role.nationality || ""),
      Number.isFinite(Number(role.openCount)) ? Math.max(0, Number(role.openCount)) : 1,
      String(role.note || ""),
      String(role.hiringManager || ""),
      String(role.updatedAt || ""),
      JSON.stringify({ ...role, id: hcId }),
      index,
    ]);
  }
  if (ids.length) await client.query("DELETE FROM hcs WHERE user_id = $1 AND NOT (hc_id = ANY($2::text[]))", [userId, ids]);
  else await client.query("DELETE FROM hcs WHERE user_id = $1", [userId]);
}

async function writeHistory(client, userId, history) {
  const ids = [];
  for (let index = 0; index < history.length; index += 1) {
    const record = history[index] && typeof history[index] === "object" ? history[index] : {};
    const recordId = String(record.id || `report_${Date.now()}_${index}`);
    const candidate = record.candidate && typeof record.candidate === "object" ? record.candidate : {};
    const reports = Array.isArray(record.reports) ? record.reports : [];
    const first = reports[0] || {};
    ids.push(recordId);
    await client.query(`INSERT INTO match_history (
      user_id, record_id, candidate_name, candidate_url, candidate_location,
      matched_hc_id, match_score, no_fit, candidate, reports, record,
      generated_at, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13)
    ON CONFLICT (user_id, record_id) DO UPDATE SET
      candidate_name = EXCLUDED.candidate_name,
      candidate_url = EXCLUDED.candidate_url,
      candidate_location = EXCLUDED.candidate_location,
      matched_hc_id = EXCLUDED.matched_hc_id,
      match_score = EXCLUDED.match_score,
      no_fit = EXCLUDED.no_fit,
      candidate = EXCLUDED.candidate,
      reports = EXCLUDED.reports,
      record = EXCLUDED.record,
      generated_at = EXCLUDED.generated_at,
      updated_at = NOW()`, [
      userId,
      recordId,
      String(candidate.name || ""),
      String(candidate.url || ""),
      String(candidate.location || ""),
      first.roleId ? String(first.roleId) : null,
      Number.isFinite(Number(first.score)) ? Math.max(0, Math.min(100, Number(first.score))) : null,
      Boolean(record.noFit || !reports.length),
      JSON.stringify(candidate),
      JSON.stringify(reports),
      JSON.stringify({ ...record, id: recordId, candidate, reports }),
      validTimestamp(record.generatedAt),
      validTimestamp(record.createdAt) || new Date().toISOString(),
    ]);
  }
  if (ids.length) await client.query("DELETE FROM match_history WHERE user_id = $1 AND NOT (record_id = ANY($2::text[]))", [userId, ids]);
  else await client.query("DELETE FROM match_history WHERE user_id = $1", [userId]);
}

async function writeMessages(client, userId, messages) {
  await client.query("DELETE FROM agent_messages WHERE user_id = $1", [userId]);
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index] && typeof messages[index] === "object" ? messages[index] : {};
    const eventId = String(message.id || `legacy_${createHash("sha256").update(`${message.role || ""}|${message.content || ""}`).digest("hex").slice(0, 24)}`);
    await client.query(`INSERT INTO agent_comment_events (user_id, event_id, role, content, payload, created_at)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6)
      ON CONFLICT (user_id, event_id) DO UPDATE SET
        role = EXCLUDED.role,
        content = EXCLUDED.content,
        payload = EXCLUDED.payload`, [
      userId,
      eventId,
      String(message.role || ""),
      String(message.content || ""),
      JSON.stringify({ ...message, id: eventId }),
      validTimestamp(message.createdAt) || new Date().toISOString(),
    ]);
    await client.query(`INSERT INTO agent_messages (user_id, position, role, content, payload)
      VALUES ($1,$2,$3,$4,$5::jsonb)`, [
      userId,
      index,
      String(message.role || ""),
      String(message.content || ""),
      JSON.stringify(message),
    ]);
  }
}

async function adminSnapshot() {
  const [dashboardResult, hcsResult, usersResult, matchesResult, trendsResult] = await Promise.all([
    pool.query(`WITH hc_base AS (
      SELECT user_id, hc_id,
        lower(regexp_replace(trim(company), '\\s+', ' ', 'g')) || '|' ||
        lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) || '|' ||
        lower(regexp_replace(regexp_replace(trim(location), '[,，;；(（].*$', ''), '\\s+', ' ', 'g')) AS canonical_key
      FROM hcs
    )
    SELECT
      (SELECT COUNT(*)::int FROM match_history WHERE created_at >= NOW() - INTERVAL '24 hours') AS "matches24h",
      (SELECT COUNT(*)::int FROM agent_comment_events WHERE role = 'user' AND created_at >= NOW() - INTERVAL '24 hours') AS "agentComments24h",
      (SELECT COUNT(DISTINCT COALESCE(hb.canonical_key, mh.user_id::text || '|' || mh.matched_hc_id))::int
        FROM match_history mh
        LEFT JOIN hc_base hb ON hb.user_id = mh.user_id AND hb.hc_id = mh.matched_hc_id
        WHERE mh.created_at >= NOW() - INTERVAL '24 hours' AND mh.matched_hc_id IS NOT NULL AND NOT mh.no_fit) AS "matchedHcs24h",
      (SELECT COUNT(DISTINCT COALESCE(hb.canonical_key, mh.user_id::text || '|' || mh.matched_hc_id))::int
        FROM match_history mh
        LEFT JOIN hc_base hb ON hb.user_id = mh.user_id AND hb.hc_id = mh.matched_hc_id
        WHERE (mh.created_at AT TIME ZONE 'America/Los_Angeles')::date >= (NOW() AT TIME ZONE 'America/Los_Angeles')::date - 6
          AND mh.matched_hc_id IS NOT NULL AND NOT mh.no_fit) AS "matchedHcs7d",
      (SELECT COUNT(*)::int FROM users) AS "totalUsers",
      (SELECT COUNT(DISTINCT lower(regexp_replace(trim(company), '\\s+', ' ', 'g')) || '|' ||
        lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) || '|' ||
        lower(regexp_replace(regexp_replace(trim(location), '[,，;；(（].*$', ''), '\\s+', ' ', 'g')))::int FROM hcs) AS "uniqueHcs",
      (SELECT COUNT(*)::int FROM hcs) AS "totalHcInstances",
      (SELECT COUNT(*)::int FROM match_history) AS "totalMatches"`),
    pool.query(`WITH hc_base AS (
      SELECT user_id, hc_id, title, company, location, business_unit, function_name, region, priority,
        open_count, note, hiring_manager, release_date,
        lower(regexp_replace(trim(company), '\\s+', ' ', 'g')) || '|' ||
        lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) || '|' ||
        lower(regexp_replace(regexp_replace(trim(location), '[,，;；(（].*$', ''), '\\s+', ' ', 'g')) AS canonical_key
      FROM hcs
    )
    SELECT hb.canonical_key AS "key",
      MIN(hb.title) AS title,
      MIN(hb.company) AS company,
      MIN(hb.location) AS location,
      MIN(hb.business_unit) AS "businessUnit",
      MIN(hb.function_name) AS function,
      MIN(hb.region) AS region,
      (ARRAY_AGG(hb.priority ORDER BY CASE hb.priority WHEN 'SSS' THEN 1 WHEN 'SS' THEN 2 ELSE 3 END))[1] AS priority,
      MAX(hb.note) AS note,
      MAX(hb.hiring_manager) AS "hiringManager",
      MAX(hb.release_date) AS "releaseDate",
      COUNT(DISTINCT hb.user_id)::int AS "userCount",
      SUM(hb.open_count)::int AS "totalOpenCount",
      COUNT(DISTINCT COALESCE(NULLIF(mh.candidate_url, ''), mh.user_id::text || '|' || mh.record_id))::int AS "matchCount",
      MAX(mh.created_at) AS "lastMatchedAt"
    FROM hc_base hb
    LEFT JOIN match_history mh ON mh.user_id = hb.user_id AND mh.matched_hc_id = hb.hc_id AND NOT mh.no_fit
    GROUP BY hb.canonical_key
    ORDER BY "matchCount" DESC, priority ASC, title ASC`),
    pool.query(`WITH hc_counts AS (
      SELECT user_id, COUNT(*)::int AS hc_count FROM hcs GROUP BY user_id
    ), match_counts AS (
      SELECT user_id, COUNT(*)::int AS match_count,
        COUNT(DISTINCT NULLIF(candidate_url, ''))::int AS candidate_count
      FROM match_history GROUP BY user_id
    ), comment_counts AS (
      SELECT user_id, COUNT(*)::int AS comment_count
      FROM agent_comment_events WHERE role = 'user' GROUP BY user_id
    )
    SELECT u.id,
      'User ' || lpad(u.id::text, 4, '0') AS label,
      u.created_at AS "createdAt",
      u.last_seen_at AS "lastSeenAt",
      COALESCE(h.hc_count, 0) AS "hcCount",
      COALESCE(m.match_count, 0) AS "matchCount",
      COALESCE(m.candidate_count, 0) AS "candidateCount",
      COALESCE(c.comment_count, 0) AS "agentCommentCount"
    FROM users u
    LEFT JOIN hc_counts h ON h.user_id = u.id
    LEFT JOIN match_counts m ON m.user_id = u.id
    LEFT JOIN comment_counts c ON c.user_id = u.id
    ORDER BY u.last_seen_at DESC`),
    pool.query(`WITH hc_base AS (
      SELECT user_id, hc_id, title,
        lower(regexp_replace(trim(company), '\\s+', ' ', 'g')) || '|' ||
        lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) || '|' ||
        lower(regexp_replace(regexp_replace(trim(location), '[,，;；(（].*$', ''), '\\s+', ' ', 'g')) AS canonical_key
      FROM hcs
    )
    SELECT mh.record_id AS id,
      mh.user_id AS "userId",
      'User ' || lpad(mh.user_id::text, 4, '0') AS "userLabel",
      mh.candidate_name AS name,
      mh.candidate_url AS "linkedinUrl",
      mh.candidate_location AS location,
      mh.match_score AS score,
      mh.no_fit AS "noFit",
      mh.created_at AS "createdAt",
      COALESCE(mh.candidate->>'headline', '') AS headline,
      COALESCE(mh.candidate->>'about', mh.candidate#>>'{profile,about}', '') AS introduction,
      COALESCE(mh.reports->0->>'summary', '') AS summary,
      COALESCE(mh.reports->0->>'level', '') AS level,
      COALESCE(hb.title, mh.reports->0#>>'{role,title}', '') AS "matchedHcTitle",
      COALESCE(hb.canonical_key, '') AS "hcKey"
    FROM match_history mh
    LEFT JOIN hc_base hb ON hb.user_id = mh.user_id AND hb.hc_id = mh.matched_hc_id
    ORDER BY mh.created_at DESC
    LIMIT 1000`),
    pool.query(`WITH days AS (
      SELECT generate_series(
        (NOW() AT TIME ZONE 'America/Los_Angeles')::date - 6,
        (NOW() AT TIME ZONE 'America/Los_Angeles')::date,
        INTERVAL '1 day'
      )::date AS day
    ), hc_base AS (
      SELECT user_id, hc_id,
        lower(regexp_replace(trim(company), '\\s+', ' ', 'g')) || '|' ||
        lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) || '|' ||
        lower(regexp_replace(regexp_replace(trim(location), '[,，;；(（].*$', ''), '\\s+', ' ', 'g')) AS canonical_key
      FROM hcs
    )
    SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
      (SELECT COUNT(*)::int FROM match_history mh
        WHERE (mh.created_at AT TIME ZONE 'America/Los_Angeles')::date = days.day) AS matches,
      (SELECT COUNT(*)::int FROM agent_comment_events ae
        WHERE ae.role = 'user' AND (ae.created_at AT TIME ZONE 'America/Los_Angeles')::date = days.day) AS "agentMessages",
      (SELECT COUNT(DISTINCT COALESCE(hb.canonical_key, mh.user_id::text || '|' || mh.matched_hc_id))::int
        FROM match_history mh
        LEFT JOIN hc_base hb ON hb.user_id = mh.user_id AND hb.hc_id = mh.matched_hc_id
        WHERE (mh.created_at AT TIME ZONE 'America/Los_Angeles')::date = days.day
          AND mh.matched_hc_id IS NOT NULL AND NOT mh.no_fit) AS "matchedHcs",
      (SELECT COUNT(*)::int FROM users u
        WHERE (u.created_at AT TIME ZONE 'America/Los_Angeles')::date <= days.day) AS "extensionUsers"
    FROM days
    ORDER BY days.day`),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    dashboard: dashboardResult.rows[0],
    trends: trendsResult.rows,
    hcs: hcsResult.rows,
    users: usersResult.rows,
    matches: matchesResult.rows,
  };
}

async function readState(client, userId) {
  const hcResult = await client.query("SELECT payload FROM hcs WHERE user_id = $1 ORDER BY sort_order ASC, created_at ASC", [userId]);
  const historyResult = await client.query("SELECT record FROM match_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200", [userId]);
  const messageResult = await client.query("SELECT payload FROM agent_messages WHERE user_id = $1 ORDER BY position ASC", [userId]);
  return {
    hcs: hcResult.rows.map((row) => row.payload),
    history: historyResult.rows.map((row) => row.record),
    messages: messageResult.rows.map((row) => row.payload),
  };
}

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      workspace_key_hash CHAR(64) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS hcs (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hc_id TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'S',
      business_unit TEXT NOT NULL DEFAULT '不限产品',
      function_name TEXT NOT NULL DEFAULT 'General',
      region TEXT NOT NULL DEFAULT '全球',
      title TEXT NOT NULL,
      company TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL,
      nationality TEXT NOT NULL DEFAULT '',
      open_count INTEGER NOT NULL DEFAULT 1 CHECK (open_count >= 0),
      note TEXT NOT NULL DEFAULT '',
      hiring_manager TEXT NOT NULL DEFAULT '',
      release_date TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, hc_id)
    )`);
    await client.query("ALTER TABLE hcs ADD COLUMN IF NOT EXISTS company TEXT NOT NULL DEFAULT ''");
    await client.query(`CREATE TABLE IF NOT EXISTS match_history (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      record_id TEXT NOT NULL,
      candidate_name TEXT NOT NULL DEFAULT '',
      candidate_url TEXT NOT NULL DEFAULT '',
      candidate_location TEXT NOT NULL DEFAULT '',
      matched_hc_id TEXT,
      match_score SMALLINT CHECK (match_score BETWEEN 0 AND 100),
      no_fit BOOLEAN NOT NULL DEFAULT FALSE,
      candidate JSONB NOT NULL DEFAULT '{}'::jsonb,
      reports JSONB NOT NULL DEFAULT '[]'::jsonb,
      record JSONB NOT NULL,
      generated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, record_id)
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS agent_messages (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, position)
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS agent_comment_events (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, event_id)
    )`);
    await client.query(`INSERT INTO agent_comment_events (user_id, event_id, role, content, payload, created_at)
      SELECT user_id, 'legacy_' || md5(role || '|' || content), role, content, payload, created_at
      FROM agent_messages
      ON CONFLICT (user_id, event_id) DO NOTHING`);
    await client.query("CREATE INDEX IF NOT EXISTS hcs_user_release_idx ON hcs (user_id, release_date DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS hcs_user_priority_idx ON hcs (user_id, priority)");
    await client.query("CREATE INDEX IF NOT EXISTS history_user_created_idx ON match_history (user_id, created_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS history_candidate_url_idx ON match_history (user_id, candidate_url)");
    await client.query("CREATE INDEX IF NOT EXISTS agent_events_created_idx ON agent_comment_events (created_at DESC)");

    const legacyExists = await client.query("SELECT to_regclass('public.superpeanut_workspaces') AS table_name");
    if (legacyExists.rows[0]?.table_name) {
      const legacyRows = await client.query("SELECT workspace_key, hcs, history, messages FROM superpeanut_workspaces");
      for (const row of legacyRows.rows) {
        const userId = await resolveUser(client, row.workspace_key);
        const state = safeState(row);
        await writeHcs(client, userId, state.hcs);
        await writeHistory(client, userId, state.history);
        await writeMessages(client, userId, state.messages);
      }
      await client.query("ALTER TABLE superpeanut_workspaces RENAME TO superpeanut_workspaces_legacy");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

await migrate();

createServer(async (request, response) => {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (request.method === "OPTIONS") return send(response, 204, {});
  if (request.method === "GET" && (pathname === "/admin" || pathname === "/admin/")) return sendAsset(response, "admin.html", "text/html; charset=utf-8");
  if (request.method === "GET" && pathname === "/admin.css") return sendAsset(response, "admin.css", "text/css; charset=utf-8");
  if (request.method === "GET" && pathname === "/admin.js") return sendAsset(response, "admin.js", "text/javascript; charset=utf-8");
  if (request.method === "GET" && pathname === "/api/admin/snapshot") {
    try {
      return send(response, 200, await adminSnapshot());
    } catch (error) {
      return send(response, 500, { error: error?.message || "admin query failed" });
    }
  }
  if (request.method === "GET" && pathname === "/health") {
    const result = await pool.query(`SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM hcs) AS hcs,
      (SELECT COUNT(*)::int FROM match_history) AS match_history`);
    return send(response, 200, { ok: true, schemaVersion: 3, tables: result.rows[0] });
  }
  if (request.method !== "POST" || !["/v1/state/read", "/v1/state/write"].includes(pathname)) {
    return send(response, 404, { error: "not found" });
  }

  const client = await pool.connect();
  try {
    const key = workspaceKey(request);
    await client.query("BEGIN");
    const userId = await resolveUser(client, key);

    if (pathname === "/v1/state/read") {
      const state = await readState(client, userId);
      await client.query("COMMIT");
      return send(response, 200, { state, updatedAt: new Date().toISOString() });
    }

    const input = await readBody(request);
    const state = safeState(input.state);
    await writeHcs(client, userId, state.hcs);
    await writeHistory(client, userId, state.history);
    await writeMessages(client, userId, state.messages);
    await client.query("COMMIT");
    return send(response, 200, { state: await readState(pool, userId), updatedAt: new Date().toISOString() });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    const message = error?.message || "storage error";
    return send(response, message === "payload too large" ? 413 : 400, { error: message });
  } finally {
    client.release();
  }
}).listen(PORT, "0.0.0.0", () => console.log(`SuperPeanut storage listening on ${PORT}`));
