UPDATE `data_publish_versions` AS `candidate`
SET `status` = 'superseded', `updated_at` = CURRENT_TIMESTAMP
WHERE `candidate`.`status` = 'published'
  AND EXISTS (
    SELECT 1 FROM `data_publish_versions` AS `newer`
    WHERE `newer`.`hospital_id` = `candidate`.`hospital_id`
      AND `newer`.`series_id` = `candidate`.`series_id`
      AND `newer`.`status` = 'published'
      AND (`newer`.`version` > `candidate`.`version` OR (`newer`.`version` = `candidate`.`version` AND `newer`.`id` > `candidate`.`id`))
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `data_publish_versions_one_active_series_unique` ON `data_publish_versions` (`hospital_id`,`series_id`) WHERE "data_publish_versions"."status" = 'published';
