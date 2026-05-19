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

以下步骤面向一台全新的 Ubuntu 22.04 x64 服务器。示例中假设域名或服务器 IP 为 `<SERVER_IP_OR_DOMAIN>`。

### 1. 安装基础软件

```bash
sudo apt update
sudo apt install -y curl git nginx
```

安装 Node.js 20 LTS：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

### 2. 拉取代码

```bash
sudo mkdir -p /opt/wujianfengyun
sudo chown "$USER":"$USER" /opt/wujianfengyun
git clone https://github.com/cuong25254625-hue/wujianfengyun.git /opt/wujianfengyun
cd /opt/wujianfengyun
```

### 3. 安装依赖并构建

```bash
npm ci
npm run typecheck
npm test
npm run build
```

构建产物：

- 前端静态文件：`client/dist/`
- 服务端 JS：`server/dist/`
- 共享类型构建：`shared/dist/`

### 4. 配置前端 WebSocket 地址

生产环境建议显式设置前端连接的 WebSocket 地址。构建前在项目根目录创建 `.env.production`：

```bash
cat > .env.production <<'EOF'
VITE_WS_URL=ws://<SERVER_IP_OR_DOMAIN>:8787
EOF
```

如果使用 HTTPS 域名和反向代理，请改为：

```bash
VITE_WS_URL=wss://<SERVER_IP_OR_DOMAIN>/ws
```

然后重新构建：

```bash
npm run build
```

> 注意：Vite 的 `VITE_` 环境变量会在构建时写入前端产物，修改后需要重新 `npm run build`。

### 5. 用 systemd 运行后端

创建服务文件：

```bash
sudo tee /etc/systemd/system/wujianfengyun-server.service > /dev/null <<'EOF'
[Unit]
Description=Wujian Fengyun MVP WebSocket Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/wujianfengyun
Environment=NODE_ENV=production
Environment=PORT=8787
ExecStart=/usr/bin/node /opt/wujianfengyun/server/dist/index.js
Restart=always
RestartSec=3
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
EOF
```

授权并启动：

```bash
sudo chown -R www-data:www-data /opt/wujianfengyun
sudo systemctl daemon-reload
sudo systemctl enable --now wujianfengyun-server
sudo systemctl status wujianfengyun-server --no-pager
```

查看日志：

```bash
sudo journalctl -u wujianfengyun-server -f
```

### 6. 用 Nginx 托管前端

创建 Nginx 配置：

```bash
sudo tee /etc/nginx/sites-available/wujianfengyun > /dev/null <<'EOF'
server {
    listen 80;
    server_name <SERVER_IP_OR_DOMAIN>;

    root /opt/wujianfengyun/client/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # 如果前端 VITE_WS_URL 使用 wss://<domain>/ws，可开启此反向代理。
    location /ws {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
}
EOF
```

启用站点：

```bash
sudo ln -sf /etc/nginx/sites-available/wujianfengyun /etc/nginx/sites-enabled/wujianfengyun
sudo nginx -t
sudo systemctl reload nginx
```

### 7. 防火墙放行

如果直接使用 `ws://<服务器>:8787`：

```bash
sudo ufw allow 80/tcp
sudo ufw allow 8787/tcp
sudo ufw status
```

如果使用 Nginx `/ws` 反向代理，则公网只需要开放 80/443，8787 可仅监听内网或由安全组限制。

### 8. 访问测试

浏览器打开：

```text
http://<SERVER_IP_OR_DOMAIN>/
```

多人测试流程：

1. 房主输入昵称并创建房间。
2. 将房间号发给其他玩家。
3. 其他玩家打开同一地址，输入昵称和房间号加入。
4. 至少 4 人准备。
5. 房主开始游戏。
6. 按页面阶段依次执行宣胜跳过、试探、传递、锁定/截获、接收/拒收、濒死结算等操作。

## 常用运维命令

```bash
# 更新代码
cd /opt/wujianfengyun
git pull
npm ci
npm run build
sudo systemctl restart wujianfengyun-server
sudo systemctl reload nginx

# 查看后端状态
sudo systemctl status wujianfengyun-server --no-pager

# 查看后端日志
sudo journalctl -u wujianfengyun-server -f

# 检查端口
ss -lntp | grep -E '(:80|:8787)'
```

## 当前 MVP 限制

- 断线重连仍为后置增强项。
- 白方机密任务系统尚未完整实现。
- 首批人物技能存在 MVP 简化，复杂时机与部分线下口头判定后续继续细化。
- 当前房间状态保存在进程内，服务重启后房间会丢失。

## License

当前为私人 MVP 项目，暂未设置开源许可证。
