export type WithdrawalPublicResultCode =
  | "withdrawal_request_created"
  | "withdrawal_request_canceled"
  | "withdrawal_request_cancel_noop"
  | "withdrawal_request_reserved"
  | "withdrawal_request_reserve_noop"
  | "withdrawal_request_approved"
  | "withdrawal_request_approve_noop"
  | "withdrawal_command_conflict"
  | "withdrawal_wallet_not_found"
  | "withdrawal_wallet_version_conflict"
  | "withdrawal_wallet_not_active"
  | "withdrawal_asset_not_found"
  | "withdrawal_asset_version_conflict"
  | "withdrawal_asset_not_active"
  | "withdrawal_insufficient_available"
  | "withdrawal_request_already_open"
  | "withdrawal_request_not_found"
  | "withdrawal_request_forbidden"
  | "withdrawal_request_version_conflict"
  | "withdrawal_request_not_user_cancelable"
  | "withdrawal_request_not_reservable"
  | "withdrawal_request_not_approvable"
  | "withdrawal_request_not_cancelable"
  | "withdrawal_target_profile_not_active"
  | "withdrawal_target_wallet_not_active"
  | "withdrawal_target_asset_not_active"
  | "withdrawal_command_forbidden"
  | "withdrawal_command_unavailable"
  | "withdrawal_read_unavailable"
  | "request_rejected"
  | "invalid_input";

const WITHDRAWAL_PUBLIC_MESSAGES: Record<
  WithdrawalPublicResultCode,
  string
> = {
  withdrawal_request_created: "Withdrawal request created.",
  withdrawal_request_canceled: "Withdrawal request canceled.",
  withdrawal_request_cancel_noop:
    "Withdrawal request was already canceled; no ledger mutation was posted.",
  withdrawal_request_reserved: "Withdrawal request reserved.",
  withdrawal_request_reserve_noop:
    "Withdrawal request was already reserved; no ledger mutation was posted.",
  withdrawal_request_approved: "Withdrawal request approved.",
  withdrawal_request_approve_noop:
    "Withdrawal request was already approved; no ledger mutation was posted.",
  withdrawal_command_conflict:
    "Command ID was already used for a different withdrawal command.",
  withdrawal_wallet_not_found: "Managed wallet account was not found.",
  withdrawal_wallet_version_conflict:
    "Managed wallet account version is no longer current.",
  withdrawal_wallet_not_active:
    "Withdrawal requests can be created only for ACTIVE wallet accounts.",
  withdrawal_asset_not_found: "Supported asset was not found.",
  withdrawal_asset_version_conflict:
    "Supported asset version is no longer current.",
  withdrawal_asset_not_active:
    "Withdrawal requests can be created only for ACTIVE supported assets.",
  withdrawal_insufficient_available:
    "Available Atomic Units are lower than the requested withdrawal units.",
  withdrawal_request_already_open:
    "This wallet and asset already have an open withdrawal request.",
  withdrawal_request_not_found: "Withdrawal request was not found.",
  withdrawal_request_forbidden:
    "The withdrawal request is not available to this account.",
  withdrawal_request_version_conflict:
    "Withdrawal request version is no longer current.",
  withdrawal_request_not_user_cancelable:
    "Only REQUESTED withdrawals can be canceled by the user.",
  withdrawal_request_not_reservable:
    "Only REQUESTED withdrawals can be reserved.",
  withdrawal_request_not_approvable:
    "Only RESERVED withdrawals can be approved.",
  withdrawal_request_not_cancelable:
    "The withdrawal request cannot be canceled in its current state.",
  withdrawal_target_profile_not_active:
    "Admin reserve and approval require an ACTIVE target profile.",
  withdrawal_target_wallet_not_active:
    "Admin reserve and approval require an ACTIVE target wallet.",
  withdrawal_target_asset_not_active:
    "Admin reserve and approval require an ACTIVE target asset.",
  withdrawal_command_forbidden: "Withdrawal command permission is required.",
  withdrawal_command_unavailable: "Withdrawal command is unavailable.",
  withdrawal_read_unavailable: "Withdrawal records are unavailable.",
  request_rejected: "The request origin was rejected.",
  invalid_input: "Check the submitted withdrawal values.",
};

export function getWithdrawalPublicMessage(
  code: string | null | undefined,
): string | null {
  return code && isWithdrawalPublicResultCode(code)
    ? WITHDRAWAL_PUBLIC_MESSAGES[code]
    : null;
}

export function isWithdrawalPublicResultCode(
  code: string,
): code is WithdrawalPublicResultCode {
  return Object.hasOwn(WITHDRAWAL_PUBLIC_MESSAGES, code);
}
