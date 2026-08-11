"use client";

import { useEffect, useState } from "react";
import {
  createPublishedDatasetView,
  emptyPublishedDatasetView,
  type PublishedDatasetPayload,
  type PublishedDatasetView,
} from "./published-data";

export type PublishedDatasetSelection = {
  seriesId?: string;
  version?: number;
  publishId?: string;
};

export async function loadPublishedDataset(
  hospitalId: string,
  selection: PublishedDatasetSelection = {},
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ hospitalId });
  if (selection.seriesId) query.set("seriesId", selection.seriesId);
  if (selection.version !== undefined) query.set("version", String(selection.version));
  if (selection.publishId) query.set("publishId", selection.publishId);
  const response = await fetch(`/api/published-data?${query}`, {
    signal,
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const result = await response.json() as { data?: PublishedDatasetPayload; error?: string };
  if (!response.ok || !result.data) throw new Error(result.error ?? "published_data_load_failed");
  return createPublishedDatasetView(result.data);
}

export function usePublishedDataset(
  hospitalId: string,
  enabled: boolean,
  selection: PublishedDatasetSelection = {},
  refreshIntervalMs = 30_000,
) {
  const selectorKey = `${selection.publishId ?? ""}|${selection.seriesId ?? ""}|${selection.version ?? ""}`;
  const requestKey = `${hospitalId}|${selectorKey}`;
  const [result, setResult] = useState<{
    requestKey: string;
    view: PublishedDatasetView;
    error: string;
  }>({ requestKey: "", view: emptyPublishedDatasetView, error: "" });

  useEffect(() => {
    if (!enabled || !hospitalId) return;
    let disposed = false;
    let controller: AbortController | null = null;
    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await loadPublishedDataset(hospitalId, selection, controller.signal);
        if (!disposed) {
          setResult({ requestKey, view: next, error: "" });
        }
      } catch (reason) {
        if (!disposed && !(reason instanceof DOMException && reason.name === "AbortError")) {
          setResult({
            requestKey,
            view: emptyPublishedDatasetView,
            error: reason instanceof Error ? reason.message : "published_data_load_failed",
          });
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), Math.max(10_000, refreshIntervalMs));
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // selection is represented by selectorKey to avoid a new-object refresh loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hospitalId, refreshIntervalMs, requestKey, selectorKey]);

  const active = enabled && Boolean(hospitalId);
  const current = active && result.requestKey === requestKey;
  return {
    view: current ? result.view : emptyPublishedDatasetView,
    loading: active && !current,
    error: current ? result.error : "",
  };
}
