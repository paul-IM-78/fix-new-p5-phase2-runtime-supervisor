import "server-only";

export const P6_T05_SEMANTIC_CASE_IDS = [
  "P6T05-SEM-001", "P6T05-SEM-002", "P6T05-SEM-003", "P6T05-SEM-004",
  "P6T05-SEM-005", "P6T05-SEM-006", "P6T05-SEM-007", "P6T05-SEM-008",
  "P6T05-SEM-009", "P6T05-SEM-010", "P6T05-SEM-011", "P6T05-SEM-012",
  "P6T05-SEM-013", "P6T05-SEM-014", "P6T05-SEM-015", "P6T05-SEM-016",
  "P6T05-SEM-017", "P6T05-SEM-018", "P6T05-SEM-019", "P6T05-SEM-020",
  "P6T05-SEM-021", "P6T05-SEM-022", "P6T05-SEM-023", "P6T05-SEM-024",
  "P6T05-SEM-025", "P6T05-SEM-026", "P6T05-SEM-027", "P6T05-SEM-028",
  "P6T05-SEM-029", "P6T05-SEM-030", "P6T05-SEM-031", "P6T05-SEM-032",
  "P6T05-SEM-033", "P6T05-SEM-034", "P6T05-SEM-035", "P6T05-SEM-036",
  "P6T05-SEM-037", "P6T05-SEM-038", "P6T05-SEM-039", "P6T05-SEM-040",
  "P6T05-SEM-041", "P6T05-SEM-042", "P6T05-SEM-043", "P6T05-SEM-044",
  "P6T05-SEM-045", "P6T05-SEM-046", "P6T05-SEM-047", "P6T05-SEM-048",
  "P6T05-SEM-049", "P6T05-SEM-050", "P6T05-SEM-051", "P6T05-SEM-052",
  "P6T05-SEM-053", "P6T05-SEM-054", "P6T05-SEM-055", "P6T05-SEM-056",
  "P6T05-SEM-057", "P6T05-SEM-058", "P6T05-SEM-059", "P6T05-SEM-060",
  "P6T05-SEM-061", "P6T05-SEM-062", "P6T05-SEM-063", "P6T05-SEM-064",
] as const;

export function assertP6T05SemanticCaseCatalog(): void {
  if (P6_T05_SEMANTIC_CASE_IDS.length !== 64) {
    throw new Error("p6_t05_case_count_invalid");
  }

  const unique = new Set(P6_T05_SEMANTIC_CASE_IDS);

  if (unique.size !== P6_T05_SEMANTIC_CASE_IDS.length) {
    throw new Error("p6_t05_case_ids_duplicate");
  }

  for (const [index, caseId] of P6_T05_SEMANTIC_CASE_IDS.entries()) {
    const expected = `P6T05-SEM-${String(index + 1).padStart(3, "0")}`;

    if (caseId !== expected) {
      throw new Error("p6_t05_case_id_sequence_invalid");
    }
  }
}
