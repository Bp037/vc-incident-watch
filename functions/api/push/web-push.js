// Minimal web-push implementation (based on @mmmike/web-push MIT)
// Uses WebCrypto so it runs in Cloudflare Workers/Pages Functions.

export async function sendPushNotification(subscription, payload, vapid, options = {}) {
  const { logger, ttl = 86400 } = options;
  const url = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await createVapidJwt({
    audience,
    subject: vapid.subject,
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
    expiration: ttl,
  });

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const encryptedPayload = await encryptPayload(
    payloadBytes,
    subscription.keys.p256dh,
    subscription.keys.auth
  );

  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
    },
    body: encryptedPayload,
  });

  const responseText = await response.text();
  logger?.debug?.("Push response", {
    endpoint: subscription.endpoint.slice(0, 50),
    status: response.status,
    statusText: response.statusText,
    body: responseText.slice(0, 200),
  });

  if (response.ok) return true;
  if (response.status === 404 || response.status === 410) return false;
  if (response.status === 429) {
    throw new Error(`Push rate limit exceeded: ${response.statusText}`);
  }
  throw new Error(`Push service error: ${response.status} ${response.statusText}`);
}

async function encryptPayload(payload, p256dhKey, authSecret) {
  const localKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const clientPublicKeyBytes = urlBase64ToUint8Array(p256dhKey);
  const clientPublicKey = await crypto.subtle.importKey(
    "raw",
    clientPublicKeyBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPublicKey },
    localKeyPair.privateKey,
    256
  );

  const sharedSecret = new Uint8Array(sharedSecretBits);
  const localPublicKeyRaw = await crypto.subtle.exportKey("raw", localKeyPair.publicKey);
  const localPublicKey = new Uint8Array(localPublicKeyRaw);
  const authSecretBytes = urlBase64ToUint8Array(authSecret);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const { contentEncryptionKey, nonce } = await deriveKeyAndNonce(
    sharedSecret,
    authSecretBytes,
    clientPublicKeyBytes,
    localPublicKey,
    salt
  );

  const paddedPayload = new Uint8Array(payload.length + 1);
  paddedPayload.set(payload);
  paddedPayload[payload.length] = 2;

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    contentEncryptionKey,
    paddedPayload
  );

  const recordSize = 4096;
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize, false);
  header[20] = 65;
  header.set(localPublicKey, 21);

  const result = new Uint8Array(header.length + encrypted.byteLength);
  result.set(header);
  result.set(new Uint8Array(encrypted), header.length);
  return result;
}

async function deriveKeyAndNonce(sharedSecret, authSecret, clientPublicKey, localPublicKey, salt) {
  const encoder = new TextEncoder();
  const ikmInfo = new Uint8Array([
    ...encoder.encode("WebPush: info"),
    0,
    ...clientPublicKey,
    ...localPublicKey,
  ]);

  const sharedSecretKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    "HKDF",
    false,
    ["deriveBits"]
  );

  const ikmBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: authSecret,
      info: ikmInfo,
    },
    sharedSecretKey,
    256
  );

  const ikm = new Uint8Array(ikmBits);
  const ikmKey = await crypto.subtle.importKey(
    "raw",
    ikm,
    "HKDF",
    false,
    ["deriveBits", "deriveKey"]
  );

  const cekInfo = new Uint8Array([...encoder.encode("Content-Encoding: aes128gcm"), 0]);
  const contentEncryptionKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: cekInfo,
    },
    ikmKey,
    { name: "AES-GCM", length: 128 },
    false,
    ["encrypt"]
  );

  const nonceInfo = new Uint8Array([...encoder.encode("Content-Encoding: nonce"), 0]);
  const nonceBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: nonceInfo,
    },
    ikmKey,
    96
  );

  const nonce = new Uint8Array(nonceBits);
  return { contentEncryptionKey, nonce };
}

async function createVapidJwt(options) {
  const { audience, subject, publicKey, privateKey, expiration = 43200 } = options;
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + expiration, sub: subject };

  const encodedHeader = uint8ArrayToUrlBase64(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = uint8ArrayToUrlBase64(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const privateKeyArray = urlBase64ToUint8Array(privateKey);
  const publicKeyArray = urlBase64ToUint8Array(publicKey);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: uint8ArrayToUrlBase64(publicKeyArray.slice(1, 33)),
    y: uint8ArrayToUrlBase64(publicKeyArray.slice(33)),
    d: uint8ArrayToUrlBase64(privateKeyArray),
  };

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signatureArray = new Uint8Array(signature);
  const encodedSignature = uint8ArrayToUrlBase64(signatureArray);
  return `${unsignedToken}.${encodedSignature}`;
}

function urlBase64ToUint8Array(base64String) {
  if (!base64String) return new Uint8Array(0);
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function uint8ArrayToUrlBase64(array) {
  const base64 = btoa(String.fromCharCode(...array));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
