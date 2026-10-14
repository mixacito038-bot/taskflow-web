-- 设备状态 / 品类归一化（一次性修旧数据）
--
-- 背景：早期版本「旧数据导入」原样保存设备状态，库里出现了 active 这类系统不认的值，
-- 品类也可能是空的。系统只认 in_use / repair / retired / scrapped 四个状态，其它值的设备：
--   · 手机端巡检清单不显示（只列「在用」）→ 没人巡检，也不计入应巡台数
--   · 有效期提醒不提醒（只看「在用」）     → 过期了没人知道
--   · 管理后台编辑保存报「设备品类不能为空」「设备状态只能是…」→ 改不了
-- 现在各个录入口都已校验，这里只处理库里已有的旧值。
-- 常见写法按字面归一；认不出来的保持原样，由后台标红、「体检」列出，人工确认后再改
-- （例如「备用」到底要不要天天巡检，只有设备科能定）。

CREATE TEMP TABLE _dev_status_map (k TEXT PRIMARY KEY, v TEXT NOT NULL);
INSERT INTO _dev_status_map (k, v) VALUES
  ('', 'in_use'), ('in_use', 'in_use'), ('inuse', 'in_use'), ('active', 'in_use'), ('enabled', 'in_use'),
  ('enable', 'in_use'), ('on', 'in_use'), ('normal', 'in_use'), ('ok', 'in_use'), ('using', 'in_use'),
  ('used', 'in_use'), ('available', 'in_use'),
  ('在用', 'in_use'), ('在用中', 'in_use'), ('正常', 'in_use'), ('正常使用', 'in_use'), ('使用', 'in_use'),
  ('使用中', 'in_use'), ('启用', 'in_use'), ('可用', 'in_use'), ('良好', 'in_use'), ('完好', 'in_use'),
  ('repair', 'repair'), ('repairing', 'repair'), ('maintenance', 'repair'), ('broken', 'repair'),
  ('维修', 'repair'), ('维修中', 'repair'), ('检修', 'repair'), ('检修中', 'repair'), ('保养', 'repair'),
  ('保养中', 'repair'), ('送修', 'repair'), ('待修', 'repair'), ('故障', 'repair'),
  ('retired', 'retired'), ('inactive', 'retired'), ('disabled', 'retired'), ('disable', 'retired'),
  ('off', 'retired'), ('stop', 'retired'), ('stopped', 'retired'), ('idle', 'retired'),
  ('停用', 'retired'), ('已停用', 'retired'), ('闲置', 'retired'), ('封存', 'retired'),
  ('scrapped', 'scrapped'), ('scrap', 'scrapped'), ('discarded', 'scrapped'),
  ('报废', 'scrapped'), ('已报废', 'scrapped'), ('淘汰', 'scrapped');

-- 归一用的键：去首尾空白（含全角空格、制表、换行）→ 小写 → 空格和横线当下划线
CREATE TEMP TABLE _dev_status_fix AS
SELECT d.id, d.code, d.status AS old, m.v AS new
  FROM devices d
  JOIN _dev_status_map m
    ON m.k = replace(replace(lower(trim(d.status, ' 　' || char(9, 10, 13))), ' ', '_'), '-', '_')
 WHERE d.status NOT IN ('in_use', 'repair', 'retired', 'scrapped');

-- 改前的值记进审计日志，事后能查到哪台设备从什么改成了什么
INSERT INTO audit_log (user_id, action, detail, ip, created_at)
SELECT NULL, 'device_status_fix', 'code=' || code || ' from=' || quote(old) || ' to=' || new, 'migration',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM _dev_status_fix;

UPDATE devices SET status = (SELECT new FROM _dev_status_fix f WHERE f.id = devices.id),
                   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE id IN (SELECT id FROM _dev_status_fix);

-- 品类为空：手机端按品类分组，空品类会显示成没有名字的一组；后台编辑也保存不了
INSERT INTO audit_log (user_id, action, detail, ip, created_at)
SELECT NULL, 'device_cat_fix', 'code=' || code || ' from=' || quote(cat_name) || ' to=未分类', 'migration',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM devices WHERE trim(cat_name, ' 　' || char(9, 10, 13)) = '';

UPDATE devices SET cat_name = '未分类', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE trim(cat_name, ' 　' || char(9, 10, 13)) = '';

DROP TABLE _dev_status_fix;
DROP TABLE _dev_status_map;
