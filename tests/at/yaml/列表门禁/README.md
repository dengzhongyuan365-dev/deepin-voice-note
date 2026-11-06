# 富文本列表真实操作 AT 门禁

## 2026-11-05：待办同名拆分与新父项完成态

新增 `case_list_task_split_regression.suite.yaml`：两条各 140 步的真实输入路径，
大写/小写对照、三级混合列表、拆分后父子完成态、分支隔离及 Undo/Redo。
修复前 2/2 失败、修复后 2/2 通过；详情和预期调整依据见 `TASK_SPLIT_FIX_REPORT.md`。


## 视觉待办错位的红绿门禁

`case_list_ultimate_shift_chain_001.suite.yaml` 从 A(视觉二级)、B(三级)、
C(二级)、大/X(三级)、D(二级) 和后续一级任务开始。用真实 Enter 插入 R(二级)、
点击勾选框、Shift+Tab/Tab、Undo/Redo，逐步核对文档顺序、实际渲染层级、
有序编号、待办状态和全树直接视觉子任务一致性。之后再次勾选/取消分支、
再次 Shift+Tab，并验证 R/C/D 不被 A 的派生取消误级联。

- 修复前同一场景在 A Shift+Tab 后失败：A 仍已勾选，而视觉子项 C 未勾选。
- 增补真实勾选 R 的步骤后，测试还抓到 A 的派生取消误清空 R/B/D。
- 标记缩进归一化事务以避免将派生勾选当成人工勾选；全量单测还抓到
  孙项完成后父项没有完成，原因是读取了旧视觉树中的子项 checked。
- 修复后用相同 AT 和增强的后续步骤检查，不能只看 A 一个勾选断言。

`case_list_ultimate_combination_001.suite.yaml` 另外覆盖 18 项视觉/结构错位混合树。
每次测试应先重新构建 web-editor 与远端 C++ 应用，逐套启动，避免共享 GUI 状态。

## 执行环境

图形 AT 只在远端 dzy@10.8.15.53 的 DDE 会话执行，使用远端自行编译版本：

```text
/home/dzy/Desktop/deepin-voice-note/build/src/deepin-voice-note
```

该构建使用调试端口：

```text
7777
```

运行方式：

```bash
cd ~/Desktop/deepin-voice-note
export DISPLAY=:0 XAUTHORITY=/home/dzy/.Xauthority
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus XDG_RUNTIME_DIR=/run/user/1000 XDG_CURRENT_DESKTOP=DDE
export HOME=/tmp/dvn-at-home PYTHONPATH=/tmp/youqu-pkg/youqu:/tmp/youqu-deps
export GTK_MODULES=gail:atk-bridge QT_ACCESSIBILITY=1 DVN_AT_SESSIOND=1
DVN_AT_APP_BIN=/home/dzy/Desktop/deepin-voice-note/build/src/deepin-voice-note \
QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 \
python3 - <<'PY'
from src.at.executor.runner import run_tests
raise SystemExit(run_tests(
    test_dir='tests/at/yaml/列表门禁',
    suite='case_list_tab_selection_semantics_gate_001',
    skip_env_check=True,
))
PY
```

## 套件

`case_list_tab_selection_semantics_gate_001.suite.yaml`

只覆盖本次确认的 Tab 选区语义：

1. 无序列表整体选区按 Tab；
2. 无序列表项内部分文字选区按 Tab；
3. 普通文字选区按 Tab；
4. 普通段落与无序列表混合选区按 Tab；
5. 一级无序 A/B/C 多选按 Tab；
6. 一级无序首项单独按 Tab；
7. 局部有序列表转无序后 B/C/D 多选按 Tab；
8. 待办列表整体选区按 Tab；
9. 待办列表项内部分文字选区按 Tab；
10. 普通段落与待办列表混合选区按 Tab；
11. 一级待办 A/B/C 多选按 Tab；
12. 一级待办首项单独按 Tab；
13. 局部有序列表转待办后 B/C/D 多选按 Tab。

## Tab / Shift+Tab 复杂矩阵套件

`case_list_tab_shift_tab_matrix_001.suite.yaml`

覆盖 12 项目标文档、Enter/Tab 创建二三级、局部转换、多选 Tab/Shift+Tab、
有序编号、待办勾选联动、混合列表、Undo/Redo，以及无父项的视觉游离项：

