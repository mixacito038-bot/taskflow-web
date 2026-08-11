import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contractUrl = new URL("../db/data-workbench-contract.ts", import.meta.url);
const schemaUrl = new URL("../db/schema.ts", import.meta.url);
const routeUrl = new URL("../app/api/data-workbench/route.ts", import.meta.url);
const migrationUrl = new URL("../drizzle/0007_data_workbench.sql", import.meta.url);
const metadataMigrationUrl = new URL("../drizzle/0008_metadata_contracts.sql", import.meta.url);

test("data workbench contract only permits explicit import and publish transitions", async () => {
  const contract = await import(contractUrl.href);
  assert.equal(contract.canAdvanceImport("uploading", "pending_mapping"), true);
  assert.equal(contract.canAdvanceImport("uploading", "published"), false);
  assert.equal(contract.canAdvanceImport("published", "uploading"), false);
  assert.equal(contract.canAdvancePublish("draft", "pending_review"), true);
  assert.equal(contract.canAdvancePublish("pending_review", "published"), false);
  assert.equal(contract.canAdvancePublish("approved", "published"), true);
});

test("connector metadata rejects inline credentials recursively", async () => {
  const { containsSensitiveConnectorMaterial, normalizeConnectorEndpoint } = await import(contractUrl.href);
  assert.equal(containsSensitiveConnectorMaterial({ host: "his.internal", password: "plaintext" }), true);
  assert.equal(containsSensitiveConnectorMaterial({ nested: { apiToken: "plaintext" } }), true);
  assert.equal(containsSensitiveConnectorMaterial({ vendor: "HIS", mode: "HL7" }), false);
  assert.equal(normalizeConnectorEndpoint("https://user:pass@his.local/api?token=bad"), null);
  assert.equal(normalizeConnectorEndpoint("https://his.local/api"), "https://his.local/api");
});

test("schema and forward migration cover every governed data layer", async () => {
  const [schema, migration, metadataMigration] = await Promise.all([
    readFile(schemaUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
    readFile(metadataMigrationUrl, "utf8"),
  ]);
  const tables = [
    "data_source_connectors",
    "data_import_jobs",
    "raw_datasets",
    "data_field_mappings",
    "data_cleaning_recipes",
    "data_cleaning_rules",
    "data_quality_issues",
    "data_publish_versions",
    "data_lineage_events",
  ];
  for (const table of tables) {
    assert.match(schema, new RegExp(`\\"${table}\\"`));
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(migration, /CREATE INDEX `data_import_jobs_hospital_status_idx`/);
  assert.match(migration, /INSERT OR IGNORE INTO `permissions`/);
  for (const table of [
    "data_field_definitions",
    "data_metric_definitions",
    "data_visualization_definitions",
    "data_exam_events",
    "data_exam_event_body_parts",
  ]) {
    assert.match(schema, new RegExp(`\\"${table}\\"`));
    assert.match(metadataMigration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(metadataMigration, /data_exam_body_parts_one_primary_unique/);
  assert.match(metadataMigration, /data_exam_events_hospital_source_key_unique/);
});

test("API contract enforces app session, same-origin mutation, tenant boundary and permissions", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /requireAppSession\(request\)/);
  assert.match(route, /assertSameOrigin\(request\)/);
  assert.match(route, /getCloudStateAccess\(userEmail, hospitalId\)/);
  assert.match(route, /hasFullHospitalScope/);
  for (const permission of ["connector.manage", "data.ingest", "data.clean", "data.review", "data.publish"]) {
    assert.match(route, new RegExp(permission.replace(".", "\\.")));
  }
  for (const action of ["save_field_definition", "save_metric_definition", "save_visualization_definition", "save_exam_event"]) {
    assert.match(route, new RegExp(action));
  }
});
