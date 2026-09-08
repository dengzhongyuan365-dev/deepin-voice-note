# Summernote 切换 Tiptap 富文本编辑器场景化 AT 用例设计

## 背景

本轮改动的核心不是单纯补齐控件可访问名称，而是将语音记事本的富文本编辑器
从旧版 Summernote 路径切换到 Tiptap 路径。后续 AT 用例应围绕真实用户场景组织，
优先验证主链路是否可用，而不是只验证某个控件是否存在。

## 代码改动关注点

| 编号 | 改动点 | 代码入口 | 测试关注 |
|---|---|---|---|
| C01 | Tiptap 默认启用，Summernote 仅作为回退路径 | `src/common/tiptapchannelbridge.*`, `src/main.cpp`, `src/gui/mainwindow/WebEngineView.qml` | 默认启动后进入 Tiptap 编辑器；设置回退环境变量时可回退旧路径 |
| C02 | 新增 C++ 宿主与 Tiptap 前端 QWebChannel 桥 | `src/common/tiptapchannelbridge.*`, `web-editor/src/runtime/tiptap-channel.js` | 编辑器 ready、内容加载、保存、搜索、图片、语音、主题等信号不丢失 |
| C03 | 新建文本笔记默认使用 Tiptap JSON envelope | `src/common/VNoteMainManager.cpp`, `src/importolddata/tiptapmigration/*` | 新建笔记后可编辑、切换、重启后内容仍存在 |
| C04 | 存量 Summernote 数据迁移到 Tiptap | `src/importolddata/tiptapmigration/*`, `src/importolddata/dbmigration/*`, `src/common/migrationviewcontroller.*` | 旧数据启动迁移后不丢失，可继续编辑保存 |
| C05 | 富文本工具栏迁移到 Tiptap | `web-editor/src/runtime/tiptap-editor.js`, `web-editor/src/runtime/tiptap-channel.js`, `src/gui/mainwindow/WebEngineView.qml` | 加粗、斜体、下划线、删除线、列表、字体/颜色等格式入口可用 |
| C06 | 图片能力迁移到 Tiptap image node | `src/common/VNoteMainManager.cpp`, `web-editor/src/extensions/image-block.*`, `web-editor/src/runtime/image-interactions.js` | 图片插入位置、选中、删除、撤销重做链路 |
| C07 | 语音能力迁移到 Tiptap voice block | `web-editor/src/extensions/voice-block.*`, `src/handler/web_engine_handler.cpp`, `src/handler/voice_to_text_handler.cpp` | 语音块显示、播放、保存、转文字结果回写 |
| C08 | 搜索从 Summernote findText 切到 Tiptap 搜索桥 | `src/gui/mainwindow/WebEngineView.qml`, `src/common/tiptapchannelbridge.cpp` | 搜索高亮不污染正文、不进入撤销重做 |
| C09 | Tiptap 文档导出 | `src/common/tiptapdocumentexporter.*` | TXT/HTML/语音导出内容正确 |
| C10 | 启动主题、字体信息缓存与补发 | `src/common/tiptapchannelbridge.cpp`, `src/handler/web_engine_handler.cpp` | 深浅色主题/字体列表在编辑器 ready 前后同步正常 |

## 场景化用例设计原则

1. **场景优先**：一个 AT suite 覆盖一个完整用户链路，可以映射多条原始 Excel 用例。
2. **可追溯**：每个 suite 保留 `trace.source_cases`，记录原始用例编号、标题和覆盖关系。
3. **少用右键坐标**：禁止固定坐标；Tiptap 编辑区右键菜单不稳定时，优先使用键盘等价操作。
4. **优先 L1 主链路**：先保证启动、新建、编辑、保存、迁移、图片等核心链路。
5. **可自动化分层**：依赖真实音频、网络 AI、视觉颜色精确判断的场景降为 L2/L3 或人工确认。

## 推荐目录

后续建议新增场景化目录：

```text
tests/at/yaml/Tiptap富文本编辑器/
```

场景文件命名建议：

