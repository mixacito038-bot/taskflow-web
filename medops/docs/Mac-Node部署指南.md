# Mac + Node.js 部署指南（备用方案，不用 Docker）

> ⚠ **这是备用方案。首选请看《局域网电脑部署指南.md》（Docker）**——
> Docker 的好处是本地跑通的东西能原样搬到云服务器，行为完全一致。
>
> **什么时候用这份**：Docker Desktop 装不上、或电脑装不动 Docker。
> 只需要装一个 Node.js，比 Docker 轻得多，功能一模一样。
>
> 两套共用同一个 `data` 文件夹，**以后随时能换过去，数据不用动**。
>
> 全程约 15～30 分钟。

---

## 一、这套和 Docker 那套的区别

**功能完全一样**——同一份后端代码、同一个管理后台、同一个手机页面、同一个数据库格式。
差别只在"程序怎么跑起来"这一层：

| | **Node 方案（本文）** | Docker 方案 |
|---|---|---|
| 要装什么 | Node.js，约 60MB，一路下一步 | Docker Desktop，约 1GB，占内存 |
| 网页服务器 | 随包的一个小程序（已实测） | nginx（业界标准） |
| 开机自启 | 系统服务（launchd），本脚本自动装 | Docker Desktop 设置里勾选 |
| 崩了会自己起来吗 | **会**（两层守护，实测 2 秒恢复） | 会 |
| 默认端口 | 8080 | 80 |
| 占用资源 | 更小 | 多一层虚拟机 |
| 环境隔离 | 无（直接跑在系统上） | 有 |
| 升级 | 覆盖文件 + 重启服务 | 重新构建镜像 |

**数据格式完全一致**：两套用的是同一个 `data` 文件夹。
以后 Docker 装好了想换过去，把服务停掉直接换即可，数据不用动。

**该选哪个？** 你的规模（几十个账号、每天几百条记录）两套都绰绰有余。
Docker 装不顺就用这套，不用纠结。

---

## 二、准备这台 Mac

### ⚠ 三个必须满足的条件

- [ ] **能一直开机不关**——这台 Mac 关了，全院就都用不了
- [ ] **不是某个人正在办公的电脑**
- [ ] **插电源**，最好接 UPS

### ⚠ 关掉睡眠（最容易翻车）

**电脑一睡眠 = 全院断服。**

**台式（Mac mini / iMac / Mac Studio）**
系统设置 → 节能（或「锁定屏幕」）→ 勾选 **「防止电脑自动进入睡眠」**。

**笔记本（MacBook）**
合上盖子就睡。三选一：

1. **别合盖**，屏幕亮度调到最低（最省事）
2. 接电源 + 外接显示器，用合盖不休眠模式
3. 终端执行（需输开机密码）：

```
sudo pmset -a disablesleep 1
```

> 恢复默认：`sudo pmset -a disablesleep 0`

说实话，MacBook 长期当服务器不合适（合盖、电池、容易被带走）。有 Mac mini 优先用那个。

---

## 三、⚠ 固定这台 Mac 的 IP

手机扫的二维码里写死的是这台 Mac 的 IP。IP 一变，**全院贴出去的二维码集体失效**。

**方法 A（推荐）**：在路由器里做「IP/MAC 绑定」/「地址保留」，找网管办。

**方法 B**：系统设置 → 网络 → 选中正在用的网络 → 详细信息 → TCP/IP →
「配置 IPv4」改为 **「手动」** → 填 IP、子网掩码、路由器地址。
**填之前先问网管要一个没人用的 IP。**

查当前 IP（终端）：

```
ipconfig getifaddr en0
```

> 插网线的话用这条自动识别：
> `ipconfig getifaddr $(route -n get default | awk '/interface:/{print $2}')`
> 部署脚本跑完也会直接打印 IP，不用自己查。

把 IP 记在这里：`________________`

---

## 四、装 Node.js

