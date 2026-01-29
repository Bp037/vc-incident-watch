import { listSubscriptions, shouldNotifyForCategory, removeSubscriptionByEndpoint } from "../push/_shared.js";
import { sendPushNotification } from "../push/web-push.js";

const VCFD_URL = "https://firefeeds.venturacounty.gov/api/incidents";
const VCFD_LATEST_KEY = "vcfd:latest";
const VCFD_UPDATED_KEY = "vcfd:lastUpdated";
const SENT_PREFIX = "sent:";

export function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

export async function fetchVcfdIncidents() {
  const res = await fetch(VCFD_URL, { cf: { cacheTtl: 30, cacheEverything: true } });
  if (!res.ok) throw new Error(`VCFD fetch failed: ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : (data?.incidents || []);
  return list.map(normalizeVcfdIncident).filter((i) => i.id);
}

export function normalizeVcfdIncident(raw) {
  const incidentNumber = raw?.incidentNumber || raw?.IncidentNumber || raw?.IncidentID || raw?.id || "";
  const responseDate = raw?.responseDate || raw?.ResponseDate || raw?.date || raw?.Date || "";
  const block = raw?.block ? String(raw.block).trim() : "";
  const address = raw?.address ? String(raw.address).trim() : "";
  const city = raw?.city ? String(raw.city).trim() : "";
  const fullAddress = [block, address].filter(Boolean).join(" ").trim();
  const fullWithCity = [fullAddress, city].filter(Boolean).join(", ").trim();

  const incidentType = raw?.incidentType || raw?.IncidentType || "";
  const status = raw?.status || raw?.Status || "";
  const units = raw?.units || raw?.Units || "";
  const latitude = raw?.latitude ?? raw?.Latitude ?? null;
  const longitude = raw?.longitude ?? raw?.Longitude ?? null;

  const id = incidentNumber || `${responseDate}|${fullWithCity}|${incidentType}`;

  return {
    id,
    incidentNumber,
    responseDate,
    incidentType,
    status,
    units,
    address: fullAddress,
    city,
    fullAddress: fullWithCity,
    latitude: latitude != null ? Number(latitude) : null,
    longitude: longitude != null ? Number(longitude) : null,
  };
}

export function classifyIncident(incident) {
  const type = String(incident?.incidentType || "").toLowerCase();
  if (type.includes("medical")) return "MEDICAL";
  if (type.includes("traffic") || type.includes("collision") || type.startsWith("tc") || type.includes("t/c")) {
    return "TRAFFIC_COLLISION";
  }
  if (type.includes("haz") || type.includes("hazmat") || type.includes("hazard")) return "HAZMAT";
  return "FIRE";
}

export function buildPushPayload(incident, category) {
  const label = category === "MEDICAL"
    ? "Medical Call"
    : category === "TRAFFIC_COLLISION"
      ? "Traffic Collision"
      : category === "HAZMAT"
        ? "Hazardous Materials"
        : "Fire Call";

  const address = incident?.fullAddress || incident?.address || "Ventura County";
  const type = incident?.incidentType || "Incident";
  const when = incident?.responseDate || "";

  return {
    title: label,
    body: when ? `${type} • ${address} • ${when}` : `${type} • ${address}`,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: incident?.id,
    data: { url: address ? googleMapsLinkFromAddress(address) : "/" },
  };
}

export async function readVcfdCache(env) {
  const kv = env.INCIDENTS_KV;
  if (!kv) return { incidents: [], lastUpdated: null };
  const incidents = (await kv.get(VCFD_LATEST_KEY, "json")) || [];
  const lastUpdated = await kv.get(VCFD_UPDATED_KEY);
  return { incidents, lastUpdated };
}

export async function refreshVcfdCache(env) {
  const kv = env.INCIDENTS_KV;
  if (!kv) throw new Error("Missing KV binding INCIDENTS_KV.");
  const incidents = await fetchVcfdIncidents();
  const lastUpdated = new Date().toISOString();
  await kv.put(VCFD_LATEST_KEY, JSON.stringify(incidents));
  await kv.put(VCFD_UPDATED_KEY, lastUpdated);
  return { incidents, lastUpdated };
}

export async function notifyNewIncidents(env, incidents) {
  const incidentsKv = env.INCIDENTS_KV;
  const subsKv = env.VCWATCH_KV;
  if (!incidentsKv) return { error: "Missing INCIDENTS_KV.", newCount: 0, notifiedCount: 0, skippedCount: 0 };
  if (!subsKv) return { error: "Missing VCWATCH_KV.", newCount: 0, notifiedCount: 0, skippedCount: 0 };

  const vapid = getVapidConfig(env);
  if (!vapid) return { error: "Missing VAPID env vars.", newCount: 0, notifiedCount: 0, skippedCount: 0 };

  const subs = await listSubscriptions(subsKv);
  if (!subs.length) return { newCount: 0, notifiedCount: 0, skippedCount: 0 };

  let newCount = 0;
  let notifiedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let removedCount = 0;

  for (const incident of incidents) {
    if (!incident?.id) continue;
    const sentKey = `${SENT_PREFIX}${incident.id}`;
    const alreadySent = await incidentsKv.get(sentKey);
    if (alreadySent) {
      skippedCount += 1;
      continue;
    }

    newCount += 1;
    const category = classifyIncident(incident);
    const payload = buildPushPayload(incident, category);
    const targets = subs.filter((sub) => shouldNotifyForCategory(category, sub.prefs || {}));

    if (!targets.length) {
      skippedCount += 1;
      await incidentsKv.put(sentKey, "1", { expirationTtl: 60 * 60 * 24 * 3 });
      continue;
    }

    for (const sub of targets) {
      try {
        const ok = await sendPushNotification(sub.subscription, payload, vapid);
        if (ok) notifiedCount += 1;
        else failedCount += 1;
      } catch (err) {
        failedCount += 1;
        if (shouldRemoveSubscription(err)) {
          await removeSubscriptionByEndpoint(subsKv, sub.endpoint);
          removedCount += 1;
        }
      }
    }

    await incidentsKv.put(sentKey, "1", { expirationTtl: 60 * 60 * 24 * 3 });
  }

  return { newCount, notifiedCount, skippedCount, failedCount, removedCount };
}

function getVapidConfig(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  };
}

function shouldRemoveSubscription(err) {
  const msg = String(err?.message || err);
  return msg.includes("410") || msg.includes("404");
}

function googleMapsLinkFromAddress(addr) {
  const q = encodeURIComponent(addr || "");
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}
