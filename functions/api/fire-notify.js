const FIRE_API_URL = "https://firefeeds.venturacounty.gov/api/incidents";
const SUBSCRIBER_KEY = "subscribers";
const LAST_IDS_KEY = "fire_last_ids";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(ctx) {
  return handleNotify(ctx);
}

export async function onRequestPost(ctx) {
  return handleNotify(ctx);
}

async function handleNotify({ env, request }) {
  if (!isAuthorized(request, env)) return unauthorized();
  const kv = env.VCWATCH_KV;
  if (!kv) return json({ ok: false, error: "Missing KV binding VCWATCH_KV." }, 500);

  const twilioSid = env.TWILIO_ACCOUNT_SID;
  const twilioToken = env.TWILIO_AUTH_TOKEN;
  const twilioFrom = env.TWILIO_FROM;
  if (!twilioSid || !twilioToken || !twilioFrom) {
    return json({ ok: false, error: "Missing Twilio env vars." }, 500);
  }

  const subscribers = await loadSubscribers(kv);
  if (!subscribers.length) {
    return json({ ok: true, sent: 0, note: "No subscribers configured." });
  }

  const incidents = await fetchFireIncidents();
  const ids = incidents.map((i) => i.id).filter(Boolean);

  const last = await loadLastIds(kv);
  if (!last) {
    await saveLastIds(kv, ids);
    return json({ ok: true, sent: 0, note: "Cold start - stored snapshot." });
  }

  const lastSet = new Set(last.ids || []);
  const newIncidents = incidents.filter((i) => i.id && !lastSet.has(i.id));

  let sent = 0;
  const errors = [];

  for (const incident of newIncidents) {
    const body = buildSmsBody(incident);
    for (const sub of subscribers) {
      try {
        const result = await sendTwilioMessage({
          sid: twilioSid,
          token: twilioToken,
          from: twilioFrom,
          to: sub.phone,
          body,
        });
        if (result.ok) sent += 1;
        else errors.push(result.error || "Unknown send error");
      } catch (err) {
        errors.push(String(err?.message || err));
      }
    }
  }

  await saveLastIds(kv, ids);

  return json({
    ok: true,
    newIncidents: newIncidents.length,
    sent,
    errors: errors.slice(0, 10),
  });
}

async function fetchFireIncidents() {
  const res = await fetch(FIRE_API_URL, { cf: { cacheTtl: 30, cacheEverything: true } });
  if (!res.ok) throw new Error(`VCFD fetch failed: ${res.status}`);
  const data = await res.json();

  const list = Array.isArray(data) ? data : (data?.incidents || []);
  return list.map(normalizeFire).filter((i) => i.id);
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

async function loadSubscribers(kv) {
  const raw = await kv.get(SUBSCRIBER_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((s) => s?.phone) : [];
  } catch {
    return [];
  }
}

async function loadLastIds(kv) {
  const raw = await kv.get(LAST_IDS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveLastIds(kv, ids) {
  const payload = { ids, updatedAt: new Date().toISOString() };
  await kv.put(LAST_IDS_KEY, JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 * 7 });
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
