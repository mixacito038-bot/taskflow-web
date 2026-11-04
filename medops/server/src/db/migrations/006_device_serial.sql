-- 设备序列号（选填）：设备铭牌上的出厂序列号（S/N），空串表示没填。
-- 不设唯一约束：不同厂家的序列号可能撞号，且多数设备一开始不会补录。
ALTER TABLE devices ADD COLUMN serial TEXT NOT NULL DEFAULT '';
