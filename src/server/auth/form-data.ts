import "server-only";

import type { PublicAuthErrorCode } from "@/lib/auth/public-errors";
import {
  getSafeAuthNextPath,
  normalizeDisplayName,
  normalizeEmail,
  validatePassword,
} from "@/lib/auth/validation";

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PublicAuthErrorCode };

export type SignUpForm = {
  email: string;
  password: string;
  displayName?: string;
};

export type SignInForm = {
  email: string;
  password: string;
  nextPath: string;
};

export type ConfirmEmailForm = {
  tokenHash: string;
  nextPath: string;
};

export function parseSignUpForm(formData: FormData): ParseResult<SignUpForm> {
  const email = normalizeEmail(formData.get("email"));
  const password = validatePassword(formData.get("password"));
  const passwordConfirm = validatePassword(formData.get("password_confirm"));
  const displayName = normalizeDisplayName(formData.get("display_name"));

  if (!email) {
    return { ok: false, error: "invalid_input" };
  }

  if (!password || !passwordConfirm) {
    return { ok: false, error: "password_policy" };
  }

  if (password !== passwordConfirm) {
    return { ok: false, error: "password_mismatch" };
  }

  if (displayName === null) {
    return { ok: false, error: "invalid_input" };
  }

  return {
    ok: true,
    value: {
      email,
      password,
      ...(displayName ? { displayName } : {}),
    },
  };
}

export function parseSignInForm(formData: FormData): ParseResult<SignInForm> {
  const email = normalizeEmail(formData.get("email"));
  const password = validatePassword(formData.get("password"));
  const nextPath = getSafeAuthNextPath(formData.get("next"));

  if (!email || !password) {
    return { ok: false, error: "invalid_credentials" };
  }

  return {
    ok: true,
    value: {
      email,
      password,
      nextPath,
    },
  };
}

export function parseConfirmEmailForm(
  formData: FormData,
): ParseResult<ConfirmEmailForm> {
  const tokenHash = formData.get("token_hash");
  const type = formData.get("type");
  const nextPath = getSafeAuthNextPath(formData.get("next"));

  if (
    typeof tokenHash !== "string" ||
    tokenHash.length < 16 ||
    tokenHash.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(tokenHash)
  ) {
    return { ok: false, error: "confirmation_invalid" };
  }

  if (type !== "email") {
    return { ok: false, error: "confirmation_invalid" };
  }

  return {
    ok: true,
    value: {
      tokenHash,
      nextPath,
    },
  };
}
