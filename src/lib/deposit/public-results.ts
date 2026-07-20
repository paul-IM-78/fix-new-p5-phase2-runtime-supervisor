export type DepositPublicResultCode =
  | "deposit_request_created"
  | "deposit_request_canceled"
  | "deposit_request_cancel_noop"
  | "deposit_request_confirmed"
  | "deposit_request_confirm_noop"
  | "deposit_command_conflict"
  | "deposit_wallet_not_found"
  | "deposit_wallet_version_conflict"
  | "deposit_wallet_not_active"
  | "deposit_asset_not_found"
  | "deposit_asset_version_conflict"
  | "deposit_asset_not_active"
  | "deposit_request_not_found"
  | "deposit_request_forbidden"
  | "deposit_request_version_conflict"
  | "deposit_request_confirmed_terminal"
  | "deposit_request_canceled_terminal"
  | "deposit_target_profile_not_active"
  | "deposit_target_wallet_not_active"
  | "deposit_target_asset_not_active"
  | "deposit_command_forbidden"
  | "deposit_command_unavailable"
  | "deposit_read_unavailable"
  | "request_rejected"
  | "invalid_input";

const DEPOSIT_PUBLIC_MESSAGES: Record<DepositPublicResultCode, string> = {
  deposit_request_created: "Deposit request created.",
  deposit_request_canceled: "Deposit request canceled.",
  deposit_request_cancel_noop:
    "Deposit request was already canceled; no ledger mutation was posted.",
  deposit_request_confirmed: "Deposit request confirmed.",
  deposit_request_confirm_noop:
    "Deposit request was already confirmed; no ledger mutation was posted.",
  deposit_command_conflict:
    "Command ID was already used for a different deposit command.",
  deposit_wallet_not_found: "Managed wallet account was not found.",
  deposit_wallet_version_conflict:
    "Managed wallet account version is no longer current.",
  deposit_wallet_not_active:
    "Deposit requests can be created only for ACTIVE wallet accounts.",
  deposit_asset_not_found: "Supported asset was not found.",
  deposit_asset_version_conflict:
    "Supported asset version is no longer current.",
  deposit_asset_not_active:
    "Deposit requests can be created only for ACTIVE supported assets.",
  deposit_request_not_found: "Deposit request was not found.",
  deposit_request_forbidden:
    "The deposit request is not available to this account.",
  deposit_request_version_conflict:
    "Deposit request version is no longer current.",
  deposit_request_confirmed_terminal:
    "Confirmed deposit requests are terminal for this command.",
  deposit_request_canceled_terminal:
    "Canceled deposit requests are terminal for this command.",
  deposit_target_profile_not_active:
    "Admin confirmation requires an ACTIVE target profile.",
  deposit_target_wallet_not_active:
    "Admin confirmation requires an ACTIVE target wallet.",
  deposit_target_asset_not_active:
    "Admin confirmation requires an ACTIVE target asset.",
  deposit_command_forbidden: "Deposit command permission is required.",
  deposit_command_unavailable: "Deposit command is unavailable.",
  deposit_read_unavailable: "Deposit records are unavailable.",
  request_rejected: "The request origin was rejected.",
  invalid_input: "Check the submitted deposit values.",
};

export function getDepositPublicMessage(
  code: string | null | undefined,
): string | null {
  return code && isDepositPublicResultCode(code)
    ? DEPOSIT_PUBLIC_MESSAGES[code]
    : null;
}

export function isDepositPublicResultCode(
  code: string,
): code is DepositPublicResultCode {
  return Object.hasOwn(DEPOSIT_PUBLIC_MESSAGES, code);
}
