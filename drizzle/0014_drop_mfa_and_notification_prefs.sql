-- 二维码二次验证（MFA）与消息偏好按需求整体下线，对应存储一并清除。
-- 保留 app_sessions / account_credentials 等会话与密码登录相关表不动。
DROP TABLE IF EXISTS `account_recovery_codes`;
--> statement-breakpoint
DROP TABLE IF EXISTS `account_mfa_settings`;
