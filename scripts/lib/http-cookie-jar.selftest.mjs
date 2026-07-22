import {
  createCookieJar,
  getSetCookieHeaders,
  splitCombinedSetCookieHeader,
} from "./http-cookie-jar.mjs";

function main() {
  assertSeparateSetCookieArray();
  assertCombinedSetCookieHeader();
  assertExpiresComma();
  assertDeletionCookie();
  assertChunkCookies();
  assertHostSeparation();
  assertPathMatching();
  assertSecureMatching();

  console.log("HTTP_COOKIE_JAR_PASS");
}

function assertSeparateSetCookieArray() {
  const headers = {
    getSetCookie() {
      return [
        "separate_a=one; Path=/",
        "separate_b=two; Path=/",
        "separate_c=three; Path=/",
      ];
    },
  };
  const jar = createCookieJar();

  jar.applyResponseCookies({
    requestUrl: "http://localhost/auth/confirm",
    headers,
  });

  assert(jar.getCookieNames("http://localhost/account").length === 3);
}

function assertCombinedSetCookieHeader() {
  const split = splitCombinedSetCookieHeader(
    "combined_a=one; Path=/, combined_b=two; Path=/",
  );

  assert(split.length === 2);

  const jar = createCookieJar();

  jar.applyResponseCookies({
    requestUrl: "http://localhost/auth/confirm",
    headers: new Headers({
      "set-cookie": "combined_a=one; Path=/, combined_b=two; Path=/",
    }),
  });

  assert(jar.getCookieNames("http://localhost/account").length === 2);
}

function assertExpiresComma() {
  const split = getSetCookieHeaders(
    new Headers({
      "set-cookie":
        "expires_a=one; Path=/; Expires=Tue, 19 Jan 2038 03:14:07 GMT, expires_b=two; Path=/",
    }),
  );

  assert(split.length === 2);
}

function assertDeletionCookie() {
  const jar = createCookieJar();

  jar.applyResponseCookies({
    requestUrl: "http://localhost/auth/confirm",
    headers: new Headers({
      "set-cookie": "delete_me=one; Path=/, keep_me=two; Path=/",
    }),
  });
  jar.applyResponseCookies({
    requestUrl: "http://localhost/auth/confirm",
    headers: new Headers({
      "set-cookie":
        "delete_me=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0",
    }),
  });

  const names = jar.getCookieNames("http://localhost/account");

  assert(!names.includes("delete_me"));
  assert(names.includes("keep_me"));
}

function assertChunkCookies() {
  const jar = createCookieJar();

  jar.applyResponseCookies({
    requestUrl: "http://localhost/auth/confirm",
    headers: new Headers({
      "set-cookie":
        "sb-test-auth-token=base; Path=/, sb-test-auth-token.0=chunk0; Path=/, sb-test-auth-token.1=chunk1; Path=/",
    }),
  });

  const names = jar.getCookieNames("http://localhost/account");

  assert(names.includes("sb-test-auth-token"));
  assert(names.includes("sb-test-auth-token.0"));
  assert(names.includes("sb-test-auth-token.1"));
  assert(jar.hasSessionCookie("http://localhost/account"));
}

function assertHostSeparation() {
  const jar = createCookieJar();

  jar.applyResponseCookies({
    requestUrl: "http://localhost/auth/confirm",
    headers: new Headers({ "set-cookie": "host_only=one; Path=/" }),
  });

  assert(jar.getCookieNames("http://localhost/account").includes("host_only"));
  assert(!jar.getCookieNames("http://127.0.0.1/account").includes("host_only"));
}

function assertPathMatching() {
  const jar = createCookieJar();

  jar.applyResponseCookies({
    requestUrl: "http://localhost/auth/confirm",
    headers: new Headers({ "set-cookie": "path_only=one; Path=/auth" }),
  });

  assert(
    jar.getCookieNames("http://localhost/auth/confirm").includes("path_only"),
  );
  assert(!jar.getCookieNames("http://localhost/account").includes("path_only"));
}

function assertSecureMatching() {
  const jar = createCookieJar();

  jar.applyResponseCookies({
    requestUrl: "https://localhost/auth/confirm",
    headers: new Headers({ "set-cookie": "secure_only=one; Path=/; Secure" }),
  });

  assert(!jar.getCookieNames("http://localhost/account").includes("secure_only"));
  assert(
    jar.getCookieNames("https://localhost/account").includes("secure_only"),
  );
}

function assert(condition) {
  if (!condition) {
    throw new Error("HTTP_COOKIE_JAR_SELFTEST_FAIL");
  }
}

main();
