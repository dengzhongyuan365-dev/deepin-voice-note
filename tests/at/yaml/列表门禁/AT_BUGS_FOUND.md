# AT-FOUND-001：Tab 对文本选区错误替换为 NBSP

## 1. 问题

在用户实际编译版本中：

```text
/home/ut006116@uos/WorkSpace/deepin-voice-note/build/src/deepin-voice-note
```

只要存在非空文本选区，按 Tab 就会删除整个选区并插入 4 个 NBSP，
列表缩进和普通文字缩进逻辑都没有执行。

典型结果：

```text
A
[4 个 NBSP]
E
```

B/C/D 等选中正文丢失。

## 2. 正确规则

```text
选区包含列表项
    -> 列表项按层级缩进

选区包含普通文字
    -> 保留文字并增加文本缩进

普通段落和列表混合选中
    -> 按块分别处理

列表项没有同级前项
    -> 保持原级，继续处理后续可缩进项

视觉层级已经到三级
    -> 不继续缩进
```

示例：

```text
A 一级
B 一级
C 一级
```

选中 A/B/C 后按 Tab：

```text
A 一级
B 二级
C 二级
```

正文、列表类型和选区不能丢失。

## 3. AT 如何发现

测试文件：

```text
case_list_tab_selection_semantics_gate_001.suite.yaml
```

每条用例先确认：

- 编辑器拥有焦点；
- ProseMirror 选区非空；
- 选区文本符合预期；
- 再执行真实 Tab。

修复前结果（首轮 7 条无序/普通文字用例）：

```text
Specs: 1 passed, 6 failed
```

失败场景：

| 场景 | 修复前实际结果 |
|---|---|
| 列表 A/B 全选 Tab | A/B 被替换成一个 NBSP 空项 |
| 列表 A/B/C 中选中 B 的文字 Tab | B 被替换成 NBSP |
| 普通文字 ABC 选区 Tab | ABC 被替换成 NBSP |
| 普通段落 + 列表混合选区 Tab | 正文被整体替换 |
| 一级 A/B/C 全选 Tab | 正文被整体替换 |
| B/C/D 局部混合列表多选 Tab | 变成 A / NBSP / E |

通过场景：

- 一级 A/B/C 光标在 A 按 Tab，三项保持一级，符合规则。

失败日志：

```text
/tmp/dvn-build-tab-semantics.log
```

## 4. 代码修复

### 4.1 Tab 分流

文件：

```text
web-editor/src/runtime/list-nesting-guard.js
```

删除“所有非空 TextSelection 先替换为 NBSP”的分支，改为：

```text
非空文本选区
  -> 普通段落按块增加文本缩进
  -> 列表项按列表规则批量缩进
  -> 混合选区两类都处理
```

### 4.2 普通文字选区

文件：

```text
web-editor/src/runtime/list-behavior.js
```

新增 `indentSelectedPlainTextBlocks()`：

- 找到选区覆盖的普通段落；
- 在每个段落开头插入 4 个 NBSP；
- 不删除原文字；
- 通过 transaction mapping 恢复原选区。

### 4.3 列表批量缩进

修改 `sinkSelectedListItems()`：

- 先按操作前选区快照收集所有选中列表项；
- 每个选中项各增加一级视觉缩进；
- 允许无父项的游离二级/三级项存在；
- 在同一个 transaction 内批量写入，避免后一项读取前一项的新缩进；
- 最多三级，最后恢复原选区。

## 5. 修改后验证

单测：

```text
cd web-editor
node --import ./test/register-css-loader.mjs --test \
  test/tab-plain-text.test.mjs \
  test/list-indent-matrix.test.mjs
```

结果：

```text
33 passed, 0 failed
```

真实 AT：

```text
Specs: 13 passed, 0 failed
```

通过日志：

```text
/tmp/dvn-fix-at-semantics-2.log
```

## 6. 当前结论

本次 Tab 选区语义问题已经修复，覆盖无序列表和待办列表。

本次范围只保留：

- `case_list_tab_selection_semantics_gate_001.suite.yaml`
- 对应的单测修改
- 本问题记录

之前批量添加的其他列表门禁、矩阵、压力及已关闭 Bug 套件已移除。


---

# Tab / Shift+Tab 三列表矩阵

文件：

```text
case_list_tab_shift_tab_matrix_001.suite.yaml
```

覆盖有序、无序、待办三种列表：

