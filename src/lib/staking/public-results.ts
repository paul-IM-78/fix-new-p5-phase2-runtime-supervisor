export type StakingPublicResultCode =
  | "staking_product_created"
  | "staking_product_updated"
  | "staking_product_update_noop"
  | "staking_product_status_changed"
  | "staking_product_status_noop"
  | "staking_product_not_found"
  | "staking_product_version_conflict"
  | "staking_product_transition_invalid"
  | "staking_product_not_draft"
  | "staking_product_code_exists"
  | "staking_product_duplicate_term"
  | "staking_project_not_found"
  | "staking_asset_not_found"
  | "staking_project_not_active"
  | "staking_asset_not_active"
  | "staking_asset_not_project_token"
  | "staking_enrollment_expired"
  | "staking_position_created"
  | "staking_position_replayed"
  | "staking_product_not_active"
  | "staking_enrollment_not_open"
  | "staking_position_below_minimum"
  | "staking_position_above_maximum"
  | "staking_wallet_not_found"
  | "staking_wallet_forbidden"
  | "staking_wallet_version_conflict"
  | "staking_wallet_not_active"
  | "staking_profile_not_active"
  | "staking_position_insufficient_available"
  | "staking_position_ledger_unavailable"
  | "staking_command_replayed"
  | "staking_command_conflict"
  | "staking_command_forbidden"
  | "staking_command_unavailable"
  | "staking_audit_unavailable"
  | "invalid_input";

const STAKING_PUBLIC_MESSAGES: Record<StakingPublicResultCode, string> = {
  staking_product_created: "Staking product draft created.",
  staking_product_updated: "Staking product draft updated.",
  staking_product_update_noop: "Staking product draft was already current.",
  staking_product_status_changed: "Staking product status changed.",
  staking_product_status_noop: "Staking product was already in that status.",
  staking_product_not_found: "Staking product was not found.",
  staking_product_version_conflict:
    "Staking product version is no longer current.",
  staking_product_transition_invalid:
    "Staking product status transition is not allowed.",
  staking_product_not_draft:
    "Only draft staking products can be edited.",
  staking_product_code_exists: "Staking product code already exists.",
  staking_product_duplicate_term:
    "An unarchived product already uses that project, asset, and duration.",
  staking_project_not_found: "Project was not found.",
  staking_asset_not_found: "Asset was not found.",
  staking_project_not_active: "Project must be active before activation.",
  staking_asset_not_active: "Asset must be active before activation.",
  staking_asset_not_project_token:
    "Asset must be the current active project SPL token.",
  staking_enrollment_expired:
    "Enrollment end time must still be in the future.",
  staking_position_created:
    "Staking position created and principal moved to locked units.",
  staking_position_replayed:
    "Staking position command replayed without duplicate changes.",
  staking_product_not_active:
    "Staking product is not active.",
  staking_enrollment_not_open:
    "Staking product enrollment is not open.",
  staking_position_below_minimum:
    "Principal is below the product minimum.",
  staking_position_above_maximum:
    "Principal is above the product maximum.",
  staking_wallet_not_found: "Managed wallet account was not found.",
  staking_wallet_forbidden:
    "Submitted wallet account does not belong to the current user.",
  staking_wallet_version_conflict:
    "Managed wallet version is no longer current.",
  staking_wallet_not_active:
    "Managed wallet must be active to create a staking position.",
  staking_profile_not_active:
    "Profile must be active to create a staking position.",
  staking_position_insufficient_available:
    "Available units are insufficient for this principal lock.",
  staking_position_ledger_unavailable:
    "Staking position ledger accounts are unavailable.",
  staking_command_replayed: "Command replayed without duplicate changes.",
  staking_command_conflict: "Command ID has already been used differently.",
  staking_command_forbidden: "Administrator authorization is required.",
  staking_command_unavailable: "Staking product command is unavailable.",
  staking_audit_unavailable: "Staking product audit is unavailable.",
  invalid_input: "Check the submitted values.",
};

export function getStakingPublicMessage(
  code: string | null | undefined,
): string | null {
  return code && isStakingPublicResultCode(code)
    ? STAKING_PUBLIC_MESSAGES[code]
    : null;
}

export function isStakingPublicResultCode(
  code: string,
): code is StakingPublicResultCode {
  return Object.hasOwn(STAKING_PUBLIC_MESSAGES, code);
}
