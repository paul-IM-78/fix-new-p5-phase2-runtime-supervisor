const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LOCAL_PORTS = new Set(["3000", "3010", "55721", "55722", "55723", "55724"]);
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

export async function localFetch(input, init = {}) {
  const url = normalizeLocalUrl(input);
  const headers = new Headers(init.headers ?? {});

  if (!headers.has("connection")) {
    headers.set("connection", "close");
  }

  return fetch(url, {
    ...init,
    headers,
    redirect: init.redirect ?? "manual",
  });
}

export async function readLocalHttpStatus(
  input,
  { timeoutMs = 2000, readBody = false, label = "local http" } = {},
) {
  try {
    const response = await localFetch(input, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body = "";

    if (readBody) {
      body = await response.text();
      assertOutputSafe(body, `${label} body`);
    }

    return {
      ok: true,
      status: response.status,
      body,
      errorCode: "none",
      causeCode: "none",
      timedOut: false,
    };
  } catch (error) {
    const cause = readSafeTransportCause(error);

    return {
      ok: false,
      status: 0,
      body: "",
      ...cause,
    };
  }
}

export function assertOutputSafe(output, label) {
  assert(!EMAIL_PATTERN.test(output), `${label} no email`);
  assert(!JWT_PATTERN.test(output), `${label} no jwt`);

  for (const marker of [
    "access_token",
    "refresh_token",
    "sb-access-token",
    "sb-refresh-token",
    "service_role",
    "SUPABASE_SERVICE_ROLE",
    "SUPABASE_SECRET_KEY",
    "DATABASE_URL=",
    "DIRECT_DATABASE_URL=",
    "BEGIN PRIVATE KEY",
    "PRIVATE_KEY=",
    "MNEMONIC=",
    "SEED_PHRASE=",
  ]) {
    assert(!output.includes(marker), `${label} no ${marker}`);
  }
}

export function redactSensitiveOutput(output) {
  return String(output)
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(UUID_PATTERN, "[REDACTED_UUID]")
    .replace(JWT_PATTERN, "[REDACTED_JWT]")
    .replace(
      /(access_token|refresh_token|sb-access-token|sb-refresh-token)\s*[:=]\s*[^,\s]+/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /(cookie|set-cookie|token|secret|key|password)\s*[:=]\s*[^,\s]+/gi,
      "$1=[REDACTED]",
    );
}

export function safeToken(value, fallback = "unknown") {
  const text = String(value ?? "");

  return /^[A-Za-z0-9_.:-]+$/.test(text) ? text : fallback;
}

export function safeLabel(value) {
  return String(value ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_ -]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

export function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeLocalUrl(input) {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );

  assert(url.protocol === "http:", "local http protocol");
  assert(LOCAL_HOSTS.has(url.hostname), "local http host");
  assert(LOCAL_PORTS.has(url.port), "local http port");
  assert(!url.username && !url.password, "local http no credentials");

  return url;
}

function readSafeTransportCause(error) {
  const cause = findTransportCause(error);
  const errorCode =
    readSafeErrorCode(error) ??
    (error instanceof Error && error.message.includes("fetch failed")
      ? "FETCH_FAILED"
      : "none");
  const causeCode = readSafeErrorCode(cause) ?? errorCode;

  return {
    errorCode,
    causeCode,
    timedOut:
      error?.name === "AbortError" ||
      errorCode === "ABORT_ERR" ||
      causeCode === "ABORT_ERR" ||
      causeCode === "UND_ERR_CONNECT_TIMEOUT" ||
      causeCode === "UND_ERR_HEADERS_TIMEOUT",
  };
}

function findTransportCause(error) {
  let current = error;
  const seen = new Set();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);

    if (readSafeErrorCode(current)) {
      return current;
    }

    current = current.cause;
  }

  return error;
}

function readSafeErrorCode(value) {
  if (!value || typeof value !== "object" || typeof value.code !== "string") {
    return null;
  }

  return safeToken(value.code, "redacted");
}

function assert(condition, label) {
  if (!condition) {
    throw new Error(`FAIL ${label}`);
  }
}
