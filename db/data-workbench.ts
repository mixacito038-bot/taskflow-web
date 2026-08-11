import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  dataCleaningRecipes,
  dataCleaningRules,
  dataBusinessTemplates,
  dataDatasetSnapshots,
  dataExamEventBodyParts,
  dataExamEvents,
  dataFieldDefinitions,
  dataFieldMappings,
  dataImportJobs,
  dataLineageEvents,
  dataMetricDefinitions,
  dataPipelineRecords,
  dataPublishVersions,
  dataQualityIssues,
  dataReconciliationConfigs,
  dataReconciliationDifferences,
  dataReconciliationRuns,
  dataRecordIssues,
  dataReviewEvents,
  dataSourceConnectors,
  dataVisualizationDefinitions,
  rawDatasets,
} from "./schema";

export const dataWorkbenchResources = [
  "connectors",
  "imports",
  "datasets",
  "mappings",
  "fieldDefinitions",
  "metrics",
  "visualizations",
  "examEvents",
  "recipes",
  "qualityIssues",
  "publishes",
  "lineage",
  "templates",
  "records",
  "quarantine",
  "reconciliations",
  "publishedRecords",
  "snapshots",
  "reviews",
] as const;

export type DataWorkbenchResource = (typeof dataWorkbenchResources)[number];

export function isDataWorkbenchResource(value: unknown): value is DataWorkbenchResource {
  return typeof value === "string" && (dataWorkbenchResources as readonly string[]).includes(value);
}

export type DataWorkbenchListQuery = {
  limit?: number;
  offset?: number;
  importId?: string;
  snapshotId?: string;
};

