# 两个人的小花园

一个只属于两个人的自托管空间。随手留下想一起做的事，保留讨论和资料，双方愿意时把它变成共同项目，再分工推进下一小步。

核心流程：**留下想法 → 彼此回应 → 一起探索 → 明确目标与分工 → 完成或暂放**。同一张卡片保存完整过程。

## 首版包含什么

- 最多两个独立账号；登录后共享同一个空间，无公开注册。
- 想法、共同目标、双方同意状态、分工待办、回顾日期。
- 留言、决定记录、带链接的参考资料。
- 手绘庭院风格、手机布局；真实空间从空白开始。
- SQLite 持久化、会话和密码保护、在线一致性备份。

不需要模型、音乐、邮件或电商平台 API 密钥。网站提供协作记录，具体项目的经营资料由你们自行收集和核实。

## 本地运行

需要 **Node.js 24.x**，项目使用内置 `node:sqlite`。没有第三方运行依赖，不需要 `npm install`。

在项目目录执行：

```sh
node scripts/accounts.mjs
node server.mjs
```

账号工具会询问创建或重置账号；先创建两人的账号。默认页面是 <http://localhost:3000>，默认数据目录是项目下的 `data/`。关闭后重新运行仍会保留内容。首次没有账号时，网页提示通过服务器账号工具初始化；没有开放注册入口。

另一个终端可执行检查：

```sh
node --test
```

常用环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址；容器内设为 `0.0.0.0` |
| `PORT` | `3000` | 应用端口 |
| `DATA_DIR` | 项目下 `data/` | 数据库及本地私密文件位置 |
| `PUBLIC_ORIGIN` | 按本地请求判断 | 正式访问源，例如 `https://cyberhome.wuhuxiaoshu.com`；不含尾部斜杠 |
| `COOKIE_SECURE` | `false` | HTTPS 部署设为 `true` |
| `BACKUP_DIR` | `DATA_DIR/backups` | 备份目录 |
| `BACKUP_KEEP` | `14` | 保留的成功备份份数 |

Linux/macOS 示例：`PORT=3100 node server.mjs`。PowerShell 示例：`$env:PORT='3100'`，再执行 `node server.mjs`。

## 当前生产部署：Node.js + systemd + 现有 Nginx

本次服务器使用原生 Node.js 运行，由 systemd 管理，复用服务器已有的 Nginx 提供 HTTPS。Docker 仍可作为其他环境的可选部署方式，见后续章节。

| 位置或设置 | 生产值 |
| --- | --- |
| 访问地址 | `https://cyberhome.wuhuxiaoshu.com` |
| 应用源码 | `/opt/our-garden` |
| Node.js | 官方 `v24.22.2` Linux x64，已核对发行包 SHA256 |
| Node 可执行文件 | `/opt/our-garden-runtime/bin/node` |
| 运行用户和组 | `ourgarden`，系统账号，禁止交互登录 |
| 私有数据目录 | `/var/lib/our-garden`，权限 `0700` |
| 数据库 | `/var/lib/our-garden/garden.sqlite` |
| 备份 | `/var/lib/our-garden/backups`，保留最近 14 份成功快照 |
| 应用监听 | 仅 `127.0.0.1:3000`，由已有 Nginx 反向代理 |
| 应用服务 | `our-garden.service`，开机启动，异常退出后重启 |
| 资源上限 | 应用内存 `384M`，V8 heap `128MB`，最多一个 CPU 核心时间 |