```text
suite_Tiptap富文本编辑器_001_默认启动与编辑区可用.suite.yaml
suite_Tiptap富文本编辑器_002_新建编辑切换持久化.suite.yaml
suite_Tiptap富文本编辑器_003_文本编辑快捷键.suite.yaml
suite_Tiptap富文本编辑器_004_富文本格式工具栏.suite.yaml
suite_Tiptap富文本编辑器_005_图片插入删除撤销重做.suite.yaml
suite_Tiptap富文本编辑器_006_搜索高亮与清空.suite.yaml
suite_Tiptap富文本编辑器_007_旧数据迁移.suite.yaml
suite_Tiptap富文本编辑器_008_保存导出.suite.yaml
suite_Tiptap富文本编辑器_009_语音块基础链路.suite.yaml
suite_Tiptap富文本编辑器_010_主题字体启动同步.suite.yaml
```

## L1 优先落地场景

### S001：Tiptap 默认启动与主编辑区可用

**目标**：验证应用默认进入 Tiptap 编辑器，不再依赖 Summernote。

**覆盖链路**：

1. 启动语音记事本。
2. 验证主窗口显示。
3. 验证记事本列表和笔记列表显示。
4. 验证详情页编辑区显示。
5. 验证 Tiptap 编辑区可访问。
6. 新建笔记后验证编辑区仍可用。

**映射原始用例**：

| 原始用例 ID | 标题 | 覆盖关系 |
|---|---|---|
| 1676385 | 从启动器打开应用 | equivalent |
| 1676573 | V25语音记事本-主界面显示 | partial |
| 1676381 | 验证可以正常启动应用 | equivalent |
| 1676383 | 验证可以正常启动应用 | equivalent |
| 1676341 | 新建笔记 | partial |

**自动化等级**：L1，适合流水线。

**已落地 AT 用例**：

| 子场景 | suite | DB 预期模板 |
|---|---|---|
| S001-001 Tiptap默认启动与新建笔记编辑区可用 | `tests/at/yaml/Tiptap富文本编辑器/suite_Tiptap富文本编辑器_001_s1.suite.yaml` | `tests/at/expected/tiptap_scenario_001_expected.yaml` |

**结果判定**：YouQu UI 操作通过后，执行 `tests/at/scripts/assert_tiptap_scenario_db.py` 校验目标记事本和新建文本笔记已落库；用例避免主菜单、右键菜单和固定坐标，只验证 Tiptap 默认启动主链路。

---

### S002：新建文本笔记、编辑、切换、持久化

**目标**：验证 Tiptap 最核心的文本笔记主链路。

**覆盖链路**：

1. 空库启动应用。
2. 新建记事本。
3. 新建文本笔记。
4. 在 Tiptap 编辑区输入文本。
5. 新建第二条笔记并切换。
6. 切回第一条笔记。
7. 验证详情页同步切换且应用无异常。
8. 可选：重启应用后验证笔记仍存在。

**映射原始用例**：

| 原始用例 ID | 标题 | 覆盖关系 |
|---|---|---|
| 1634839 | 首次使用语音记事本应用，新建记事本 | equivalent |
| 1625243 | 新建记事本 | equivalent |
| 1634891 | 新建文本笔记 | equivalent |
| 1634893 | 新建笔记，最新新建的排在最上方 | partial |
| 1634907 | 切换笔记，详情页同步切换 | equivalent |
| 1634959 | 点击文本笔记详情页的文本区域编辑文字内容 | equivalent |

**自动化等级**：L1，优先落地。

---

### S003：Tiptap 基础文本编辑快捷键

**目标**：验证编辑器替换后，基础键盘编辑能力不退化。

**覆盖链路**：

1. 新建文本笔记。
2. 输入中文、英文、数字、特殊字符。
3. 输入回车、空格、Tab。
4. 执行 Ctrl+A 全选。
5. 执行 Ctrl+C 复制。
6. 执行 Ctrl+X 剪切。
7. 执行 Ctrl+V 粘贴。
8. 执行 Delete 删除。
9. 执行 Backspace 删除。
10. 执行 Ctrl+Z 撤销。
11. 执行 Ctrl+Shift+Z 重做。
12. 验证应用仍运行，编辑区仍可用。

**映射原始用例**：

| 原始用例 ID | 标题 | 覆盖关系 |
|---|---|---|
| 1634953 | 文本笔记详情页输入内容含中文、英文、数字、特殊字符 | equivalent |
| 1634955 | 文本笔记详情页输入内容键入回车 | equivalent |
| 1634957 | 文本笔记详情页输入内容键入空格、Tab | equivalent |
| 1676405 | 详情页文本编辑操作 | equivalent |
| 1676393 | 编辑区支持delete键删除编辑光标后面的文本 | equivalent |
| 1676391 | 选中编辑区内容，按Delete键删除选中内容 | equivalent |
| 1676389 | 编辑光标前面有文本，backspace删除 | equivalent |
| 1676387 | 选中编辑区内容，按backspace删除 | partial |
| 1676215 | Ctrl+Z撤销和Ctrl+Shift+Z重做功能验证---文本编辑 | equivalent |

