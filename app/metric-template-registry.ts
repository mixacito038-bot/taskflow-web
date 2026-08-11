import {
  HOSPITAL_METRIC_CATALOG_VERSION,
  hospitalMetricCatalog,
  type HospitalMetricCatalogItem,
} from "./hospital-metric-catalog";
import {
  COMPREHENSIVE_MONITORING_VERSION,
  comprehensiveMonitoringCatalog,
} from "./comprehensive-monitoring-template";

export type MetricTemplateRegistryEntry = {
  catalog: readonly HospitalMetricCatalogItem[];
  label: string;
  expectedCount: number;
};

/**
 * 平台登记的指标模板：版本号是唯一键，导入与激活都只接受这里登记的版本。
 * expectedCount 在服务端导入时强校验，防止半套目录被写入草稿。
 */
export const metricTemplateRegistry: Record<string, MetricTemplateRegistryEntry> = {
  [HOSPITAL_METRIC_CATALOG_VERSION]: {
    catalog: hospitalMetricCatalog,
    label: "医院关注指标基线",
    expectedCount: 20,
  },
  [COMPREHENSIVE_MONITORING_VERSION]: {
    catalog: comprehensiveMonitoringCatalog,
    label: "全面监测专业分析模板",
    expectedCount: 30,
  },
};

export function resolveMetricTemplate(version: string): MetricTemplateRegistryEntry | null {
  return Object.prototype.hasOwnProperty.call(metricTemplateRegistry, version)
    ? metricTemplateRegistry[version]
    : null;
}

export const registeredMetricTemplateVersions: ReadonlySet<string> = new Set(
  Object.keys(metricTemplateRegistry),
);
