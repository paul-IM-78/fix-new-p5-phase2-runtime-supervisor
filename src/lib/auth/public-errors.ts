export type PublicAuthErrorCode =
  | "invalid_input"
  | "password_policy"
  | "password_mismatch"
  | "invalid_credentials"
  | "email_not_confirmed"
  | "signup_unavailable"
  | "confirmation_invalid"
  | "confirmation_expired"
  | "password_reset_sent"
  | "recovery_invalid"
  | "recovery_expired"
  | "password_update_failed"
  | "password_updated"
  | "account_restricted"
  | "account_unavailable"
  | "admin_forbidden"
  | "mfa_enrollment_required"
  | "mfa_challenge_required"
  | "mfa_invalid_code"
  | "mfa_factor_invalid"
  | "mfa_state_invalid"
  | "mfa_unavailable"
  | "mfa_already_enrolled"
  | "mfa_enrollment_failed"
  | "request_rejected"
  | "auth_unavailable";

const PUBLIC_AUTH_ERROR_MESSAGES: Record<PublicAuthErrorCode, string> = {
  invalid_input: "입력값을 확인해 주세요.",
  password_policy:
    "비밀번호는 12자 이상 128자 이하로 입력해 주세요.",
  password_mismatch: "비밀번호 확인이 일치하지 않습니다.",
  invalid_credentials: "이메일 또는 비밀번호를 확인해 주세요.",
  email_not_confirmed:
    "이메일 확인을 완료한 뒤 로그인해 주세요.",
  signup_unavailable:
    "지금은 회원가입 요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  confirmation_invalid: "이메일 확인 링크가 유효하지 않습니다.",
  confirmation_expired:
    "이메일 확인 링크가 만료되었습니다. 다시 가입을 시도해 주세요.",
  password_reset_sent:
    "계정이 존재하고 재설정이 가능한 경우 안내 이메일이 발송됩니다.",
  recovery_invalid: "비밀번호 재설정 링크가 유효하지 않습니다.",
  recovery_expired:
    "비밀번호 재설정 링크가 만료되었습니다. 다시 요청해 주세요.",
  password_update_failed:
    "비밀번호를 변경할 수 없습니다. 재설정 절차를 다시 진행해 주세요.",
  password_updated:
    "비밀번호가 변경되었습니다. 다시 로그인해 주세요.",
  account_restricted:
    "현재 계정은 보호 기능을 사용할 수 없습니다.",
  account_unavailable: "계정 상태를 확인할 수 없습니다.",
  admin_forbidden: "관리자 접근 권한을 확인할 수 없습니다.",
  mfa_enrollment_required:
    "관리자 접근을 위해 인증 앱 등록이 필요합니다.",
  mfa_challenge_required:
    "관리자 접근을 위해 추가 인증이 필요합니다.",
  mfa_invalid_code: "인증 코드를 확인해 주세요.",
  mfa_factor_invalid: "인증 수단을 확인할 수 없습니다.",
  mfa_state_invalid:
    "추가 인증 상태를 확인할 수 없습니다. 다시 로그인해 주세요.",
  mfa_unavailable:
    "추가 인증을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  mfa_already_enrolled: "이미 등록된 인증 앱이 있습니다.",
  mfa_enrollment_failed:
    "인증 앱 등록을 시작할 수 없습니다. 다시 시도해 주세요.",
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

export function mapSupabaseRecoveryErrorCode(
  error: unknown,
): PublicAuthErrorCode {
  const code = getSupabaseAuthErrorCode(error);

  switch (code) {
    case "otp_expired":
    case "otp_disabled":
      return "recovery_expired";
    default:
      return "recovery_invalid";
  }
}

export function mapSupabasePasswordUpdateErrorCode(
  error: unknown,
): PublicAuthErrorCode {
  const code = getSupabaseAuthErrorCode(error);

  switch (code) {
    case "weak_password":
      return "password_policy";
    default:
      return "password_update_failed";
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
