<p align="center"><img src="public/favicon.svg" width="64" alt="小花园"></p>

<h1 align="center">Our Garden · 小花园</h1>

<p align="center">桌面上一只小伙伴，替两个人记住想法。</p>

<p align="center">情侣桌宠 · 共享想法 · 共同目标</p>

<p align="center">
  <a href="https://github.com/Xiaoshu0553/our-garden/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Xiaoshu0553/our-garden/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node.js 24+" src="https://img.shields.io/badge/Node.js-24%2B-657957">
  <img alt="Windows and macOS" src="https://img.shields.io/badge/Desktop-Windows%20%7C%20macOS-7e916b">
</p>

<p align="center">
  <a href="https://github.com/Xiaoshu0553/our-garden/releases/latest">下载 Windows / Mac 软件</a> ·
  <a href="COMPANION.md">桌宠使用说明</a> ·
  <a href="docs/SELF_HOSTING.md">自己部署</a>
</p>

## 下载安装

这是一款安装在电脑上的桌面宠物软件。请选择对应安装包，使用时不需要安装 Node.js 或开发工具。

| 电脑 | 下载 0.4.4 |
| --- | --- |
| Windows 10 / 11，x64 | [安装版 EXE](https://github.com/Xiaoshu0553/our-garden/releases/download/v0.4.4/Garden-Companion-0.4.4-win-x64-setup.exe) · [便携版 EXE](https://github.com/Xiaoshu0553/our-garden/releases/download/v0.4.4/Garden-Companion-0.4.4-win-x64-portable.exe) |
| Mac M 系列芯片，macOS 13+ | [Apple Silicon DMG](https://github.com/Xiaoshu0553/our-garden/releases/download/v0.4.4/Garden-Companion-0.4.4-mac-arm64.dmg) |
| Mac Intel，macOS 13+ | [Intel DMG](https://github.com/Xiaoshu0553/our-garden/releases/download/v0.4.4/Garden-Companion-0.4.4-mac-x64.dmg) |

Windows 安装版按向导安装；便携版直接运行。Mac 打开 DMG，将“小花园桌宠”拖入“应用程序”。默认连接共享服务器，两个人分别注册后即可用邀请码连接。

安装包、源码、SHA-256 校验值和原生构建检查记录均位于 [Releases](https://github.com/Xiaoshu0553/our-garden/releases/latest)。当前 Mac 使用 ad-hoc 签名，尚未进行 Apple Developer ID 签名或公证；Windows 安装包也暂未购买代码签名证书。

## 为什么做这个

小花园是一款面向情侣的桌面宠物与双人协作工具。两个人各自注册，通过邀请码连接，在各自的电脑上记录灵感、接收对方的提醒，一起整理想做的事。

两个人经常会突然想到一件想一起做的事：录一期播客、安排一趟旅行，或者养成一个小习惯。念头散落在聊天里，很容易被后来的消息盖住。

小花园把这个入口放到桌面上。单击小狗或小猫，就能随手记下一句话；原话会先保存，再带到伴侣的电脑上。两个人都愿意之后，再把它变成共同目标，留下讨论，分工走下一小步。

## 看看它的样子

**单击宠物，打开快捷输入卡片。**

<img src="docs/images/quick-capture.png" width="640" alt="单击桌宠弹出的快捷记录卡片">

**双击或右键进入主界面，查看共同记录和目标。**

<p>
  <img src="docs/images/companion-home.png" width="360" alt="小花园桌宠主界面">
  <img src="docs/images/shared-goals.png" width="360" alt="双方确认后的共同目标与分工">
</p>

截图使用演示账号和测试记录。

## 已经能做什么

- **桌面陪伴**：Windows / macOS，小狗、小猫，可导入自定义静态形象；支持拖动、托盘、快捷键和免打扰。
- **随手记录**：单击打开快捷卡片，双击或右键打开完整界面；两种窗口分别保留草稿。
- **注册与配对**：各自注册，用一次性邀请码连接伴侣；可解除绑定，双方保留各自可查看的只读历史。每个小花园最多两人，不同小花园的数据相互隔离。
- **双人同步**：共享想法、留言、持久未读与送达 / 已读回执，通过 SSE 接收更新。
- **共同目标**：直接发起共同话题，等待对方确认后推进目标，记录下一步、负责人和完成状态。
- **离线待发**：已登录的电脑断网时先保存原话，重连后重发，并避免生成重复记录。
- **软件更新**：服务器发布新版本时收到提醒，由用户点击下载；核对安装包大小与 SHA-256 后再打开安装包。
- **自托管**：客户端默认使用共享服务器，也能连接自己的 HTTPS 服务。

## 两个人开始使用

第一次使用可在软件的“设置”或右键／托盘菜单选择“使用教程”，在软件内离线阅读图文说明。简要步骤也可查看 [COMPANION.md](COMPANION.md)。

1. 打开桌宠，双击进入主界面，注册自己的账号。
2. 在设置里生成伴侣邀请码，把它交给对方。
3. 对方在注册时填写，或登录后输入邀请码加入。
4. 单击宠物写下一句话，点击“记录并分享”。

邀请码有效 24 小时，只能使用一次。已有记录的单人小花园加入伴侣前，需要确认把这些记录一起分享。

桌宠默认连接本项目的线上服务，也可以在设置里填写自己的 HTTPS 小花园地址。Windows 使用 `Ctrl + Shift + Space`，Mac 使用 `⌘ + Shift + Space` 打开快捷卡片。

设置中可检查软件版本。更新提醒不会自动下载；点击“下载并安装”后才开始下载，校验成功后打开对应安装包并退出旧版。Mac 打开 DMG 后仍需将应用拖入“应用程序”完成替换。

## 开发与自托管

后端需要 Node.js 24 或更新版本，使用内置 `node:sqlite`，没有第三方运行依赖。

```sh
git clone https://github.com/Xiaoshu0553/our-garden.git
cd our-garden
node server.mjs
```

打开 `http://localhost:3000` 使用网页。桌宠界面的浏览器预览位于 `http://localhost:3000/companion/index.html`；在地址后加上 `?demo=1` 可体验本机双人演示。

开发桌面端：

```sh
cd desktop
npm install
npm start
```

桌面端也提供 `pnpm-lock.yaml`。Windows 打包执行 `npm run dist:win`，生成安装版和便携版；在 Mac 构建环境执行 `npm run dist:mac`，生成 DMG 和 ZIP。GitHub Actions 的 [Desktop installers](.github/workflows/desktop.yml) 工作流分别在 Windows、Apple Silicon Mac 和 Intel Mac 构建机上生成安装包。详细步骤见 [COMPANION.md](COMPANION.md)。

共享服务是桌宠的配套同步组件，使用 Node.js 内置 SQLite，支持 HTTPS、Docker、systemd 与一致性备份。部署见 [自托管说明](docs/SELF_HOSTING.md)；网页提供辅助访问和开发预览。

## 技术结构

```mermaid
flowchart LR
  W[Windows 桌宠] -->|HTTPS| S[Node.js 服务]
  M[Mac 桌宠] -->|HTTPS| S
  B[网页] -->|HTTPS| S
  S --> D[(SQLite)]
  S -->|SSE 更新| W
  S -->|SSE 更新| M
```

| 目录 | 内容 |
| --- | --- |
| `desktop/` | Electron 主进程、安全桥接与桌面检查 |
| `public/companion/` | 桌宠界面、注册配对、猫狗形象与本机演示 |
| `public/` | 网页协作界面 |
| `lib/` | SQLite、账号、小花园隔离与同步 |
| `test/` | 后端、权限、迁移、备份与注册检查 |
| `deploy/` | HTTPS、Docker、systemd 与恢复模板 |
| `docs/` | 项目截图与自托管说明 |

## 验证

```sh
npm test
npm run package
```

当前有 49 项后端与更新测试，覆盖注册登录、邀请码竞争、跨小花园隔离、解绑与历史权限、共同话题、会话、备份恢复、更新提醒与安装包校验。CI 在 Linux 与 Windows 上执行测试及源码包检查。

桌面检查另外覆盖单击 / 双击、双账号同步、共同话题提交、解绑、只读历史、更新提醒时保留草稿、离线重发、会话恢复，以及便携 EXE 重复启动后的资源完整性，见 [`desktop/test/`](desktop/test/)。Mac 原生构建检查 DMG、应用签名、架构与启动；这些检查不代替两台实体 Mac 的日常使用验收。

当前自定义形象为静态图片；语音、照片生成动画、手机推送、静默安装更新和宠物跨屏互访尚未接入。

---

作者：[@Xiaoshu0553](https://github.com/Xiaoshu0553)