打开 [https://nodejs.org/](https://nodejs.org/)，下载 **LTS 长期支持版**（选 macOS Installer .pkg），
一路下一步装完。

装完**关掉终端再重开**，然后验证：

```
node -v
```

显示 `v18` 以上即可（如 `v22.14.0`）。

> Apple 芯片（M 系列）和 Intel 芯片都支持，官网会自动给对应版本。

---

## 五、放代码并部署

### 1. 解压

把压缩包解压，把 `medops` 文件夹放到**个人文件夹**下，即 `~/medops`
（完整路径类似 `/Users/你的用户名/medops`）。

> 解压后**同级**会自动生成一个 `data` 文件夹（`~/data`）存放全部数据，**这就是全部家当，别删。**

### 2. 运行一键部署

打开「终端」（聚焦搜索输入「终端」回车），执行：

```
cd ~/medops/deploy/nodejs
bash setup.sh
```

> 小技巧：在访达里进到 `nodejs` 文件夹，右键 →「服务」→「新建位于文件夹位置的终端窗口」，
> 就不用手敲路径，直接输 `bash setup.sh`。

### 3. 按提示操作

| 步骤 | 脚本做什么 | 你要做什么 |
|---|---|---|
| 0 | 检查 Node.js 版本 | 等着 |
| 1 | 安装后端依赖并逐个自检 | **等 1～3 分钟**（要联网） |
| 2 | 生成密钥、建数据目录 | 等着 |
| 3 | 创建管理员账号 | **输入账号（建议 admin）和密码（至少 6 位）** |
| 4 | 安装开机自启服务 | **输入你的 Mac 开机密码**（装系统服务需要） |
| 5 | 等待服务就绪 | 等着 |

> 输密码时**屏幕上不显示任何字符**（连星号都没有），这是正常的，照打然后回车。

结束后屏幕会打印访问地址，**抄下来**。

---

## 六、验收：五件事都做一遍

### 1. 本机打开

浏览器输入 `http://localhost:8080/`，应看到入口页。

### 2. 另一台电脑打开

同一局域网的电脑输入 `http://这台Mac的IP:8080/`（如 `http://192.168.1.50:8080/`）。

### 3. 手机打开

手机连**同一个 WiFi**，浏览器输入同样地址。再用**微信扫一扫**试一次。

### 4. 登录管理后台

`http://192.168.1.50:8080/admin/`，用刚创建的管理员账号登录。

### 5. ⚠ 检查服务器时间

登录后看首页右上角「服务器时间」，**必须等于当前北京时间**。

不对的话：系统设置 → 通用 → 日期与时间 → 打开「自动设置时间和日期」，
然后 `cd ~/medops/deploy/nodejs && bash manage.sh restart`。

> 三级签字的"今天是哪天"全靠服务器时间裁决，时间错了签字日期全错，且很难发现。

---

## 七、日常操作

全部在 `~/medops/deploy/nodejs` 目录下执行：

| 想做什么 | 命令 |
|---|---|
| 看状态 | `bash manage.sh status` |
| 看日志（实时） | `bash manage.sh logs`（Ctrl+C 退出） |
| 重启 | `bash manage.sh restart` |
| 停止 | `bash manage.sh stop` |
| 启动 | `bash manage.sh start` |
| 立刻备份一次 | `bash manage.sh backup` |
| 卸载开机自启（不删数据） | `bash manage.sh uninstall` |

**Mac 重启后不用管任何事**——服务是系统级的，开机自动起来，不需要有人登录。

### 改端口

编辑 `~/medops/deploy/nodejs/config.env`，把 `PORT=8080` 改成别的，然后：

```
bash manage.sh restart
```

> **想用 80 端口（地址里不带 `:8080`）**？macOS 上 1024 以下端口需要 root 权限，
> 直接改会启动失败。可以用端口转发：
> `echo "rdr pass inet proto tcp from any to any port 80 -> 127.0.0.1 port 8080" | sudo pfctl -ef -`
> （重启失效，需要写成开机项。**其实不必折腾——二维码是扫的，没人手打地址。**）

---

## 八、常见问题

| 现象 | 处理 |
|---|---|
| `node: command not found` | Node.js 没装好，或装完没重开终端。重开终端再试 |
| `npm install` 卡住或失败 | 先换国内镜像：`npm config set registry https://registry.npmmirror.com`，再重跑 |
| 提示依赖不完整 | 删掉 `~/medops/server/node_modules` 后重跑 setup.sh |
| 提示端口被占用 | 改 `config.env` 里的 `PORT`，`bash manage.sh restart` |
| 手机连不上 | ① 确认同一 WiFi；② 系统设置 → 网络 → 防火墙，允许 node 接受传入连接（Mac 防火墙默认是关的）；③ 让网管确认手机网段能访问这台 Mac |
| 睡一觉起来打不开 | 电脑睡眠了，见第二节 |
| 重启后打不开 | `bash manage.sh status` 看服务状态；不正常就 `bash manage.sh start` |
| IP 变了二维码失效 | IP 没固定，回第三节 |
| 想从零重来 | `bash manage.sh stop`，删掉 `~/data` 文件夹，重跑 `bash setup.sh` |

---

## 九、⚠ 备份（不能省）

自动备份每天凌晨 02:30 生成，存在 `~/data/backups/`，保留 30 天。
**但它和数据在同一块硬盘上——这台 Mac 坏了，两边一起没。**

### 必须做的

每周固定时间，把整个 `~/data` 文件夹复制到**另一台电脑或移动硬盘**：

```
cp -R ~/data ~/Desktop/巡检备份-$(date +%Y%m%d)
```

然后把桌面上这个文件夹拷到移动硬盘或另一台电脑。

- [ ] 责任人：`________________`
- [ ] 时间：建议每周一上午
- [ ] 存放位置：`________________`

### 怎么恢复（已实测验证）

新电脑上装好 Node.js、解压 medops、把备份的 `data` 文件夹放回**与 medops 同级**的位置，
再跑一次 `bash setup.sh` 即可——科室、设备、账号、签字记录会原样回来。

> **上线第一周务必演练一次恢复**，不然备份等于没有。

---

## 十、以后想换成 Docker 或云服务器

数据格式完全一样，换过去只需三步：

1. `bash manage.sh stop && bash manage.sh uninstall`（停掉 Node 服务）
2. `data` 文件夹原地不动（Docker 方案用的是同一个位置）
3. 按《局域网电脑部署指南.md》跑 Docker 的部署脚本

想上公网（护士长在家也能签字）就按《部署手册.md》，把 `data` 文件夹传到云服务器即可。

---

## 附录：Linux 服务器上常驻（非 Mac）

`setup.sh` 在 Linux 上会用 `nohup` 后台启动，但重启后不会自动拉起。
要开机自启，建一个 systemd 服务：

```
sudo tee /etc/systemd/system/medops.service > /dev/null <<'EOF'
[Unit]
Description=急救设备巡检系统
After=network.target

[Service]
Type=simple
User=你的用户名
WorkingDirectory=/opt/medops/deploy/nodejs
ExecStart=/usr/bin/node /opt/medops/deploy/nodejs/serve.js
Restart=always
RestartSec=10
Environment=TZ=Asia/Shanghai

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now medops
sudo systemctl status medops
```
