/**
 * 左侧菜单目录：角色配置里“按菜单勾选”的依据。
 *
 * 与 EquipmentPlatform 的 navItems 保持同步：每个菜单声明它在左侧显示所需的
 * 权限编码（任一命中即显示）。勾选菜单会把这些权限授予角色；取消勾选会移除
 * 不再被其他已勾选菜单需要的权限。消息中心与使用指南不需要权限，始终可见。
 */
export type MenuCatalogItem = {
  id: string;
  label: string;
  group: "show" | "manage";
  permissions: readonly string[];
  note?: string;
};

export const menuCatalog: readonly MenuCatalogItem[] = [
  { id: "cockpit", label: "效益驾驶舱", group: "show", permissions: ["dashboard.view"] },
  { id: "analysis", label: "采集与分析", group: "show", permissions: ["dashboard.view", "source.manage"] },
  { id: "report", label: "效益分析报告", group: "show", permissions: ["report.manage", "report.review", "report.approve", "report.export"] },
  { id: "improvement", label: "运营改进中心", group: "show", permissions: ["improvement.manage"] },
  { id: "capital", label: "资本计划", group: "show", permissions: ["improvement.manage", "report.approve"] },
  { id: "equipment", label: "设备台账", group: "manage", permissions: ["equipment.manage"] },
  { id: "costs", label: "成本填报", group: "manage", permissions: ["cost.manage"] },
  { id: "layout", label: "驾驶舱配置", group: "manage", permissions: ["member.manage"] },
  { id: "sources", label: "文件口径说明", group: "manage", permissions: ["source.manage"] },
  { id: "workbench", label: "数据准备中心（隐藏入口）", group: "manage", permissions: ["connector.manage", "data.ingest", "data.clean", "data.review", "data.publish"], note: "通过品牌区连击加口令进入" },
  { id: "access", label: "医院与权限", group: "manage", permissions: ["hospital.manage", "member.manage"] },
  { id: "operations", label: "云端运维", group: "manage", permissions: ["member.manage"] },
] as const;

export function menuVisibleForPermissions(item: MenuCatalogItem, permissionCodes: ReadonlySet<string>): boolean {
  return item.permissions.some((code) => permissionCodes.has(code));
}

/** 勾选/取消一个菜单后应得到的权限集合。 */
export function togglePermissionsForMenu(
  current: readonly string[],
  item: MenuCatalogItem,
  enable: boolean,
  grantable: ReadonlySet<string>,
): string[] {
  const next = new Set(current);
  if (enable) {
    for (const code of item.permissions) {
      if (grantable.has(code)) next.add(code);
    }
    return [...next];
  }
  const stillNeeded = new Set(
    menuCatalog
      .filter((menu) => menu.id !== item.id && menuVisibleForPermissions(menu, next))
      .flatMap((menu) => [...menu.permissions]),
  );
  for (const code of item.permissions) {
    if (!stillNeeded.has(code)) next.delete(code);
  }
  return [...next];
}
