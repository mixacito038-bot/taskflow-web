"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  CircleAlert,
  Cloud,
  CloudCog,
  Database,
  Download,
  FileCheck2,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import styles from "./CloudOperationsCenter.module.css";

type HealthStatus = "pass" | "warning" | "fail" | "pending";

type SystemHealthResponse = {
  checkedAt: string;
  hospital: {
    id: string;
    code: string;
    name: string;
    shortName: string;
    level: string;
    region: string;
  };
  access: {
    status: "authorized";
    role: string;
    dataScope: string;
  };
  totals: {
    recordCount: number;
    estimatedD1Bytes: number;
    artifactCount: number;
    artifactBytes: number;
    reportCount: number;
    issuedReportCount: number;
    templateCount: number;
    eventCount: number;
    auditCount: number;
    membershipCount: number;
  };
  resources: Array<{
    resource: string;
    label: string;
    recordCount: number;
    estimatedBytes: number;
    schemaVersion: number | null;
    updatedAt: string | null;
    initialized: boolean;
  }>;
  reportStatuses: Record<string, number>;
  latestSyncAt: string | null;
  health: {
    performed: boolean;
    overall: HealthStatus;
    checks: Array<{
      id: string;
      label: string;
      status: HealthStatus;
      detail: string;
    }>;
    storage: {
      status: HealthStatus;
      checkedObjects: number;
      missingObjects: number;
      mismatchedObjects: number;
      message: string;
    } | null;
  };
};

export type CloudOperationsCenterProps = {
  hospitalId: string;
  hospitalName: string;
  canManage: boolean;
};

const healthLabels: Record<HealthStatus, string> = {
  pass: "正常",
  warning: "需确认",
  fail: "异常",
  pending: "待检查",
};

function displayBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function displayTime(value: string | null) {
  if (!value) return "尚无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function errorMessage(code: string) {
  return ({
    authentication_required: "登录状态已失效，请重新登录后再试",
    permission_denied: "当前角色不是该医院管理员，不能查看云端运维信息",
    hospital_not_found: "当前医院不存在或已停用",
    health_store_unavailable: "云数据库暂不可用，请稍后重试",
    health_check_failed: "云端自检未完成，请稍后重试",
    backup_too_large: "医院备份超过在线下载上限，请联系平台管理员分批导出",
  } as Record<string, string>)[code] ?? "请求未完成，请稍后重试";
}

function StatusIcon({ status }: { status: HealthStatus }) {
  if (status === "pass") return <CheckCircle2 size={18} />;
  if (status === "warning") return <AlertTriangle size={18} />;
  if (status === "fail") return <CircleAlert size={18} />;
  return <LoaderCircle size={18} />;
}