- 第二项 Tab 后 Shift+Tab 往返；
- B/C 多选 Tab 后 Shift+Tab 往返；
- 一级首项可以成为无父项的游离二级/三级项；
- 同类型三级缩进后连续 Shift+Tab 回一级；
- 三种跨类型三级链：有序→无序→待办、无序→待办→有序、待办→有序→无序；
- 12 项复杂混合、局部转换、多选、勾选联动和 Undo/Redo；
- 有序/待办游离项的编号连续性和视觉父子联动。

最终结果：

```text
10 passed, 0 failed
```

历史问题、测试脚本修正和新增产品 Bug 见本文件后面的 AT-FOUND 记录。


---

# AT-FOUND-002：多选 Tab 使后面的项一次跳两级

## 问题

视觉缩进模型允许一级首项成为游离二级项。旧的多选 Tab 路径按项循环调用
单点 `sinkListItem`，后一项会读取前一项刚更新过的 `dvnIndentLevel` 作为
缩进基准。

典型结构：

```text
A 一级
B 二级
C 三级
D 二级
E 一级
```

选中 A-E 后按一次 Tab，E 从一级直接变成三级。

## 发现方式

`web-editor/test/list-indent-matrix.test.mjs` 的全结构 × 全选区矩阵在生成
“选中 A-E 后 Tab”时稳定报告：

```text
E 一次变化超过一级: 1 -> 3
```

新增 AT：

```text
complex_ordered_orphan_numbering
```

用真实键盘执行 A 连续 Tab 到三级、B/C/D 各 Tab 一次，然后 A-D 多选往返，
同时校验视觉层级与有序编号。

## 修复

文件：

```text
web-editor/src/runtime/list-behavior.js
```

多选 Tab 改为基于操作前选区快照，在一个 transaction 中把每个选中项各加
一级视觉缩进；不再逐项重新定位，也不再复制 `previousSibling` 的缩进值。
最终视觉层级仍硬限制为三级。

---

# AT-FOUND-003：待办游离项勾选错误联动视觉更浅的结构后代

## 问题

待办级联旧逻辑把 ProseMirror 结构 descendants 全部视为视觉子项。允许游离
项后，结构父子关系和视觉父子关系可能不同。

例如：

```text
A 视觉三级
B 视觉二级
C 视觉三级（B 的视觉子项）
D/E 视觉二级
F 视觉三级（E 的视觉子项）
```

这里 B-F 可能仍是 A 的结构后代，但视觉层级比 A 浅。勾选 A 时，旧逻辑会
错误勾选 B-F。

## 发现方式

新增 AT：

```text
complex_task_orphan_cascade
```

真实点击 A 的勾选框后断言只有 A 变为完成；随后验证 B 只联动 C、E 只联动 F、
同级 D 不联动 E，并覆盖 B-F 多选 Tab/Shift+Tab 与 Undo/Redo 后勾选状态不变。

## 修复

文件：

```text
web-editor/src/runtime/task-list-cascade.js
```

`taskItemDescendants()` 只收集视觉层级严格深于当前项的节点，结构后代若视觉
层级不更深则不再参与级联。


---

# AT-FOUND-004：跳级视觉父子下待办父项完成态依赖操作顺序

## 1. 问题

结构：

```text
A 一级
B 三级
C 二级
D 三级
E 一级
```

用户确认：B 和 C 都是 A 的直接视觉子项，D 是 C 的视觉子项。

修复前：

- 点击 A：B/C/D 全部被级联勾选；
- 只点击 C：C/D 完成后 A 被勾选，但 B 仍未勾选。

同一视觉结构下，父项完成态取决于用户先点 A 还是先点子项，属于 Bug。

## 2. 发现方式

新增 AT：

```text
orphan_task_skipped_level_parent_consistency
```

创建 A-L 共 12 个待办项，构造：

```text
A(1) -> B(3) -> C(2) -> D(3) -> E-L(1)
```

点击 C 后断言 A 仍为未完成，因为 B 这一 A 的直接视觉子项尚未完成。
修复前 AT 实际结果为 `A=true, B=false, C=true, D=true`，稳定失败。

## 3. 根因

文件：

```text
web-editor/src/runtime/task-list-cascade.js
```

`directChildTaskItems()` 原来先取所有候选后代，然后只保留“最浅视觉层级”。

在当前结构中：

- B 深度 3；
- C 深度 2；
- D 深度 3。

最浅层级过滤只保留 C，漏掉更早完成分支中的 B；但 `taskItemDescendants()`
仍把 B 视为 A 的后代，导致点击 A 和点击子项的完成态不一致。

## 4. 修复

按文档顺序维护视觉缩进栈：

