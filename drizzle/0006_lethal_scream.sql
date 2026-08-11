UPDATE `report_templates`
SET `is_default` = 0
WHERE `is_default` = 1
  AND `id` NOT IN (
    SELECT `id`
    FROM (
      SELECT
        `id`,
        ROW_NUMBER() OVER (
          PARTITION BY `hospital_id`
          ORDER BY `updated_at` DESC, `created_at` DESC, `id` DESC
        ) AS `default_rank`
      FROM `report_templates`
      WHERE `is_default` = 1
    )
    WHERE `default_rank` = 1
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `report_templates_one_default_per_hospital` ON `report_templates` (`hospital_id`) WHERE "report_templates"."is_default" = 1;
