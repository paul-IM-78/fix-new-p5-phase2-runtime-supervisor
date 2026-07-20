export type WalletPublicResultCode =
  | "wallet_status_changed"
  | "wallet_status_noop"
  | "wallet_account_not_found"
  | "wallet_account_version_conflict"
  | "wallet_account_transition_invalid"
  | "wallet_target_profile_inactive"
  | "wallet_command_replayed"
  | "wallet_command_conflict"
  | "wallet_command_forbidden"
  | "wallet_command_unavailable"
  | "wallet_audit_unavailable"
  | "invalid_input";

const WALLET_PUBLIC_MESSAGES: Record<WalletPublicResultCode, string> = {
  wallet_status_changed: "Wallet account status changed.",
  wallet_status_noop: "Wallet account was already in that status.",
  wallet_account_not_found: "Wallet account was not found.",
  wallet_account_version_conflict:
    "Wallet account version is no longer current.",
  wallet_account_transition_invalid:
    "Wallet account status transition is not allowed.",
  wallet_target_profile_inactive:
    "Target profile must be ACTIVE before reactivating a wallet.",
  wallet_command_replayed: "Wallet command replayed without duplicate changes.",
  wallet_command_conflict: "Command ID has already been used differently.",
  wallet_command_forbidden: "Administrator authorization is required.",
  wallet_command_unavailable: "Wallet command is unavailable.",
  wallet_audit_unavailable: "Wallet audit is unavailable.",
  invalid_input: "Check the submitted values.",
};

export function getWalletPublicMessage(
  code: string | null | undefined,
): string | null {
  return code && isWalletPublicResultCode(code)
    ? WALLET_PUBLIC_MESSAGES[code]
    : null;
}

export function isWalletPublicResultCode(
  code: string,
): code is WalletPublicResultCode {
  return Object.hasOwn(WALLET_PUBLIC_MESSAGES, code);
}
