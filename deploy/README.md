# 一键部署说明

本目录提供 Ubuntu 22.04 x64 的部署脚本，目标是减少手写 Nginx/systemd 配置时的拼写错误。

推荐生产结构：

```text
浏览器 http/https
        │
        ▼
Nginx :80/:443
  ├─ /      -> client/dist 静态文件
  └─ /ws    -> 127.0.0.1:8787 WebSocket 后端
```

## 首次部署

在服务器执行：

```bash
git clone https://github.com/cuong25254625-hue/wujianfengyun.git
cd wujianfengyun
bash deploy/install.sh --domain 你的服务器IP --https off
```

如果你已经有域名，并希望预留 HTTPS/WSS：

```bash
bash deploy/install.sh --domain game.example.com
```

脚本默认：

- 部署目录：`/opt/wujianfengyun`
- 后端端口：`8787`
- Git 分支：`main`
- systemd 服务：`wujianfengyun-server`
- Nginx 前端站点：`/etc/nginx/sites-available/wujianfengyun`
- WebSocket 入口：`/ws`

## 常用参数

```text
--domain <域名或IP>       必填，公网访问地址
--repo <git-url>          仓库地址
--project-dir <path>      部署目录，默认 /opt/wujianfengyun
--branch <name>           分支，默认 main
--port <number>           后端端口，默认 8787
--https reserved|enabled|off
--skip-tests              跳过 npm test
```

HTTPS 模式说明：

- `reserved`：默认。前端构建为 `wss://域名/ws`，但不自动申请证书。适合 DNS 已准备好、稍后手动 Certbot。
- `enabled`：脚本会尝试安装 Certbot 并申请证书。要求域名已解析到服务器。
- `off`：前端构建为 `ws://域名或IP/ws`。适合 IP 临时测试。

## 更新部署

后续代码已推送到 GitHub 后，在服务器执行：

```bash
cd /opt/wujianfengyun
bash deploy/update.sh --domain 你的服务器IP --https off
```

域名部署：

```bash
bash deploy/update.sh --domain game.example.com
```

脚本会：

1. 检查 Git 工作区是否干净；
2. `git pull --ff-only` 拉取最新代码；
3. 重新生成 `client/.env.production`；
4. 执行 `npm ci`、`typecheck`、`test`、`build`；
5. `nginx -t` 通过后重启后端并 reload Nginx。

如果服务器上有临时改动，脚本会中止，避免覆盖。确实要继续时可加：

```bash
bash deploy/update.sh --domain game.example.com --allow-dirty
```

## 状态诊断

```bash
cd /opt/wujianfengyun
bash deploy/status.sh
```

会输出：

- OS / Node / npm 版本；
- Git 当前提交和工作区状态；
- `client/dist`、`server/dist`、`shared/dist` 是否存在；
- systemd 服务状态；
- Nginx 配置检查；
- 80/443/8787 端口监听；
- 最近后端和 Nginx 日志。

## 启用 HTTPS

前提：域名已经解析到服务器公网 IP，80 端口可访问。

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d game.example.com
sudo nginx -t
sudo systemctl reload nginx
```

然后重新构建前端，确保使用 WSS：

```bash
cd /opt/wujianfengyun
bash deploy/update.sh --domain game.example.com
```

访问：

```text
https://game.example.com/
```

## 常见问题

### 看到 Welcome to nginx

说明默认站点或其他站点抢占了 80 端口。执行：

```bash
bash deploy/status.sh
ls -la /etc/nginx/sites-enabled/
sudo nginx -T | grep -A20 -B5 'server_name'
```

一键脚本会删除默认站点 symlink 并启用 `wujianfengyun`。

### 后端服务反复 auto-restart

查看真实 Node 报错：

```bash
sudo journalctl -u wujianfengyun-server -n 100 --no-pager -l
```

也可以直接运行：

```bash
cd /opt/wujianfengyun
PORT=8787 NODE_ENV=production node server/dist/index.js
```

### 页面打开但创建房间失败

优先检查：

```bash
bash deploy/status.sh
```

确认：

- `wujianfengyun-server` 是 active；
- Nginx `/ws` 配置存在；
- `client/.env.production` 里的 `VITE_WS_URL` 正确；
- 重新执行过 `npm run build` 或 `deploy/update.sh`。
