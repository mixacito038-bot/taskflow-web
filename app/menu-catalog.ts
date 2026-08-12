/**
 * 左侧菜单目录：角色配置里“按菜单勾选”的依据。
 *
 * 与 EquipmentPlatform 的 navItems 保持同步：每个菜单声明它在左侧显示所需的
 * 权限编码（任一命中即显示）。勾选菜单会把这些权限授予角色；取消勾选会移除
 * 不再被其他已勾选菜单需要的权限。
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
  { id: "costs", label: "设备数据填报", group: "manage", permissions: ["cost.manage"] },
  { id: "layout", label: "驾驶舱配置", group: "manage", permissions: ["member.manage"] },
  { id: "sources", label: "指标字典", group: "manage", permissions: ["source.manage"] },
  { id: "workbench", label: "数据准备中心（隐藏入口）", group: "manage", permissions: ["connector.manage", "data.ingest", "data.clean", "data.review", "data.publish"], note: "通过品牌区连击加口令进入" },
  { id: "access", label: "医院与权限", group: "manage", permissions: ["hospital.manage", "member.manage"] },
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

/**
 * 判断“取消勾选某菜单”是否真的能让它从左侧隐藏。
 *
 * 当该菜单赖以显示的权限全部被其它已勾选菜单共享时（如“效益驾驶舱”和“采集与分析”
 * 都需要 dashboard.view），取消其中一个并不会改变其可见性——形成“死复选框”。
 * 此时返回 false，供 UI 呈现“受共享约束”态并给出说明，避免静默无效的点击。
 * 若该菜单当前本就不可见，或取消后确实会隐藏，则返回 true。
 */
export function canHideMenu(menuId: string, permissionCodes: readonly string[]): boolean {
  const item = menuCatalog.find((menu) => menu.id === menuId);
  if (!item) return true;
  const permissionSet = new Set(permissionCodes);
  if (!menuVisibleForPermissions(item, permissionSet)) return true;
  const next = togglePermissionsForMenu(permissionCodes, item, false, permissionSet);
  return !menuVisibleForPermissions(item, new Set(next));
}
