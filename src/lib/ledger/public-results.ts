export type LedgerPublicResultCode =
  | "opening_balance_posted"
  | "opening_balance_already_posted"
  | "opening_wallet_not_found"
  | "opening_wallet_version_conflict"
  | "opening_wallet_not_active"
  | "opening_profile_not_active"
  | "opening_asset_not_found"
  | "opening_asset_version_conflict"
  | "opening_asset_not_active"
  | "opening_ledger_activity_exists"
  | "opening_reversal_posted"
  | "opening_reversal_noop"
  | "opening_journal_not_found"
  | "opening_journal_invalid"
  | "opening_journal_not_reversible"
  | "opening_reversal_insufficient_available"
  | "financial_command_conflict"
  | "financial_command_forbidden"
  | "financial_command_unavailable"
  | "financial_audit_unavailable"
  | "invalid_input";

const LEDGER_PUBLIC_MESSAGES: Record<LedgerPublicResultCode, string> = {
  opening_balance_posted: "Opening Balance가 기록되었습니다.",
  opening_balance_already_posted:
    "해당 지갑과 자산에는 이미 Opening Balance가 있습니다.",
  opening_wallet_not_found: "지갑 계정을 찾을 수 없습니다.",
  opening_wallet_version_conflict:
    "지갑 계정 버전이 더 이상 최신이 아닙니다.",
  opening_wallet_not_active: "ACTIVE 상태의 지갑 계정만 처리할 수 있습니다.",
  opening_profile_not_active: "대상 프로필이 ACTIVE 상태여야 합니다.",
  opening_asset_not_found: "지원 자산을 찾을 수 없습니다.",
  opening_asset_version_conflict:
    "지원 자산 버전이 더 이상 최신이 아닙니다.",
  opening_asset_not_active: "ACTIVE 상태의 지원 자산만 처리할 수 있습니다.",
  opening_ledger_activity_exists:
    "기존 원장 Entry가 있어 Opening Balance를 설정할 수 없습니다.",
  opening_reversal_posted: "Opening Balance 역분개가 기록되었습니다.",
  opening_reversal_noop:
    "해당 Opening Journal은 이미 역분개되어 추가 원장 변경 없이 기록했습니다.",
  opening_journal_not_found: "Opening Journal을 찾을 수 없습니다.",
  opening_journal_invalid: "Opening Journal 구조가 유효하지 않습니다.",
  opening_journal_not_reversible:
    "해당 Journal은 Opening Balance 역분개 대상이 아닙니다.",
  opening_reversal_insufficient_available:
    "사용 가능한 잔액이 원본 Opening 금액보다 작아 역분개할 수 없습니다.",
  financial_command_conflict: "Command ID가 다른 요청에 이미 사용되었습니다.",
  financial_command_forbidden: "AAL2 관리자 권한이 필요합니다.",
  financial_command_unavailable: "금융 명령을 사용할 수 없습니다.",
  financial_audit_unavailable: "금융 감사 조회를 사용할 수 없습니다.",
  invalid_input: "입력값을 확인해 주세요.",
};

export function getLedgerPublicMessage(
  code: string | null | undefined,
): string | null {
  return code && isLedgerPublicResultCode(code)
    ? LEDGER_PUBLIC_MESSAGES[code]
    : null;
}

export function isLedgerPublicResultCode(
  code: string,
): code is LedgerPublicResultCode {
  return Object.hasOwn(LEDGER_PUBLIC_MESSAGES, code);
}
