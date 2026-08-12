-- 医院等级与类别拆分。
-- 旧版下拉把"三级综合/三级专科"这类类别混进了等级字段，既选不出"三级乙等"，
-- 也表达不了"二级中医医院"。这里补 category 列，并把历史取值拆回两个字段。
-- 等次无从推断的一律落到"（未定等）"，不臆造甲乙丙。
ALTER TABLE `hospitals` ADD `category` text DEFAULT '未设置' NOT NULL;
--> statement-breakpoint
UPDATE `hospitals` SET `category` = '综合医院', `level` = '三级（未定等）' WHERE `level` = '三级综合';
--> statement-breakpoint
UPDATE `hospitals` SET `category` = '专科医院', `level` = '三级（未定等）' WHERE `level` = '三级专科';
--> statement-breakpoint
UPDATE `hospitals` SET `category` = '中医医院', `level` = '三级（未定等）' WHERE `level` = '三级中医';
--> statement-breakpoint
UPDATE `hospitals` SET `category` = '综合医院', `level` = '二级（未定等）' WHERE `level` = '二级综合';
--> statement-breakpoint
UPDATE `hospitals` SET `category` = '专科医院', `level` = '二级（未定等）' WHERE `level` = '二级专科';
--> statement-breakpoint
UPDATE `hospitals` SET `level` = '二级（未定等）' WHERE `level` = '二级医院';
--> statement-breakpoint
UPDATE `hospitals` SET `level` = '一级（未定等）' WHERE `level` = '一级医院';
--> statement-breakpoint
UPDATE `hospitals` SET `level` = '三级（未定等）' WHERE `level` = '三级医院';
--> statement-breakpoint
UPDATE `hospitals` SET `level` = '未定级' WHERE `level` = '未设置' OR `level` = '';
