export type DomainPublicResultCode =
  | "project_created"
  | "project_updated"
  | "project_update_noop"
  | "project_status_changed"
  | "project_status_noop"
  | "project_not_found"
  | "project_version_conflict"
  | "project_transition_invalid"
  | "project_activation_not_ready"
  | "active_project_conflict"
  | "project_code_exists"
  | "asset_created"
  | "asset_updated"
  | "asset_update_noop"
  | "asset_status_changed"
  | "asset_status_noop"
  | "asset_not_found"
  | "asset_version_conflict"
  | "asset_transition_invalid"
  | "asset_code_exists"
  | "asset_mint_exists"
  | "asset_native_symbol_exists"
  | "asset_in_use"
  | "asset_has_current_assignment"
  | "asset_not_ready"
  | "project_token_assigned"
  | "project_token_assign_noop"
  | "project_token_retired"
  | "project_token_retire_noop"
  | "project_already_has_token"
  | "project_token_assignment_not_allowed"
  | "assignment_not_found"
  | "assignment_version_conflict"
  | "asset_already_assigned"
  | "active_project_token_retire_forbidden"
  | "domain_command_replayed"
  | "domain_command_conflict"
  | "domain_command_forbidden"
  | "domain_command_unavailable"
  | "domain_audit_unavailable"
  | "invalid_input";

const DOMAIN_PUBLIC_MESSAGES: Record<DomainPublicResultCode, string> = {
  project_created: "Project created.",
  project_updated: "Project details updated.",
  project_update_noop: "Project details were already current.",
  project_status_changed: "Project status changed.",
  project_status_noop: "Project was already in that status.",
  project_not_found: "Project was not found.",
  project_version_conflict: "Project version is no longer current.",
  project_transition_invalid: "Project status transition is not allowed.",
  project_activation_not_ready: "Project needs one active token before activation.",
  active_project_conflict: "Another project is already active.",
  project_code_exists: "Project code already exists.",
  asset_created: "Asset created.",
  asset_updated: "Asset details updated.",
  asset_update_noop: "Asset details were already current.",
  asset_status_changed: "Asset status changed.",
  asset_status_noop: "Asset was already in that status.",
  asset_not_found: "Asset was not found.",
  asset_version_conflict: "Asset version is no longer current.",
  asset_transition_invalid: "Asset status transition is not allowed.",
  asset_code_exists: "Asset code already exists.",
  asset_mint_exists: "Asset mint already exists.",
  asset_native_symbol_exists: "Native asset symbol already exists.",
  asset_in_use: "Asset is in use by an active project.",
  asset_has_current_assignment: "Asset still has a current assignment.",
  asset_not_ready: "Asset is not ready for project-token use.",
  project_token_assigned: "Project token assigned.",
  project_token_assign_noop: "Project token was already assigned.",
  project_token_retired: "Project token assignment retired.",
  project_token_retire_noop: "Project token assignment was already retired.",
  project_already_has_token: "Project already has a current token.",
  project_token_assignment_not_allowed: "Project state does not allow token assignment.",
  assignment_not_found: "Project token assignment was not found.",
  assignment_version_conflict: "Assignment version is no longer current.",
  asset_already_assigned: "Asset is already assigned to another project.",
  active_project_token_retire_forbidden:
    "Suspend the project before retiring its current token.",
  domain_command_replayed: "Command replayed without duplicate changes.",
  domain_command_conflict: "Command ID has already been used differently.",
  domain_command_forbidden: "Administrator authorization is required.",
  domain_command_unavailable: "Domain command is unavailable.",
  domain_audit_unavailable: "Domain audit is unavailable.",
  invalid_input: "Check the submitted values.",
};

export function getDomainPublicMessage(
  code: string | null | undefined,
): string | null {
  return code && isDomainPublicResultCode(code)
    ? DOMAIN_PUBLIC_MESSAGES[code]
    : null;
}

export function isDomainPublicResultCode(
  code: string,
): code is DomainPublicResultCode {
  return Object.hasOwn(DOMAIN_PUBLIC_MESSAGES, code);
}
