import type { Metadata } from "next";
import EquipmentPlatform from "./EquipmentPlatform";
import { PRODUCT_FULL_NAME } from "./brand";
import { resolveViewerIdentity } from "./server-identity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: PRODUCT_FULL_NAME,
  description: "医院医疗设备效益分析与管理平台：五维效益驾驶舱、单机分析、全成本核算与指标口径治理。",
};

export default async function Home() {
  const viewer = await resolveViewerIdentity();
  return <EquipmentPlatform viewer={viewer} />;
}
