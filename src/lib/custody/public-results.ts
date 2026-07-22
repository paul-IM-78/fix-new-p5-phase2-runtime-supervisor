export type CustodyPublicResultCode =
  | "custody_provider_created"
  | "custody_provider_updated"
  | "custody_provider_update_noop"
  | "custody_provider_status_changed"
  | "custody_provider_status_noop"
  | "custody_provider_not_found"
  | "custody_provider_version_conflict"
  | "custody_provider_not_draft"
  | "custody_provider_terms_immutable"
  | "custody_provider_transition_invalid"
  | "custody_provider_capability_required"
  | "custody_provider_code_exists"
  | "custody_binding_created"
  | "custody_binding_updated"
  | "custody_binding_update_noop"
  | "custody_binding_status_changed"
  | "custody_binding_status_noop"
  | "custody_binding_not_found"
  | "custody_binding_version_conflict"
  | "custody_binding_not_draft"
  | "custody_binding_terms_immutable"
  | "custody_binding_transition_invalid"
  | "custody_binding_provider_not_approved"
  | "custody_binding_asset_not_ready"
  | "custody_binding_key_exists"
  | "custody_binding_duplicate_active_role"
  | "custody_asset_not_found"
  | "custody_command_replayed"
  | "custody_command_conflict"
  | "custody_command_forbidden"
  | "custody_command_unavailable"
  | "custody_audit_unavailable"
  | "invalid_input";

const CUSTODY_PUBLIC_MESSAGES: Record<CustodyPublicResultCode, string> = {
  custody_provider_created: "Custody provider draft created.",
  custody_provider_updated: "Custody provider draft updated.",
  custody_provider_update_noop: "Custody provider draft was already current.",
  custody_provider_status_changed: "Custody provider status changed.",
  custody_provider_status_noop: "Custody provider was already in that status.",
  custody_provider_not_found: "Custody provider was not found.",
  custody_provider_version_conflict:
    "Custody provider version is no longer current.",
  custody_provider_not_draft:
    "Only draft providers that have never been approved can be edited.",
  custody_provider_terms_immutable:
    "Custody provider identity and capability terms are frozen.",
  custody_provider_transition_invalid:
    "Custody provider status transition is not allowed.",
  custody_provider_capability_required:
    "Approve at least one observation or provider capability first.",
  custody_provider_code_exists: "Custody provider code already exists.",
  custody_binding_created: "Custody account binding draft created.",
  custody_binding_updated: "Custody account binding draft updated.",
  custody_binding_update_noop:
    "Custody account binding draft was already current.",
  custody_binding_status_changed: "Custody account binding status changed.",
  custody_binding_status_noop:
    "Custody account binding was already in that status.",
  custody_binding_not_found: "Custody account binding was not found.",
  custody_binding_version_conflict:
    "Custody account binding version is no longer current.",
  custody_binding_not_draft:
    "Only draft bindings that have never been approved can be edited.",
  custody_binding_terms_immutable:
    "Custody account binding terms are frozen.",
  custody_binding_transition_invalid:
    "Custody account binding status transition is not allowed.",
  custody_binding_provider_not_approved:
    "Approve the custody provider before approving this binding.",
  custody_binding_asset_not_ready:
    "The selected asset must be ACTIVE on SOLANA.",
  custody_binding_key_exists:
    "Binding key already exists for this custody provider.",
  custody_binding_duplicate_active_role:
    "This provider, asset, and role already have a non-retired binding.",
  custody_asset_not_found: "Supported asset was not found.",
  custody_command_replayed: "Command replayed without duplicate changes.",
  custody_command_conflict:
    "Command ID has already been used for a different custody request.",
  custody_command_forbidden: "Administrator authorization is required.",
  custody_command_unavailable: "Custody command is unavailable.",
  custody_audit_unavailable: "Custody audit is unavailable.",
  invalid_input: "Check the submitted custody values.",
};

export function getCustodyPublicMessage(
  code: string | null | undefined,
): string | null {
  return code && isCustodyPublicResultCode(code)
    ? CUSTODY_PUBLIC_MESSAGES[code]
    : null;
}

export function isCustodyPublicResultCode(
  code: string,
): code is CustodyPublicResultCode {
  return Object.hasOwn(CUSTODY_PUBLIC_MESSAGES, code);
}
