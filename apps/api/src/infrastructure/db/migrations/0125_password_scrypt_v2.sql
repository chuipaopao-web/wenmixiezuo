-- AUTH-TAKEOVER-01：密码哈希参数列（scrypt-v2 接管）。
-- NULL=历史v1参数（n=16384,r=8,p=1，与rebuild "scrypt-v1-legacy"逐字节一致）；
-- 登录成功后透明升级为 v2（n=32768,r=8,p=3），参数随行存储，rebuild可免重哈希直接验证。
ALTER TABLE user_accounts ADD password_format TEXT;
ALTER TABLE user_accounts ADD password_n INTEGER;
ALTER TABLE user_accounts ADD password_r INTEGER;
ALTER TABLE user_accounts ADD password_p INTEGER;