export async function listDataWorkbenchResource(
  hospitalId: string,
  resource: DataWorkbenchResource,
  query: number | DataWorkbenchListQuery = 100,
  dbOverride?: Awaited<ReturnType<typeof getDb>>,
) {
  const db = dbOverride ?? await getDb();
  const options = typeof query === "number" ? { limit: query } : query;
  const boundedLimit = Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 500));
  const boundedOffset = Math.max(0, Math.min(Math.trunc(options.offset ?? 0), 1_000_000));
  const importId = options.importId ?? "";
  const snapshotId = options.snapshotId ?? "";
  switch (resource) {
    case "connectors":
      return db.select().from(dataSourceConnectors)
        .where(eq(dataSourceConnectors.hospitalId, hospitalId))
        .orderBy(desc(dataSourceConnectors.updatedAt)).limit(boundedLimit).offset(boundedOffset);
    case "imports":
      return db.select().from(dataImportJobs)
        .where(and(eq(dataImportJobs.hospitalId, hospitalId), ...(importId ? [eq(dataImportJobs.id, importId)] : [])))
        .orderBy(desc(dataImportJobs.createdAt)).limit(boundedLimit).offset(boundedOffset);
    case "datasets":
      return db.select().from(rawDatasets)
        .where(and(eq(rawDatasets.hospitalId, hospitalId), ...(importId ? [eq(rawDatasets.importJobId, importId)] : [])))
        .orderBy(desc(rawDatasets.createdAt)).limit(boundedLimit).offset(boundedOffset);
    case "mappings":
      return db.select().from(dataFieldMappings)
        .where(eq(dataFieldMappings.hospitalId, hospitalId))
        .orderBy(desc(dataFieldMappings.updatedAt)).limit(boundedLimit).offset(boundedOffset);
    case "fieldDefinitions":
      return db.select().from(dataFieldDefinitions)
        .where(eq(dataFieldDefinitions.hospitalId, hospitalId))
        .orderBy(desc(dataFieldDefinitions.updatedAt)).limit(boundedLimit).offset(boundedOffset);
    case "metrics":
      return db.select().from(dataMetricDefinitions)
        .where(eq(dataMetricDefinitions.hospitalId, hospitalId))
        .orderBy(desc(dataMetricDefinitions.updatedAt)).limit(boundedLimit).offset(boundedOffset);
    case "visualizations":
      return db.select().from(dataVisualizationDefinitions)
        .where(eq(dataVisualizationDefinitions.hospitalId, hospitalId))
        .orderBy(desc(dataVisualizationDefinitions.updatedAt)).limit(boundedLimit).offset(boundedOffset);
    case "examEvents": {
      const events = await db.select().from(dataExamEvents)
        .where(eq(dataExamEvents.hospitalId, hospitalId))
        .orderBy(desc(dataExamEvents.occurredAt)).limit(boundedLimit).offset(boundedOffset);
      if (!events.length) return [];
      const bodyParts = await db.select().from(dataExamEventBodyParts).where(and(
        eq(dataExamEventBodyParts.hospitalId, hospitalId),
        inArray(dataExamEventBodyParts.examEventId, events.map((event) => event.id)),
      )).orderBy(dataExamEventBodyParts.sequence);
      return events.map((event) => ({ ...event, bodyParts: bodyParts.filter((part) => part.examEventId === event.id) }));
    }
    case "recipes": {
      const recipes = await db.select().from(dataCleaningRecipes)
        .where(eq(dataCleaningRecipes.hospitalId, hospitalId))
        .orderBy(desc(dataCleaningRecipes.updatedAt)).limit(boundedLimit).offset(boundedOffset);
      if (!recipes.length) return [];
      const rules = await db.select().from(dataCleaningRules).where(and(
        eq(dataCleaningRules.hospitalId, hospitalId),
        inArray(dataCleaningRules.recipeId, recipes.map((recipe) => recipe.id)),
      )).orderBy(dataCleaningRules.sequence);
      return recipes.map((recipe) => ({
        ...recipe,
        rules: rules.filter((rule) => rule.recipeId === recipe.id),
      }));
    }
    case "qualityIssues":
      return db.select().from(dataQualityIssues)
        .where(eq(dataQualityIssues.hospitalId, hospitalId))
        .orderBy(desc(dataQualityIssues.createdAt)).limit(boundedLimit).offset(boundedOffset);
    case "publishes":
      return db.select().from(dataPublishVersions)
        .where(eq(dataPublishVersions.hospitalId, hospitalId))
        .orderBy(desc(dataPublishVersions.createdAt)).limit(boundedLimit).offset(boundedOffset);
    case "lineage":
      return db.select().from(dataLineageEvents)
        .where(eq(dataLineageEvents.hospitalId, hospitalId))
        .orderBy(desc(dataLineageEvents.id)).limit(boundedLimit).offset(boundedOffset);
    case "templates":
      return db.select().from(dataBusinessTemplates)
        .where(or(eq(dataBusinessTemplates.hospitalId, hospitalId), isNull(dataBusinessTemplates.hospitalId)))
        .orderBy(desc(dataBusinessTemplates.version)).limit(boundedLimit).offset(boundedOffset);
    case "records": {
      const snapshots = await db.select({ id: dataDatasetSnapshots.id }).from(dataDatasetSnapshots).where(and(
        eq(dataDatasetSnapshots.hospitalId, hospitalId),
        inArray(dataDatasetSnapshots.status, ["ready", "published", "superseded", "withdrawn"]),
        ...(snapshotId ? [eq(dataDatasetSnapshots.id, snapshotId)] : []),
        ...(importId ? [eq(dataDatasetSnapshots.importJobId, importId)] : []),
      ));
      if (!snapshots.length) return [];
      return db.select().from(dataPipelineRecords)
        .where(and(eq(dataPipelineRecords.hospitalId, hospitalId), inArray(dataPipelineRecords.snapshotId, snapshots.map((item) => item.id))))
        .orderBy(dataPipelineRecords.sourceRowNumber, dataPipelineRecords.id).limit(boundedLimit).offset(boundedOffset);
    }
    case "quarantine": {
      let allowedSnapshotIds: string[] | null = null;
      if (importId) {
        const snapshots = await db.select({ id: dataDatasetSnapshots.id }).from(dataDatasetSnapshots).where(and(
          eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.importJobId, importId),
          ...(snapshotId ? [eq(dataDatasetSnapshots.id, snapshotId)] : []),
        ));
        allowedSnapshotIds = snapshots.map((snapshot) => snapshot.id);
        if (!allowedSnapshotIds.length) return [];
      }
      const issues = await db.select().from(dataRecordIssues)
        .where(and(
          eq(dataRecordIssues.hospitalId, hospitalId), eq(dataRecordIssues.status, "open"),
          ...(allowedSnapshotIds ? [inArray(dataRecordIssues.snapshotId, allowedSnapshotIds)] : snapshotId ? [eq(dataRecordIssues.snapshotId, snapshotId)] : []),
        ))
        .orderBy(desc(dataRecordIssues.createdAt)).limit(boundedLimit).offset(boundedOffset);
      if (!issues.length) return [];
      const records = await db.select().from(dataPipelineRecords).where(and(
        eq(dataPipelineRecords.hospitalId, hospitalId),
        inArray(dataPipelineRecords.id, [...new Set(issues.map((issue) => issue.recordId))]),
      ));
      return issues.map((issue) => {
        const row = records.find((record) => record.id === issue.recordId);
        return {
          issueId: issue.id, snapshotId: issue.snapshotId, recordId: issue.recordId,
          revision: row?.revision ?? 0, sourceRowNumber: row?.sourceRowNumber ?? 0,
          fieldName: issue.fieldName, message: issue.message, severity: issue.severity, status: issue.status,
          value: JSON.parse(issue.beforeJson), record: row ? JSON.parse(row.recordJson) as Record<string, unknown> : null,
        };
      });
    }
    case "reconciliations": {
      const [configs, runs] = await Promise.all([
        db.select().from(dataReconciliationConfigs).where(eq(dataReconciliationConfigs.hospitalId, hospitalId)).orderBy(desc(dataReconciliationConfigs.updatedAt)).limit(boundedLimit).offset(boundedOffset),
        db.select().from(dataReconciliationRuns).where(eq(dataReconciliationRuns.hospitalId, hospitalId)).orderBy(desc(dataReconciliationRuns.createdAt)).limit(boundedLimit).offset(boundedOffset),
      ]);
      const differences = runs.length ? await db.select().from(dataReconciliationDifferences).where(and(
        eq(dataReconciliationDifferences.hospitalId, hospitalId),
        inArray(dataReconciliationDifferences.runId, runs.map((run) => run.id)),
      )).limit(boundedLimit).offset(boundedOffset) : [];
      return [{ configs, runs, differences }];
    }
    case "publishedRecords":
      return db.select().from(dataPipelineRecords).innerJoin(dataDatasetSnapshots, and(
        eq(dataPipelineRecords.snapshotId, dataDatasetSnapshots.id),
        eq(dataDatasetSnapshots.layer, "published"),
      )).where(and(
        eq(dataPipelineRecords.hospitalId, hospitalId),
        ...(snapshotId ? [eq(dataDatasetSnapshots.id, snapshotId)] : []),
        ...(importId ? [eq(dataDatasetSnapshots.importJobId, importId)] : []),
      )).orderBy(desc(dataPipelineRecords.createdAt)).limit(boundedLimit).offset(boundedOffset);
    case "snapshots":
      return db.select().from(dataDatasetSnapshots)
        .where(and(
          eq(dataDatasetSnapshots.hospitalId, hospitalId), inArray(dataDatasetSnapshots.status, ["ready", "published", "superseded", "withdrawn"]),
          ...(snapshotId ? [eq(dataDatasetSnapshots.id, snapshotId)] : []),
          ...(importId ? [eq(dataDatasetSnapshots.importJobId, importId)] : []),
        ))
        .orderBy(desc(dataDatasetSnapshots.createdAt)).limit(boundedLimit).offset(boundedOffset);
    case "reviews":
      return db.select().from(dataReviewEvents)
        .where(eq(dataReviewEvents.hospitalId, hospitalId))
        .orderBy(desc(dataReviewEvents.id)).limit(boundedLimit).offset(boundedOffset);
  }
}

