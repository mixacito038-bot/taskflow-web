import { inspectAppSession } from "../db/account-security";
import { getChatGPTUser } from "./chatgpt-auth";
import type { ViewerIdentity } from "./access-control-data";

/**
 * 服务端统一身份解析：优先识别账号密码会话，其次识别统一身份网关请求头。
 * 两者都不存在时返回未认证访客（前端进入登录页/演示模式）。
 */
export async function resolveViewerIdentity(): Promise<ViewerIdentity> {
  try {
    const inspection = await inspectAppSession();
    if (inspection.session?.authMethod === "password" && inspection.state === "active" && inspection.account) {
      return {
        displayName: inspection.account.displayName,
        email: inspection.account.email,
        authenticated: true,
      };
    }
  } catch {
    // 数据库不可用（本地纯前端预览等）时退回统一身份/访客路径。
  }

  const user = await getChatGPTUser();
  if (user) {
    return { displayName: user.displayName, email: user.email, authenticated: true };
  }
  return { displayName: "本地演示账号", email: "demo@local.invalid", authenticated: false };
}