**自动化等级**：L1/L2，优先用键盘实现，避免 Tiptap 右键菜单超时。

**已落地 AT 用例**：

| 子场景 | suite | DB 预期模板 |
|---|---|---|
| S003-001 混合字符回车空格Tab输入 | `tests/at/yaml/Tiptap富文本编辑器/suite_Tiptap富文本编辑器_003_001_s1.suite.yaml` | `tests/at/expected/tiptap_scenario_003_001_expected.yaml` |
| S003-002 全选复制剪切粘贴 | `tests/at/yaml/Tiptap富文本编辑器/suite_Tiptap富文本编辑器_003_002_s1.suite.yaml` | `tests/at/expected/tiptap_scenario_003_002_expected.yaml` |
| S003-003 删除退格撤销重做 | `tests/at/yaml/Tiptap富文本编辑器/suite_Tiptap富文本编辑器_003_003_s1.suite.yaml` | `tests/at/expected/tiptap_scenario_003_003_expected.yaml` |

**结果判定**：YouQu UI 操作通过后，执行 `tests/at/scripts/assert_tiptap_scenario_db.py` 对比 DB 中的 Tiptap JSON envelope 与预期模板。


---

### S004：Tiptap 图片插入、选中、删除、撤销重做

**目标**：验证图片从 Summernote 迁移到 Tiptap image node 后主链路可用。

**覆盖链路**：

1. 新建文本笔记。
2. 输入一段定位文本。
3. 在光标处插入测试图片。
4. 验证应用无异常，编辑区仍可用。
5. 删除图片。
6. Ctrl+Z 恢复图片。
7. Ctrl+Y 重做恢复图片。
8. 切换笔记触发保存后，通过 DB 校验 image node 与图片文件。

**映射原始用例**：

| 原始用例 ID | 标题 | 覆盖关系 |
|---|---|---|
| 1676377 | 插入图片显示在编辑区输入焦点所在位置 | equivalent |
| 1676231 | 导入图片---粘贴图片至编辑区 | partial |
| 1676233 | 导入图片 -- 拖拽图片至编辑区 | partial |
| 1676229 | 查看导入图片 | partial |
| 1676227 | 详情页右键菜单操作---删除图片 | partial |
| 1676225 | 详情页右键菜单操作---复制图片 | partial |
| 1676223 | 详情页右键菜单操作---剪切图片 | partial |
| 1676221 | 详情页右键菜单操作---保存图片 | partial |
| 1676213 | Ctrl+Z撤销和Ctrl+Shift+Z重做功能验证---导入/删除图片 | equivalent |

**自动化等级**：L1/L2。拖拽、右键菜单、查看原图可拆成 L2；主链路优先覆盖插入、删除、撤销重做。

**已落地 AT 用例**：

| 子场景 | suite | DB 预期模板 |
|---|---|---|
| S004-001 图片粘贴插入并持久化 | `tests/at/yaml/Tiptap富文本编辑器/suite_Tiptap富文本编辑器_004_001_s1.suite.yaml` | `tests/at/expected/tiptap_scenario_004_001_expected.yaml` |
| S004-002 图片插入后撤销删除 | `tests/at/yaml/Tiptap富文本编辑器/suite_Tiptap富文本编辑器_004_002_s1.suite.yaml` | `tests/at/expected/tiptap_scenario_004_002_expected.yaml` |
| S004-003 图片插入撤销后重做恢复 | `tests/at/yaml/Tiptap富文本编辑器/suite_Tiptap富文本编辑器_004_003_s1.suite.yaml` | `tests/at/expected/tiptap_scenario_004_003_expected.yaml` |

**结果判定**：YouQu UI 操作通过后，执行 `tests/at/scripts/assert_tiptap_scenario_db.py` 校验 Tiptap JSON 中的 `image` node 数量、`images/` 相对路径、图片文件落盘；当前自动化优先覆盖稳定主链路：图片插入后通过 Ctrl+Z 撤销使 DB 中 image node 归零，通过 Ctrl+Y 重做恢复 image node。图片右键/拖拽/原图查看另拆 L2，避免引入不稳定坐标和右键菜单。

