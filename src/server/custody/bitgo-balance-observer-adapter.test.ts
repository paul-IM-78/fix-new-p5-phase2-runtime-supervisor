import "server-only";

export const P6_T07_INTEGRATION_CASE_IDS = [
  "P6T07-INT-001", "P6T07-INT-002", "P6T07-INT-003", "P6T07-INT-004",
  "P6T07-INT-005", "P6T07-INT-006", "P6T07-INT-007", "P6T07-INT-008",
  "P6T07-INT-009", "P6T07-INT-010", "P6T07-INT-011", "P6T07-INT-012",
  "P6T07-INT-013", "P6T07-INT-014", "P6T07-INT-015", "P6T07-INT-016",
  "P6T07-INT-017", "P6T07-INT-018", "P6T07-INT-019", "P6T07-INT-020",
  "P6T07-INT-021", "P6T07-INT-022", "P6T07-INT-023", "P6T07-INT-024",
  "P6T07-INT-025", "P6T07-INT-026", "P6T07-INT-027", "P6T07-INT-028",
  "P6T07-INT-029", "P6T07-INT-030", "P6T07-INT-031", "P6T07-INT-032",
  "P6T07-INT-033", "P6T07-INT-034", "P6T07-INT-035", "P6T07-INT-036",
  "P6T07-INT-037", "P6T07-INT-038", "P6T07-INT-039", "P6T07-INT-040",
  "P6T07-INT-041", "P6T07-INT-042", "P6T07-INT-043", "P6T07-INT-044",
  "P6T07-INT-045", "P6T07-INT-046", "P6T07-INT-047", "P6T07-INT-048",
  "P6T07-INT-049", "P6T07-INT-050", "P6T07-INT-051", "P6T07-INT-052",
  "P6T07-INT-053", "P6T07-INT-054",
  "P6T07-INT-055", "P6T07-INT-056",
] as const;

export function assertP6T07IntegrationCaseCatalog(): void {
  if (P6_T07_INTEGRATION_CASE_IDS.length !== 56) {
    throw new Error("p6_t07_case_count_invalid");
  }

  if (new Set(P6_T07_INTEGRATION_CASE_IDS).size !== 56) {
    throw new Error("p6_t07_case_ids_duplicate");
  }

  for (const [index, caseId] of P6_T07_INTEGRATION_CASE_IDS.entries()) {
    const expected = `P6T07-INT-${String(index + 1).padStart(3, "0")}`;

    if (caseId !== expected) {
      throw new Error("p6_t07_case_ids_invalid");
    }
  }
}
