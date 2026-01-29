import { json } from "./_shared.js";

export async function onRequestGet({ env }) {
  return json({
    ok: true,
    vapidPublicKey: env.VAPID_PUBLIC_KEY || "",
    enableTestUi: String(env.ENABLE_PUSH_TEST || "").toLowerCase() === "true",
  });
}
