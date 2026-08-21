-- 有效期提醒：给设备加"有效期"与"提醒提前量"
-- 场景：除颤电极片、急救药品、氧气瓶等有保质期，过期在抢救时才发现后果严重。
-- 约定：expiry_date 为 YYYY-MM-DD（Asia/Shanghai 自然日），空串表示该设备不适用有效期。
--       remind_days 为到期前多少天开始提醒，0 表示用全局默认（30 天）。

ALTER TABLE devices ADD COLUMN expiry_date TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN expiry_note TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN remind_days INTEGER NOT NULL DEFAULT 0;

-- 按到期日筛选是高频查询（每次开首页都算），建索引；空串行不参与
CREATE INDEX idx_devices_expiry ON devices(expiry_date) WHERE expiry_date <> '';