运行时可以从 [Node.js 官方发行目录](https://nodejs.org/dist/latest-v24.x/) 安装；更新运行时也应先校验对应的 `SHASUMS256.txt`。源码、运行时和数据目录独立，更新源码不会清空数据。应用不需要 `npm install` 或构建步骤。

### 服务安装与启动

以下是原生方式的安装命令，在普通 SSH 终端中以 root 执行。先确认官方 Node 已安装到上述路径、源码已放入 `/opt/our-garden`，并创建运行账号与私有目录：

```sh
getent group ourgarden >/dev/null || groupadd --system ourgarden
id -u ourgarden >/dev/null 2>&1 || useradd --system --gid ourgarden --home-dir /var/lib/our-garden --shell /usr/sbin/nologin ourgarden
install -d -o ourgarden -g ourgarden -m 0700 /var/lib/our-garden
```

安装应用服务、原生备份服务与定时器。原生备份模板的源文件带 `.native`，安装时使用定时器对应的标准服务名；不要同时启用 Docker 版备份服务：

```sh
cd /opt/our-garden
install -m 0644 deploy/our-garden.service /etc/systemd/system/our-garden.service
install -m 0644 deploy/our-garden-backup.native.service /etc/systemd/system/our-garden-backup.service
install -m 0644 deploy/our-garden-backup.timer /etc/systemd/system/our-garden-backup.timer
systemd-analyze verify /etc/systemd/system/our-garden.service /etc/systemd/system/our-garden-backup.service /etc/systemd/system/our-garden-backup.timer
systemctl daemon-reload
systemctl enable --now our-garden.service
curl --fail --silent --show-error http://127.0.0.1:3000/healthz
```

应用和备份均以非 root 账号运行，服务只允许写入 `/var/lib/our-garden`；源码和运行时保持只读。文件系统保护和权限配置参考 [Ubuntu systemd 执行环境说明](https://manpages.ubuntu.com/manpages/jammy/man5/systemd.exec.5.html)，资源限制参考 [资源控制说明](https://manpages.ubuntu.com/manpages/jammy/man5/systemd.resource-control.5.html)。

### 两人的账号与初始凭据

网页没有公开注册。以运行账号执行账号工具，并显式指定生产数据目录：

```sh
runuser -u ourgarden -- env DATA_DIR=/var/lib/our-garden /opt/our-garden-runtime/bin/node /opt/our-garden/scripts/accounts.mjs
```

需要无人值守初始化时，用下面的方式分别创建两人。示例昵称可以替换，最多两个账号：

```sh
runuser -u ourgarden -- env DATA_DIR=/var/lib/our-garden /opt/our-garden-runtime/bin/node /opt/our-garden/scripts/accounts.mjs --name '你' --generate /var/lib/our-garden/accounts.credentials.local
runuser -u ourgarden -- env DATA_DIR=/var/lib/our-garden /opt/our-garden-runtime/bin/node /opt/our-garden/scripts/accounts.mjs --name 'TA' --generate /var/lib/our-garden/accounts.credentials.local
```

生成的随机密码只写入私有凭据文件，不显示在终端或服务日志中。通过受信任的 SSH 通道取出并分别交给本人；首次登录后，可在“我的设置”修改昵称和密码。取用后的初始明文凭据文件可以删除，数据库继续保留密码散列；不将凭据放进源码、发布包或公开网页。

需要重置账号时运行交互工具，避免在命令行参数中放入新密码：

```sh
runuser -u ourgarden -- env DATA_DIR=/var/lib/our-garden /opt/our-garden-runtime/bin/node /opt/our-garden/scripts/accounts.mjs --reset --name '要重置的昵称'
```

### HTTPS 与登录访问源

本次生产使用现有 Nginx 的独立站点，将该域名转发至 `127.0.0.1:3000`。站点示例见 `deploy/nginx.conf`；证书和续期由服务器现有 HTTPS 管理方式维护。变更 Nginx 时先检查配置，再重载服务器现有实例。

`our-garden.service` 显式设置 `COOKIE_SECURE=true` 和 `PUBLIC_ORIGIN=https://cyberhome.wuhuxiaoshu.com`。正式登录使用域名 HTTPS 地址。Nginx 应转发 Cookie、`Set-Cookie` 与浏览器原始 `Origin`，不缓存 API 响应。配置了 HTTPS 的服务仅用本地 HTTP 做 `/healthz` 检查，不用本地 HTTP 地址登录。

### 日常状态、重启和日志

```sh
systemctl status our-garden.service --no-pager
systemctl restart our-garden.service
journalctl -u our-garden.service -n 80 --no-pager
systemctl show our-garden.service -p MainPID -p MemoryCurrent -p MemoryMax -p Result
```

应用的重启命令只操作小院服务。数据库在独立数据目录中，重启后账号、项目、分工与讨论继续保留。

### 原生方式的备份与恢复

服务启动并完成账号初始化后，启用每天北京时间 03:15 后五分钟内执行的备份任务。下面的手动启动会立即生成第一份一致性备份：

```sh
systemctl enable --now our-garden-backup.timer
systemctl start our-garden-backup.service
systemctl show our-garden-backup.service -p Result -p ExecMainStatus
systemctl list-timers our-garden-backup.timer --no-pager
journalctl -u our-garden-backup.service -n 30 --no-pager
```

备份服务成功后退出，显示 `Result=success`、`ExecMainStatus=0` 为正常结果。它与 Docker 方式使用同一个 SQLite 一致性备份脚本，包含 WAL 中已提交的内容，并检查快照完整性。需要手动运行脚本时：

```sh
runuser -u ourgarden -- env DATA_DIR=/var/lib/our-garden /opt/our-garden-runtime/bin/node /opt/our-garden/scripts/backup.mjs
```

备份仍在同一台服务器，应定期通过 SSH 复制一份到另一个私密位置。恢复前先停止应用与备份任务，再把下面的示例文件名替换为真实快照：

```sh
systemctl stop our-garden.service our-garden-backup.timer our-garden-backup.service
runuser -u ourgarden -- env DATA_DIR=/var/lib/our-garden /opt/our-garden-runtime/bin/node /opt/our-garden/deploy/restore.mjs /var/lib/our-garden/backups/garden-真实文件名.sqlite --app-stopped
```

确认恢复成功后再启动：

```sh
systemctl start our-garden.service our-garden-backup.timer
curl --fail --silent --show-error http://127.0.0.1:3000/healthz
```

恢复脚本保留恢复前的数据文件，清除恢复后的登录会话；两人需要重新登录。首版没有上传文件接口，业务数据均在 SQLite 中；资料卡里的外部链接目标由原网站保存。

### 原生方式更新源码

更新前先备份，然后停止小院应用：

```sh
systemctl start our-garden-backup.service
systemctl stop our-garden.service
```

用经过校验的发布包更新 `/opt/our-garden` 中的源码，保留 `/var/lib/our-garden` 的数据库、备份和凭据。如果服务模板也有变更，按前述步骤重新安装对应 unit。随后启动并检查：

```sh
systemctl daemon-reload
systemctl start our-garden.service
curl --fail --silent --show-error http://127.0.0.1:3000/healthz
journalctl -u our-garden.service -n 30 --no-pager
```

## Docker 部署（可选）

服务器需要已启动、允许你的 SSH 访问，并安装 Docker Engine 和 Compose 插件。Docker 官方支持 Ubuntu 22.04 x86_64；安装步骤见 [Ubuntu 官方安装说明](https://docs.docker.com/engine/install/ubuntu/)。本项目不修改服务器的 SSH 配置、防火墙或已有网站。

将项目源码放到 `/opt/our-garden` 或你选择的独立目录；不要上传本地 `data/`、凭据文件、`.env` 或其他项目的密钥。以下命令在该目录执行。

### 先通过 SSH 隧道私密访问

```sh
docker compose up -d --build
docker compose ps
docker compose exec app node scripts/accounts.mjs
```

先创建两个人的账号。用户名可以使用两人的昵称；密码由交互输入，不写入命令历史。

默认只绑定服务器的 `127.0.0.1:3000`。在自己电脑保持这个终端打开：

```sh
ssh -N -L 3000:127.0.0.1:3000 用户名@服务器地址
```

然后在自己电脑打开 <http://localhost:3000>。如果本机 3000 已占用，可用 `-L 3100:127.0.0.1:3000`，再访问 <http://localhost:3100>。此模式无需开放服务器 3000 端口。

如果服务器 3000 已有服务，在项目根目录的 `.env` 写入 `APP_PORT=3100`，重新启动，再使用 `-L 3000:127.0.0.1:3100`。

### 生成初始登录凭据

无人值守初始化时，可以让账号工具生成密码并写入已忽略的本地凭据文件。输出只显示文件位置，不显示密码。

```sh
docker compose exec -T app node scripts/accounts.mjs --name '你的昵称' --generate /app/data/accounts.credentials.local
docker compose exec -T app node scripts/accounts.mjs --name 'TA的昵称' --generate /app/data/accounts.credentials.local
```

凭据只存放在服务器的数据卷中。通过受信任的 SSH 会话读取，并分别交给本人；首次登录后在账号设置里修改密码。不要将此文件提交到 Git、打进源码包或通过公开链接分发。

需要重置某个账号时运行交互工具，或使用：

```sh
docker compose exec -T app node scripts/accounts.mjs --reset --name '要重置的昵称' --generate /app/data/accounts.credentials.local
```

重置会使这个人的旧会话失效。生成结果追加在凭据文件中；取用完毕后可删除这份初始明文凭据文件，数据库里只保留密码散列。

### 配置域名和 HTTPS

有域名后，两个人可以直接通过浏览器访问。先完成以下准备：

1. 将域名的 A 记录指向服务器公网 IPv4；只有配置了正确 IPv6 时才添加 AAAA。
2. 在云安全组和服务器防火墙放行 TCP 80、443；UDP 443 可选，用于 HTTP/3。
3. 确认 80、443 没有被其他网站占用。已有反向代理时，在原代理中增加这个域名的站点配置，转发至 `127.0.0.1:3000`，并配置应用的 `PUBLIC_ORIGIN` 与 `COOKIE_SECURE=true`。

使用附带的 Caddy 配置时：

```sh
cp deploy/env.example .env
```

`deploy/env.example` 已预填本空间的域名 `cyberhome.wuhuxiaoshu.com`。确认 `.env` 中的域名无误，再运行：

```sh
docker compose -f compose.yaml -f deploy/compose.https.yaml up -d --build
docker compose -f compose.yaml -f deploy/compose.https.yaml ps
docker compose -f compose.yaml -f deploy/compose.https.yaml logs --tail=80 caddy
```

Caddy 根据域名申请和续期证书，并将 HTTP 跳转至 HTTPS。上述 DNS、端口和证书持久化要求见 [Caddy 自动 HTTPS 文档](https://caddyserver.com/docs/automatic-https)。应用会切换为 Secure Cookie 并校验配置的访问源；请用域名的 `https://` 地址登录。

本空间的正式访问地址为 **https://cyberhome.wuhuxiaoshu.com**，需以容器健康、证书获取成功和实际登录验证作为部署完成依据。

启用这个覆盖配置后，后续 `up`、`build`、`stop`、`down` 操作都使用相同的两组 `-f` 参数。账号和备份的 `exec` 命令仍可使用默认配置，因为服务名与项目名相同。

## 数据与备份

Docker 数据保存在 `our-garden_garden_data` 命名卷中，应用路径是 `/app/data/garden.sqlite`。容器重新创建不会清空这个卷。不要运行 `docker compose down --volumes`，该命令会删除数据库及备份所在的卷。

手动在线备份：

```sh
docker compose exec -T app node scripts/backup.mjs
```

本地不使用 Docker 时：

```sh
node scripts/backup.mjs
node scripts/backup.mjs --backup-dir /另外的私密目录 --keep 30
```

脚本使用 [Node SQLite backup API](https://nodejs.org/api/sqlite.html#sqlitebackup-sourcedb-path-options) 获取包含 WAL 中已提交内容的一致性快照，执行完整性检查后保留最近 14 份成功备份。不会把运行中的主数据库直接当成备份复制。备份中包含两人的内容与密码散列，应当作为私密数据管理。

### 每天自动备份

附带的 systemd 模板默认项目目录是 `/opt/our-garden`。使用其他目录时，先编辑 `deploy/our-garden-backup.service` 的 `WorkingDirectory`。

```sh
sudo install -m 0644 deploy/our-garden-backup.service /etc/systemd/system/our-garden-backup.service
sudo install -m 0644 deploy/our-garden-backup.timer /etc/systemd/system/our-garden-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now our-garden-backup.timer
sudo systemctl start our-garden-backup.service
systemctl list-timers our-garden-backup.timer
```

任务每天在北京时间 03:15 后的五分钟窗口内运行，漏掉的任务会在恢复运行后补做。使用 `journalctl -u our-garden-backup.service -n 30` 查看备份结果。

备份默认仍在同一台服务器，建议定期通过 SSH 将备份复制到另一个私密位置。下载整个备份目录到当前电脑：

```sh
docker compose cp app:/app/data/backups/. ./backup-download/
```

### 从备份恢复

先停止应用，以免旧进程继续往原数据库写入。Caddy 可以继续运行。将命令中的文件名替换为真实的成功备份文件名。

```sh
docker compose stop app
docker compose run --rm --no-deps app node deploy/restore.mjs /app/data/backups/garden-真实文件名.sqlite --app-stopped
docker compose up -d app
```

使用 HTTPS 时，将上面的 `stop`、`run`、`up` 命令均加上 `-f compose.yaml -f deploy/compose.https.yaml`。恢复脚本先检查备份，再替换数据库；恢复前的主文件与 WAL、SHM 保留在 `data/before-restore-时间-标识/`，恢复后的会话全部失效，两人需要重新登录。

应用未提供文件上传接口，因此首版需要备份的业务数据全部在 SQLite 中；资料卡里的外部链接内容由链接目标自行保存。

## 更新与排查

每次更新前先运行一次备份，再替换源码并重建：

```sh
docker compose exec -T app node scripts/backup.mjs
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 app
```

HTTPS 部署的重建命令使用：

```sh
docker compose -f compose.yaml -f deploy/compose.https.yaml up -d --build
```

健康检查地址 `/healthz` 只返回运行状态，不返回个人数据。无法访问时，按 SSH 连接、容器健康、域名解析、HTTPS 证书、登录状态的顺序检查。登录后写入报访问源错误时，确认 `PUBLIC_ORIGIN` 与浏览器地址的协议、域名、端口完全一致。

默认应用容器内存上限 512MB，Caddy 上限 192MB；它们是初始资源预算，实际使用时可通过 `docker stats` 检查。服务器上已有其他服务时，应按实际余量调整。
