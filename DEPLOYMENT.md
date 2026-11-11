# 本次生产部署记录

日期：2026-11-12（Asia/Shanghai）

- 正式地址：https://cyberhome.wuhuxiaoshu.com/
- 服务器：Ubuntu 22.04 x86_64。
- 应用目录：`/opt/our-garden`。
- 独立运行时：`/opt/our-garden-runtime/bin/node`，Node.js v24.22.2；来自 nodejs.org 官方发行包，已核验官方 SHA256。
- 运行账号：系统用户 `ourgarden`，无交互登录 shell。
- 监听：`127.0.0.1:3000`；现有 Nginx 为本域名提供 HTTPS 反向代理。
- 服务：`our-garden.service`，已启用开机启动；384MB 内存上限，Node heap 128MB。
- 数据：`/var/lib/our-garden/garden.sqlite`，由 `ourgarden` 拥有，目录权限 0700。
- 站点配置：`/www/server/panel/vhost/nginx/cyberhome.wuhuxiaoshu.com.conf`。
- TLS 证书：`/etc/letsencrypt/live/cyberhome.wuhuxiaoshu.com/`；签发成功，Certbot timer 已启用，模拟续期成功。
- 备份：`our-garden-backup.timer` 每天北京时间 03:15 起运行（最多随机延迟 5 分钟），保留最近 14 份一致性快照。
- 首份备份已通过完整性校验，并通过 SSH 下载至本机 `.local/first-production-backup.sqlite`。
- 本次使用原生 Node + systemd 运行；Docker Hub 连接超时，未启动本项目的 Docker 容器。Docker 配置仍作为可选部署方式保留。

## 已完成的验收

1. 本地 28 项自动测试全部通过；同版本页面完成桌面和手机交互检查。
2. 正式域名 HTTPS 验证正常，匿名请求无法读取私有数据；登录 Cookie 包含 Secure、HttpOnly、SameSite=Strict。
3. 两个真实账号完成共享想法、双方确认、共同目标、分工、完成待办、讨论、资料和决定记录检查。
4. 仅重启本应用后，上述记录仍存在。
5. 验收项目已由发起人移除，两人已登出；初始正式空间为空。
6. 首份正式备份包含 2 个账号、0 个项目、0 个会话，`PRAGMA quick_check` 返回 `ok`。
7. 应用服务、备份 timer、证书续期 timer 均为 active；证书模拟续期成功。

正式页面的内置浏览器自动化出现连接及绑定超时，未能再次完成线上页面操作；线上 HTTPS 接口完整流程已通过，前端文件与本地已验收版本一致。

## 日常维护

```sh
systemctl status our-garden.service
journalctl -u our-garden.service -n 80 --no-pager
systemctl restart our-garden.service
systemctl start our-garden-backup.service
systemctl list-timers our-garden-backup.timer
```

账号创建、密码重置、更新、备份和恢复步骤见 [README.md](README.md) 的原生部署章节。私有账号凭据、数据库和部署私钥均不包含在 Git 或源码发布包中。
