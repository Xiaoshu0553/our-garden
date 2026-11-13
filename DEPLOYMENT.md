# 自托管与运行

完整部署步骤见 [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)，桌宠使用与打包见 [COMPANION.md](COMPANION.md)。

支持两种运行方式：

- 原生 Node.js 24 + systemd，由已有 Nginx 提供 HTTPS。
- Docker Compose，可搭配 Caddy 或已有 Nginx。

部署模板位于 `deploy/`，请把 `PUBLIC_ORIGIN` / `SITE_DOMAIN` 替换为自己的实际访问域名。桌面端可在设置中连接自己的 HTTPS 服务。

升级前执行一致性备份。数据库、备份、账号凭据、模型密钥和部署私钥属于运行数据，不随源码或安装包分发。

0.3 增加多小花园隔离和伴侣邀请。旧版的两个账号及其项目会保留在原来的小花园；已有新注册账号时，不能直接使用缺少隔离能力的旧后端读取同一数据库。
