import type { Metadata } from "next";
import EquipmentPlatform from "./EquipmentPlatform";
import { PRODUCT_FULL_NAME } from "./brand";
import { resolveViewerIdentity } from "./server-identity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: PRODUCT_FULL_NAME,
  description: "大型医疗设备五维效益驾驶舱、单机分析、全成本核算与指标治理在线原型。",
};

export default async function Home() {
  const viewer = await resolveViewerIdentity();
  return <EquipmentPlatform viewer={viewer} />;
}
