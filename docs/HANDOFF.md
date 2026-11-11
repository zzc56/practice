# 交接文档（Handoff）

> 这份文档写给接手的开发者或 AI。目标：不改代码也能看懂全貌；改代码后能安全地把 **GitHub 仓库** 和 **线上网站** 同时更新。
>
> 最后更新：2026-11-11 · 对应提交 `21fb952`

---

## 1. 一句话概况

「知序」在线刷题站：**纯 Node.js 24 + 内置 SQLite**，无 npm 依赖、无前端构建，用 Docker 部署在阿里云 ECS，域名 `nexthub.space`，代码托管在 GitHub `zzc56/practice`。

---

## 2. 三个位置

| 位置 | 地址 | 说明 |
|---|---|---|
| GitHub 仓库 | `https://github.com/zzc56/practice` | 分支 `main`，公开仓库 |
| 本地工作副本 | `C:\Users\25646\Documents\Codex\2026-11-01\hinge-softmax-lstm-cell-state-cfg\practice` | 开发用（Windows） |
| 线上服务器 | `root@47.76.55.90` → `/opt/zhixue/ds-practice` | 阿里云 ECS，宝塔面板管理 nginx |

线上容器：`ds-practice-zhixu-1`，宿主 `8080` → 容器 `3000`，数据卷 `ds-practice_zhixu-data`。

---

## 3. 线上拓扑

```
浏览器
  │  https://nexthub.space
  ▼
nginx（宝塔，1.30.6）
  /www/server/panel/vhost/nginx/nexthub.space.conf
  listen 443 ssl → proxy_pass http://127.0.0.1:8080
  │
  ▼
Docker 容器 ds-practice-zhixu-1（node:24-alpine + clang）
  │  /app/data  ← 数据卷 zhixu-data（SQLite: practice.sqlite）
  ▼
账号 / 进度 / 邀请码 / 管理会话
```

- 证书：Let's Encrypt，`/etc/letsencrypt/live/nexthub.space/`，含 `nexthub.space` 与 `www.nexthub.space`
- 续期：`certbot.timer` 每天自动续期，续期后执行 `/usr/local/bin/zhixu-cert-deploy.sh`（复制到宝塔证书目录并 reload nginx）
- 旧域名 `study.nexthub.space` 仍独立可用（另一份 nginx 配置）

---

## 4. 更新流程（唯一正确姿势）

代码改动必须 **同时** 落到 GitHub 和线上，顺序不能反。

```bash
# ① 本地：改代码 → 提交 → 推送
cd C:\Users\25646\Documents\Codex\2026-11-01\hinge-softmax-lstm-cell-state-cfg\practice
git add -A
git commit -m "说明这次改了什么"
git push git@github.com:zzc56/practice.git main
```

> **注意**：本机 HTTPS 推送常被墙（`Failed to connect ... port 443`），用 **SSH 地址** 推送。

```bash
# ② 服务器：拉取 + 重建 + 验证
ssh root@47.76.55.90
cd /opt/zhixue/ds-practice
git fetch origin main && git reset --hard FETCH_HEAD
docker compose up -d --build
curl -s http://127.0.0.1:8080/api/health   # 期望 {"ok":true,"total":2887}
```

```bash
# ③ 公网验收
curl -s https://nexthub.space/api/health
```

**判断是否成功**：`total` 数字必须等于题库总数（当前 2887）；容器状态 `Up ... (healthy)`；`git log --oneline -1` 与 GitHub 一致。

> 只有改了 `dist/`、`server.mjs`、`banks.mjs`、`judge/` 才需要重建镜像；只改文档不需要重新部署。

---

## 5. 代码结构

| 路径 | 作用 |
|---|---|
| `server.mjs` | HTTP 服务、路由、账号/邀请码/进度 API、静态文件、安全头 |
| `banks.mjs` | 读取并校验 `dist/data/subjects.json` 与各科目题库，去重、统计总数 |
| `dist/app.js` | 前端主逻辑（练习页、错题本、收藏、题库、设置） |
| `dist/core.js` | 判分、答题记录、统计、备份导入导出（纯函数，有单元测试） |
| `dist/account.js` | 登录态与进度同步队列 |
| `dist/coding.js` | 编程题页面 |
| `dist/data/subjects.json` | 科目清单：`[{id,title,file}]` |
| `dist/data/*.json` | 各科目题库 |
| `judge/` | C 代码评测（clang → wasm，worker 隔离）；`judge/cases.mjs` 为私有用例，**不入库** |
| `tests/` | node:test 用例（core / backend / admin / 题库校验等） |
| `tools/` | 题库构建、发布打包、本地预览脚本 |
| `Dockerfile` / `compose.yaml` | 镜像与编排（8080→3000，挂载数据卷） |
| `.dockerignore` | **白名单**模式，新增要 COPY 的文件必须在这里放行 |

---

## 6. 题库格式

`subjects.json`：

```json
[{"id":"probability","title":"概率论与数理统计","file":"probability.json"}]
```

题目对象：

```json
{
  "id": "PF001", "number": 6, "chapter": "probability-2024-fill", "topic": "古典概型",
  "stem": "题干", "options": [], "answer": [], "accept": ["57/100","0.57"],
  "referenceAnswer": "57/100", "answerSource": "reviewed", "mode": "text", "images": [],
  "source": "概率论历年期末卷", "sourceCode": "PL2024", "originalNumber": "第 1 题",
  "questionType": "fill", "searchText": "关键词", "explanation": "解析"
}
```

