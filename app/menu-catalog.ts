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
  { id: "analysis", label: "效益分析", group: "show", permissions: ["dashboard.view", "source.manage"] },
  { id: "report", label: "效益分析报告", group: "show", permissions: ["report.manage", "report.review", "report.approve", "report.export"] },
  { id: "improvement", label: "运营改进中心", group: "show", permissions: ["improvement.manage"] },
  /* 资本计划是院长层的论证页（含导出论证清单）。原来 improvement.manage 也能进，
     于是「仅查看授权科室、跟进本科室改进任务」的临床科室负责人也能进——按签发权限收口。 */
  { id: "capital", label: "资本计划", group: "show", permissions: ["report.approve"] },
  { id: "equipment", label: "设备台账", group: "manage", permissions: ["equipment.manage"] },
  { id: "costs", label: "设备数据填报", group: "manage", permissions: ["cost.manage"] },
  { id: "layout", label: "驾驶舱配置", group: "manage", permissions: ["member.manage"] },
  { id: "sources", label: "指标字典", group: "manage", permissions: ["source.manage"] },
  { id: "workbench", label: "数据准备中心（隐藏入口）", group: "manage", permissions: ["data.ingest", "data.clean", "data.review", "data.publish"], note: "通过品牌区连击加口令进入" },
  { id: "access", label: "医院与权限", group: "manage", permissions: ["hospital.manage", "member.manage"] },
] as const;

export function menuVisibleForPermissions(item: MenuCatalogItem, permissionCodes: ReadonlySet<string>): boolean {
  return item.permissions.some((code) => permissionCodes.has(code));
}

/* 这里原来还有 togglePermissionsForMenu() 和 canHideMenu()：角色配置弹窗曾经有一排菜单复选框，
   勾菜单去反推权限，还要判断「这个菜单赖以显示的权限被别的菜单共享，取消勾选也隐藏不掉」，
   于是界面上出现勾了点不动的死复选框。现在弹窗只勾权限一处，菜单由 menuVisibleForPermissions
   实时算出来只读展示，这两个函数没有调用方，一并删掉。 */
