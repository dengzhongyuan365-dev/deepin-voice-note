> 更新：2026-11-05 用户已授权修复两个问题，详见 `TASK_SPLIT_FIX_REPORT.md`。
> 下文为发现阶段的历史记录；当时“新父项未完成”仅用于隔离问题，现已改为应完成。

# 真实用户操作链：发现问题记录（2026-11-05）

## 本轮结论

- 新增 2 个 YAML、3 条长操作链：2 条通过，1 条失败。
- 失败链单独重跑仍失败，2/2 命中同一检查点；不是两个不同 Bug。
- 新增稳定候选问题 1 个；用户确认 0 个；本轮修复产品问题 0 个。
- 本轮只改测试和文档。三份列表产品源码的执行前后 SHA256 一致。
- 原有 57 条通过是上一轮基线结果，不代表新增操作路径通过。

## 输入和判定方式

内容从空白编辑器实际输入：一种先打开待办再逐项 Enter，另一种先逐段输入普通文本后全选转有序。
不使用 setContent、editor.commands、设置选区或 DOM .click() 准备/执行业务操作。
键盘通过现有 AT 输入；鼠标通过 WebEngine CDP 鼠标移动/按下/抬起。
只读定位器读取目标段落/复选框的位置路径，不修改编辑器文档或焦点。

每个检查点按整篇实际显示顺序核对所有行的文字、列表类型、实际渲染层级、勾选和编号。
同名行按文档顺序区分，不再用文字作为唯一键。数字层级不因缺失中间层而重新聚类。
对照预期来自场景表，不调用产品父子关系/勾选计算函数。第二条链另外检查反向 DOM/PM 选区及颜色保持。
失败时保存页面截图、当前完整文档 JSON、DOM/PM 选区以及前序检查点。

## 场景一：两条只有文字不同的对照链

文件：`case_list_user_evolution_discovery_001.suite.yaml`

|阶段|真实操作|检查重点|
|---|---|---|
|创建|输入 ROOT，开启待办，逐次 Enter 输入其余 13 行|14 行均为一级、未勾选，顺序完整|
|建层级|逐项 Tab 创建二三级；另一个一级分支也建立二三级|两分支均存在，未操作行不受影响|
|混排|O 转有序、U 转无序、N 转有序|类型只影响目标项；独立有序段均从 1 开始|
|往返|P 从三级 Shift+Tab 到二级，再 Tab 回三级|其他项层级、文字、类型与勾选均不变|
|增加子项|P 行末 Enter 输入 P2；O 行末 Enter 输入 O2|实际增加到 16 行；新项位于三级；O/O2 为 1/2|
|勾选|点击 XS/XA、再点击后面的 A 复选框|P/P2/Q 被正确联动；V/T 等未选中项不受影响|
|拆分|在 XS/XA 的 X 与后字之间按 Enter|增加到 17 行，新任务未勾选；已有 P/P2 不得被取消|
|历史|Undo，再 Redo|整篇前后内容、层级、类型、编号和勾选恢复一致|

建层级时的目标：

```text
ROOT       待办一级
  XS/XA    待办二级
    P      待办三级
    O      有序三级（由待办转换）
    U      无序三级（由待办转换）
  A        待办二级
    Q      待办三级
  V        待办二级
    T      待办三级
TAIL       待办一级
  W        待办二级
    Y      待办三级
  N        有序二级（由待办转换）
END        待办一级
```

### AT-CANDIDATE-007：回车拆出的同名任务触发错误级联

完整操作链在拆分前形成：

```text
[ ] ROOT
  [x] XA
    [x] P
    [x] P2
    1. O
    2. O2
    · U
  [x] A
    [x] Q
  [ ] V
    [ ] T
[ ] TAIL
  [ ] W
    [ ] Y
  1. N
[ ] END
```

把光标放在 `X|A`，按 Enter：

