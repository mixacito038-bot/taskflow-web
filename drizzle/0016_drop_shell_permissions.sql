-- 删除两条空壳权限。
--
-- audit.view：整个 app/ 下没有一处 hasPermission("audit.view")，也不在任何菜单的
-- permissions 里；权限中心只有 医院/成员/角色 三个页签，根本没有审计日志页面。
-- connector.manage：同样没有任何 hasPermission 判定，数据准备中心全文无 connector 相关界面；
-- 服务端虽有 create_connector/update_connector 两个 action 的守卫，但全仓库没有任何前端调用方。
--
-- 空壳权限比没有权限更糟：医院在角色里勾上它，以为关住了某个功能，实际什么都没关。
-- 种子用的是 INSERT OR IGNORE，回刷不到已有库，所以存量必须用这个迁移清。
-- 先删授权再删权限本身，避免 role_permissions 留下指向不存在权限的孤儿行。
DELETE FROM `role_permissions` WHERE `permission_code` IN ('audit.view', 'connector.manage');
--> statement-breakpoint
DELETE FROM `permissions` WHERE `code` IN ('audit.view', 'connector.manage');