1. 无序 P1：Enter/Tab 创建二三级子项并做 H-K 多选往返；
2. 无序 P2/P3：普通段落转列表、中间插入与宽范围多选；
3. 有序 P1：三级子项创建、连续编号与 H-K 多选往返；
4. 有序 P2/P3：统一转换、中间插入与多选编号连续性；
5. 待办 P1：12 项多选 Tab/Shift+Tab 与勾选状态保持；
6. 待办 P1：三级子项创建、勾选联动与 H-K 多选往返；
7. 混合类型：局部转换后的多选 Tab/Shift+Tab；
8. 多分支混合：宽范围 Tab/Shift+Tab 与 Undo/Redo；
9. 有序游离项：A 先成为视觉三级，B-D 仅各升一级；A-D 多选往返，
   校验视觉编号、三级封顶及 Undo/Redo；
10. 待办游离项：A 为视觉三级孤立项，B/C、E/F 为视觉父子对；
    勾选只按视觉父子关系级联，并覆盖 B-F 多选、状态保持及 Undo/Redo。

所有层级断言同时校验实际渲染位置和声明层级，避免把“文档里没有二级项”
误判成三级不存在。

## 游离项交叉套件

`case_list_orphan_cross_matrix_001.suite.yaml`

新增 4 条 12 项复杂场景：

1. 有序游离多分支：A 为三级孤立项，B-E 为两个二三级分支；
   B-G 多选 Tab/Shift+Tab，逐步校验编号、选区与 Undo/Redo；
2. 待办游离多分支：验证父项完成态、取消子项回推父项、
   手动取消父项级联子项，以及缩进往返后的勾选状态；
3. 游离层级局部转待办：B-G 从有序转待办，保持视觉层级，
   校验 B/C-D、E/F-G 的视觉父子联动和混合多选往返；
4. 待办跳级视觉父子：`A(1) -> B(3) -> C(2) -> D(3)` 中 B/C
   都是 A 的直接视觉子项，验证 A 的完成态不依赖勾选操作顺序。

`case_list_orphan_boundary_cross_001.suite.yaml`

新增 2 条跨级边界场景：

1. 有序三/二/一级混合选区：连续 Shift+Tab 让一级项退出列表，
   再对“普通段落 + 列表项”混合选区 Tab，校验编号重置和文本顺序；
2. 待办同样跨越列表边界，校验退出列表、勾选状态保留、混合 Tab
   以及 Undo/Redo。

## 游离项演化套件

`case_list_orphan_evolution_001.suite.yaml`

新增 3 条：

1. 有序游离空项：A 先到三级，Enter 创建空项后再用 Enter 逐级降到一级，
   继续输入 X/Y，校验编号、跨列表边界和 Undo；
2. 待办游离空项：同样的 Enter 逐级下降，校验勾选状态和退出列表后的恢复；
3. 待办跳级父项：`A(1)->B(3)->C(2)->D(3)` 的完成态及勾选 Undo/Redo。

当前结果：

- 有序空项：passed；
- 待办空项：passed；
- 跳级父项 Undo/Redo：passed，问题记录为 `AT-FOUND-005`。

## PMS 待办历史 Bug 回归

`case_list_pms_task_regression_001.suite.yaml`

按 PMS 原始 Bug 描述复现：

1. `BUG-382177`：二级待办移动到三级后，勾选新三级不能联动原有三级；
2. `BUG-382181`：一级下存在无二级父项的游离三级，同时还有其他二级项；
   勾完所有二级项时，一级不能提前勾选；
3. `BUG-382189`：一级已勾选后，在二级行尾 Enter 新增未勾选二级项，
   一级必须立即取消勾选。

当前结果：

```text
3 passed, 0 failed
```

## PMS 已关闭列表 Bug 回归

`case_list_closed_pms_regression_001.suite.yaml`

覆盖模块 133755 中筛选出的 10 个已关闭列表 Bug：

1. 381039：首行一级列表 Tab 降为二级；
2. 381009：三级行尾 Enter 创建空行后，再 Enter 降为二级；
3. 379801：二级 Shift+Tab 后再 Tab，其他二级项不能变三级；
4. 379767：三级往返缩进不能出现四级；
5. 379771：三级无序项连续 Backspace 逐级退出为普通文本；
6. 379765：一级有序项 Shift+Tab 退出为普通文本；
7. 379759：二级有序项行首 Backspace 回到一级且文字不重叠；
8. 379715：多行文本反复切换有序/无序/待办，选区保持；
9. 379707：列表转换后点击选中区域可取消高亮；
10. 379679：多行文本转有序列表后序号显示在对应列表行。

当前结果：

```text
10 passed, 0 failed
```

