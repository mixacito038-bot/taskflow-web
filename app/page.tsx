import type { Metadata } from "next";
import EquipmentPlatform from "./EquipmentPlatform";
import { PRODUCT_FULL_NAME } from "./brand";
import { getChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: PRODUCT_FULL_NAME,
  description: "大型医疗设备五维效益驾驶舱、单机分析、全成本核算与指标治理在线原型。",
};

export default async function Home() {
  const user = await getChatGPTUser();
  return (
    <EquipmentPlatform
      viewer={user
        ? { displayName: user.displayName, email: user.email, authenticated: true }
        : { displayName: "本地演示账号", email: "demo@local.invalid", authenticated: false }}
    />
  );
}
