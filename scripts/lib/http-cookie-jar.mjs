const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function getSetCookieHeaders(headers) {
  if (!headers) {
    return [];
  }

  if (typeof headers.getSetCookie === "function") {
    return splitSetCookieValues(headers.getSetCookie());
  }

  if (typeof headers.raw === "function") {
    const rawSetCookies = headers.raw()["set-cookie"];

    if (Array.isArray(rawSetCookies)) {
      return splitSetCookieValues(rawSetCookies);
    }
  }

  const header = headers.get?.("set-cookie");

  return typeof header === "string"
    ? splitCombinedSetCookieHeader(header)
    : [];
}

function splitSetCookieValues(values) {
  return values.flatMap((value) =>
    value ? splitCombinedSetCookieHeader(value) : [],
  );
}

export function splitCombinedSetCookieHeader(value) {
  const headers = [];
  let start = 0;
  let inExpiresAttribute = false;
  let inQuotedValue = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === '"') {
      inQuotedValue = !inQuotedValue;
      continue;
    }

    if (inQuotedValue) {
      continue;
    }

    if (char === ";") {
      inExpiresAttribute = false;
      continue;
    }

    if (
      !inExpiresAttribute &&
      value
        .slice(Math.max(start, index - 8), index + 1)
        .toLowerCase()
        .endsWith("expires=")
    ) {
      inExpiresAttribute = true;
      continue;
    }

    if (
      char === "," &&
      startsCookiePair(value, index + 1)
    ) {
      const header = value.slice(start, index).trim();

      if (header) {
        headers.push(header);
      }

      start = index + 1;
    }
  }

  const tail = value.slice(start).trim();

  if (tail) {
    headers.push(tail);
  }

  return headers;
}

export function createCookieJar() {
  const cookies = new Map();
  let sequence = 0;

  return {
    applyResponseCookies({ requestUrl, headers }) {
      const url = toUrl(requestUrl);

      for (const header of getSetCookieHeaders(headers)) {
        const parsed = parseSetCookieHeader(header, url);

        if (!parsed) {
          continue;
        }

        const key = getCookieKey(parsed);

        if (parsed.deleteCookie) {
          cookies.delete(key);
          continue;
        }

        cookies.set(key, {
          ...parsed,
          sequence: sequence++,
        });
      }
    },

    getCookieHeader(requestUrl) {
      return selectCookies(cookies, toUrl(requestUrl))
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");
    },

    getCookieNames(requestUrl) {
      const selected = requestUrl
        ? selectCookies(cookies, toUrl(requestUrl))
        : [...cookies.values()].filter((cookie) => !isExpired(cookie));

      return selected.map((cookie) => cookie.name);
    },

    hasSessionCookie(requestUrl) {
      return this.getCookieNames(requestUrl).some(
        (name) =>
          name.startsWith("sb-") &&
          name.includes("-auth-token") &&
          !name.includes("code-verifier"),
      );
    },

    getHeader(requestUrl) {
      return this.getCookieHeader(requestUrl);
    },

    store(response, requestUrl) {
      this.applyResponseCookies({
        requestUrl: requestUrl ?? response.url,
        headers: response.headers,
      });
    },
  };
}

