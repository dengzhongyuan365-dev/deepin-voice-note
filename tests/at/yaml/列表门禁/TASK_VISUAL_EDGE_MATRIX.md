# 待办视觉树边界与高交叉新 AT（2026-11-05）

## 原则/输入路径

只在远端 `dzy@10.8.15.53:~/Desktop/deepin-voice-note` 的编译版 `build/src/deepin-voice-note` 的 DDE 会话执行；不占用本地 GUI。
本轮**只修改 YAML 用例和本文档，没有修改产品源码**；`task-split-fix/source-after.sha256` 与当前产品源码校验一致。
每条用例都从空文档实际键盘输入，真实点击工具栏和复选框、使用 Enter/Tab/Shift+Tab/Undo/Redo；CDP 仅只读定位实际渲染坐标、获取状态及失败截图，未用 setContent 或脚本直接改 checkbox/document 模拟操作。
AT 的 `__dvnJourney.checkpoint` 按文档顺序逐行核对全文文字、实际渲染层级、列表类型、checkbox 状态和有序编号；失败会留 JSON/截图。每条 17 行、三级多分支，基础路径包含 P 的 3→2→3、添加 P2/O2、将 O/U/N 转为有序/无序、勾选 XA 及后方 A、在 X|A 回车生成新父项 A。

基础视觉树（`[x]` 已完成；O/O2、N 有序，U 无序）：

```text
[ ] ROOT
  [x] X
  [x] A（回车新生成）
    [x] P
    [x] P2
    1. O
    2. O2
    · U
  [x] A（后方原有同名项）
    [x] Q
  [ ] V
    [ ] T
[ ] TAIL
  [ ] W
    [ ] Y
  1. N
[ ] END
```

## case_list_task_visual_edge_matrix_001.suite.yaml

1. `edge_duplicate_names_in_three_visual_branches`：把三级 P 的文字**真实选中并改为 A**，此时文档有 3 个视觉层级/分支不同、但名称相同的 A；点击新二级 A 取消仅影响改名后的 A 与 P2，不影响后方 A/Q；点击后方 A 取消仅影响 Q；重新逐个勾选新分支子项，父项只有全部完成才勾选；对末项完成进行 Undo/Redo。校验另一分支保持原态，O/O2 与 N 的编号不动。
2. `edge_outdent_sibling_checkbox_boundary`：P2 三级 Shift+Tab 成二级视觉同级，此时新 A 只有 P 一个直接视觉待办子项。取消新 A，只联动 P，不影响游离出的 P2 和后方 A/Q；取消 P2、恢复 P 勾选，A 按剩余子项重算；Undo/Redo；再 Tab 把未完成的 P2 变回三级，A 必须取消；重新勾选 P2 后 A 才完成。
3. `edge_ordered_children_partial_type_conversion`：连续选中三级有序 O/O2，**同一次工具栏操作**转待办，二项新待办初始未完成，原二级 A 必须取消；逐项完成时第一项不能提前勾选父项，第二项完成才勾选；Undo/Redo 时全文编号（仍存在的 N=1）、层级和两个同名 A 分支均保持。

## case_list_task_visual_edge_matrix_002.suite.yaml

4. `edge_enter_new_same_name_child_under_checked_parent`：在已经勾选的三级 P2 行尾按 Enter，新建同级空待办，使二级 A 取消勾选但 P/P2 保持；输入 A，**三级子项与两处二级父项同名**。交叉点击后方二级 A 取消/重新完成 Q，不能触及前方；勾选新三级 A 才恢复前方父项；Undo/Redo 只恢复该子项及父项，不影响后方 A/Q 和有序 O/O2。
5. `edge_checked_child_task_ordered_task_roundtrip`：已有完成的三级 P2 → 有序时，视觉父项 A 仍应完成（剩余直接待办 P 完成）；有序 P2 与后面的有序 O/O2 合并，编号严格 **1/2/3**，N 仍为 1；转换 Undo/Redo 后，再将 P2 从有序转待办，初始未勾选使 A 取消；重新勾选 P2 恢复 A，并检查 Undo/Redo。O/O2 回到 1/2。

第一轮该路径失败在**测试预期**：最初错误地预期 P2 转有序后 O/O2 仍为 1/2，实际列表合并为 P2/O/O2=1/2/3；快照中全文类型、状态、层级均正确。修改测试预期（非产品源码）后，整条链重新运行通过；原始失败留 `artifacts/visual-edge-matrix/second-run.log` 和 `artifacts/list-user-evolution/*145538*`。

## case_list_task_visual_edge_matrix_003.suite.yaml

6. `edge_multi_type_range_conversion_outdent_cascade`：同次选中原有序三级 O/O2 与无序三级 U，局部整体转成待办，此时三个新子项未完成，二级 A 取消；逐项勾选到第三项才完成父项；将最后一个已完成的子项 Shift+Tab 变二级视觉同级，取消该同级项不应取消 A；再取消 A 的剩余子项之一，A 必须取消；Undo/Redo 时游离项、原 P/P2、后方同名 A/Q 以及 N=1 不变。

## case_list_task_visual_edge_matrix_004.suite.yaml

7. `edge_mixed_five_item_multi_select_outdent_indent_history`：在已完成的新 A 下，跨待办三级 P/P2、有序三级 O/O2、无序三级 U **连续选取五项**；一次 Shift+Tab 应五项均只退一级，后方同名 A/Q 和其他列表不变；Undo/Redo 严格还原全文后，对相同范围 Tab 恢复三级；取消 P 的完成态只能取消第一个父 A，取消后方同名 A 才能取消 Q；Undo 后后方分支恢复，前方仍未完成。全过程保持 O/O2 和 N 编号连续。

## 结果与待覆盖风险

四套件 **7/7 通过**，第二轮独立重放仍 **7/7 通过**；合计 7 条新用例、977 步（含每条完整建文档路径）、135 次整篇显式检查，实际执行 14 次用例，14 次通过。逐日志统计见 `tests/at/artifacts/visual-edge-matrix/results.json`。目前本轮**新发现的已确认产品 Bug：0**；用例编号预期错误：1（已修订，不计为产品 Bug）；产品代码修复：0。
本轮检验了同名碰撞、树边界变化、待办/有序/无序多选转换和多步 Undo/Redo；并不等于“所有可能路径”已经穷尽。尚需单独设计的风险包括跨文档切换后再次编辑、持久化关闭重启、剪贴板跨文档粘贴及大规模长文档性能。

说明：当前未支持以鼠标拖动列表项来重排，不把它列为待补 AT 场景；文字选择拖动也不能冒充列表项重排。
