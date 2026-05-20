# 无间风云基础人物版 MVP

这是一个基于《无间风云》规则文档制作的快速可玩 Web MVP。项目目标是先跑通多人联机核心对局，再逐步补完白方任务、更多基础人物和线上可用性能力。

## 当前能力

- 房间系统：创建房间、加入房间、准备、房主开始游戏。
- 身份系统：支持 4-8 人局，红/蓝/白身份暗置，死亡后翻身份。
- 角色系统：已接入首批 10 个基础人物及角色图片。
- 情报系统：真情报 / 假情报、传递、接收、拒收、情报归属结算。
- 常规技能：试探、锁定、截获。
- 生死胜利：假情报上限濒死、死亡结算、杀人奖励试探、红蓝三真宣胜、红蓝清场宣胜。
- Web 调试界面：多浏览器窗口可进行核心对局测试。

首批角色：陈永仁、刘建明、福尔摩斯、成步堂龙一、开膛手杰克、秋濑或、绫里千寻、C.C、绫波丽、我妻由乃。

## 技术栈

- Monorepo：npm workspaces
- 共享类型：TypeScript
- 服务端：Node.js + TypeScript + ws
- 客户端：React + TypeScript + Vite
- 通信协议：WebSocket + JSON

## 目录结构

```text
.
├── client/              # React + Vite 前端
│   └── public/characters/ # 角色图片
├── server/              # Node.js WebSocket 服务端
├── shared/              # 共享领域类型与协议
├── outputs/             # 规则整理与架构设计文档
├── package.json         # workspace 根配置
└── tsconfig.base.json
```

## 本地开发

### 环境要求

- Node.js 20 LTS 或更高版本
- npm 10 或更高版本

### 安装依赖

```bash
npm install
```

### 启动前后端开发服务

```bash
npm run dev
```

默认端口：

- 前端：`http://localhost:5180/`
- 后端 WebSocket：`ws://localhost:8787`

也可以分别启动：

```bash
npm run dev:server
npm run dev:client
```

### 验证命令

```bash
npm run typecheck
npm test
npm run build
```

## Ubuntu 22.04 x64 服务器部署

推荐使用 `deploy/` 目录下的一键脚本，减少手写 Nginx / systemd 配置时的拼写错误。生产推荐结构是：Nginx 托管 `client/dist`，并把 `/ws` 反向代理到本机后端 `8787`。公网只需要开放 80/443，后续可平滑升级 HTTPS/WSS。

### 推荐：首次一键部署

IP 临时测试：

```bash
git clone https://github.com/cuong25254625-hue/wujianfengyun.git
cd wujianfengyun
bash deploy/install.sh --domain <SERVER_IP> --https off
```

域名部署并预留 HTTPS/WSS：

```bash
git clone https://github.com/cuong25254625-hue/wujianfengyun.git
cd wujianfengyun
bash deploy/install.sh --domain <YOUR_DOMAIN>
```

脚本默认会：

- 安装 `curl git nginx`；
- 安装/检查 Node.js 20；
- 拉取或更新 `/opt/wujianfengyun`；
- 生成 `client/.env.production`；
- 执行 `npm ci`、`npm run typecheck`、`npm test`、`npm run build`；
- 写入并启动 `wujianfengyun-server` systemd 服务；
- 写入 Nginx 站点配置；
- 删除默认 Nginx 站点 symlink；
- 执行 `nginx -t`，成功后 reload Nginx。

常用参数：

```text
--domain <域名或IP>       必填，公网访问地址
--project-dir <path>      部署目录，默认 /opt/wujianfengyun
--branch <name>           分支，默认 main
--port <number>           后端端口，默认 8787
--https reserved|enabled|off
--skip-tests              跳过 npm test
```

### 推荐：更新部署

代码推送到 GitHub 后，服务器执行：

```bash
cd /opt/wujianfengyun
bash deploy/update.sh --domain <SERVER_IP> --https off
```

域名部署：

```bash
cd /opt/wujianfengyun
bash deploy/update.sh --domain <YOUR_DOMAIN>
```

更新脚本会检查 Git 工作区是否干净，默认使用 `git pull --ff-only`，避免覆盖服务器上的临时改动。

### 推荐：状态诊断

```bash
cd /opt/wujianfengyun
bash deploy/status.sh
```

诊断脚本会输出：

- OS / Node / npm 版本；
- Git 当前提交与工作区状态；
- `client/dist/index.html`、`server/dist/index.js`、`shared/dist/index.js` 是否存在；
- `wujianfengyun-server` 服务状态；
- Nginx 配置测试结果；
- 80/443/8787 端口监听；
- 最近后端和 Nginx 日志。

### HTTPS 启用

如果域名已经解析到服务器，并且 80 端口可访问：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <YOUR_DOMAIN>
sudo nginx -t
sudo systemctl reload nginx
```

然后重新构建前端，确保 WebSocket 使用 WSS：

```bash
cd /opt/wujianfengyun
bash deploy/update.sh --domain <YOUR_DOMAIN>
```

HTTPS 启用后访问：

```text
https://<YOUR_DOMAIN>/
```

### 手动部署参考

如果脚本无法满足特殊服务器环境，可参考 `deploy/README.md` 中的脚本行为手动处理。关键点：

- Vite 生产环境变量应写入 `client/.env.production`；
- 使用 Nginx `/ws` 反代时，推荐：`VITE_WS_URL=wss://<YOUR_DOMAIN>/ws`；
- IP 临时测试可用：`VITE_WS_URL=ws://<SERVER_IP>/ws`；
- 修改 `client/.env.production` 后必须重新 `npm run build`；
- systemd 后端入口是 `/opt/wujianfengyun/server/dist/index.js`；
- Nginx 前端根目录是 `/opt/wujianfengyun/client/dist`。

### 多人测试流程

1. 房主输入昵称并创建房间。
2. 将房间号发给其他玩家。
3. 其他玩家打开同一地址，输入昵称和房间号加入。
4. 至少 4 人准备。
5. 房主开始游戏。
6. 按页面阶段依次执行宣胜跳过、试探、传递、锁定/截获、接收/拒收、濒死结算等操作。

## 常用运维命令

```bash
# 更新代码并重启
cd /opt/wujianfengyun
bash deploy/update.sh --domain <SERVER_IP_OR_DOMAIN>

# 一键诊断
bash deploy/status.sh

# 查看后端状态
sudo systemctl status wujianfengyun-server --no-pager -l

# 查看后端日志
sudo journalctl -u wujianfengyun-server -f

# 检查端口
ss -lntp | grep -E '(:80|:443|:8787)'
```

## 当前 MVP 限制

- 断线重连仍为后置增强项。
- 白方机密任务系统尚未完整实现。
- 首批人物技能存在 MVP 简化，复杂时机与部分线下口头判定后续继续细化。
- 当前房间状态保存在进程内，服务重启后房间会丢失。

## License

当前为私人 MVP 项目，暂未设置开源许可证。