支持的 `questionType`：

| 类型 | 判分方式 | 必填字段 |
|---|---|---|
| `single` / `multiple` | 选项索引比对 | `options`、`answer: [索引…]` |
| `ordered` | 按空位顺序比对 | `options`、`answer` |
| `fill` | 文本归一化后与 `accept` 比对（忽略空格、全半角） | `accept: [多种写法]`、`referenceAnswer` |
| `essay` | 展开参考答案后自评 | `referenceAnswer`、`explanation` |
| `invalid` | 不计正误，只展示参考结论 | `answer: null`、`referenceAnswer` |

约束：

- 章节 `count` 必须等于该章实际题数（前端用于显示）
- 题目 `id` 全局唯一；章节 `id` 全局唯一
- 科目 `id` 和文件名必须匹配 `^[a-z][a-z0-9-]*$`

校验方式（改完题库跑一下）：

```bash
node -e "import('./banks.mjs').then(async m=>{const c=m.loadBanks('./dist');console.log('total',c.all.total);for(const [k,b] of c.banks)console.log(k,b.total)})"
node tests/core.test.mjs      # 判分与统计的单元测试
```

---

## 7. 当前题库

| 科目 | 数量 | 组成 |
|---|---|---|
| 数据结构 | 533 | 8 个章节 |
| 数据库 | 2 | 测试题 |
| 概率论与数理统计 | 32 | 选择 10 + 填空 9 + 计算证明 11 + 问题题 2 |
| 马克思主义基本原理 | 2320 | 单选 826、多项及不定项 526、判断 278、待核 690 |
| **合计** | **2887** | |

---

## 8. 运维

```bash
# 日志
cd /opt/zhixue/ds-practice && docker compose logs --tail=100

# 重启
docker compose restart

# 备份数据（SQLite 在数据卷里）
docker run --rm -v ds-practice_zhixu-data:/data -v /root:/backup alpine \
  tar czf /backup/zhixu-$(date +%F).tar.gz -C /data .

# 证书状态
certbot certificates
```

管理后台：`https://nexthub.space/admin/`（**只有密码，没有用户名**，密码在服务器 `.env` 的 `ADMIN_PASSWORD`）。

---

## 9. 已知待办

1. **登录/IP 冻结**：需求是「验证码多次输错 → 冻结该 IP 30 分钟」，目前只有 `server.mjs` 里的 `throttle()`（15 分钟窗口、超限 429），**尚未实现 IP 级持久冻结**。
2. **概率论大题答案需人工复核**：计算与证明题的参考答案由维护者推导，建议逐题校对。
3. **两道原题参数缺失**（已在站内标为“原题问题”，不计正误）：
   - 2022–2023 填空第 2 题：二项分布未给 n
   - 2022–2023 第 13 题：4 次射击却给了 5 个命中率
4. **移动端渲染未实测**：新增的填空输入框、解答题自评按钮建议在手机上过一遍。

---

## 10. 禁止事项

- ❌ 不要把 `.env`、`judge/cases.mjs`、`data/*.sqlite`、`dist/data/*.sqlite` 提交到仓库
- ❌ 不要 `docker compose down -v`（`-v` 会删数据卷，账号和进度全丢）
- ❌ 不要在服务器上直接改代码后不提交（下次 `git reset --hard` 会被覆盖）
- ❌ 不要在公开仓库或聊天里写密码、私钥

---

## 11. 权限清单（**不写在本文件里**，需私下移交）

| 权限 | 用途 | 移交方式 |
|---|---|---|
| GitHub `zzc56/practice` 写权限 | 推送代码 | 添加协作者 / 转移仓库 |
| 服务器 root SSH | 部署与运维 | 私钥或密码，私下传递 |
| 宝塔面板账号 | nginx、证书 | 私下传递 |
| 阿里云账号 + 云解析 DNS | 域名与实例 | 控制台授权 |
| 管理后台密码 | 生成邀请码 | 服务器 `.env` 中读取 |

> 如果开通过临时部署公钥（`dsh-deploy`），交接完成后应删除：
> `sed -i '/dsh-deploy/d' /root/.ssh/authorized_keys`

---

## 12. 给接手的 AI 的规则（可直接粘贴）

```
你在维护「知序」刷题站：
- 代码：https://github.com/zzc56/practice（main），本地副本在 Windows 的 practice 目录
- 线上：阿里云 47.76.55.90，/opt/zhixue/ds-practice，docker compose，域名 https://nexthub.space
- 数据：SQLite 在 docker 数据卷 ds-practice_zhixu-data，永远不要删卷

每次改动必须同时满足：
1) 本地提交并推送到 GitHub（用 SSH 地址，HTTPS 常被墙）
2) 服务器 git fetch + git reset --hard + docker compose up -d --build
3) 验证 https://nexthub.space/api/health 的 total 等于题库总数（当前 2887）
4) 题库改动要保证 chapter.count 与题数一致，并跑 node tests/core.test.mjs

不要提交 .env、judge/cases.mjs、数据库文件；不要 docker compose down -v。
改动前先读 docs/HANDOFF.md 和 README.md。
```

---

## 13. 本次交接的提交记录

| 提交 | 内容 |
|---|---|
| `f4e4c19` | 新增概率论选择题 10 道 |
| `21fb952` | 新增填空/解答题型，概率论扩到 32 道，总数 567 |