---

### S005：旧 Summernote 数据迁移到 Tiptap

**目标**：验证老用户数据在编辑器切换后不丢失，迁移后仍可编辑保存。

**覆盖链路**：

1. 使用旧 Summernote 数据库 fixture 启动应用。
2. 启动时触发迁移。
3. 验证迁移完成后进入主界面。
4. 打开旧笔记。
5. 验证笔记详情页可打开。
6. 在 Tiptap 编辑区追加文本。
7. 切换笔记或重启应用。
8. 验证应用无异常，笔记仍可打开。

**映射原始用例**：

| 原始用例 ID | 标题 | 覆盖关系 |
|---|---|---|
| 1884375 | 语音记事本基本功能验证 | partial |
| 1634905 | 重启应用查看笔记列表默认选中第一条 | partial |
| 1634907 | 切换笔记，详情页同步切换 | partial |
| 1634959 | 点击文本笔记详情页的文本区域编辑文字内容 | partial |

**自动化等级**：L1。需要准备稳定的旧数据 fixture。

## L2 场景

### S006：Tiptap 富文本格式工具栏

**目标**：验证 Summernote 工具栏迁移到 Tiptap 后，常用格式入口可用。

**覆盖链路**：

1. 新建文本笔记并输入文本。
2. 选中文本。
3. 执行加粗和取消加粗。
4. 执行斜体和取消斜体。
5. 执行下划线和取消下划线。
6. 执行删除线和取消删除线。
7. 执行有序列表。
8. 执行无序列表。
9. 滚动编辑区后验证工具栏仍可用。

**映射原始用例**：

| 原始用例 ID | 标题 | 覆盖关系 |
|---|---|---|
| 1681115 | V25语音记事本-文本工具状态 | partial |
| 1676269 | 选中文本进行加粗和取消加粗 | equivalent |
| 1676267 | 显示输入光标，加粗和取消加粗 | partial |
| 1676263 | 显示输入光标，设置/取消设置斜体 | equivalent |
| 1676261 | 选中文本设置/取消设置下划线 | equivalent |
| 1676259 | 显示输入光标，设置/取消设置下划线 | partial |
| 1676257 | 选中文本设置/取消设置删除线 | equivalent |
| 1676255 | 显示输入光标，设置/取消设置删除线 | partial |
| 1676241 | 选中文本，点击有序列表 | equivalent |
| 1676239 | 显示输入光标，点击有序列表 | partial |
| 1676237 | 选中文本，点击无序列表 | equivalent |
| 1676235 | 显示输入光标，点击无序列表 | partial |

**自动化等级**：L2。若只断言控件存在，标记为 partial；若能通过导出 HTML 校验格式，再升级为 equivalent。

---

### S007：Tiptap 搜索高亮与清空

**目标**：验证搜索从 Summernote `findText` 切换到 Tiptap 搜索桥后仍可用，并且不污染正文。

**覆盖链路**：

1. 新建包含关键字的文本笔记。
2. 搜索详情页正文关键字。
3. 验证搜索结果状态。
4. 清空搜索框。
5. 回到笔记详情页继续编辑。
6. 执行撤销/重做，验证搜索行为不影响正文编辑链路。

**映射原始用例**：

| 原始用例 ID | 标题 | 覆盖关系 |
|---|---|---|
| 1676369 | V25-语音记事本 搜索关键字匹配详情页文本 | equivalent |
| 1676371 | V25-语音记事本 搜索关键字匹配文本笔记 | partial |
| 1676373 | 搜索关键字不匹配文本笔记和详情页文本内容 | equivalent |
| 1676375 | 搜索关键字仅匹配记事本 | partial |
| 1635179 | 输入特殊字符搜索 | equivalent |
| 1635181 | 搜索框输入关键字，按Enter键显示搜索结果 | equivalent |
| 1635183 | 搜索只针对文本笔记列表和详情页的文本 | partial |

**自动化等级**：L2，优先做可稳定断言的搜索结果/应用状态。

---

### S008：Tiptap 混合内容导出

**目标**：验证 Tiptap JSON 能正确导出 TXT/HTML/语音相关文件。

**覆盖链路**：

1. 创建包含文本的笔记。
2. 插入图片。
3. 可选插入或使用预置语音块。
4. 保存为 TXT。
5. 保存为 HTML。
6. 保存语音。
7. 验证导出文件存在。
8. 可选验证 TXT 包含正文关键字。

