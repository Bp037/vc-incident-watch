const FIRE_API_URL = "https://firefeeds.venturacounty.gov/api/incidents";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ env, request }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const twilioSid = env.TWILIO_ACCOUNT_SID;
  const twilioToken = env.TWILIO_AUTH_TOKEN;
  const twilioFrom = env.TWILIO_FROM;
  if (!twilioSid || !twilioToken || !twilioFrom) {
    return json({ ok: false, error: "Missing Twilio env vars." }, 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: "Invalid JSON body." }, 400);

  const mode = String(body.mode || "latest").toLowerCase();
  const incoming = Array.isArray(body.recipients)
    ? body.recipients
    : [{ name: body.name, phone: body.phone }];

  const recipients = [];
  const invalid = [];

  for (const item of incoming) {
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    const phone = normalizePhone(item?.phone);
    if (!phone) {
      invalid.push({ name, phone: item?.phone ?? "" });
      continue;
    }
    recipients.push({ name, phone });
  }

  if (!recipients.length) {
    return json({ ok: false, error: "No valid recipients." }, 400);
  }

  let message = "";
  if (mode === "custom") {
    message = String(body.message || "").trim();
    if (!message) return json({ ok: false, error: "Custom message is required." }, 400);
  } else {
    const latest = await fetchLatestIncident();
    if (!latest) {
      message = "VCFD Fire Call\nNo active incidents available.";
    } else {
      message = buildSmsBody(latest);
    }
  }

  let sent = 0;
  const errors = [];

  for (const recipient of recipients) {
    try {
      const result = await sendTwilioMessage({
        sid: twilioSid,
        token: twilioToken,
        from: twilioFrom,
        to: recipient.phone,
        body: message,
      });
      if (result.ok) sent += 1;
      else errors.push(result.error || "Unknown send error");
    } catch (err) {
      errors.push(String(err?.message || err));
    }
  }

  return json({
    ok: true,
    sent,
    recipients: recipients.length,
    invalid,
    errors: errors.slice(0, 10),
  });
}

async function fetchLatestIncident() {
  const res = await fetch(FIRE_API_URL, { cf: { cacheTtl: 30, cacheEverything: true } });
  if (!res.ok) throw new Error(`VCFD fetch failed: ${res.status}`);
  const data = await res.json();

  const list = Array.isArray(data) ? data : (data?.incidents || []);
  const incidents = list.map(normalizeFire).filter((i) => i.id);
  incidents.sort((a, b) => parseResponseDate(b.dateStr) - parseResponseDate(a.dateStr));
  return incidents[0] || null;
}

function normalizeFire(raw) {
  const id = raw?.incidentNumber || raw?.IncidentNumber || raw?.id || raw?.IncidentID;
  const dateStr = raw?.responseDate || raw?.ResponseDate || raw?.date || raw?.Date || "";
  const block = raw?.block ? String(raw.block).trim() : "";
  const addr = raw?.address ? String(raw.address).trim() : "";
  const city = raw?.city ? String(raw.city).trim() : "";
  const street = [block, addr].filter(Boolean).join(" ").trim();
  const fullAddress = [street, city].filter(Boolean).join(", ").trim();
  const type = raw?.incidentType || raw?.IncidentType || "";
  const status = raw?.status || raw?.Status || "";
  const units = raw?.units || raw?.Units || "";

  const fallbackId = `${dateStr}|${fullAddress}|${type}`.trim();

  return {
    id: id || fallbackId,
    dateStr,
    type,
    status,
    units,
    fullAddress,
  };
}

function parseResponseDate(s) {
  const m = String(s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/);
  if (!m) {
    const parsed = Date.parse(s);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  const yy = parseInt(m[3], 10);
  const hh = parseInt(m[4], 10);
  const mi = parseInt(m[5], 10);
  const year = yy < 100 ? (2000 + yy) : yy;
  return new Date(year, mm - 1, dd, hh, mi).getTime() || 0;
}

function buildSmsBody(incident) {
  const parts = [
    "VCFD Fire Call",
    `Time: ${incident.dateStr || "—"}`,
    `Type: ${incident.type || "—"}`,
    `Address: ${incident.fullAddress || "—"}`,
  ];
  if (incident.units) parts.push(`Units: ${incident.units}`);
  if (incident.status) parts.push(`Status: ${incident.status}`);
  if (incident.fullAddress) {
    parts.push(`Map: ${googleMapsLinkFromAddress(incident.fullAddress)}`);
  }
  return parts.join("\n");
}

function googleMapsLinkFromAddress(addr) {
  const q = encodeURIComponent(addr || "");
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function normalizePhone(input) {
  if (input == null) return "";
  let raw = String(input).trim();
  if (!raw) return "";
  raw = raw.replace(/[()\-.\s]/g, "");
  if (raw.startsWith("00")) raw = "+" + raw.slice(2);
  if (!raw.startsWith("+")) return "";
  const cleaned = "+" + raw.slice(1).replace(/\D/g, "");
  if (cleaned.length < 8) return "";
  return cleaned;
}

async function sendTwilioMessage({ sid, token, from, to, body }) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = btoa(`${sid}:${token}`);

  const payload = new URLSearchParams({
    From: from,
    To: to,
    Body: body,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { ok: false, error: `Twilio HTTP ${res.status}: ${errText.slice(0, 120)}` };
  }
  return { ok: true };
}

function isAuthorized(request, env) {
  const token = env.ADMIN_TOKEN;
  if (!token) return true;
  const header = request.headers.get("authorization") || "";
  if (header.toLowerCase().startsWith("bearer ")) {
    const provided = header.slice(7).trim();
    return provided === token;
  }
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token") || "";
  return queryToken === token;
}

function unauthorized() {
  return json({ ok: false, error: "Unauthorized" }, 401);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}
