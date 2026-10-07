# 胜利女神：NIKKE 妮姬喜好排序（nikkerank）

> **在线站点：<https://mrshrimplee.github.io/nikkerank/>** ｜ 源码仓库：<https://github.com/MRShrimpLee/nikkerank>

一个「二择」式的妮姬喜好排序器：每次只给你两位妮姬，你只要点击更喜欢的那一位，
若干轮之后就能得到你的前 N 名本命排行，以及一份偏好分析（部队 / 企业 / 职业 / 武器 / 属性）。

本项目与 [明日方舟干员喜好排序](https://github.com/MRShrimpLee/arknrank) 是同一系列，
**排序引擎完全相同**（移植自 [uzkk/favorite](https://github.com/uzkk/favorite)，MIT，作者 Shigma），
按妮姬的数据结构重做了筛选维度与卡片展示。整站是**零构建静态站点**：
没有框架、没有 npm 依赖、没有构建步骤，`index.html` 双击即可运行。

- 收录 **205** 名妮姬（含全球服角色与联动角色），中文名 + 角色卡片图全部本地打包（约 28 MB）
- 数据与头像来自 [GameKee 妮姬百科 · 角色图鉴](https://www.gamekee.com/nikke/second/64599)
- 六个筛选维度：**稀有度 / 职业 / 企业 / 爆裂阶段 / 武器 / 属性**，另有「去除联动角色」（24 名 / 9 个 IP）
  与「去除异格角色」（47 名同名换皮）两个开关

## 快速开始

```bash
# 方式一：直接双击 index.html（全部相对路径 + 传统 <script>，file:// 也能跑）

# 方式二：起一个静态服务器（推荐，行为与线上一致）
python -m http.server 8000
# 然后访问 http://127.0.0.1:8000/
```

### 部署到 GitHub Pages

```bash
# 1) 先在 GitHub 网页上新建空仓库（不要勾 README/.gitignore/License）
#    https://github.com/new  ->  仓库名 nikkerank，Public

# 2) 关联并推送
git remote -v                 # 应显示 https://github.com/MRShrimpLee/nikkerank.git
git push -u origin main

# 3) 仓库 Settings -> Pages：Source = Deploy from a branch，Branch = main，目录 = / (root)
```

一两分钟后访问 **<https://mrshrimplee.github.io/nikkerank/>** 即可。
站点全部使用相对路径，换仓库名或绑自定义域名都不用改代码；根目录带 `.nojekyll`，Pages 会跳过 Jekyll 直接发布。

## 目录结构

```
nikkerank/
├── index.html            主页面（设置 → 二择 → 结果 三视图）
├── about.html            关于页（算法、数据来源、版权）
├── uplog.html            更新日志
├── css/style.css         全部样式
├── js/
│   ├── data.js           角色数据（由 tools/gen_data.py 生成，勿手改）
│   ├── engine.js         排序引擎（与明日方舟版同一份，源自 uzkk/favorite）
│   └── app.js            界面与交互（原生 DOM，无框架）
├── assets/
│   ├── portraits/        205 张角色卡片图，文件名 = GameKee 条目 id
│   └── logo/             站点图标
└── tools/
    ├── gen_data.py       抓取角色数据生成 js/data.js（增量缓存）
    ├── fetch_avatars.py  增量下载缺失的角色图
    ├── gen_logo.py       重新生成站点图标（需要 Pillow）
    ├── test_engine.js    引擎与数据集测试（Node 运行，45 项）
    └── _.cache/ 等为生成物，已在 .gitignore 中
```

## 数据来源与规整

角色数据取自 GameKee 妮姬百科「角色图鉴」的 205 个条目：每个角色的结构化资料
（稀有度 / 职业 / 企业 / 爆裂阶段 / 武器 / 属性 / 部队 / CV / 实装日期）来自其内容 JSON，
角色图取自条目的 `icon` 字段。

抓取过程中发现并规整了 3 类不一致（都记录在 `tools/report.json`）：

| 情况 | 处理 |
| --- | --- |
| 4 名「超标准」角色的企业名带后缀（如「米西利斯（超标准）」） | 统一为企业本体，保留 `overflow` 标记 |
| 伊莎贝尔的属性百科写作「雷电」 | 统一为「电击」（游戏内只有 5 种属性） |
| 马斯特 / 爱德 / 爱丽丝：仙境兔女郎的职业写作「支援型」 | 统一为「辅助型」（百科自身筛选器只有火力/防御/辅助三类） |

### 异格（同名换皮）判定

命名规律是「本体名：后缀」，46 名走这个规则，另有「零 (暂称)」用括号写法，共 **47** 名换皮、
158 名本体。每名换皮都记录 `baseName` / `baseId`；`安妮：奇迹仙女` 的本体是 `N102`
（安妮是 N102 的本名），已单列别名映射。

### 联动角色判定

按百科的「部队」字段识别，共 24 名 / 9 个 IP：新世纪福音战士（7）、NieR:Automata（3）、
电锯人（3）、Lycoris Recoil（3）、生化危机（3）、Re:从零开始的异世界生活（2）、
女神异闻录 3/4/5（各 1）。

## 更新数据

```bash
python tools/gen_data.py        # 重新生成 js/data.js（只抓新角色，旧资料走缓存）
python tools/fetch_avatars.py   # 增量下载缺失的角色图
node   tools/test_engine.js     # 45 项测试（排序正确性 + 数据集完整性）
```

## 算法

与明日方舟版一致：Pairwise Comparison + 二叉树二分插入，题量
`≈ (N − 1) + (排名数 − 1) × log₂N`。205 名角色排前 10 名约需 310 轮，前 1 名约需 204 轮。

偏好分析的参考值 = 该标签在你前 m 名中的加权占比 − 在全部参测角色中的占比
（权重 `w_i = 1 / (1 + i)`），标签取自每位角色的部队 / 企业 / 职业 / 武器 / 属性。

## 版权与协议

- 排序引擎移植自 [uzkk/favorite](https://github.com/uzkk/favorite)，MIT 协议，作者 Shigma；本项目同样以 [MIT](LICENSE) 开源。
- 角色数据与图片来自 GameKee 社区百科，仅供学习与交流使用。
- 《胜利女神：NIKKE》及其角色版权归 SHIFT UP Corp. / Level Infinite 所有，本站为非商业同人作品。