**映射原始用例**：

| 原始用例 ID | 标题 | 覆盖关系 |
|---|---|---|
| 1676417 | 保存为TXT | equivalent |
| 1676415 | 保存语音 | partial |
| 1676347 | 详情页包含语音笔记+文本+语音转文字+图片，保存为HTML | partial |
| 1676345 | 详情页包含语音笔记+文本+语音转文字+图片，保存为TXT | partial |
| 1676343 | 保存语音 | partial |
| 1676323 | 多选状态下点击详情页“保存笔记”按钮，保存为TXT | partial |
| 1676321 | 多选状态下点击详情页“保存语音”按钮 | partial |

**自动化等级**：L2。文件选择框和保存路径需要使用稳定策略，禁止固定坐标。

---

### S009：Tiptap 语音块基础链路

**目标**：验证语音块从 Summernote 插件迁移到 Tiptap node view 后基础能力可用。

**覆盖链路**：

1. 使用包含语音块的 fixture 数据启动。
2. 打开语音笔记。
3. 验证语音块显示。
4. 执行播放/暂停。
5. 执行复制/剪切/粘贴语音块。
6. 删除语音块。
7. 保存语音。
8. 可选验证语音转文字结果回写。

**映射原始用例**：

| 原始用例 ID | 标题 | 覆盖关系 |
|---|---|---|
| 1676293 | 语音笔记显示 | equivalent |
| 1676291 | 播放/暂停播放录音 | partial |
| 1676289 | 播放/暂停播放录音-通过space快捷键操作 | partial |
| 1676287 | V25语音记事本-语音右键菜单 | partial |
| 1676285 | 右键语音笔记，保存为MP3 | partial |
| 1676279 | 复制语音笔记 | partial |
| 1676277 | 剪切语音笔记 | partial |
| 1676211 | Ctrl+Z撤销和Ctrl+Shift+Z重做---保存/删除录音 | partial |
| 1676435 | 网络正常，可正常进行语音转文字操作 | manual/partial |
| 1679637 | 网络不正常，无法正常进行语音转文字操作 | manual/partial |
| 1680885 | 语音转文字-编辑 | manual/partial |

**自动化等级**：L2/L3。真实录音、网络 AI、音频设备相关内容不建议放入基础流水线。

---

### S010：Tiptap 主题、字体、启动同步

**目标**：验证 Tiptap QWebChannel 初始化前后的主题/字体信息不会丢失。

**覆盖链路**：

1. 启动应用进入 Tiptap 编辑器。
2. 验证编辑区可用。
3. 切换主题或使用预设主题环境启动。
4. 验证应用无异常，编辑区仍可输入。
5. 验证字体相关入口可用。

**映射原始用例**：

| 原始用例 ID | 标题 | 覆盖关系 |
|---|---|---|
| 1676457 | 主题 | partial |
| 1676205 | 设置字体统一 | partial |
| 1676207 | 编辑区无字体-设置字体 | partial |
| 1676209 | 编辑区有字体-设置字体 | partial |
| 1635305 | 切换字体大小查看语音记事本各个界面显示 | manual/partial |

**自动化等级**：L2。颜色精确视觉判断不适合基础 AT，可降级为应用状态和编辑可用性验证。

## 第一批建议实现顺序

| 顺序 | 场景 | 原因 |
|---|---|---|
| 1 | S001 默认启动与编辑区可用 | 最基础，失败说明 Tiptap 默认路径有问题 |
| 2 | S002 新建编辑切换持久化 | 核心文本笔记主链路 |
| 3 | S003 文本编辑快捷键 | 稳定、无需坐标、能覆盖大量真实用例 |
| 4 | S004 图片插入删除撤销重做 | 对应本轮图片插入/选中光标修复重点 |
| 5 | S005 旧数据迁移 | Summernote → Tiptap 切换最核心风险 |

## 后续统计口径

后续对外建议同时输出三类指标：

1. **场景覆盖率**：已自动化场景数 / 计划场景数。
2. **源用例追溯覆盖率**：`trace.source_cases` 去重后的原始用例数 / 可自动化原始用例数。
3. **流水线通过率**：通过 suite 数 / 执行 suite 数。

这样可以说明：AT 用例不是为了堆数量，而是围绕 Tiptap 替换 Summernote 的真实功能风险做场景化验证。
