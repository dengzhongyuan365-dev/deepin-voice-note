# 两条已确认缺陷：已完成待办回车格式继承 / 普通段落恢复待办后的父项联动

本文件为修复过程的最终记录；之前 `RICHTEXT_CROSS_MATRIX.md` 中「未修改产品源码」描述的是**发现阶段**，不适用于本次修复阶段。所有构建和真实操作仅在 `dzy@10.8.15.53:~/Desktop/deepin-voice-note`。

## 修复前失败证据

1. `case_list_richtext_probe_020`：三级 ROOT/A/P2，勾选 P2 后给它文字加粗和背景色。回车前 `selection.$from.marks() = [bold, highlight]`；回车后、新项 P3 输入前 `storedMarks = null`、位置 marks 为空；P3 无格式。修复前日志 `probe_020-final.log`，图片/状态 `20261105-173936-855181`。
2. `case_list_richtext_probe_022`：ROOT/A/P2 全勾选，后加三级 O 并设有序；O 转普通文本后隔断任务关系，ROOT/A 勾选属正常；O 再转未勾选的视觉三级待办，ROOT/A 仍勾选。修复前日志 `probe_022-final.log`，图片/状态 `20261105-174255-021984`。17 行复杂原型 `depth_019-verified.log` 亦失败。

## 原因和修复范围

- `web-editor/src/runtime/task-list-cascade.js`: Tiptap `splitListItem` 通过 `ensureMarks` 设置回车后待输入文字格式。因为新增未勾选 P3 导致已完成的 A/ROOT 完成态重算，插件 `appendTransaction` 仅修改 checkbox 但新事务默认不带 `storedMarks`，覆盖前一事务保留的格式。修复：仅在**新增父项状态变化**且原 state 具有显式待输入格式的折叠选区，复制 `storedMarks` 到追加事务；不影响非折叠选区和用户主动取消格式。
- 同文件：按顶层列表块单独构建视觉任务树，O 从普通文本恢复为相邻独立 taskList 时尽管显示三级，仍无法算进 ROOT/A。修复：连续列表块在前块末尾确实保留嵌套视觉层、后块首项也处于子级时继续缩进栈；普通文本及其他非列表块仍清空栈构成硬边界，**相邻独立根级列表不会仅因 Tab 自动卷入前块**。有序/无序项仍参与栈以阻断不合法待办联动。
- 修正旧 `list-toolbar-exhaustive-matrix.test.mjs` 对已完成任务“重新应用一个未勾选的子任务仍要求父任务保持勾选”的过时预期：父项变未勾选是正确联动；其他项仍应完全不变。二次取消 C 后，失去所有子项的 B 是叶子项，不凭空恢复历史勾选。
- `tests/at/setup_voice_note_at.sh` 测试辅助：远程桌面 Caps Lock 偶尔被外部会话打开，导致建文 `ROOT` 实际输入 `root`，失败发生在产品行为之前。AT 启动前只检查远程 X11 LED 并关闭 Caps Lock，避免将键盘环境污染误报成产品失败。该操作不触及用户本地桌面。

## 测试

- 新增 `web-editor/test/task-cross-block-format.test.mjs` 两条单测：已完成待办回车保留 mark，隔着普通段落不联动、相邻嵌套块恢复视觉父子；前端全量单测 `690/690` 通过。
- 远程 `npm run build` + `cmake --build build -j 4` 成功，AT 实际运行自己构建的 `build/src/deepin-voice-note`；最小 AT `probe_020`、`probe_022` 修复前失败、修复后均通过。
- 17 行完整长链 `depth_013` 修复后通过；富文本多行、跨类型操作 `cross_001`、`depth_009` 修复后通过。
- 远程真实键鼠 AT 共 **14 套、17 条检查点用例，17 通过、0 失败**：包括两条最小复现、17 行混合长链、富文本与跨类型、`task_visual_edge_matrix_001` 至 `_004`、`richtext_cross_005` 与 `_006`。逐套日志和统计见 `tests/at/artifacts/richtext-cross/fix-results.json`；此前 Caps Lock 导致前置条件失败的旧日志不计入结果。
- 额外补充相邻独立一级列表不得误接视觉父项的反向单测；最终修改后的前端全量仍为 `690/690`（`fix-all-unit-final.log`）。

## 后续发现：连续 Enter 退出空项时，二级/一级文字样式丢失

用户继续操作发现：已完成的三级 P2 加粗并设背景色 → Enter 建三级 P3（P3 继承正确）→ Enter 建空三级 → 再 Enter 下沉至二级 → 输入 NEXT，NEXT 的粗体和背景色都消失。真实键鼠 AT `case_list_richtext_probe_023.suite.yaml` 修复前失败，日志 `tests/at/artifacts/richtext-cross/probe_023-before-fix.log`：空三级时 `storedMarks=[bold,highlight]`，下沉至空二级后变为 null，NEXT 无文字 marks；视觉层级仍正确。之前 `depth_007` 连续创建的是**有文字**的三级项，没有覆盖空项回车反缩进，这就是门禁遗漏点。

产品约定：用户未主动取消加粗和背景色时，空项缩进层级变化不应清除仍在使用的待输入格式。根因是 `ListNestingGuard.descendEmptyListItem` 在空项再次回车时走 `liftActiveListItem`（结构提升）或 `setNodeMarkup`（额外视觉层级下降）；结构提升会重建选区，使 Tiptap 回车保存的 `storedMarks` 丢失。这是与先前父项状态重算导致的格式丢失**不同的第二处入口**，所以先前只修 `TaskListCascade.appendTransaction` 不够。

修复 `web-editor/src/runtime/list-nesting-guard.js`：仅空列表项的 Enter 下沉成功、折叠选区且本来存在显式 `storedMarks` 时，在整次下沉（含结构归一化）结束后恢复待输入 marks；恢复事务不加入 Undo 历史。添加 `web-editor/test/task-cross-block-format.test.mjs` 两条单测：结构三级空项下降与仅视觉三级空项下降。新 AT `probe_023` 复测二级输入；扩展 AT `probe_024` 在二级再回车建空项并下沉一级，检查一级新输入仍继承。所有文件和应用运行均仅在远程测试机。

修复后最终统计详见 `tests/at/artifacts/richtext-cross/probe_023-results.json`；此前 `fix-results.json` 是**本次发现之前**两条修复的结果，不包含新增空项回车路径。

### 同一规则延伸：空项 Tab / Shift+Tab

针对上述“视觉层级变化不等于用户取消格式”的规则，补测空三级 `Shift+Tab` 与空二级 `Tab`：两者在修改前都会清除显式待输入 marks，单测修复前失败证据分别为 `probe_023-shifttab-exploration.log`、`probe_025-tab-exploration.log`。修复只针对**原本已存在显式 storedMarks 的折叠光标**，在 `liftActiveListItem` / `sinkActiveListItem` 结构或视觉操作完成后恢复；不修改有文本选区的格式规则，也不新增 Undo 记录。新真实键鼠 AT `probe_025`、`probe_026` 分别覆盖 Shift+Tab / Tab 后继续输入并断言实际渲染 marks。最终构建和 AT 统计请看 `tests/at/artifacts/richtext-cross/probe_026-results.json`。