export async function connectorInHospital(hospitalId: string, connectorId: string) {
  const db = await getDb();
  const [row] = await db.select().from(dataSourceConnectors).where(and(
    eq(dataSourceConnectors.id, connectorId),
    eq(dataSourceConnectors.hospitalId, hospitalId),
  )).limit(1);
  return row ?? null;
}

export async function importInHospital(hospitalId: string, importId: string) {
  const db = await getDb();
  const [row] = await db.select().from(dataImportJobs).where(and(
    eq(dataImportJobs.id, importId),
    eq(dataImportJobs.hospitalId, hospitalId),
  )).limit(1);
  return row ?? null;
}

export async function datasetInHospital(hospitalId: string, datasetId: string) {
  const db = await getDb();
  const [row] = await db.select().from(rawDatasets).where(and(
    eq(rawDatasets.id, datasetId),
    eq(rawDatasets.hospitalId, hospitalId),
  )).limit(1);
  return row ?? null;
}

export async function mappingInHospital(hospitalId: string, mappingId: string) {
  const db = await getDb();
  const [row] = await db.select().from(dataFieldMappings).where(and(
    eq(dataFieldMappings.id, mappingId),
    eq(dataFieldMappings.hospitalId, hospitalId),
  )).limit(1);
  return row ?? null;
}

export async function fieldDefinitionInHospital(hospitalId: string, id: string) {
  const db = await getDb();
  const [row] = await db.select().from(dataFieldDefinitions).where(and(
    eq(dataFieldDefinitions.id, id), eq(dataFieldDefinitions.hospitalId, hospitalId),
  )).limit(1);
  return row ?? null;
}

export async function metricDefinitionInHospital(hospitalId: string, id: string) {
  const db = await getDb();
  const [row] = await db.select().from(dataMetricDefinitions).where(and(
    eq(dataMetricDefinitions.id, id), eq(dataMetricDefinitions.hospitalId, hospitalId),
  )).limit(1);
  return row ?? null;
}

