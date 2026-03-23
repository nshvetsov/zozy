const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  };
}

function textResponse(statusCode, body, contentType = "text/plain; charset=utf-8") {
  return {
    statusCode,
    headers: {
      ...corsHeaders,
      "Content-Type": contentType,
    },
    body,
  };
}

function parseAllowedHosts() {
  const raw = (process.env.ALLOWED_HOSTS || "").trim();
  if (!raw) return null;
  const hosts = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length ? new Set(hosts) : null;
}

function validateTargetUrl(value, allowedHosts) {
  if (typeof value !== "string" || !value.trim()) return { ok: false, reason: "URL is required" };
  let target;
  try {
    target = new URL(value.trim());
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (!["http:", "https:"].includes(target.protocol)) {
    return { ok: false, reason: "Only http/https URLs are allowed" };
  }
  if (allowedHosts && !allowedHosts.has(target.hostname.toLowerCase())) {
    return { ok: false, reason: `Host is not allowed: ${target.hostname}` };
  }
  return { ok: true, target };
}

async function readRequestBody(event) {
  if (!event || !event.body) return {};
  if (typeof event.body === "object") return event.body;
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

module.exports.handler = async function handler(event = {}) {
  const method = (event.httpMethod || (event.requestContext && event.requestContext.http && event.requestContext.http.method) || "POST").toUpperCase();
  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: "",
    };
  }
  if (method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed. Use POST." });
  }

  const body = await readRequestBody(event);
  const allowedHosts = parseAllowedHosts();
  const check = validateTargetUrl(body.url, allowedHosts);
  if (!check.ok) return jsonResponse(400, { error: check.reason });

  try {
    const response = await fetch(check.target.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; zozy-url-proxy/1.0)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return jsonResponse(response.status, { error: `Upstream HTTP ${response.status}` });
    }
    const html = await response.text();
    if (!html.trim()) return jsonResponse(502, { error: "Upstream returned empty body" });
    return textResponse(200, html, "text/html; charset=utf-8");
  } catch (error) {
    return jsonResponse(502, { error: `Fetch failed: ${error && error.message ? error.message : "unknown"}` });
  }
};