|行|预期|实际|
|---|---|---|
|X|仍勾选、二级|符合|
|刚拆出的 A|未勾选、二级|符合|
|P/P2|保持勾选、三级|**被取消勾选**|
|原先的 A/Q|保持勾选和层级|符合|
|O/O2|仍为 1/2|符合|
|其余所有行|内容/顺序/层级/状态不变|符合|

唯一文字对照：仅把 XA 改为 XS，重复相同全过程，在 `X|S` 回车时 P/P2 保持勾选。
此对照 14 个整篇检查点全部通过。重复文字路径前 11 个检查点通过，第 12 个失败；
其后的 Undo/Redo 没有执行，不计作已验证。

只读代码分析：`task-list-cascade.js` 的 `taskItemIdentityMap` 使用文字加出现次数识别任务。
旧文档的第一个 A 是下方已勾选的 A；新文档的第一个 A 是刚拆出的未勾选 A。
`checkedChangedTaskItems` 把两者配对，误认为用户取消了原任务，随后
`cascadeManualParentChanges` 把新 A 下的 P/P2 清空。新任务跳过归一化的保护同样依赖此键。
此分析与唯一文字对照、两次相同失败及截图相符。待用户确认，尚未修复。

证据（相对仓库根目录）：

- `tests/at/artifacts/list-user-evolution/second-run.log`：唯一名称通过、重复名称失败。
- `tests/at/artifacts/list-user-evolution/duplicate-repeat.log`：重复名称单独复跑失败。
- `tests/at/artifacts/list-user-evolution/20261105-122929-250817.png`：首次业务失败页面。
- `tests/at/artifacts/list-user-evolution/20261105-123223-327882.png`：复跑失败页面。
- 同名 `-state.json`：完整文档、选区及各检查点状态。
- `product-before.sha256`、`binary.sha256`：产品源码和运行二进制校验值。

## 场景二：反向混合选区和多步历史

文件：`case_list_user_evolution_discovery_002.suite.yaml`

1. 普通段落逐行创建 A–L，全选转换为有序列表，核对 1–12。
2. Tab 建立 `1/2/3/3/2/3/3/1/2/3/2/1` 的层级，并核对各层编号。
3. C/F 局部转待办，D/G 局部转无序，核对其他有序部分的连续性。
4. E 行末 Enter 创建 EC，再 Tab 到三级；C 行末 Enter 创建三级 C2，增至 14 行。
5. 从 G 行末反向选到 C2 行首，跨越待办/无序/有序以及二三级；分别核对真实 DOM 和 PM 选区。
6. 将选区统一转有序，核对所有行及编号；选择当前主题第四个字体色块。
7. 多选 Tab：二级项进入三级，已有三级保持三级；核对连续编号和颜色。
8. 多选 Shift+Tab：选中的各行都回到二级；核对外部一级分支和全部编号。
9. 选区统一转待办；连续 Undo 三次，再 Redo 三次，每步校验整篇状态及颜色。

本轮此链的 15 个整篇检查点全部通过；不能据此声称任意历史组合通过。

## 运行方式

只在 `dzy@10.8.15.53:~/Desktop/deepin-voice-note` 运行，环境变量见 README 的远端设置。
本次新 YAML 必须通过以下只读定位/证据驱动运行：

```bash
python3 -u tests/at/run_list_user_journey.py --suite case_list_user_evolution_discovery_001
python3 -u tests/at/run_list_user_journey.py --suite case_list_user_evolution_discovery_002
python3 -u tests/at/run_list_user_journey.py --suite case_list_user_evolution_discovery_001 --spec-ids journey_split_duplicate_task_text
```

初次运行曾因测试给 DOM 添加定位标记被编辑器重绘清除而中断，已换为只读 CSS 路径定位。
该次属于 AT 定位器故障，不计为产品 Bug，也没有调整业务断言来回避失败。

## 本轮没有覆盖的路径

剪切粘贴跨文档、保存重开、输入法组合输入、拖拽、字体大小引起换行后的跨行选区等尚未加入本轮。
本轮优先保留已经发现的失败用例，等待用户确认，不改产品代码或放宽断言以获得全绿。