1. 处理当前项前，弹出所有同层或更深的分支；
2. 栈顶就是当前项的最近视觉祖先；
3. 栈顶不超过父项时，当前项是父项的直接子项；
4. 跳级项和后续较浅项都能得到正确的父子关系。

因此：

```text
A(1) -> B(3) -> C(2) -> D(3)
```

解析为：

```text
A 的直接子项：B、C
C 的直接子项：D
```

## 5. 验证

新增单测后：

```text
663 passed, 0 failed
```

真实 AT 全量：

```text
32 passed, 0 failed
```

目标用例：

```text
orphan_task_skipped_level_parent_consistency
```


---

# AT-FOUND-005：任务级联错误参与 Undo，导致一次撤销回退两次勾选

## 1. 问题

结构：

```text
A 一级
B 二级
C 三级
D 三级
```

操作：

1. 勾选 C：C 完成；
2. 勾选父项 B：B 触发级联，C/D 完成，A 随子项完成；
3. 按一次 Undo。

期望回到第 2 步之前：

```text
A 未完成
B 未完成
C 已完成
D 未完成
```

实际：

```text
A 未完成
B 未完成
C 未完成
D 未完成
```

一次 Undo 把第 1 步的 C 勾选也回退了。

## 2. 根因

文件：

```text
web-editor/src/runtime/task-list-cascade.js
```

`TaskListCascade.appendTransaction` 会在所有任务相关事务后执行，包括
ProseMirror History 产生的 Undo/Redo 事务。

Undo 勾选 B 时，事务内容是：

```text
B: true -> false
```

插件把这次变化误判成“用户手动取消父项 B”，于是执行：

```text
cascadeManualParentChanges()
  -> C = false
  -> D = false
```

因此历史中原本已完成的 C 被级联插件再次取消。

## 3. 修复

识别 History 事务：

```text
transaction.getMeta('history$') != null
```

发现 Undo/Redo 事务时直接跳过任务级联 `appendTransaction`。历史事务本身已经
包含完整的反向状态，插件不能把历史回放再次解释成用户勾选操作。

## 4. 验证

目标 AT：

```text
orphan_task_skipped_parent_undo_redo
```

修复前稳定失败，修复后通过。

全量真实 AT：

```text
32 passed, 0 failed
```

前端单测：

```text
663 passed, 0 failed
```


---

# PMS 历史 Bug 回归结果

使用当前 `build/src/deepin-voice-note` 真实操作复核：

| PMS Bug | 原问题 | 当前结果 | AT |
|---|---|---|---|
| 382177 | 二级待办缩进为三级后，勾选新三级会联动原有三级 | 未复现，通过 | `pms_bug_382177_moved_level3_not_parent` |
| 382181 | 游离三级未完成时，勾选其他二级导致一级提前勾选 | 未复现，通过 | `pms_bug_382181_skipped_level_parent` |
| 382189 | 一级勾选后，二级行尾 Enter 新增未勾选二级，一级仍保持勾选 | 未复现，通过 | `pms_bug_382189_new_child_unchecks_parent` |

套件：

```text
case_list_pms_task_regression_001.suite.yaml
```

结果：

```text
3 passed, 0 failed
```


---

# PMS 已关闭列表 Bug 回归结果

从模块 `133755` 的 104 条记录中筛出与列表编辑直接相关的已关闭 Bug，
使用当前构建真实操作回归：

| PMS Bug | 原问题 | 当前结果 | AT |
|---|---|---|---|
| 381039 | 多级列表第一行一级项按 Tab 无法降为二级 | 未复现，通过 | `pms_closed_381039_first_item_tab` |
| 381009 | 三级行尾 Enter 新空行再 Enter，应降为二级 | 未复现，通过 | `pms_closed_381009_empty_level3_enter` |
| 379801 | 二级 Shift+Tab 后再 Tab，其他二级项被压到三级 | 未复现，通过 | `pms_closed_379801_shift_tab_then_tab` |
| 379767 | 三级回退后再缩进出现四级 | 未复现，通过 | `pms_closed_379767_level3_roundtrip` |
| 379771 | 三级无序项连续 Backspace 无法退出列表 | 未复现，通过 | `pms_closed_379771_backspace_exit` |
| 379765 | 一级有序项 Shift+Tab 未退出为普通文本 | 未复现，通过 | `pms_closed_379765_level1_exit` |
| 379759 | 二级有序项行首 Backspace 跳到上一行并重叠 | 未复现，通过 | `pms_closed_379759_level2_backspace` |
| 379715 | 多行文本切换三种列表后选区丢失 | 未复现，通过 | `pms_closed_379715_selection_switch` |
| 379707 | 转换列表后点击选中区域不能取消高亮 | 未复现，通过 | `pms_closed_379707_click_clear_selection` |
| 379679 | 多行文本转有序列表后序号显示位置异常 | 未复现，通过 | `pms_closed_379679_multiline_number` |

