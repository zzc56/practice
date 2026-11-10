# 知序在线刷题网站

电脑、平板和手机均可使用。目前收录 **533 道数据结构题**、**2 道数据库测试题**和 **10 道概率论选择题**（2024–2025、2022–2023 期末卷），提供章节练习、随机练习、题目检索、错题本、收藏、学习统计和备份导入导出。

新账号使用管理员按科目生成的一次性邀请码注册；登录后可在多台设备间同步学习进度。后端使用 Node.js 24 内置 HTTP、加密和 SQLite 模块，不依赖外部数据库，也不需要 `npm install` 或前端构建。

[本地运行](#本地运行) · [服务器部署](#服务器部署) · [管理后台](#管理后台) · [备份与更新](#备份与更新) · [题库与参考答案](#题库与参考答案) · [检查与测试](#检查与测试)

## 本地运行

安装 Node.js 24 或更高版本。在项目目录把 `.env.example` 复制为 `.env`，设置 `ADMIN_PASSWORD`，然后运行：

```bash
npm start
```

在浏览器打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。首次运行会创建 `data/practice.sqlite`。访问 [管理后台](http://127.0.0.1:3000/admin/) 生成邀请码。已有账号可以直接登录。

仅检查静态页面时可运行 `npm run preview:static`，默认地址为 `http://127.0.0.1:8713`。注册、登录、题库读取和同步需要完整的 Node 服务。

## 服务器部署

服务器安装 Docker 与 Docker Compose 后，将本项目整个目录上传到服务器，进入包含 `compose.yaml` 的目录。使用 `.env` 配置管理后台密码。

仅当项目中没有 `.env` 时，先复制配置模板：

```bash
cp .env.example .env
```

确认 `.env` 中的 `ADMIN_PASSWORD` 已设定，启动：

```bash
docker compose up -d --build
docker compose logs -f --tail=50
```

浏览器访问 `http://服务器IP:8080`。如服务器启用了防火墙或云安全组，需要放行该端口。管理员在 `/admin/` 选择科目并生成邀请码，新用户在账号入口使用该码注册；之后在电脑和手机上登录同一个账号即可同步。已有 `.env` 时直接编辑，不要再次复制模板覆盖原配置。

健康检查地址为 `/api/health`。可在服务器上执行：

```bash
curl http://127.0.0.1:8080/api/health
```

返回的 JSON 包含 `"ok": true` 和 `"total": 545`。

### 域名和 HTTPS

1. 将域名解析到服务器，并准备该域名的 HTTPS 证书。
2. 将随附 `nginx.conf` 中的 `study.example.com`、证书与密钥路径替换为实际值，放入服务器的 Nginx 站点配置。
3. 在仓库根目录的 `.env` 中设置（`compose.yaml` 会读取这些值）：

   ```ini
   ADMIN_PASSWORD=你的管理密码
   COOKIE_SECURE=true
   APP_ORIGIN=https://你的域名
   TRUSTED_PROXY=true
   ```

4. 将 `ports` 改成 `"127.0.0.1:8080:3000"`，使应用通过 Nginx 提供 HTTPS 访问。
5. 应用修改后的配置：

   ```bash
   docker compose up -d --build
   sudo nginx -t
   sudo systemctl reload nginx
   ```

之后访问 `https://你的域名`。`COOKIE_SECURE=true` 仅适用于 HTTPS；本地 HTTP 预览或首次通过 IP 测试时保留 `false`。

`TRUSTED_PROXY=true` 用于告诉应用「我前面有反向代理」：Nginx 会用自己的地址转发请求，开启后应用才会从 `X-Real-IP` / `X-Forwarded-For` 取访客真实 IP，否则登录限流会把所有访客算成同一个来源，访问日志里也只有 Nginx 的地址。直接暴露 3000 端口、没有反向代理时保持 `false`，避免客户端伪造该请求头。

随附 Nginx 配置已传递 `Host`、`X-Forwarded-Proto` 等请求头，并将网页和 API 一起反向代理到应用。使用宝塔等管理面板时，可配置等效的 HTTPS 反向代理，目标为 `http://127.0.0.1:8080`。

### 部署到子路径

默认使用域名的根路径。若需使用 `https://你的域名/practice/`，在 `.env` 中补充：

```ini
BASE_PATH=/practice
APP_ORIGIN=https://你的域名
```

Nginx 使用保留原路径的代理配置：

```nginx
location /practice {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

这里 `proxy_pass` 的末尾不加 `/`。应用会将 `/practice` 重定向至 `/practice/`，Cookie 也限定在对应路径。

### 直接用 Node.js 部署到服务器

通过环境变量可指定监听地址和数据目录。例如 Linux 服务器：

```bash
HOST=0.0.0.0 PORT=3000 DATA_DIR=/var/lib/zhixu node --env-file=.env server.mjs
```

直接运行时请用服务器的进程管理器或 systemd 管理进程，并在前方配置 HTTPS 反向代理。运行用户必须能够读写 `DATA_DIR`。

Windows PowerShell 示例：

```powershell
$env:HOST = '0.0.0.0'
$env:PORT = '3000'
$env:DATA_DIR = "$PWD\data"
node --env-file=.env server.mjs
```

## 账号与学习数据

- 新账号注册后固定访问邀请码绑定的科目。后端按账号限制题库、题图和进度。升级前创建的账号保留原有记录，可访问当前及之后新增的全部科目。
- 用户名为 3–32 个字母、数字、汉字、下划线或短横线；密码为 8–128 个字符。用户名不区分大小写。
- 密码用独立随机盐和 scrypt 派生后保存；会话通过 HttpOnly、SameSite Cookie 识别。修改密码会注销其他设备的旧会话。
- 同一账号的作答、错题、收藏、阅读设置和练习位置保存在服务器 SQLite 数据库。网站会自动同步，临时断网产生的操作会保存在当前浏览器，恢复连接后补传。
- 多设备对同一题作答时，保留所有作答次数；较早的离线记录不会覆盖较新的答题结果。重复提交同一个同步事件不会重复计数。
- 备份文件为 JSON，可通过网站的设置页导出和导入。导入会替换该账号当前进度；网站会检查其他设备是否刚刚更新，避免直接覆盖新记录。
- 本版本使用用户名和密码，不接入邮箱，也没有邮件找回密码流程。请保存好登录信息，并定期导出学习记录。忘记密码时可请管理员在后台重置（见下一节）。

### 生成科目邀请码

登录 `/admin/`，选择科目并点击“生成一次性邀请码”。生成后立即复制，系统只存邀请码的哈希。注册成功时核销该码，注册失败不会消耗它。旧的共用邀请码已停用。

部署时沿用现有 SQLite 数据卷，服务启动会自动升级账号表。

修改 `.env` 后运行：

```bash
docker compose up -d
```

Compose 会重建使用新配置的容器。只执行 `docker compose restart` 不会重新读取 `.env`。直接运行 Node 时，停止进程后用 `node --env-file=.env server.mjs` 重新启动。

若需要暂停新注册，可在 `.env` 中设置 `ALLOW_REGISTRATION=false`，再运行 `docker compose up -d`。暂停期间已生成的邀请码也无法注册，已有账号可继续登录。

### 管理后台

在 `.env` 中设置 `ADMIN_PASSWORD` 并重建容器后，访问 `/admin`（子路径部署时为 `/practice/admin/`）即可打开管理后台：

```ini
# .env
ADMIN_PASSWORD=换成一串足够长的随机密码
```

管理密码只用于后台登录，与学员账号完全独立，也不会出现在网页源码里；留空时后台无法登录，其余功能不受影响。

后台可以：

- 按用户名搜索、按状态筛选，分页浏览全部账号
- 查看每个账号的作答题目数、作答次数、正确率、错题数和收藏数
- 禁用 / 启用账号：禁用后该账号无法登录，已登录的设备立即失效，学习记录保留
- 重置密码：用于学员忘记密码，重置后该账号所有设备需要重新登录
- 强制下线：清除该账号的全部登录会话，数据不受影响，对方可以再登录
- 删除账号：账号、密码和学习记录一起删除，不可恢复，需要输入用户名确认
- 导出当前筛选结果为 CSV（带 UTF-8 BOM，Excel 直接打开不乱码）

管理会话有效期为 12 小时，Cookie 同样是 HttpOnly、SameSite=Lax，HTTPS 部署下带 Secure；登录失败按来源限流，15 分钟内最多 5 次。

### 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址；Docker 中为 `0.0.0.0` |
| `PORT` | `3000` | 应用端口 |
| `DATA_DIR` | 项目下的 `data` | SQLite 文件目录 |
| `COOKIE_SECURE` | `false` | HTTPS 部署时设置为 `true` |
| `APP_ORIGIN` | 未设置 | 网站对外的来源地址，例如 `https://study.example.com`，不含路径 |
| `BASE_PATH` | 空 | 可选访问前缀，例如 `/practice`，末尾不加 `/` |
| `TRUSTED_PROXY` | `false` | 前面有 Nginx 等反向代理时设为 `true`，才按 `X-Real-IP` / `X-Forwarded-For` 取访客真实 IP 限流 |
| `ADMIN_PASSWORD` | 空 | 管理后台 `/admin` 的登录密码；为空时后台无法登录 |
| `ALLOW_REGISTRATION` | `true` | 设置 `false` 完全关闭新注册；为 `true` 时仍需要有效的一次性邀请码 |

## 备份与更新

网站已经绑定 SQLite 数据库，存储账号、密码哈希、登录会话、答题记录、错题和收藏，无需另行安装 MySQL。直接运行时文件为 `data/practice.sqlite`；Docker 中为 `/app/data/practice.sqlite`。

Docker Compose 使用名为 `zhixu-data` 的数据卷挂载到 `/app/data`。重新构建镜像或重建容器不会清空该卷；`docker compose down -v` 会删除数据卷，请只在确定要清空全部账号和记录时使用。

数据库采用 WAL 模式。备份整个数据库目录时，先停止服务，复制目录后再启动，避免只复制正在变化的单个 SQLite 文件：

```bash
docker compose stop
docker compose cp zhixu:/app/data ./data-backup
docker compose start
```

每次备份请使用新的目标目录名。恢复时将备份目录中的全部数据库文件放回应用数据卷，确保容器中的 `node` 用户拥有读写权限，再启动服务。更新应用前保留一份数据库目录备份和网站导出的 JSON 备份。

从 GitHub 克隆部署的项目，在原项目目录执行：

```bash
git pull --ff-only
docker compose up -d --build
```

用部署压缩包安装的项目，需要先更新应用文件并保留服务器自己的 `.env`，再执行上面的 Docker Compose 命令。两种方式都应沿用原来的 Compose 项目，以继续使用同一数据卷。更新后可用 `/api/health` 检查服务，再刷新浏览器。

如果更新涉及 Nginx 站点配置，执行 `sudo nginx -t` 检查通过后再重新加载 Nginx。

## 题库与参考答案

### 编程练习

登录数据结构科目或全科账号，在「编程练习」中按链表、图、二叉树选题。只提交题目要求的 C 函数，系统负责构造数据结构和调用函数。评测结果仅为「正确」「部分正确」或「错误」。网页只提供公开样例和接口定义。

本地评测需要 PATH 中有 Clang 和 wasm-ld，也可以用环境变量 JUDGE_CLANG 指定 Clang 的绝对路径。Docker 镜像会安装这两项工具。C 代码编译成 WebAssembly，每个用例在独立实例中执行，提供有限的内存分配、字符输入输出和 printf（支持 %d、%i、%c、%s、%%）。允许引入题目使用的基础标准头文件，其他预处理指令与内联汇编不受支持。

隐藏用例文件是服务端的 judge/cases.mjs，导出按题目 ID 索引的 Map，每个用例是一对输入和预期输出字符串。该文件由部署者单独放入服务端目录，已排除在 Git 和公开发布包之外。部署时在构建镜像前私下复制该文件，勿上传到公开仓库。缺少用例时可以打开题面，提交时会提示评测未配置。

数据结构题库收录 533 道去重题目，编号与 Word 一致。数据库科目包含 2 道测试题。概率论科目收录 2024–2025、2022–2023 两套期末卷的选择题共 10 道，答案与解析由维护者整理。练习页使用单栏专注布局，底部固定“上一题”和“下一题”，长题和解析可在阅读区内滚动。单选题点击选项即作答，参考答案和解析显示在选项下方。题目字号可在练习页工具栏调整。

原图题也可以直接选择选项判分。选项 A、B、C、D 按原图中的顺序对应；原图中的圈选、勾选和红叉仅是原资料的作答痕迹。补充参考答案时按题意重新求解，并修正了部分原资料答案错误。

多选题可继续勾选，切题时按最终答案集合保存一次。多空题选完全部空位后显示解析，切题时按空位顺序保存结果。原题若存在歧义、代码错误或选项缺少正确结果，会直接显示参考结论和原因，此类题目不计入正误统计。

科目清单为 `dist/data/subjects.json`。现有题库分别是 `dist/data/questions.json` 与 `dist/data/database.json`，题图在 `dist/assets/questions/`。新增科目时，添加同格式的 JSON 文件并在清单中登记 `id`、`title` 和 `file`，重启后即可在后台选中并生成邀请码。题目 ID 和章节 ID 在各科目之间都必须唯一，已有 ID 不要更改。每题的 `answer` 为从 0 开始的选项下标，`explanation` 为解析；`questionType` 区分 `single`、`multiple`、`ordered` 和 `invalid`。题目使用稳定的 `id` 保存进度，维护题库时应保留已有 ID。

逐题参考答案补丁保存在 `tools/answer-reviews/part-*.json`，可通过 `tools/apply-answer-reviews.py` 重新合并。重新生成原始题库时，构建脚本会在完整补丁存在时自动恢复这些参考答案，避免被原始未补答案的数据覆盖。

知识点参考阅读：[OpenDSA 教材目录](https://opendsa.cs.vt.edu/OpenDSA/Books/Catalog/html/index.html)、[Princeton Algorithms 有向图](https://algs4.cs.princeton.edu/42digraph/)。逐题结论以题目中的条件、公式和图示为依据。

## 检查与测试

```bash
npm test
```

测试使用 Node.js 自带测试运行器，覆盖一次性邀请码并发核销、科目权限隔离、旧账号迁移、关闭注册、错题与收藏、筛选、备份、静态文件访问、账号隔离、同账号多会话同步、重复事件幂等、并发版本冲突、修改密码后的会话失效以及子路径配置。测试会在系统临时目录建立独立数据库，并在本机临时端口启动测试服务，不会使用正式数据目录。

`tools/focus-browser-qa.mjs` 用于检查专注布局、点选判分、切题状态和跨设备同步。检查使用 Playwright、浏览器和临时数据库，可通过 `PLAYWRIGHT_MODULE` 与 `BROWSER_EXECUTABLE` 指定路径。

## 目录

```text
dist/                 网页、题库和题图
server.mjs            正式应用服务与账号同步 API
Dockerfile            容器镜像定义
compose.yaml          容器启动和数据库数据卷
.env.example          管理密码等配置模板，复制为 .env 后自行填写
nginx.conf            HTTPS 反向代理示例
tools/serve.mjs       仅用于静态页面调试
tools/build-bank.py   从本次整理的题目数据生成网站题库
tools/focus-browser-qa.mjs  专注布局与点选判分的浏览器检查
tests/                题库、练习、账号同步与管理后台的自动化测试
data/                 本机运行时自动生成，部署包不包含用户数据
```

网站运行不需要原始 Word 或压缩包；构建题库的辅助脚本需要原先整理过程中产生的源数据。仓库中的题库和题图已经生成完成。