## 列表跨路径压力套件

`case_list_cross_path_stress_001.suite.yaml`

新增 3 条 12 项交叉路径：

1. 待办父子整体转有序、再转回待办，检查勾选状态和 Undo/Redo；
2. 三级有序分支局部转待办，再转回有序，检查编号、层级和选区；
3. 三种列表混排下局部统一转有序，检查类型边界、选区和历史恢复。

当前结果：

```text
3 passed, 0 failed
```

其中 `stress_task_parent_child_conversion_history` 曾发现
“转回待办后父项仍勾选、子项全未勾选”，修复后通过，见 `AT-FOUND-006`。

## 列表跨路径压力套件二

`case_list_cross_path_stress_002.suite.yaml`

新增 3 条：

1. 双待办分支只转换其中一个分支，验证父项完成态和 Undo/Redo；
2. 待办父子转换后新增未勾选子项，验证父项重算和历史恢复；
3. 三种列表混排跨类型 Tab/Shift+Tab，再统一转有序并恢复历史。

结果：

```text
3 passed, 0 failed
```

## 待办多级混合列表压力套件

`case_list_task_mixed_hierarchy_001.suite.yaml`

构造 13 项连续多级待办，内部混排有序列表和无序列表，覆盖一级到三级：

1. 中间有序项 Shift+Tab 后重新分组编号，同时验证待办父项勾选；
2. 中间待办项 Shift+Tab 后父项完成态重算；
3. 已勾选父项下，将三级有序项局部转为待办，验证新任务未勾选和父项重算；
4. 将三级待办局部转回有序，验证编号分组、层级和勾选；
5. 中间项转换后的 Undo/Redo。

结果：

```text
2 passed, 0 failed
```

## 上一轮基线结果（13 套）

- Tab 选区语义：13 passed, 0 failed；
- 原有复杂矩阵：10 passed, 0 failed；
- 游离项交叉矩阵：4 passed, 0 failed；
- 游离项跨级边界：2 passed, 0 failed；
- 游离项演化：3 passed, 0 failed；
- PMS 激活 Bug 回归：3 passed, 0 failed；
- PMS 已关闭列表 Bug 回归：10 passed, 0 failed；
- 列表跨路径压力一：3 passed, 0 failed；
- 列表跨路径压力二：3 passed, 0 failed；
- 待办多级混合列表压力：2 passed, 0 failed；
- 视觉错位完整链：1 passed, 0 failed；
- 18 项混合视觉树：1 passed, 0 failed；
- Enter 视觉同级：2 passed, 0 failed；
- 合计 AT：57 passed, 0 failed；
- 前端单测：667 passed, 0 failed。

## 本轮发现型用例：非全绿

新增 `case_list_user_evolution_discovery_001/002.suite.yaml`，共 3 条真实用户长操作链。
结果：2 条通过，1 条失败；失败场景单独重跑仍失败。新增稳定候选问题 1 个，未修改产品源码。
重复任务文字情况下，二级 XA 行中 Enter 拆出 A 会错误取消三级 P/P2；唯一文字 XS 对照正常。
详细步骤、预期、实际、对照实验和截图见 `USER_EVOLUTION_DISCOVERY.md`。
新用例通过 `tests/at/run_list_user_journey.py` 执行，不要直接调用原始 runner 忽略按行鼠标定位。


### 2026-11-05 本轮最终回归结果

同一修复版本：17 套件、64 条 AT 通过，0 失败、0 跳过；单元回归 688/688。
新两条 AT 修复前失败、修复后通过。初轮旧预期调整与重跑依据见 `TASK_SPLIT_FIX_REPORT.md`；
机器可核验结果见 `tests/at/artifacts/task-split-fix/final-results.json`。

## 2026-11-05 待办视觉边界与同名交叉 AT

新增 `case_list_task_visual_edge_matrix_001/002/003/004.suite.yaml` 七条真实键鼠全篇逐行断言场景；覆盖同名三项、三级缩进往返、混合局部转换、已完成父项下新建子项与多步 Undo/Redo。步骤、预期与真实运行见 `TASK_VISUAL_EDGE_MATRIX.md`。本批只增加测试，产品源码未改。

## 2026-11-05 富文本与三级混合列表交叉 AT

新增六条独立真实键鼠长链（字体、字号、颜色、背景、局部格式 × 有序/无序/待办跨层、转换和联动），操作、预期与测试证据见 [`RICHTEXT_CROSS_MATRIX.md`](RICHTEXT_CROSS_MATRIX.md)。