export async function metricDefinitionsByCodesVersionInHospital(hospitalId: string, codes: string[], version: number) {
  if (!codes.length) return [];
  const db = await getDb();
  return db.select().from(dataMetricDefinitions).where(and(
    eq(dataMetricDefinitions.hospitalId, hospitalId),
    eq(dataMetricDefinitions.version, version),
    inArray(dataMetricDefinitions.code, [...new Set(codes)]),
  ));
}

export async function activeFieldDefinitionIdsInHospital(hospitalId: string, ids: string[]) {
  if (!ids.length) return [];
  const db = await getDb();
  return db.select({ id: dataFieldDefinitions.id }).from(dataFieldDefinitions).where(and(
    eq(dataFieldDefinitions.hospitalId, hospitalId),
    eq(dataFieldDefinitions.status, "active"),
    inArray(dataFieldDefinitions.id, [...new Set(ids)]),
  ));
}

export async function activeMetricDefinitionIdsInHospital(hospitalId: string, ids: string[]) {
  if (!ids.length) return [];
  const db = await getDb();
  return db.select({ id: dataMetricDefinitions.id }).from(dataMetricDefinitions).where(and(
    eq(dataMetricDefinitions.hospitalId, hospitalId),
    eq(dataMetricDefinitions.status, "active"),
    inArray(dataMetricDefinitions.id, [...new Set(ids)]),
  ));
}

export async function visualizationDefinitionInHospital(hospitalId: string, id: string) {
  const db = await getDb();
  const [row] = await db.select().from(dataVisualizationDefinitions).where(and(
    eq(dataVisualizationDefinitions.id, id), eq(dataVisualizationDefinitions.hospitalId, hospitalId),
  )).limit(1);
  return row ?? null;
}

export async function examEventInHospital(hospitalId: string, id: string) {
  const db = await getDb();
  const [row] = await db.select().from(dataExamEvents).where(and(
    eq(dataExamEvents.id, id), eq(dataExamEvents.hospitalId, hospitalId),
  )).limit(1);
  return row ?? null;
}

export async function recipeInHospital(hospitalId: string, recipeId: string) {
  const db = await getDb();
  const [row] = await db.select().from(dataCleaningRecipes).where(and(
    eq(dataCleaningRecipes.id, recipeId),
    eq(dataCleaningRecipes.hospitalId, hospitalId),
  )).limit(1);
  return row ?? null;
}

export async function qualityIssueInHospital(hospitalId: string, issueId: string) {
  const db = await getDb();
  const [row] = await db.select().from(dataQualityIssues).where(and(
    eq(dataQualityIssues.id, issueId),
    eq(dataQualityIssues.hospitalId, hospitalId),
  )).limit(1);
  return row ?? null;
}

export async function publishInHospital(hospitalId: string, publishId: string) {
  const db = await getDb();
  const [row] = await db.select().from(dataPublishVersions).where(and(
    eq(dataPublishVersions.id, publishId),
    eq(dataPublishVersions.hospitalId, hospitalId),
  )).limit(1);
  return row ?? null;
}

export async function importsReadyForPublish(hospitalId: string, importIds: string[], dataDomain: string) {
  if (!importIds.length) return false;
  const db = await getDb();
  const rows = await db.select({ id: dataImportJobs.id }).from(dataImportJobs).where(and(
    eq(dataImportJobs.hospitalId, hospitalId),
    eq(dataImportJobs.dataDomain, dataDomain),
    eq(dataImportJobs.status, "ready"),
    inArray(dataImportJobs.id, importIds),
  ));
  return new Set(rows.map((row) => row.id)).size === new Set(importIds).size;
}

export async function hasOpenBlockingIssues(hospitalId: string, importIds: string[]) {
  if (!importIds.length) return false;
  const db = await getDb();
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(dataQualityIssues).where(and(
    eq(dataQualityIssues.hospitalId, hospitalId),
    inArray(dataQualityIssues.importJobId, importIds),
    eq(dataQualityIssues.severity, "blocker"),
    inArray(dataQualityIssues.status, ["open", "acknowledged"]),
  ));
  return Number(count) > 0;
}

export async function writeDataLineage(input: {
  hospitalId: string;
  accountId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  fromStatus?: string;
  toStatus?: string;
  importJobId?: string | null;
  datasetVersion?: string;
  mappingVersion?: string;
  ruleVersion?: string;
  detailJson?: string;
}) {
  const db = await getDb();
  await db.insert(dataLineageEvents).values({
    hospitalId: input.hospitalId,
    actorAccountId: input.accountId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    fromStatus: input.fromStatus ?? "",
    toStatus: input.toStatus ?? "",
    importJobId: input.importJobId ?? null,
    datasetVersion: input.datasetVersion ?? "",
    mappingVersion: input.mappingVersion ?? "",
    ruleVersion: input.ruleVersion ?? "",
    detailJson: input.detailJson ?? "{}",
  });
}
