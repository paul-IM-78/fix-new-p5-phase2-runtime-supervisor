export type PublicAuthErrorCode =
  | "invalid_input"
  | "password_policy"
  | "password_mismatch"
  | "invalid_credentials"
  | "email_not_confirmed"
  | "signup_unavailable"
  | "confirmation_invalid"
  | "confirmation_expired"
  | "account_restricted"
  | "account_unavailable"
  | "request_rejected"
  | "auth_unavailable";

const PUBLIC_AUTH_ERROR_MESSAGES: Record<PublicAuthErrorCode, string> = {
  invalid_input: "입력값을 확인해 주세요.",
  password_policy: "비밀번호는 12자 이상 128자 이하로 입력해 주세요.",
  password_mismatch: "비밀번호 확인이 일치하지 않습니다.",
  invalid_credentials: "이메일 또는 비밀번호를 확인해 주세요.",
  email_not_confirmed: "이메일 확인을 완료한 뒤 로그인해 주세요.",
  signup_unavailable:
    "지금은 회원가입 요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  confirmation_invalid: "이메일 확인 링크가 유효하지 않습니다.",
  confirmation_expired: "이메일 확인 링크가 만료되었습니다. 다시 가입을 시도해 주세요.",
  account_restricted: "현재 계정은 사용할 수 없습니다.",
  account_unavailable: "계정 상태를 확인할 수 없습니다.",
  request_rejected: "요청을 처리할 수 없습니다.",
  auth_unavailable:
    "인증 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
};

export function getPublicAuthErrorMessage(
  code: string | null | undefined,
): string | null {
  if (!code || !isPublicAuthErrorCode(code)) {
    return null;
  }

  return PUBLIC_AUTH_ERROR_MESSAGES[code];
}

export function isPublicAuthErrorCode(
  code: string,
): code is PublicAuthErrorCode {
  return Object.hasOwn(PUBLIC_AUTH_ERROR_MESSAGES, code);
}

export function mapSupabaseAuthErrorCode(
  error: unknown,
  fallback: PublicAuthErrorCode,
): PublicAuthErrorCode {
  const code = getSupabaseAuthErrorCode(error);

  switch (code) {
    case "email_not_confirmed":
      return "email_not_confirmed";
    case "invalid_credentials":
    case "invalid_login_credentials":
      return "invalid_credentials";
    case "otp_expired":
    case "otp_disabled":
      return "confirmation_expired";
    case "weak_password":
      return "password_policy";
    default:
      return fallback;
  }
}

export function getSupabaseAuthErrorCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}
