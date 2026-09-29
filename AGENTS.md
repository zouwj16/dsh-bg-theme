# AGENTS.md — dsh-bg-theme

给在本仓库里工作的 agent：这是一个 **DSH bundle 插件**（不是应用，也不是库）。运行期只有两个文件有意义：`client.js`（浏览器半侧，配色就是它的 `PALETTE` 常量）和 `cordis.patch.yml`（往 profile 插一行）。改动配色只应改 `client.js` 的 `PALETTE`，然后同步 `README.md` 的对照表。

## 装进当前 profile

用 `plugin_manager` 工具，不要手写 profile 文件、不要在 profile 目录里跑 pnpm——安装（`pnpm add` + 选入 `dsh.profile.bundles`）由它负责：

- `action: install_bundle`，`target` 取其一：
  - 本仓库目录的绝对路径
  - `https://github.com/zouwj16/dsh-bg-theme`
  - 已生成的 `local-dsh-bg-theme-<version>.tgz` 绝对路径
- 该工具需要 `danger-full-access` 或本次批准。
- 装完读结果的 `application` / `warnings` 判断是否生效，不要靠日志或进程表推断。

## 改完配色怎么让它在页面生效

顺序不能反，三步缺一不可（原因与踩坑记录见 `README.md` 的「改配色」）：

1. 刷新 profile 里的副本（pnpm 对本地目录依赖不可靠，必要时直接按目录复制）。
2. 让宿主重新快照：改动 profile 的 `cordis.patch.yml` 内容即可（例如加一行注释再还原）。
3. 让页面加载新代码：强刷页面（`Ctrl+Shift+R`）；不行就重启 Harness。

## 交付前自检

```bash
node measure/verify-palette.mjs
```

零依赖、不需要装 DSH，检查清单、工厂注册、token 形状、patch 行、locale、图标，以及 README 表格与 `client.js` 是否逐值一致。它**不能**判断 token 名是否真的存在于产品样式表里，也不能判断半透明色的 alpha 是否与原生一致——那两项需要对着安装好的 `app.asar` 跑维护者的完整检查。

另一个零依赖自检，不需要 DSH 安装，专门验证原生窗口底色补丁的字节账目与幂等性：

```bash
node measure/patch-window-base.mjs --self-test
```

CI 模板在 `measure/ci-verify.yml`：复制成 `.github/workflows/verify.yml` 即启用。它没有直接放在那个路径下，是因为推送 workflow 文件要求令牌具备 `workflow` 权限（`gh auth refresh -s workflow`）；在 GitHub 网页端新建该文件则不需要。

## 原生窗口底色（Windows 白闪）

呼出窗口时的白闪在插件半侧修不了：渲染/宿主进程只能覆盖 CSS token，够不到原生窗口底色。仓库里的 `measure/patch-window-base.mjs` 改的是**已安装客户端的 `app.asar`**，这是本仓库唯一会碰产品安装目录的东西。

- 干跑不带参数；`--apply` 才写，`--verify` 校验整个归档，`--revert [--apply]` 回滚，`--self-test` 用内置夹具自检。
- 改写是等长的：`lib/main.js` 字节数不变、索引偏移不变、归档头里的 SHA-256 同步更新。脚本自己证明这一点——把两处插入摘掉、注释还原成原文本后必须逐字节等于原文件；写入前还会跑 `node --check` 过语法。
- 回滚状态在 `<app.asar>.window-base-backup\`；归档与状态不符（例如产品升级过）时 `--revert` 拒绝写入。
- 生效需要重启 Harness。产品升级会覆盖 `app.asar`，升级后重跑 `--apply`。
- 只有产品改动导致锚点失效时脚本才会报错退出，那时按 `EDITS` 里的锚点与注释块重新对齐（不要改成按行号或偏移硬写）。

## 边界

- 不要给这个插件加运行期依赖或安装脚本：它的价值之一就是"零依赖、无构建"。
- 不要把平台专属字体钉进 `--dsw-font-family`（会破坏 macOS 客户端的字体回退）。
- macOS 的菜单/弹出材质不跟随本套配色，这是有意为之，不要为了"统一"去覆盖那条平台规则。
- 半透明 token 只改色相、不改 alpha。
- `measure/patch-window-base.mjs` 是维护脚本，不是安装脚本：它不在插件的加载路径上，产品侧不会被自动执行；插件本身仍然零依赖、装完即用。
