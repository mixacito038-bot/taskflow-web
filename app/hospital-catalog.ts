/**
 * 医院等级与类别口径。
 *
 * 等级依据卫生部《医院分级管理办法（试行草案）》（1989）：医院按功能、任务、设施条件、
 * 技术建设、医疗服务质量和科学管理水平分为一、二、三级；一、二级各分甲乙丙三等，
 * 三级另增设特等，合称"三级十等"。实际填报中大量医院已定级但未定等（例如新设三级医院
 * 尚未完成等次评审），因此每一级额外提供"未定等"，未参加评审的填"未定级"。
 *
 * 类别依据《医疗机构管理条例实施细则》（卫生部令第35号）第三条列举的医疗机构类别，
 * 取其中"医院"及与设备效益分析相关的机构形态。
 *
 * 等级和类别是两件事：原先把"三级综合""三级专科"放进等级下拉，等于把类别混进了等级，
 * 既选不出"三级乙等"，也无法表达"二级中医医院"。这里拆成两个字段。
 */

export type HospitalLevelOption = {
  value: string;
  /** 级：一级/二级/三级，用于排序与统计；未定级为 0。 */
  tier: 0 | 1 | 2 | 3;
};

export const HOSPITAL_LEVELS: HospitalLevelOption[] = [
  { value: "三级特等", tier: 3 },
  { value: "三级甲等", tier: 3 },
  { value: "三级乙等", tier: 3 },
  { value: "三级丙等", tier: 3 },
  { value: "三级（未定等）", tier: 3 },
  { value: "二级甲等", tier: 2 },
  { value: "二级乙等", tier: 2 },
  { value: "二级丙等", tier: 2 },
  { value: "二级（未定等）", tier: 2 },
  { value: "一级甲等", tier: 1 },
  { value: "一级乙等", tier: 1 },
  { value: "一级丙等", tier: 1 },
  { value: "一级（未定等）", tier: 1 },
  { value: "未定级", tier: 0 },
];

export const HOSPITAL_LEVEL_VALUES = HOSPITAL_LEVELS.map((level) => level.value);

export const HOSPITAL_CATEGORIES = [
  "综合医院",
  "中医医院",
  "中西医结合医院",
  "民族医医院",
  "专科医院",
  "康复医院",
  "妇幼保健院",
  "护理院",
  "疗养院",
  "社区卫生服务中心",
  "乡镇卫生院",
  "未设置",
];

/**
 * 历史值兜底：旧版下拉把类别混在等级里，库中已存在"三级综合"这类取值。
 * 迁移时拆成（等级, 类别）两个值；等次无从推断的一律落到"未定等"，不臆造甲乙丙。
 */
export const LEGACY_HOSPITAL_LEVEL_MAP: Record<string, { level: string; category: string }> = {
  "三级综合": { level: "三级（未定等）", category: "综合医院" },
  "三级专科": { level: "三级（未定等）", category: "专科医院" },
  "三级中医": { level: "三级（未定等）", category: "中医医院" },
  "二级综合": { level: "二级（未定等）", category: "综合医院" },
  "二级专科": { level: "二级（未定等）", category: "专科医院" },
  "二级医院": { level: "二级（未定等）", category: "未设置" },
  "一级医院": { level: "一级（未定等）", category: "未设置" },
  "三级医院": { level: "三级（未定等）", category: "未设置" },
  "未设置": { level: "未定级", category: "未设置" },
  "": { level: "未定级", category: "未设置" },
};

/** 把任意历史/外部取值折算成当前口径；无法识别的原样保留，由界面单列显示，不静默改写医院资料。 */
export function normalizeHospitalTaxonomy(level: string, category?: string): { level: string; category: string } {
  const rawLevel = (level ?? "").trim();
  const rawCategory = (category ?? "").trim();
  const legacy = LEGACY_HOSPITAL_LEVEL_MAP[rawLevel];
  if (legacy) return { level: legacy.level, category: rawCategory || legacy.category };
  return { level: rawLevel || "未定级", category: rawCategory || "未设置" };
}

/** 排序用：三级特等最高，未定级最低。用于集团对比等需要按等级排列的场景。 */
export function hospitalLevelRank(level: string): number {
  const index = HOSPITAL_LEVEL_VALUES.indexOf(level);
  return index === -1 ? HOSPITAL_LEVEL_VALUES.length : index;
}
