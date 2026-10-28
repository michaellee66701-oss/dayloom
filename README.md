# 时序 · Dayloom

围绕上午 09:00–11:30、下午 14:00–16:30、晚上 20:00–22:30 的个人计划工具，另有 18:00 锻炼安排。支持周/月日历、任务完成与改期、考试和截止日倒数、JSON 备份，以及手机和电脑同步。

访问：https://michaellee66701-oss.github.io/dayloom/

## 使用同步

1. 在 Supabase SQL Editor 运行 `supabase/setup.sql`。当前项目已完成初始化。
2. 在 Supabase 的 Authentication → Users → Add user → Create new user 创建自己的邮箱/密码账号，勾选 Auto Confirm User。网页不需要数据库密码，也不需要 Supabase 管理账号密码。
3. 在保存了原有计划的设备上打开网站，点右上角「登录同步」，登录刚创建的账号，选择「合并并开启」。
4. 在另一台设备打开同一个网址，使用同一账号登录；本机没有旧计划时可选「只读取云端」。
5. 两边显示「已同步」后即可正常使用。修改后约 1.2 秒上传；页面可见时每 15 秒检查一次云端，切回页面也会检查。可从同步面板点「立即同步」。

计划始终有浏览器本机副本，网络中断时可以继续编辑已经打开的页面。网络恢复后合并离线修改；关闭页面期间不在后台同步。当前版本不提供离线首次打开页面的保证。

不同任务和不同字段可自动合并；同一字段双方都改动，或一方删除另一方修改时，会显示选择窗口，避免静默覆盖。首次连接前会保留一份浏览器备份，可在「偏好设置 → 手机与电脑同步」下载；也可以从「数据与备份」导出当前计划的 JSON。

在不同账号之间切换时，会先要求读取该账号云端计划，不自动上传上一账号的本机内容。退出登录保留本机计划；共用设备需要自行管理浏览器中的个人数据。

## 本地开发与发布

项目目录：`E:\Project\dayloom`。网站入口是仓库根目录的 `index.html`，GitHub Pages 使用 `main` 分支的根目录。

```sh
npm ci
npm test
npm run build
git add .
git commit -m "Update Dayloom"
git push origin main
```

编辑 `src/` 中的源文件，然后构建。构建会把样式、课程参考和同步 SDK 打包到根目录 `index.html`，网页运行不依赖外部 CDN。添加日常任务直接在网页操作，无需修改代码或提交 Git。

- `src/app.js`：日历、任务和本机保存；兼容原来的 `dayloom-planner-v1` 数据。
- `src/sync.mjs`：登录、轮询、离线恢复、冲突选择和账号绑定。
- `src/merge.mjs`：按任务 ID 与字段执行三方合并。
- `src/cloud-config.js`：项目 URL 和可公开的 publishable key。
- `supabase/setup.sql`：数据库表、RLS 权限、带版本校验的保存函数。
- `tests/merge.test.mjs`：合并算法检查。
- `tests/browser-sync.mjs`：用模拟服务检查桌面/手机同步、离线合并、冲突与编辑保护；不写入实际云端账号。

浏览器测试需要安装 Playwright，并通过 `DAYLOOM_CHROME` 指定 Chrome/Chromium 可执行文件（未指定时使用 Playwright 自带浏览器）：

```sh
npm ci
npx playwright install chromium
node tests/browser-sync.mjs
```

## 数据与权限

Supabase Auth 管理登录。每个用户的计划存入 `dayloom_documents` 的独立记录；RLS 仅允许登录用户读取自己的记录。浏览器只能通过 `dayloom_save` 函数写入；函数使用登录身份而不是客户端提交的用户 ID，并校验文档版本，遇到并发写入会返回新版本供客户端重新合并。

网页只包含可公开的 publishable key。不要把 secret key、service_role key、数据库密码或用户密码放进仓库。登录会话保存在当前浏览器，不进入 JSON 计划备份。

课程仅作可关闭的时间占用参考，实验课与第 9–12 节排除。倒数日显示在页面内，不发送后台通知。免费服务的额度、暂停政策和大陆网络可达性以 Supabase 实际情况为准。
