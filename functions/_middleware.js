const ADMIN_PATHS = ["/admin.html"];

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (!ADMIN_PATHS.includes(url.pathname)) {
    return next();
  }

  if (isAuthorized(request, env)) {
    return next();
  }

  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="VC Watch Admin"',
      "Cache-Control": "no-store",
    },
  });
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