function parseSetCookieHeader(header, requestUrl) {
  const [pair, ...attributes] = header.split(";");
  const separatorIndex = pair.indexOf("=");

  if (separatorIndex <= 0) {
    return null;
  }

  const name = pair.slice(0, separatorIndex).trim();

  if (!COOKIE_NAME_PATTERN.test(name)) {
    return null;
  }

  const value = pair.slice(separatorIndex + 1).trim();
  const attributeMap = parseAttributes(attributes);
  const domainAttribute = attributeMap.get("domain");
  const domain = domainAttribute
    ? normalizeDomain(domainAttribute)
    : requestUrl.hostname.toLowerCase();
  const hostOnly = !domainAttribute;

  if (!domain || !domainMatches(requestUrl.hostname, domain, hostOnly)) {
    return null;
  }

  const path = attributeMap.get("path") ?? getDefaultPath(requestUrl);
  const secure = attributeMap.has("secure");
  const maxAge = parseMaxAge(attributeMap.get("max-age"));
  const expires = parseExpires(attributeMap.get("expires"));
  const now = Date.now();
  const expiresAt = Number.isFinite(maxAge)
    ? now + maxAge * 1000
    : expires;
  const deleteCookie =
    (Number.isFinite(maxAge) && maxAge <= 0) ||
    (Number.isFinite(expiresAt) && expiresAt <= now);

  return {
    name,
    value,
    domain,
    hostOnly,
    path,
    secure,
    expiresAt,
    deleteCookie,
  };
}

function parseAttributes(attributes) {
  const parsed = new Map();

  for (const attribute of attributes) {
    const trimmed = attribute.trim();

    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = (
      separatorIndex >= 0 ? trimmed.slice(0, separatorIndex) : trimmed
    )
      .trim()
      .toLowerCase();
    const value =
      separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1).trim() : "";

    parsed.set(key, value);
  }

  return parsed;
}

function startsCookiePair(value, startIndex) {
  let index = startIndex;

  while (index < value.length && /\s/.test(value[index])) {
    index += 1;
  }

  const nameStart = index;

  while (index < value.length && value[index] !== "=") {
    if (value[index] === ";" || value[index] === ",") {
      return false;
    }

    index += 1;
  }

  if (index === nameStart || value[index] !== "=") {
    return false;
  }

  return COOKIE_NAME_PATTERN.test(value.slice(nameStart, index));
}

function normalizeDomain(domain) {
  return domain.trim().replace(/^\./, "").toLowerCase();
}

function domainMatches(hostname, domain, hostOnly) {
  const host = hostname.toLowerCase();

  if (hostOnly) {
    return host === domain;
  }

  return host === domain || host.endsWith(`.${domain}`);
}

function pathMatches(requestPath, cookiePath) {
  if (requestPath === cookiePath) {
    return true;
  }

  if (!requestPath.startsWith(cookiePath)) {
    return false;
  }

  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

function getDefaultPath(requestUrl) {
  const path = requestUrl.pathname;

  if (!path || !path.startsWith("/")) {
    return "/";
  }

  const lastSlash = path.lastIndexOf("/");

  return lastSlash <= 0 ? "/" : path.slice(0, lastSlash);
}

function parseMaxAge(value) {
  if (value === undefined) {
    return Number.NaN;
  }

  const maxAge = Number(value);

  return Number.isFinite(maxAge) ? maxAge : Number.NaN;
}

function parseExpires(value) {
  if (!value) {
    return Number.NaN;
  }

  const expires = Date.parse(value);

  return Number.isFinite(expires) ? expires : Number.NaN;
}

function selectCookies(cookies, requestUrl) {
  const now = Date.now();
  const selected = [];

  for (const [key, cookie] of cookies) {
    if (isExpired(cookie, now)) {
      cookies.delete(key);
      continue;
    }

    if (
      domainMatches(requestUrl.hostname, cookie.domain, cookie.hostOnly) &&
      pathMatches(requestUrl.pathname, cookie.path) &&
      (!cookie.secure || requestUrl.protocol === "https:")
    ) {
      selected.push(cookie);
    }
  }

  return selected.sort(
    (left, right) =>
      right.path.length - left.path.length || left.sequence - right.sequence,
  );
}

function isExpired(cookie, now = Date.now()) {
  return Number.isFinite(cookie.expiresAt) && cookie.expiresAt <= now;
}

function getCookieKey(cookie) {
  return `${cookie.domain}\t${cookie.path}\t${cookie.name}`;
}

function toUrl(value) {
  return value instanceof URL ? value : new URL(value);
}