套件：

```text
case_list_closed_pms_regression_001.suite.yaml
```

结果：

```text
10 passed, 0 failed
```

全量列表 AT 合计：

```text
45 passed, 0 failed
```


---

# AT-FOUND-006：待办父子转有序再转回待办后父项仍保持勾选

## 1. 问题

1. 创建待办 A-L；
2. B/C/D 缩进为 A 的二级子项；
3. 勾选 A，B/C/D 级联勾选；
4. 选中 B/C/D，点击有序列表；
5. 再选中 B/C/D，点击待办列表。

期望：B/C/D 作为新任务默认未勾选，A 同步取消勾选。

修复前实际：

```text
A 已勾选
B/C/D 未勾选
```

## 2. 根因

列表转换事务：

```text
web-editor/src/runtime/list-behavior.js
switchListTypeForSelection()
```

为了避免转换时误级联未选中的祖先，设置了：

```text
tr.setMeta(taskListCascadePluginKey, true)
```

这会跳过全局任务级联插件。但转成待办时，新 taskItem 默认
`checked=false`，父项仍保留旧的 `checked=true`，造成父子状态矛盾。

## 3. 修复

在任务级联模块导出：

```text
normalizeTaskParentCheckedStates(tr)
```

列表转换到 `taskList` 后、构造最终选区前，直接在该转换事务内归一化父项状态。

必须先归一化再构造 Selection，因为 `setNodeMarkup` 会生成新文档；旧文档上的
Selection 不能再用于当前 transaction。

## 4. 验证

目标 AT：

```text
stress_task_parent_child_conversion_history
```

修复前稳定失败，修复后通过。

全量列表 AT：

```text
51 passed, 0 failed
```

前端单测：

```text
664 passed, 0 failed
```


---

# 待办多级混合列表压力回归

新场景：

```text
13 项连续待办，内部包含多个有序/无序列表，分布于一级、二级、三级
```

覆盖操作：

- 中间有序项 Shift+Tab 后，有序编号重新分组；
- 中间待办项 Shift+Tab 后，父项完成态重新计算；
- 已勾选父项下，将三级有序项局部转成待办；
- 将三级待办局部转回有序；
- 中间项转换后的 Undo/Redo；
- 文字顺序、列表类型、视觉层级、编号和勾选状态。

套件：

```text
case_list_task_mixed_hierarchy_001.suite.yaml
```

结果：

```text
2 passed, 0 failed
```

全量列表 AT 合计：

```text
53 passed, 0 failed
```


---

# AT-CANDIDATE-007：回车拆出同名任务后，已有三级任务被取消勾选

- 状态：稳定复现，待用户确认；本轮产品源码未修改。
- 新增候选数：1；独立重复运行：2/2 失败；唯一文字对照通过。
- 用例：`case_list_user_evolution_discovery_001.suite.yaml` 的 `journey_split_duplicate_task_text`。
- 步骤/预期/实际/只读代码分析/证据：见 `USER_EVOLUTION_DISCOVERY.md`。
- 原因指向：文字加出现次数不能稳定识别拆分前后的任务，导致将新任务当成旧任务的手动取消。
- 尚未修复，未将失败断言改成通过；失败后的 Undo/Redo 未执行，不计为覆盖。


## 2026-11-05 更新：007 与用户反馈的新父项问题修复

用户已授权一起修复。新增真实输入 AT 修复前 2/2 失败、修复后 2/2 通过，
包含 22 个整篇检查点/用例和后续点击、Undo/Redo。两个问题独立记录，
不是把用户反馈重复计为 AT 新发现。详情见 `TASK_SPLIT_FIX_REPORT.md`。
本轮统计：AT 发现的已确认问题 1 个；用户发现的问题 1 个；共修复 2 个。
扩展回归结果以该报告和对应运行日志为准。上文“尚未修复”为历史调查记录。


### 2026-11-05 本轮最终回归结果

同一修复版本：17 套件、64 条 AT 通过，0 失败、0 跳过；单元回归 688/688。
新两条 AT 修复前失败、修复后通过。初轮旧预期调整与重跑依据见 `TASK_SPLIT_FIX_REPORT.md`；
机器可核验结果见 `tests/at/artifacts/task-split-fix/final-results.json`。
