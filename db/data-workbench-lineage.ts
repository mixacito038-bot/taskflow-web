export function freezeSnapshotLineage(input: {
  existing: unknown;
  importJobId?: string | null;
  rawSnapshotId?: string;
  layer: "raw" | "staging" | "curated" | "published";
  snapshotId: string;
  sourceRowNumber: number;
  sourceRecordId: string;
}) {
  const existing = input.existing && typeof input.existing === "object" ? input.existing as Record<string, unknown> : {};
  return {
    ...existing,
    importJobId: typeof existing.importJobId === "string" ? existing.importJobId : input.importJobId ?? null,
    rawSnapshotId: typeof existing.rawSnapshotId === "string" ? existing.rawSnapshotId : input.rawSnapshotId ?? (input.layer === "raw" ? input.snapshotId : null),
    sourceRowNumber: input.sourceRowNumber,
    sourceRecordId: input.sourceRecordId,
  };
}
