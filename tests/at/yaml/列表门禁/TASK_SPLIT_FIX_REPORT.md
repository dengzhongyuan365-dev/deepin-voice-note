# 待办回车同名误联动及新父项未完成：修复与回归

日期：2026-11-05。工作目录及 GUI 均在远程 `dzy@10.8.15.53:~/Desktop/deepin-voice-note`。
使用该目录 `build/src/deepin-voice-note`，不使用本机或其他安装包。

## 两个独立问题

1. AT-CANDIDATE-007（本轮用户授权修复）：`X|A` 回车新增 A，后方已有已完成 A 时，P/P2 被误取消。
2. 用户发现的问题：P/P2 仍完成时，新视觉父项 A 未完成。不是问题 1 的替代证据。

## 根因及修改

- 删除 task-list-cascade.js 中“文字＋出现次序”识别旧任务及猜测手动勾选的逻辑。
- TaskItemWithHeading 增加 `setTaskChecked` 明确命令，复选框 change 事件调用它并携带操作意图。
  复用上游 NodeView 的渲染、a11y、update 与只读行为，不复制上游整个 NodeView。
- 明确勾选操作才向下联动视觉子项；命令位置用事务映射跟随后续变更，已删除目标不联动邻项。
- 编辑后的父项完成态按当前视觉树从子到父计算，不再跳过新建父项。
- 不改变视觉父子边界、三级上限、列表序号计算和文档 schema，不增加持久化 ID。
- Undo/Redo 仍恢复历史快照，不将历史状态差异当成点击。

## 真实输入 AT 的红绿验证

新套件 `case_list_task_split_regression.suite.yaml`，两条用例各 140 个步骤、22 个整篇检查点。
从空文档真实输入 ROOT、XA、P、O、U、A/a、Q、V、T、TAIL、W、Y、N、END；
通过 Enter、Tab 建立三级多分支，O/U/N 局部转换为有序/无序；P 做 3→2→3；
P 行尾 Enter 插入 P2，O 行尾 Enter 插入 O2；点击 XA 和后方 A/a；
XA 行首 Right 后 Enter。没有 setContent/写 DOM/直接改 checked 构造该场景。

每个检查点核对全文文字、顺序、类型、渲染层级、有序编号与 checkbox 状态。
修复前：2/2 失败。小写组新 A=false、P/P2=true；大写组新 A=false、P/P2=false。
修复后：2/2 通过，两组新 A=true、P/P2=true，另一个 A/a 与 Q 不变，有序 O/O2 仍为 1/2。
继续执行而不是在修复点停止：

| 操作 | 预期 |
|---|---|
| Undo/Redo 拆分 | 整篇恢复拆分前/后，包括勾选、类型、编号、层级 |
| 点击新 A 取消 | 仅新 A、P/P2 取消，后方同名 A/a、Q 不变 |
| Undo/Redo 取消 | 完整恢复本次操作，不吞掉前一次操作 |
| 单独勾选 P | P=true，P2=false，新 A=false |
| 再勾选 P2 | P/P2、新 A 全部 true |
| 点击后方 A/a 取消 | 仅后方 A/a、Q 取消，前方新 A/P/P2 保持 true |
| Undo/Redo 后方分支 | 只恢复后方分支，其他列表与编号不变 |

证据目录：`tests/at/artifacts/task-split-fix/`。
`before-at.log` 与 before-*.png/json；`after-at.log` 与 *-split.png/json；
`after-build.sha256` 记录修复后程序和 Web 资源版本。

## 预期修订说明（不是按实际结果放宽断言）

调查阶段把“新 A 未完成”当作暂不处理的观测值。现在用户明确要求修复该问题，
因此旧 discovery_001、A/a 对照及 Enter 视觉同级用例统一改为：
**有直接视觉子待办且全部完成，新父项必须完成，即使文字为空。**
没有子项的新空待办仍未完成，有未完成子项的父项仍未完成。
旧 ultimate_shift_chain 同样有新 R=false 的过时预期：改为 R=true，并增加取消 R/B、再勾选 R/B 的检查，原后续缩进链不删减。
ultimate_combination 中新 T 同样应随 B 完成；点击后 T/B 取消，Undo 恢复完成、Redo 恢复取消。
去掉原来 assertTaskConsistency 对 T 的豁免，全树都必须一致。
单测里原来用通用 updateAttributes 模拟用户点击的 5 处，改用明确勾选命令，
原有子项联动预期不变；真实 AT 仍点击复选框，不调用该命令。

## 单元回归（辅助，不代替 AT）

688/688 通过，新增 21 条：重复大小写/中文/空文字/emoji 与全完成/部分完成/未完成组合；
Enter 拆分、Undo/Redo、序列化重载；真正 checkbox change；只读；
直接属性修改不伪装点击；目标位置映射及目标删除；已完成叶项 Enter 新建未完成叶项。
旧 667 条中修正上述 5 处模拟入口及 1 处与用户确认语义冲突的空父项预期。

## 扩展 GUI 回归

最终共 **17 套件 / 64 条 AT 通过 / 0 失败 / 0 跳过**（含新回归 2 条，未重复计数）。
逐日志汇总见 `final-results.json` / `final-results.txt`。
初轮旧预期失败日志保留，最终结果采用修订语义后实际复跑的日志，不删除历史失败证据。
三种列表复杂缩进矩阵 10 条、选区语义 13 条、已关闭 Bug 10 条、PMS 待办回归 3 条、
视觉错位/游离项/混合转换/历史恢复及完整输入路径均已实际执行。
全程代码版本保持同一修复版本，程序、Web 资源、源码校验通过。
旧套件有部分使用固定 JSON 初始化，不能将这些称为全部从空文档真实输入；
本次两条新回归和 user_evolution 系列从真实输入开始。

## 交付

修改位于远程工作目录，未提交。产品源码涉及：
- `web-editor/src/extensions/task-checkbox-intent.js`（新增意图键）
- `web-editor/src/extensions/list-item-with-heading.js`（明确命令及复选框入口）
- `web-editor/src/runtime/task-list-cascade.js`（取消文字身份推断，归一化包括新父项）
- `web-editor/src/runtime/list-behavior.js`（归一化调用移除旧文档参数）

本机桌面 `待办回车问题-修复回归/` 保存报告、前后对比截图及完整日志证据。
没有将远程源代码覆盖到本机工作区，也没有操作本机 GUI。
本轮通过表明上述已执行路径通过，不表示穷尽所有未来操作组合。