export default function CloudOperationsCenter({
  hospitalId,
  hospitalName,
  canManage,
}: CloudOperationsCenterProps) {
  const [data, setData] = useState<SystemHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const loadOverview = useCallback(async (runCheck = false, signal?: AbortSignal) => {
    if (!hospitalId || !canManage) return;
    if (runCheck) setChecking(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ hospitalId });
      if (runCheck) params.set("check", "1");
      const response = await fetch(`/api/system-health?${params.toString()}`, {
        signal,
        cache: "no-store",
      });
      const payload = await response.json() as SystemHealthResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "health_check_failed");
      setData(payload);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(errorMessage(loadError instanceof Error ? loadError.message : "health_check_failed"));
    } finally {
      if (runCheck) setChecking(false);
      else setLoading(false);
    }
  }, [canManage, hospitalId]);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void loadOverview(false, controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [loadOverview]);

  async function downloadBackup() {
    if (!hospitalId || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const params = new URLSearchParams({ hospitalId, download: "backup" });
      const response = await fetch(`/api/system-health?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? "health_check_failed");
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `${hospitalName || hospitalId}-云端备份-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (downloadError) {
      setError(errorMessage(downloadError instanceof Error ? downloadError.message : "health_check_failed"));
    } finally {
      setDownloading(false);
    }
  }

  if (!canManage) {
    return (
      <section className={styles.restricted}>
        <ShieldCheck size={24} />
        <div>
          <strong>仅医院管理员可查看云端运维信息</strong>
          <p>容量、备份和存储健康状态属于医院级管理范围。</p>
        </div>
      </section>
    );
  }

  const visibleData = data?.hospital.id === hospitalId ? data : null;
  const overall = visibleData?.health.overall ?? "pending";
  const metrics = visibleData ? [
    {
      label: "医院云记录",
      value: visibleData.totals.recordCount.toLocaleString("zh-CN"),
      note: `含 ${visibleData.totals.auditCount} 条审计记录`,
      icon: <Database size={20} />,
    },
    {
      label: "业务载荷估算",
      value: displayBytes(visibleData.totals.estimatedD1Bytes),
      note: "不含数据库索引与系统开销",
      icon: <Cloud size={20} />,
    },
    {
      label: "云端报告文件",
      value: `${visibleData.totals.artifactCount} 份`,
      note: `R2 共 ${displayBytes(visibleData.totals.artifactBytes)}`,
      icon: <FileCheck2 size={20} />,
    },
    {
      label: "最近云端写入",
      value: displayTime(visibleData.latestSyncAt),
      note: `${visibleData.totals.reportCount} 个报告版本`,
      icon: <HardDrive size={20} />,
    },
  ] : [];

  return (
    <section className={styles.center}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}><CloudCog size={15} /> 云端运维</span>
          <h1>云端运维与演示自检</h1>
          <p>确认医院数据、报告文件和访问边界均已就绪，并下载不含连接凭据的医院级备份。</p>
        </div>
        <div className={styles.actions}>
          <button
            className="secondary-button"
            type="button"
            disabled={loading || checking || downloading}
            onClick={() => void downloadBackup()}
          >
            {downloading ? <LoaderCircle className={styles.spin} size={17} /> : <Download size={17} />}
            {downloading ? "正在整理" : "下载医院备份"}
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={loading || checking}
            onClick={() => void loadOverview(true)}
          >
            {checking ? <LoaderCircle className={styles.spin} size={17} /> : <RefreshCw size={17} />}
            {checking ? "正在检查" : "运行云端自检"}
          </button>
        </div>
      </header>

      {error ? (
        <div className={styles.error} role="alert">
          <CircleAlert size={18} />
          <span>{error}</span>
          <button type="button" onClick={() => void loadOverview(false)}>重试</button>
        </div>
      ) : null}

      {loading && !visibleData ? (
        <div className={styles.loading}>
          <LoaderCircle className={styles.spin} size={22} />
          <span>正在读取医院云端状态…</span>
        </div>
      ) : null}

      {visibleData ? (
        <>
          <div className={`${styles.summary} ${styles[overall]}`}>
            <div className={styles.summaryIcon}><StatusIcon status={overall} /></div>
            <div>
              <span>演示就绪状态</span>
              <strong>{overall === "pass" ? "全部检查通过" : overall === "warning" ? "可演示，有事项待确认" : overall === "fail" ? "存在云端异常" : "等待完整自检"}</strong>
              <small>{visibleData.hospital.name} · {visibleData.access.role} · 检查于 {displayTime(visibleData.checkedAt)}</small>
            </div>
            <span className={styles.statusPill}>{healthLabels[overall]}</span>
          </div>

          <div className={styles.metrics}>
            {metrics.map((metric) => (
              <article className={styles.metric} key={metric.label}>
                <span className={styles.metricIcon}>{metric.icon}</span>
                <div>
                  <p>{metric.label}</p>
                  <strong>{metric.value}</strong>
                  <small>{metric.note}</small>
                </div>
              </article>
            ))}
          </div>

          <div className={styles.grid}>
            <article className={styles.panel}>
              <div className={styles.panelHeading}>
                <div>
                  <h2>医院云数据分布</h2>
                  <p>D1 中各业务资源的记录数量与载荷估算</p>
                </div>
                <Database size={19} />
              </div>
              <div className={styles.resourceList}>
                {visibleData.resources.map((resource) => (
                  <div className={styles.resourceRow} key={resource.resource}>
                    <span className={`${styles.resourceState} ${resource.initialized ? styles.ready : styles.missing}`} />
                    <div>
                      <strong>{resource.label}</strong>
                      <small>{resource.initialized ? `结构版本 v${resource.schemaVersion}` : "尚未初始化"}</small>
                    </div>
                    <b>{resource.recordCount.toLocaleString("zh-CN")} 条</b>
                    <span>{displayBytes(resource.estimatedBytes)}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeading}>
                <div>
                  <h2>现场演示检查单</h2>
                  <p>检查只读取状态，不会修改医院数据</p>
                </div>
                <ShieldCheck size={19} />
              </div>
              <div className={styles.checkList}>
                {visibleData.health.checks.map((check) => (
                  <div className={`${styles.checkRow} ${styles[check.status]}`} key={check.id}>
                    <StatusIcon status={check.status} />
                    <div>
                      <strong>{check.label}</strong>
                      <span>{check.detail}</span>
                    </div>
                    <small>{healthLabels[check.status]}</small>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <div className={styles.backupNote}>
            <Archive size={18} />
            <div>
              <strong>备份范围清楚可审计</strong>
              <p>JSON 包含医院业务数据、报告元数据、模板和审计记录；自动排除令牌、密钥、连接字符串、成员邮箱与个人偏好。Word/CSV 文件仍保存在私有 R2，不会塞入 JSON。</p>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
