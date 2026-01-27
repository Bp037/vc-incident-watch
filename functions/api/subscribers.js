const KV_KEY = "subscribers";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ env, request }) {
  if (!isAuthorized(request, env)) return unauthorized();
  const kv = env.VCWATCH_KV;
  if (!kv) return json({ ok: false, error: "Missing KV binding VCWATCH_KV." }, 500);

  const subscribers = await loadSubscribers(kv);
  subscribers.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return json({ ok: true, count: subscribers.length, subscribers });
}

export async function onRequestPost({ env, request }) {
  if (!isAuthorized(request, env)) return unauthorized();
  const kv = env.VCWATCH_KV;
  if (!kv) return json({ ok: false, error: "Missing KV binding VCWATCH_KV." }, 500);

  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: "Invalid JSON body." }, 400);

  const mode = String(body.mode || "merge").toLowerCase();
  const replacing = mode === "replace";
  const now = new Date().toISOString();

  const incoming = Array.isArray(body.subscribers)
    ? body.subscribers
    : [{ name: body.name, phone: body.phone }];

  const invalid = [];
  const normalized = [];

  for (const item of incoming) {
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    const phone = normalizePhone(item?.phone);
    if (!phone) {
      invalid.push({ name, phone: item?.phone ?? "" });
      continue;
    }
    normalized.push({ name, phone });
  }

  const existing = replacing ? [] : await loadSubscribers(kv);
  const byPhone = new Map(existing.map((s) => [s.phone, s]));

  for (const sub of normalized) {
    if (byPhone.has(sub.phone)) {
      const current = byPhone.get(sub.phone);
      const nextName = sub.name || current.name || "";
      byPhone.set(sub.phone, {
        ...current,
        name: nextName,
        updatedAt: now,
      });
    } else {
      byPhone.set(sub.phone, {
        name: sub.name || "",
        phone: sub.phone,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const out = Array.from(byPhone.values());
  await kv.put(KV_KEY, JSON.stringify(out), { expirationTtl: 60 * 60 * 24 * 365 });

  return json({
    ok: true,
    added: normalized.length,
    invalid,
    count: out.length,
    subscribers: out,
  });
}

export async function onRequestDelete({ env, request }) {
  if (!isAuthorized(request, env)) return unauthorized();
  const kv = env.VCWATCH_KV;
  if (!kv) return json({ ok: false, error: "Missing KV binding VCWATCH_KV." }, 500);

  let phone = null;
  const url = new URL(request.url);
  if (url.searchParams.get("phone")) phone = url.searchParams.get("phone");

  if (!phone) {
    const body = await request.json().catch(() => null);
    phone = body?.phone || null;
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return json({ ok: false, error: "Phone is required." }, 400);

  const existing = await loadSubscribers(kv);
  const remaining = existing.filter((s) => s.phone !== normalizedPhone);

  await kv.put(KV_KEY, JSON.stringify(remaining), { expirationTtl: 60 * 60 * 24 * 365 });
  return json({ ok: true, count: remaining.length, removed: normalizedPhone });
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

async function loadSubscribers(kv) {
  const raw = await kv.get(KV_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function isAuthorized(request, env) {
  const token = env.ADMIN_TOKEN;
  if (!token) return true;
  const header = request.headers.get("authorization") || "";
  const lower = header.toLowerCase();
  if (lower.startsWith("bearer ")) {
    const provided = header.slice(7).trim();
    return provided === token;
  }
  if (lower.startsWith("basic ")) {
    const creds = decodeBasic(header);
    if (creds && creds.user === "admin" && creds.pass === token) return true;
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

function decodeBasic(header) {
  try {
    const encoded = header.slice(6).trim();
    const decoded = atob(encoded);
    const idx = decoded.indexOf(":");
    if (idx === -1) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}
