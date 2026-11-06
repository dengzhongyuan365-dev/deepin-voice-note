// SPDX-FileCopyrightText: 2026 UnionTech Software Technology Co., Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// 列表缩进 / 反缩进的组合矩阵回归。
//
// 单点用例挡不住"修东边冒西边"，这里把所有结构形态 × 所有选区 × 两个方向
// 全量枚举，统一校验不变量：
//   1. 文本顺序不变、不丢项
//   2. 未选中的项视觉层级不变
//   3. 选中项最多各降/升一级，且不能反向
//   4. 选中的项不能有"该动却没动"的
//   5. 操作后选区不能消失
import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import { Editor } from '@tiptap/core'

import { closeHistory } from '@tiptap/pm/history'
import { createTiptapExtensions } from '../src/runtime/tiptap-extensions.js'
import { liftActiveListItem, sinkActiveListItem, switchSelectedListType } from '../src/runtime/list-behavior.js'
import { orderedListMarkerNumbers } from '../src/runtime/normal-list-markers.js'

function defineGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true })
}

function setupDom() {
  const window = new Window()
  defineGlobal('window', window)
  defineGlobal('document', window.document)
  defineGlobal('navigator', window.navigator)
  defineGlobal('Node', window.Node)
  defineGlobal('Element', window.Element)
  defineGlobal('HTMLElement', window.HTMLElement)
  defineGlobal('DocumentFragment', window.DocumentFragment)
  defineGlobal('Event', window.Event)
  defineGlobal('KeyboardEvent', window.KeyboardEvent)
  defineGlobal('CustomEvent', window.CustomEvent)
  defineGlobal('MutationObserver', window.MutationObserver)
  defineGlobal('getComputedStyle', window.getComputedStyle.bind(window))
  defineGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 0))
  defineGlobal('cancelAnimationFrame', (id) => clearTimeout(id))
  return window
}

function paragraph(text) {
  return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }
}
function listItem(text, extra = [], indentLevel = 0) {
  return { type: 'listItem', attrs: { dvnIndentLevel: indentLevel }, content: [paragraph(text), ...extra] }
}
function taskItem(text, extra = [], indentLevel = 0) {
  return { type: 'taskItem', attrs: { checked: false, dvnIndentLevel: indentLevel }, content: [paragraph(text), ...extra] }
}
function list(type, items) {
  return type === 'orderedList' ? { type, attrs: { start: 1 }, content: items } : { type, content: items }
}

function createEditor(window, content) {
  const element = window.document.createElement('div')
  window.document.body.appendChild(element)
  return new Editor({ element, extensions: createTiptapExtensions(), content })
}

// 文档顺序枚举所有"块"：列表项（含视觉层级）与被反缩进踢出列表的普通段落。
//
// 关键：一级项反缩进会**退出列表变成普通段落**，如果只数 listItem，就会把
// "A 掉出列表"误判成"文本顺序变了、A 丢了"，产生假阳性。这里统一按顶层块
// 顺序枚举，段落记为 visualDepth 0，并按 (文本, 第几次出现) 做身份匹配。
function enumerateBlocks(node, structuralDepth = 0, acc = []) {
  if (!node || typeof node !== 'object') return acc
  const kind = node.type
  if (kind === 'listItem' || kind === 'taskItem') {
    const own = node.content?.find((child) => child.type === 'paragraph')
    acc.push({
      blockKind: 'item',
      text: own?.content?.[0]?.text ?? '',
      visualDepth: Math.min(3, structuralDepth + 1 + (Number(node.attrs?.dvnIndentLevel) || 0)),
    })
    if (Array.isArray(node.content)) {
      node.content.forEach((child) => {
        if (child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList') {
          enumerateBlocks(child, structuralDepth + 1, acc)
        }
      })
    }
    return acc
  }
  if (kind === 'paragraph') {
    acc.push({
      blockKind: 'paragraph',
      text: node.content?.[0]?.text ?? '',
      visualDepth: 0,
    })
    return acc
  }
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => enumerateBlocks(child, structuralDepth, acc))
  }
  return acc
}

// 与上面同口径，但直接走 ProseMirror 节点，顺便带出"块自身文本"的位置区间，
// 用于校验变换后选区端点是否仍然完整覆盖这批块（只查"非空"会漏掉端点缩水）。
function enumerateDocBlocks(doc) {
  const acc = []
  const walk = (node, pos, structuralDepth, insideItem) => {
    const isItem = node.type.name === 'listItem' || node.type.name === 'taskItem'
    if (isItem) {
      const textblockPos = pos + 1
      const textblock = doc.nodeAt(textblockPos)
      const textStart = textblockPos + 1
      acc.push({
        blockKind: 'item',
        text: textblock ? textblock.textContent : '',
        visualDepth: Math.min(3, structuralDepth + 1 + (Number(node.attrs?.dvnIndentLevel) || 0)),
        textStart,
        textEnd: textStart + (textblock ? textblock.content.size : 0),
      })
    } else if (!insideItem && node.isTextblock) {
      acc.push({
        blockKind: 'paragraph',
        text: node.textContent,
        visualDepth: 0,
        textStart: pos + 1,
        textEnd: pos + 1 + node.content.size,
      })
    }
    let offset = pos + 1
    for (let index = 0; index < node.childCount; index += 1) {
      const child = node.child(index)
      walk(child, offset, isItem ? structuralDepth + 1 : structuralDepth, insideItem || isItem)
      offset += child.nodeSize
    }
  }
  walk(doc, -1, 0, false)
  return acc
}

// 用 (文本, 出现序号) 给块编号，重复文本也能对上号。
function blockKeys(blocks) {
  const seen = new Map()
  return blocks.map((block) => {
    const nth = seen.get(block.text) ?? 0
    seen.set(block.text, nth + 1)
    return `${block.text}#${nth}`
  })
}

function textStartPos(editor, index) {
  let seen = -1
  let found = null
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.isTextblock) {
      seen += 1
      if (seen === index) { found = pos + 1; return false }
    }
    return true
  })
  if (found === null) throw new Error(`textblock ${index} not found`)
  return found
}

function textEndPos(editor, index) {
  let seen = -1
  let found = null
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.isTextblock) {
      seen += 1
      if (seen === index) { found = pos + node.nodeSize - 1; return false }
    }
    return true
  })
  if (found === null) throw new Error(`textblock ${index} not found`)
  return found
}

// ---- 结构形态库 -----------------------------------------------------------
// 结构形态库按"列表类型"参数化：同一个结构要在 无序 / 有序 / 待办 三种顶层列表
// 各跑一遍，再叠三种列表互相嵌套的交叉结构。只跑无序会漏掉整整两类列表。
//
// mkItem 造列表项（listItem / taskItem），mkList 造同级子列表。
function buildStructures(mkItem, mkList) {
  return {
    'flat-4': [mkItem('A'), mkItem('B'), mkItem('C'), mkItem('D')],
    'nested-1': [mkItem('A', [mkList([mkItem('B'), mkItem('C'), mkItem('D')])]), mkItem('E')],
    'nested-2': [mkItem('A', [mkList([mkItem('B', [mkList([mkItem('C'), mkItem('D')])])])]), mkItem('E')],
    'visual-12': [mkItem('A'), mkItem('B', [], 1), mkItem('C', [], 2), mkItem('D', [], 1), mkItem('E')],
    'visual-sibling': [mkItem('A'), mkItem('B', [], 1), mkItem('C', [], 1), mkItem('D', [], 1), mkItem('E')],
    'mixed-struct+visual': [
      mkItem('A', [mkList([mkItem('B')])]),
      mkItem('C', [], 1),
      mkItem('D', [], 1),
      mkItem('E'),
    ],
    'mixed-visual+struct': [
      mkItem('A', [mkList([mkItem('B'), mkItem('C')])]),
      mkItem('D', [], 1),
      mkItem('E'),
    ],
    'nested-then-visual': [
      mkItem('A', [mkList([mkItem('B'), mkItem('C')])]),
      mkItem('D', [], 1),
      mkItem('E', [], 1),
      mkItem('F'),
    ],
    'visual-3level': [mkItem('A'), mkItem('B', [], 1), mkItem('C', [], 2), mkItem('D', [], 2), mkItem('E', [], 1)],
    'flat-with-empty': [mkItem('A'), mkItem(''), mkItem(''), mkItem('D')],
    'nested-with-empty': [mkItem('A', [mkList([mkItem('B'), mkItem(''), mkItem('D')])]), mkItem('E')],
    'visual-with-empty': [mkItem('A'), mkItem('', [], 1), mkItem('', [], 1), mkItem('E')],
    'mixed-task': [
      mkItem('A', [list('taskList', [taskItem('B'), taskItem('C')])]),
      mkItem('D'),
    ],
  }
}

// 三种顶层列表类型（列表项工厂 + 子列表类型）。
const LIST_TYPES = [
  { label: '无序', listType: 'bulletList', mkItem: listItem },
  { label: '有序', listType: 'orderedList', mkItem: listItem },
  { label: '待办', listType: 'taskList', mkItem: taskItem },
]

// 交叉嵌套：三种列表互相包含（外层 / 中层 / 内层各不同）。
const CROSS_STRUCTURES = {
  'cross-ul-ol-task': [list('bulletList', [
    listItem('A', [list('orderedList', [
      listItem('B', [list('taskList', [taskItem('C'), taskItem('D')])]),
    ])]),
    listItem('E'),
  ])],
  'cross-task-ol-ul': [list('taskList', [
    taskItem('A', [list('orderedList', [
      listItem('B', [list('bulletList', [listItem('C'), listItem('D')])]),
    ])]),
    taskItem('E'),
  ])],
  'cross-ol-task-ul-visual': [list('orderedList', [
    listItem('A', [list('taskList', [
      taskItem('B', [list('bulletList', [listItem('C')])]),
      taskItem('D', [], 1),
    ])]),
    listItem('E', [], 1),
    listItem('F'),
  ])],
}

// 单类型结构 × 3 种列表类型。
const STRUCTURES = {}
const STRUCTURE_TYPES = []
for (const { label, listType, mkItem } of LIST_TYPES) {
  const built = buildStructures(mkItem, (items) => list(listType, items))
  for (const [name, content] of Object.entries(built)) {
    const key = `${label}/${name}`
    STRUCTURES[key] = { content, listType }
    STRUCTURE_TYPES.push(key)
  }
}
// 交叉嵌套结构（外层类型随结构自带）。
for (const [name, content] of Object.entries(CROSS_STRUCTURES)) {
  STRUCTURES[`交叉/${name}`] = { content, listType: null }
  STRUCTURE_TYPES.push(`交叉/${name}`)
}

function topLevelList(listType, content) {
  // listType 为 null（交叉结构）时 content 已经是完整列表节点。
  return listType ? list(listType, content) : content[0]
}

function analyze(before, after, selectedIndexes, direction) {
  const problems = []
  const beforeKeys = blockKeys(before)
  const afterKeys = blockKeys(after)
  if (beforeKeys.join('|') !== afterKeys.join('|')) {
    problems.push(`文本顺序/内容变化: ${before.map((b) => b.text).join(',')} -> ${after.map((a) => a.text).join(',')}`)
    return problems
  }

  for (let i = 0; i < before.length; i += 1) {
    const isSelected = selectedIndexes.has(i)
    const delta = after[i].visualDepth - before[i].visualDepth
    if (!isSelected && delta !== 0) {
      problems.push(`未选中项 ${before[i].text} 视觉层级被改: ${before[i].visualDepth} -> ${after[i].visualDepth}`)
    }
    if (direction === 'out' && delta > 0) {
      problems.push(`反缩进时 ${before[i].text} 反向变深: ${before[i].visualDepth} -> ${after[i].visualDepth}`)
    }
    if (direction === 'in' && delta < 0) {
      problems.push(`缩进时 ${before[i].text} 反向变浅: ${before[i].visualDepth} -> ${after[i].visualDepth}`)
    }
    if (Math.abs(delta) > 1) {
      problems.push(`${before[i].text} 一次变化超过一级: ${before[i].visualDepth} -> ${after[i].visualDepth}`)
    }
    // 反缩进时选中的项必须"各降一级"：命中这条的就是"选中了却没动"
    // （跨类型嵌套的祖先/子孙同时被选中时最容易踩：子孙的视觉层级被保持逻辑写回）。
    if (direction === 'out' && isSelected && delta !== -1) {
      problems.push(`选中项 ${before[i].text} 未按"各降一级"处理: ${before[i].visualDepth} -> ${after[i].visualDepth}`)
    }
  }
  return problems
}

const FAILURES = []

for (const [name, spec] of Object.entries(STRUCTURES)) {
  const { content, listType } = spec
  const window = setupDom()
  const probe = createEditor(window, { type: 'doc', content: [topLevelList(listType, content)] })
  const total = enumerateBlocks(probe.getJSON()).length
  probe.destroy()

  for (const direction of ['out', 'in']) {
    // 选区：[i, j] 覆盖文档顺序的第 i..j 个列表项
    const ranges = []
    for (let i = 0; i < total; i += 1) {
      for (let j = i; j < total; j += 1) ranges.push([i, j])
    }
    for (const [i, j] of ranges) {
      const editor = createEditor(window, { type: 'doc', content: [topLevelList(listType, content)] })
      const before = enumerateDocBlocks(editor.state.doc)
      const beforeKeys = blockKeys(before)
      // 跳过最外层同名容器带来的索引歧义：用 textblock 索引即列表项本身
      editor.chain().focus().setTextSelection({ from: textStartPos(editor, i), to: textEndPos(editor, j) }).run()
      // 空项的“块自身文本”是零宽的，选它本身就等于折叠光标（光标场景），
      // 这类组合不能按“范围选区”校验端点。
      const selectionWasEmpty = editor.state.selection.empty
      const selected = new Set()
      for (let k = i; k <= j; k += 1) selected.add(k)

      const handled = direction === 'out' ? liftActiveListItem(editor) : sinkActiveListItem(editor)
      const after = enumerateDocBlocks(editor.state.doc)
      const problems = analyze(before, after, selected, direction)
      if (handled && selectionWasEmpty) {
        // 光标场景：操作后必须仍然是光标，不能被扩成范围
        if (!editor.state.selection.empty) {
          problems.push('光标场景被扩成范围选区')
        }
      }
      if (handled && !selectionWasEmpty) {
        const { from, to, empty } = editor.state.selection
        // 变换后选区不应消失（否则无法连续按 Shift+Tab / Tab）
        if (empty) {
          problems.push('变换后选区消失')
        } else {
          const afterKeys = blockKeys(after)
          const firstEntry = after[afterKeys.indexOf(beforeKeys[i])]
          const lastEntry = after[afterKeys.indexOf(beforeKeys[j])]
          // 只查"非空"会漏掉端点缩水（用户现象：第一项整段高亮，后面几项只剩一条细缝）
          if (firstEntry && from > firstEntry.textStart) {
            problems.push(`选区起点晚于首个选中项文本起点: ${from} > ${firstEntry.textStart}`)
          }
          if (lastEntry && to < lastEntry.textEnd) {
            problems.push(`选区终点早于最后一个选中项文本终点: ${to} < ${lastEntry.textEnd}`)
          }
          // 选区必须恰好盖住这批项自身的文本，不能缩水也不能连带选中没选的项。
          const covered = new Set()
          after.forEach((entry, index) => {
            if (from <= entry.textEnd && to >= entry.textStart) covered.add(afterKeys[index])
          })
          const expected = new Set(beforeKeys.slice(i, j + 1))
          for (const key of expected) {
            if (!covered.has(key)) problems.push(`选区漏掉选中项 ${key}`)
          }
          for (const key of covered) {
            if (!expected.has(key)) problems.push(`选区多盖了未选中项 ${key}`)
          }
        }
      }
      if (problems.length) {
        FAILURES.push(`[${name}/${direction}/选中 ${i}..${j}] ${problems.join(' ; ')}`)
      }
      editor.destroy()
    }
  }
}

// ---- 方案 A 不变量 1：AllSelection（Ctrl+A）与拖选全文必须完全等价 -------------
//
// 回归背景：全选后 $from 落在文档首块，第一按 Shift+Tab 会把首块踢成普通段落，
// 之后 $from 就在段落里了。旧实现拿 isInListItem($from) 当入口门槛，第二按起
// 全部返回 false（用户现象：连按无反应、只有主动再点一次才动）。
function findTextRange(editor, text) {
  let range = null
  editor.state.doc.descendants((node, pos) => {
    if (range) return false
    if (node.isText && node.text === text) {
      range = { from: pos, to: pos + node.nodeSize }
      return false
    }
    return true
  })
  if (!range) throw new Error(`text not found: ${text}`)
  return range
}

function dispatchTab(editor, window, shift) {
  editor.isFocused = true
  const event = new window.KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  })
  editor.view.dom.dispatchEvent(event)
  return event
}

function imageNode(relPath = 'images/a.png') {
  return {
    type: 'image',
    attrs: {
      src: `file:///x/${relPath}`,
      relPath,
      alt: '',
      title: null,
    },
  }
}

function imageListItem(itemType, relPath, text = '', indentLevel = 0) {
  const attrs = itemType === 'taskItem'
    ? { checked: false, dvnIndentLevel: indentLevel }
    : { dvnIndentLevel: indentLevel }
  const content = [{ type: 'paragraph', content: [
    ...(text ? [{ type: 'text', text }] : []),
    imageNode(relPath),
  ] }]
  return { type: itemType, attrs, content }
}

function imageListDoc(listType, relPaths) {
  const itemType = listType === 'taskList' ? 'taskItem' : 'listItem'
  return {
    type: 'doc',
    content: [{
      type: listType,
      attrs: listType === 'orderedList' ? { start: 1 } : {},
      content: relPaths.map((relPath, index) => imageListItem(itemType, relPath, `item-${index + 1}`)),
    }],
  }
}

function imagePositions(editor, relPath) {
  const positions = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && node.attrs?.relPath === relPath) positions.push(pos)
    return true
  })
  return positions
}

function selectImage(editor, relPath, occurrence = 0) {
  const positions = imagePositions(editor, relPath)
  assert.ok(positions.length > occurrence, `没有找到第 ${occurrence + 1} 张图片 ${relPath}`)
  assert.equal(editor.commands.setNodeSelection(positions[occurrence]), true)
  assert.equal(editor.state.selection.node?.type.name, 'image')
}

function selectedImageOccurrence(editor, relPath) {
  let occurrence = 0
  let selected = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'image' || node.attrs?.relPath !== relPath) return true
    if (pos === editor.state.selection.from) selected = occurrence
    occurrence += 1
    return true
  })
  return selected
}

function selectedImageVisualDepth(editor) {
  const $pos = editor.state.doc.resolve(editor.state.selection.from)
  let structuralDepth = 0
  let item = null
  for (let depth = 1; depth <= $pos.depth; depth += 1) {
    const node = $pos.node(depth)
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      structuralDepth += 1
      item = node
    }
  }
  if (!item) return 0
  return structuralDepth + (Number(item.attrs?.dvnIndentLevel) || 0)
}

function hasListNodes(node) {
  if (!node || typeof node !== 'object') return false
  if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'taskList') return true
  return Array.isArray(node.content) && node.content.some(hasListNodes)
}

function selectionCoverage(editor) {
  return blockKeys(enumerateDocBlocks(editor.state.doc)).length === 0
    ? ''
    : editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n')
}

test('方案A：Ctrl+A 全选与拖选全文，Shift+Tab / Tab 结果必须完全一致', () => {
  const problems = []
  for (const [name, spec] of Object.entries(STRUCTURES)) {
    const { content, listType } = spec
    for (const direction of ['out', 'in']) {
      const window = setupDom()
      const results = []
      for (const mode of ['all', 'drag']) {
        const editor = createEditor(window, { type: 'doc', content: [topLevelList(listType, content)] })
        if (mode === 'all') {
          editor.chain().focus().selectAll().run()
        } else {
          editor.chain().focus().setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 }).run()
        }
        const event = dispatchTab(editor, window, direction === 'out')
        results.push({
          handled: event.defaultPrevented,
          json: JSON.stringify(editor.getJSON()),
          coverage: selectionCoverage(editor),
          empty: editor.state.selection.empty,
        })
        editor.destroy()
      }
      const [all, drag] = results
      if (all.handled !== drag.handled) {
        problems.push(`[${name}/${direction}] 处理结果不一致：Ctrl+A=${all.handled} 拖选=${drag.handled}`)
      }
      if (all.json !== drag.json) {
        problems.push(`[${name}/${direction}] 文档结果不一致`)
      }
      if (all.coverage !== drag.coverage || all.empty !== drag.empty) {
        problems.push(`[${name}/${direction}] 选区结果不一致`)
      }
    }
  }
  assert.equal(problems.length, 0, `Ctrl+A / 拖选全文等价性失败 ${problems.length} 例：\n${problems.join('\n')}`)
})

// ---- 方案 A 不变量 2：多级阶梯连按 Shift+Tab，必须逐级降到底 ------------------
//
// 每一按只允许各块降一级；文本顺序、块集合、选区覆盖集合都不能变；一直按到
// 没有任何列表项为止，文档里不能残留列表节点。
const LADDERS = {
  'ladder-3level-task': [list('taskList', [
    taskItem('T1A', [list('taskList', [
      taskItem('T2A', [list('taskList', [taskItem('T3A'), taskItem('T3B')])]),
    ])]),
    taskItem('T1B'),
  ])],
  'ladder-cross-ul-ol-task': [list('bulletList', [
    listItem('C1A', [list('orderedList', [
      listItem('C2A', [list('taskList', [taskItem('C3A'), taskItem('C3B')])]),
    ])]),
    listItem('C1B'),
  ])],
  'ladder-cross-task-ol-ul': [list('taskList', [
    taskItem('D1A', [list('orderedList', [
      listItem('D2A', [list('bulletList', [listItem('D3A'), listItem('D3B')])]),
    ])]),
    taskItem('D1B'),
  ])],
  'ladder-3level': [list('bulletList', [
    listItem('L1A', [list('bulletList', [
      listItem('L2A', [list('bulletList', [listItem('L3A'), listItem('L3B')])]),
    ])]),
    listItem('L1B'),
  ])],
  'ladder-3level-ordered': [list('orderedList', [
    listItem('O1A', [list('orderedList', [
      listItem('O2A', [list('orderedList', [listItem('O3A'), listItem('O3B')])]),
    ])]),
    listItem('O1B'),
  ])],
  'ladder-mixed-visual': [list('bulletList', [
    listItem('M1A', [list('bulletList', [listItem('M2A', [], 1), listItem('M2B')])]),
    listItem('M1B', [], 1),
    listItem('M1C'),
  ])],
  'ladder-user-report': [list('bulletList', [
    listItem('大萨达撒', [list('bulletList', [
      listItem('大萨达', [list('bulletList', [listItem('大萨达'), listItem('啊实打实')])]),
    ])]),
    listItem('阿萨德'),
  ])],
}

test('方案A：多级阶梯连按 Shift+Tab 必须逐级降到底、不丢项、不反向', () => {
  const problems = []
  for (const [name, content] of Object.entries(LADDERS)) {
    for (const mode of ['all', 'drag']) {
      const window = setupDom()
      const editor = createEditor(window, { type: 'doc', content })
      const baselineKeys = blockKeys(enumerateDocBlocks(editor.state.doc))
      let previous = enumerateDocBlocks(editor.state.doc)
      let presses = 0

      while (presses < 8) {
        if (mode === 'all') {
          editor.chain().focus().selectAll().run()
        } else {
          editor.chain().focus().setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 }).run()
        }
        const event = dispatchTab(editor, window, true)
        if (!event.defaultPrevented) break
        presses += 1

        const after = enumerateDocBlocks(editor.state.doc)
        const afterKeys = blockKeys(after)
        if (afterKeys.join('|') !== baselineKeys.join('|')) {
          problems.push(`[${name}/${mode}/第${presses}按] 文本顺序或块数量变化：${baselineKeys.join(',')} -> ${afterKeys.join(',')}`)
          break
        }
        for (let index = 0; index < after.length; index += 1) {
          const delta = after[index].visualDepth - previous[index].visualDepth
          if (delta > 0) {
            problems.push(`[${name}/${mode}/第${presses}按] ${after[index].text} 反向变深 ${previous[index].visualDepth} -> ${after[index].visualDepth}`)
          }
          if (delta < -1) {
            problems.push(`[${name}/${mode}/第${presses}按] ${after[index].text} 一次降超过一级 ${previous[index].visualDepth} -> ${after[index].visualDepth}`)
          }
          if (!afterKeys.includes(baselineKeys[index])) {
            problems.push(`[${name}/${mode}/第${presses}按] 块 ${baselineKeys[index]} 身份对不上`)
          }
        }
        const { empty, from, to } = editor.state.selection
        if (empty) problems.push(`[${name}/${mode}/第${presses}按] 选区消失`)
        const covered = new Set()
        after.forEach((entry, index) => {
          if (from <= entry.textEnd && to >= entry.textStart) covered.add(afterKeys[index])
        })
        for (const key of covered) {
          if (!baselineKeys.includes(key)) problems.push(`[${name}/${mode}/第${presses}按] 选区多盖未选中项 ${key}`)
        }
        // 拖选全文后连按：选区必须一直覆盖原来那批块，不能每按一次缩水一圈
        // （用户现象：紫色高亮越按越少，看着像选区丢了）。
        for (const key of baselineKeys) {
          if (!covered.has(key)) problems.push(`[${name}/${mode}/第${presses}按] 选区缩水，漏掉 ${key}`)
        }
        previous = after
      }

      const finalBlocks = enumerateDocBlocks(editor.state.doc)
      if (finalBlocks.some((block) => block.visualDepth > 0)) {
        problems.push(`[${name}/${mode}] 连按 ${presses} 次仍未全部退出列表：${finalBlocks.map((b) => `${b.text}@${b.visualDepth}`).join(' | ')}`)
      }
      if (hasListNodes(editor.getJSON())) {
        problems.push(`[${name}/${mode}] 全部退出后文档里仍残留列表节点`)
      }
      if (presses === 0) problems.push(`[${name}/${mode}] 第一按就没有被处理`)
      editor.destroy()
    }
  }
  assert.equal(problems.length, 0, `阶梯反缩进失败 ${problems.length} 例：\n${problems.join('\n')}`)
})

// ---- 视觉游离项：一级首项也可 Tab，二级/三级不要求存在结构父项 -----------
//
// 用户确认的模型：视觉层级允许游离项，唯一硬限制是最深三级。首项从一级
// Tab 到二级、再到三级，不能因为“没有前一个兄弟项”而拒绝；超过三级后再按
// Tab 保持三级，Shift+Tab 则逐级回收。
test('一级唯一项可成为游离二/三级，且三级封顶、可逐级反缩进', () => {
  const window = setupDom()
  const cases = [
    { name: '列表是文档第一块', content: [{ type: 'paragraph', content: [{ type: 'text', text: '唯一的图片行' }] }] },
    {
      name: '列表前面有一个普通段落',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '上面的正文' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '唯一的图片行' }] },
      ],
    },
    {
      name: '列表前面有多段内容',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '正文一' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '正文二' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '唯一的图片行' }] },
      ],
    },
  ]

  const problems = []
  for (const spec of cases) {
    for (const listType of ['bulletList', 'orderedList', 'taskList']) {
      const editor = createEditor(window, { type: 'doc', content: spec.content })
      const targetPos = findTextRange(editor, '唯一的图片行')
      editor.chain().focus().setTextSelection(targetPos).run()
      const command = `toggle${listType.charAt(0).toUpperCase()}${listType.slice(1)}`
      editor.chain().focus()[command]().run()
      editor.chain().focus().setTextSelection(findTextRange(editor, '唯一的图片行').from).run()

      const level = () => {
        const entry = enumerateDocBlocks(editor.state.doc)
          .find((block) => block.blockKind === 'item' && block.text === '唯一的图片行')
        return entry?.visualDepth
      }
      if (level() !== 1) problems.push(`[${spec.name}/${listType}] 转列表后应是视觉一级，实际 ${level()}`)
      for (const expected of [2, 3, 3]) {
        const event = dispatchTab(editor, window, false)
        if (!event.defaultPrevented) problems.push(`[${spec.name}/${listType}] Tab 未被处理`)
        if (level() !== expected) {
          problems.push(`[${spec.name}/${listType}] Tab 后应为视觉 ${expected}，实际 ${level()}`)
        }
      }
      for (const expected of [2, 1]) {
        const event = dispatchTab(editor, window, true)
        if (!event.defaultPrevented) problems.push(`[${spec.name}/${listType}] Shift+Tab 未被处理`)
        if (level() !== expected) {
          problems.push(`[${spec.name}/${listType}] Shift+Tab 后应为视觉 ${expected}，实际 ${level()}`)
        }
      }
      editor.destroy()
    }
  }
  assert.equal(problems.length, 0, `游离项缩进回归失败 ${problems.length} 例：\n${problems.join('\n')}`)
})

// 范围选区 Tab：ProseMirror sinkListItem 对同一列表的范围只处理首项，
// 用户选中 B/C/D 后按 Tab 时三项必须一起下沉一级，未选中的 A/E 不能动。
test('选中连续一级兄弟 B/C/D 后 Tab，三项一起缩进且选区保持', () => {
  const window = setupDom()
  const editor = createEditor(window, {
    type: 'doc',
    content: [list('bulletList', ['A', 'B', 'C', 'D', 'E'].map((text) => listItem(text)))],
  })
  const beforeJSON = editor.getJSON()
  const b = findTextRange(editor, 'B')
  const d = findTextRange(editor, 'D')
  editor.chain().focus().setTextSelection({ from: b.from, to: d.to }).run()

  const event = dispatchTab(editor, window)
  assert.equal(event.defaultPrevented, true, 'Tab 应由列表范围缩进处理')

  const after = enumerateDocBlocks(editor.state.doc)
  for (const text of ['B', 'C', 'D']) {
    const item = after.find((block) => block.blockKind === 'item' && block.text === text)
    assert.ok(item, `${text} 不应丢失`)
    assert.equal(item.visualDepth, 2, `${text} 应缩进到二级`)
  }
  for (const text of ['A', 'E']) {
    const item = after.find((block) => block.blockKind === 'item' && block.text === text)
    assert.equal(item.visualDepth, 1, `未选中的 ${text} 必须保持一级`)
  }
  assert.equal(editor.state.selection.empty, false, '缩进后 B/C/D 选区必须保持')

  assert.equal(liftActiveListItem(editor), true, 'Shift+Tab 应由列表范围反缩进处理')
  assert.deepEqual(editor.getJSON(), beforeJSON, '反缩进后应精确恢复初始结构')
  assert.equal(editor.state.selection.empty, false, '反缩进后选区仍应覆盖 B/C/D')
  editor.destroy()
})

// 反向保证：反缩进把子列表拆成新的顶层列表块后，靠 dvnIndentLevel 仍能 Tab 回到二级。
test('B04 反向：反缩进拆出来的游离子项仍可用 Tab 恢复到二级', () => {
  const window = setupDom()
  const editor = createEditor(window, {
    type: 'doc',
    content: [{
      type: 'orderedList',
      attrs: { start: 1 },
      content: [listItem('a', [list('orderedList', [listItem('b')])])],
    }],
  })

  editor.chain().focus().setTextSelection(findTextRange(editor, 'a')).run()
  dispatchTab(editor, window, true) // Shift+Tab：a 退出列表，b 成为新的顶层首项
  const afterLift = enumerateDocBlocks(editor.state.doc)
  const lifted = afterLift.find((block) => block.blockKind === 'item' && block.text === 'b')
  assert.ok(lifted, '反缩进后 b 应该还是列表项')
  assert.equal(lifted.visualDepth, 2, 'b 反缩进后视觉层级应保持二级')

  const bRange = findTextRange(editor, 'b')
  editor.chain().focus().setTextSelection(bRange).run()
  const handled = sinkActiveListItem(editor)
  const afterTab = enumerateDocBlocks(editor.state.doc)
  const reindented = afterTab.find((block) => block.blockKind === 'item' && block.text === 'b')
  assert.equal(handled, true, '游离子项 Tab 应被处理')
  assert.equal(reindented.visualDepth, 3, 'b 应能 Tab 回到三级')
  editor.destroy()
})


// 回归：父项本身带真实子列表时，Tab 只改变父项自己的视觉缩进。
//
// 典型用户路径：A / B(B1) / C 中把光标放到 B 按 Tab。旧实现走
// ProseMirror sinkListItem，把 B 连同 B1 整棵子树结构下沉；外层序号和 B1
// 的层级一起变化。产品语义要求 B1 的结构、属性和视觉深度全部不动。
function itemHasDirectChildList(node) {
  for (let index = 0; index < node.childCount; index += 1) {
    if (['bulletList', 'orderedList', 'taskList'].includes(node.child(index).type.name)) return true
  }
  return false
}

function listItemSnapshots(doc) {
  const snapshots = []
  const walk = (node, structuralDepth = 0) => {
    const isItem = node.type.name === 'listItem' || node.type.name === 'taskItem'
    if (isItem) {
      snapshots.push({
        text: node.firstChild?.textContent ?? '',
        itemType: node.type.name,
        structuralDepth,
        indentLevel: Number(node.attrs?.dvnIndentLevel) || 0,
        checked: node.attrs?.checked ?? null,
        hasChildList: itemHasDirectChildList(node),
      })
    }
    node.forEach((child) => walk(child, isItem ? structuralDepth + 1 : structuralDepth))
  }
  walk(doc)
  return snapshots
}

test('父项带子列表时 Tab 只改父项，子项结构和视觉层级不动', () => {
  const failures = []
  for (const { label, listType, mkItem } of LIST_TYPES) {
    for (const childIndentLevel of [0, 1]) {
      const window = setupDom()
      const editor = createEditor(window, {
        type: 'doc',
        content: [list(listType, [
          mkItem('A'),
          mkItem('B', [list(listType, [mkItem('B1', [], childIndentLevel)])]),
          mkItem('C'),
        ])],
      })

      const initial = listItemSnapshots(editor.state.doc)
      const initialB = initial.find((item) => item.text === 'B')
      const initialB1 = initial.find((item) => item.text === 'B1')
      if (!initialB || !initialB1) {
        failures.push(`[${label}/子项缩进${childIndentLevel}] 初始结构缺少 B 或 B1`)
        editor.destroy()
        continue
      }

      editor.chain().focus().setTextSelection(findTextRange(editor, 'B').from).run()
      const event = dispatchTab(editor, window, false)
      if (!event.defaultPrevented) failures.push(`[${label}/子项缩进${childIndentLevel}] Tab 未处理`)

      const afterOneTab = listItemSnapshots(editor.state.doc)
      const bAfterOneTab = afterOneTab.find((item) => item.text === 'B')
      const b1AfterOneTab = afterOneTab.find((item) => item.text === 'B1')
      if (!bAfterOneTab || !b1AfterOneTab) {
        failures.push(`[${label}/子项缩进${childIndentLevel}] Tab 后 B 或 B1 丢失`)
        editor.destroy()
        continue
      }
      if (bAfterOneTab.structuralDepth !== initialB.structuralDepth
        || bAfterOneTab.indentLevel !== initialB.indentLevel + 1
        || !bAfterOneTab.hasChildList) {
        failures.push(`[${label}/子项缩进${childIndentLevel}] B 不是仅视觉缩进一级: ${JSON.stringify({ initialB, bAfterOneTab })}`)
      }
      if (JSON.stringify(b1AfterOneTab) !== JSON.stringify(initialB1)) {
        failures.push(`[${label}/子项缩进${childIndentLevel}] B1 被带动: ${JSON.stringify({ initialB1, b1AfterOneTab })}`)
      }
      for (const text of ['A', 'C']) {
        const before = initial.find((item) => item.text === text)
        const after = afterOneTab.find((item) => item.text === text)
        if (JSON.stringify(after) !== JSON.stringify(before)) {
          failures.push(`[${label}/子项缩进${childIndentLevel}] 未选中的 ${text} 被带动`)
        }
      }
      if (afterOneTab.map((item) => item.text).join('|') !== initial.map((item) => item.text).join('|')) {
        failures.push(`[${label}/子项缩进${childIndentLevel}] 文本顺序变化`)
      }

      // 连续第二次 Tab 仍然只能动 B；Shift+Tab 逐级只还原 B。
      dispatchTab(editor, window, false)
      const afterTwoTabs = listItemSnapshots(editor.state.doc)
      const bAfterTwoTabs = afterTwoTabs.find((item) => item.text === 'B')
      const b1AfterTwoTabs = afterTwoTabs.find((item) => item.text === 'B1')
      if (bAfterTwoTabs?.indentLevel !== 2 || bAfterTwoTabs?.structuralDepth !== initialB.structuralDepth) {
        failures.push(`[${label}/子项缩进${childIndentLevel}] 第二次 Tab 后 B 层级错误: ${JSON.stringify(bAfterTwoTabs)}`)
      }
      if (JSON.stringify(b1AfterTwoTabs) !== JSON.stringify(initialB1)) {
        failures.push(`[${label}/子项缩进${childIndentLevel}] 第二次 Tab 带动了 B1`)
      }

      dispatchTab(editor, window, true)
      const bAfterFirstOutdent = listItemSnapshots(editor.state.doc).find((item) => item.text === 'B')
      if (bAfterFirstOutdent?.indentLevel !== 1
        || bAfterFirstOutdent?.structuralDepth !== initialB.structuralDepth) {
        failures.push(`[${label}/子项缩进${childIndentLevel}] 第一次 Shift+Tab 后 B 层级错误: ${JSON.stringify(bAfterFirstOutdent)}`)
      }
      dispatchTab(editor, window, true)
      const restored = listItemSnapshots(editor.state.doc)
      const bRestored = restored.find((item) => item.text === 'B')
      const b1Restored = restored.find((item) => item.text === 'B1')
      if (JSON.stringify(bRestored) !== JSON.stringify(initialB)
        || JSON.stringify(b1Restored) !== JSON.stringify(initialB1)) {
        failures.push(`[${label}/子项缩进${childIndentLevel}] Tab/Shift+Tab 未恢复原状`)
      }
      editor.destroy()
    }
  }
  assert.equal(failures.length, 0, `带子列表的单父项缩进回归失败：\n${failures.join('\n')}`)
})

// 二级项是父项下唯一子项，并且自身还带子列表时，Tab 仍必须能进入三级。
// 旧实现只要看到“有子列表 + 没有同级前项”就提前返回，表现为同一位置的项
// 因为多了子内容而偶发不能缩进；实际缩进只改当前项的 dvnIndentLevel，完全
// 不依赖同级前项，也不会带动它的子列表。
test('二级首项带子列表时仍可进入三级，且只修改当前项', () => {
  const failures = []
  for (const outer of LIST_TYPES) {
    for (const middle of LIST_TYPES) {
      const window = setupDom()
      const editor = createEditor(window, {
        type: 'doc',
        content: [list(outer.listType, [
          outer.mkItem('A', [list(middle.listType, [
            middle.mkItem('B', [list(outer.listType, [outer.mkItem('B1')])]),
            middle.mkItem('C'),
          ])]),
        ])],
      })
      const name = `${outer.label}外层/${middle.label}中层`
      const initial = listItemSnapshots(editor.state.doc)
      const initialB = initial.find((item) => item.text === 'B')
      const initialB1 = initial.find((item) => item.text === 'B1')

      editor.chain().focus().setTextSelection(findTextRange(editor, 'B').from).run()
      const event = dispatchTab(editor, window, false)
      if (!event.defaultPrevented) failures.push(`[${name}] Tab 未处理`)

      const afterTab = listItemSnapshots(editor.state.doc)
      const bAfterTab = afterTab.find((item) => item.text === 'B')
      const b1AfterTab = afterTab.find((item) => item.text === 'B1')
      if (bAfterTab?.structuralDepth !== initialB?.structuralDepth
        || bAfterTab?.indentLevel !== initialB?.indentLevel + 1) {
        failures.push(`[${name}] 二级首项没有只靠视觉属性进入三级: ${JSON.stringify({ initialB, bAfterTab })}`)
      }
      if (JSON.stringify(b1AfterTab) !== JSON.stringify(initialB1)) {
        failures.push(`[${name}] 子项 B1 被带动: ${JSON.stringify({ initialB1, b1AfterTab })}`)
      }
      if (afterTab.map((item) => item.text).join('|') !== initial.map((item) => item.text).join('|')) {
        failures.push(`[${name}] 文本顺序变化`)
      }

      dispatchTab(editor, window, true)
      const restored = listItemSnapshots(editor.state.doc)
      if (JSON.stringify(restored) !== JSON.stringify(initial)) {
        failures.push(`[${name}] Shift+Tab 未精确恢复: ${JSON.stringify({ initial, restored })}`)
      }
      editor.destroy()
    }
  }
  assert.equal(failures.length, 0, `二级首项带子列表缩进回归失败：\n${failures.join('\n')}`)
})

// 用户实际路径：有序 A / B(B1,B2) / C / D，光标在 B 连续做 Tab/Shift+Tab。
// B 带真实子列表时仍只能改变 B 自己的视觉层级；B 缩进后必须进入子级编号组，
// 回到根级后 B/C/D 的根编号必须重新连续，不能出现 1,1,1,2 后突然断号或重号。
test('带子列表的有序项 Tab/Shift+Tab 往返后编号始终按当前视觉层级连续', () => {
  const window = setupDom()
  const editor = createEditor(window, {
    type: 'doc',
    content: [list('orderedList', [
      listItem('A'),
      listItem('B', [list('orderedList', [listItem('B1'), listItem('B2')])]),
      listItem('C'),
      listItem('D'),
    ])],
  })
  const outerList = () => editor.state.doc.firstChild
  const item = (text) => listItemSnapshots(editor.state.doc).find((entry) => entry.text === text)

  editor.chain().focus().setTextSelection(findTextRange(editor, 'B').from).run()

  for (let round = 1; round <= 3; round += 1) {
    const beforeB = item('B')
    const beforeB1 = item('B1')
    dispatchTab(editor, window, false)

    assert.deepEqual(orderedListMarkerNumbers(outerList()), [1, 1, 2, 3], `第 ${round} 轮 Tab 后断号/重号`)
    assert.equal(item('B').structuralDepth, beforeB.structuralDepth, `第 ${round} 轮 Tab 把 B 的结构层级改了`)
    assert.equal(item('B').indentLevel, beforeB.indentLevel + 1, `第 ${round} 轮 Tab 没有只缩进 B`)
    assert.deepEqual(item('B1'), beforeB1, `第 ${round} 轮 Tab 把未选中的 B1 一起移动了`)

    dispatchTab(editor, window, true)

    assert.deepEqual(orderedListMarkerNumbers(outerList()), [1, 2, 3, 4], `第 ${round} 轮 Shift+Tab 后断号/重号`)
    assert.equal(item('B').structuralDepth, beforeB.structuralDepth, `第 ${round} 轮 Shift+Tab 把 B 的结构层级改了`)
    assert.equal(item('B').indentLevel, beforeB.indentLevel, `第 ${round} 轮 Shift+Tab 没有恢复 B`)
    assert.deepEqual(item('B1'), beforeB1, `第 ${round} 轮 Shift+Tab 把未选中的 B1 一起移动了`)
  }

  editor.destroy()
})

// 用户截图同构路径：A / B(B1,B2) / C / D。B 先 Tab 缩进、再 Shift+Tab
// 回到根级，然后连续 Tab 两次。父项编号必须按当前视觉层级重新计算，但
// B1/B2 仍在原有序子列表中独立连续编号，不能被子项缩进或往返重置/断号。
test('有序父项回到根级后连续 Tab，父项重排且子列表独立编号不重置', () => {
  const window = setupDom()
  const editor = createEditor(window, {
    type: 'doc',
    content: [list('orderedList', [
      listItem('A'),
      listItem('B', [list('orderedList', [listItem('B1'), listItem('B2')])]),
      listItem('C'),
      listItem('D'),
    ])],
  })
  const outerList = () => editor.state.doc.firstChild
  const innerList = () => outerList().child(1).lastChild
  const item = (text) => listItemSnapshots(editor.state.doc).find((entry) => entry.text === text)
  const initialB1 = item('B1')

  editor.chain().focus().setTextSelection(findTextRange(editor, 'B').from).run()

  dispatchTab(editor, window, false)
  assert.deepEqual(orderedListMarkerNumbers(outerList()), [1, 1, 2, 3], 'Tab 后父项编号未按视觉层级重算')

  dispatchTab(editor, window, true)
  assert.deepEqual(orderedListMarkerNumbers(outerList()), [1, 2, 3, 4], 'Shift+Tab 回根级后编号未恢复连续')

  dispatchTab(editor, window, false)
  dispatchTab(editor, window, false)
  assert.equal(item('B').indentLevel, 2, '连续两次 Tab 没有只推进父项自身')
  assert.deepEqual(orderedListMarkerNumbers(outerList()), [1, 1, 2, 3], '连续 Tab 后父项编号断号/重号')
  assert.deepEqual(orderedListMarkerNumbers(innerList()), [1, 2], '连续 Tab 把子列表编号重置或改乱')
  assert.deepEqual(item('B1'), initialB1, '连续 Tab 改变了未选中的 B1')

  dispatchTab(editor, window, true)
  dispatchTab(editor, window, true)
  assert.equal(item('B').indentLevel, 0, '两次 Shift+Tab 没有恢复父项到根级')
  assert.deepEqual(orderedListMarkerNumbers(outerList()), [1, 2, 3, 4], '恢复根级后父列表编号不连续')
  assert.deepEqual(orderedListMarkerNumbers(innerList()), [1, 2], '恢复根级后子列表编号不连续')
  assert.deepEqual(item('B1'), initialB1, '恢复根级改变了未选中的 B1')

  editor.destroy()
})

// 跨列表类型时，当前项是独立列表首项但前面已有列表块：Tab 仍然只能缩进
// 当前项本身，不能调用跨列表挂载把当前项及其已有子列表整体下沉。
test('跨类型列表首项带子列表时 Tab 不整体下沉', () => {
  const failures = []
  for (const previousSpec of LIST_TYPES) {
    for (const currentSpec of LIST_TYPES) {
      for (const childSpec of LIST_TYPES) {
        const window = setupDom()
        const editor = createEditor(window, {
          type: 'doc',
          content: [
            list(previousSpec.listType, [previousSpec.mkItem('P')]),
            list(currentSpec.listType, [
              currentSpec.mkItem('T', [list(childSpec.listType, [childSpec.mkItem('T1')])]),
            ]),
          ],
        })
        const initial = listItemSnapshots(editor.state.doc)
        const initialT = initial.find((item) => item.text === 'T')
        const initialT1 = initial.find((item) => item.text === 'T1')
        const label = `${previousSpec.label}/${currentSpec.label}/${childSpec.label}`

        editor.chain().focus().setTextSelection(findTextRange(editor, 'T').from).run()
        dispatchTab(editor, window, false)
        const after = listItemSnapshots(editor.state.doc)
        const afterT = after.find((item) => item.text === 'T')
        const afterT1 = after.find((item) => item.text === 'T1')

        if (editor.state.doc.childCount !== 2) {
          failures.push(`${label}: 文档由两个列表块变成了 ${editor.state.doc.childCount} 块`)
        }
        if (afterT?.structuralDepth !== initialT?.structuralDepth
          || afterT?.indentLevel !== initialT?.indentLevel + 1
          || !afterT?.hasChildList) {
          failures.push(`${label}: T 不是仅视觉缩进一级 ${JSON.stringify({ initialT, afterT })}`)
        }
        if (JSON.stringify(afterT1) !== JSON.stringify(initialT1)) {
          failures.push(`${label}: T1 被整体带动 ${JSON.stringify({ initialT1, afterT1 })}`)
        }
        if (after.map((item) => item.text).join('|') !== initial.map((item) => item.text).join('|')) {
          failures.push(`${label}: 文本顺序变化`)
        }

        dispatchTab(editor, window, true)
        const restored = listItemSnapshots(editor.state.doc)
        if (JSON.stringify(restored) !== JSON.stringify(initial)) {
          failures.push(`${label}: Shift+Tab 未恢复`)
        }
        editor.destroy()
      }
    }
  }
  assert.equal(failures.length, 0, `跨类型首项缩进失败：\n${failures.join('\n')}`)
})


// 用户真实路径的完整交叉矩阵：前一个列表块、当前独立列表块、后一个列表块。
// 当前列表首项 C 按 Tab 时，只允许 C 的视觉层级 +1；D、两个子列表、前后列表
// 以及待办勾选状态都必须原样保留。27 种前后类型组合 × 4 种子树分布全部覆盖。
test('相邻三个列表共 108 例：Tab 只缩进当前独立列表首项，兄弟与子树不漂移', () => {
  const failures = []
  const makeItem = (spec, text, children = [], checked = false) => {
    const node = spec.mkItem(text, children)
    if (spec.listType === 'taskList') node.attrs.checked = checked
    return node
  }
  const shapes = [
    { name: '无子树', currentChildren: false, followingChildren: false },
    { name: '当前项带子树', currentChildren: true, followingChildren: false },
    { name: '后续兄弟带子树', currentChildren: false, followingChildren: true },
    { name: '当前项和后续兄弟都带子树', currentChildren: true, followingChildren: true },
  ]
  const visualDepth = (item) => item.structuralDepth + item.indentLevel

  for (const previousSpec of LIST_TYPES) {
    for (const currentSpec of LIST_TYPES) {
      for (const nextSpec of LIST_TYPES) {
        for (const shape of shapes) {
          const window = setupDom()
          const cChildren = shape.currentChildren
            ? [list(currentSpec.listType, [makeItem(currentSpec, 'C1', [], true)])]
            : []
          const dChildren = shape.followingChildren
            ? [list(currentSpec.listType, [makeItem(currentSpec, 'D1', [], true)])]
            : []
          const editor = createEditor(window, {
            type: 'doc',
            content: [
              list(previousSpec.listType, [
                makeItem(previousSpec, 'A', [], true),
                makeItem(previousSpec, 'B', [], false),
              ]),
              list(currentSpec.listType, [
                makeItem(currentSpec, 'C', cChildren, true),
                makeItem(currentSpec, 'D', dChildren, shape.followingChildren),
              ]),
              list(nextSpec.listType, [
                makeItem(nextSpec, 'E', [], true),
                makeItem(nextSpec, 'F', [], false),
              ]),
            ],
          })
          const label = `${previousSpec.label}/${currentSpec.label}/${nextSpec.label}/${shape.name}`
          const initialJSON = JSON.stringify(editor.getJSON())
          const initial = listItemSnapshots(editor.state.doc)
          const initialC = initial.find((item) => item.text === 'C')
          const initialOthers = initial.filter((item) => item.text !== 'C')
          const initialChildCount = editor.state.doc.childCount
          const initialOrder = initial.map((item) => item.text).join('|')
          // 相邻同类型列表在第一次结构事务中会被既有归一化合并；这属于独立
          // 的列表边界规则。当前回归真正要求“三块保持不变”的是类型不同的块。
          const canChangeBlockBoundary = previousSpec.listType === currentSpec.listType
            || currentSpec.listType === nextSpec.listType

          editor.chain().focus().setTextSelection(findTextRange(editor, 'C').from).run()
          const firstEvent = dispatchTab(editor, window, false)
          const afterFirst = listItemSnapshots(editor.state.doc)
          const afterFirstC = afterFirst.find((item) => item.text === 'C')
          const afterFirstOthers = afterFirst.filter((item) => item.text !== 'C')

          if (!firstEvent.defaultPrevented) failures.push(`${label}: 第一次 Tab 未处理`)
          if (!canChangeBlockBoundary && editor.state.doc.childCount !== initialChildCount) {
            failures.push(`${label}: 列表块边界变化 ${initialChildCount} -> ${editor.state.doc.childCount}`)
          }
          if (afterFirstC && initialC && visualDepth(afterFirstC) !== visualDepth(initialC) + 1) {
            failures.push(`${label}: C 未只缩进一级 ${JSON.stringify({ initialC, afterFirstC })}`)
          }
          if (JSON.stringify(afterFirstOthers) !== JSON.stringify(initialOthers)) {
            failures.push(`${label}: 未选中的兄弟/前后项或勾选状态被带动 ${JSON.stringify({ initialOthers, afterFirstOthers })}`)
          }
          if (afterFirst.map((item) => item.text).join('|') !== initialOrder) {
            failures.push(`${label}: 文本顺序变化`)
          }

          const secondEvent = dispatchTab(editor, window, false)
          const afterSecond = listItemSnapshots(editor.state.doc)
          const afterSecondC = afterSecond.find((item) => item.text === 'C')
          if (!secondEvent.defaultPrevented) failures.push(`${label}: 第二次 Tab 未处理`)
          if (afterSecondC && initialC && visualDepth(afterSecondC) !== Math.min(3, visualDepth(initialC) + 2)) {
            failures.push(`${label}: 第二次 Tab 后 C 视觉层级错误 ${JSON.stringify({ initialC, afterSecondC })}`)
          }
          if (JSON.stringify(afterSecond.filter((item) => item.text !== 'C'))
            !== JSON.stringify(initialOthers)) {
            failures.push(`${label}: 第二次 Tab 带动了未选中项`)
          }
          if (Math.max(...afterSecond.map(visualDepth)) > 3) {
            failures.push(`${label}: 出现第 4 层列表`)
          }

          dispatchTab(editor, window, true)
          dispatchTab(editor, window, true)
          if (canChangeBlockBoundary) {
            const restored = listItemSnapshots(editor.state.doc).map((item) => ({
              text: item.text,
              itemType: item.itemType,
              visualDepth: visualDepth(item),
              checked: item.checked,
              hasChildList: item.hasChildList,
            }))
            const expected = initial.map((item) => ({
              text: item.text,
              itemType: item.itemType,
              visualDepth: visualDepth(item),
              checked: item.checked,
              hasChildList: item.hasChildList,
            }))
            if (JSON.stringify(restored) !== JSON.stringify(expected)) {
              failures.push(`${label}: 两次 Shift+Tab 后语义未恢复`)
            }
          } else if (JSON.stringify(editor.getJSON()) !== initialJSON) {
            failures.push(`${label}: 两次 Shift+Tab 后文档未精确恢复`)
          }
          editor.destroy()
        }
      }
    }
  }
  assert.deepEqual(failures, [], `相邻独立列表首项缩进失败 ${failures.length} 例：\n${failures.join('\n')}`)
})

// 图片是 NodeSelection，不是文本范围选区；列表缩进/反缩进后必须保留图片节点
// 选中框。三种列表都要覆盖，重复图片还要按“第几次出现”确认恢复的是原图片。
test('图片 NodeSelection 在 Tab / Shift+Tab 后保持选中，三种列表全覆盖', () => {
  const problems = []
  for (const listType of ['bulletList', 'orderedList', 'taskList']) {
    const window = setupDom()
    const editor = createEditor(window, imageListDoc(listType, ['images/a.png', 'images/a.png', 'images/a.png']))

    selectImage(editor, 'images/a.png', 1)
    const sinkEvent = dispatchTab(editor, window, false)
    if (!sinkEvent.defaultPrevented) problems.push(`[${listType}] Tab 未被列表逻辑处理`)
    if (editor.state.selection.node?.type.name !== 'image') {
      problems.push(`[${listType}] Tab 后图片 NodeSelection 丢失：${editor.state.selection.constructor.name}`)
    }
    if (selectedImageOccurrence(editor, 'images/a.png') !== 1) {
      problems.push(`[${listType}] Tab 后恢复到了错误的重复图片`)
    }
    if (selectedImageVisualDepth(editor) !== 2) {
      problems.push(`[${listType}] Tab 后图片项视觉层级应为 2，实际 ${selectedImageVisualDepth(editor)}`)
    }

    const liftEvent = dispatchTab(editor, window, true)
    if (!liftEvent.defaultPrevented) problems.push(`[${listType}] Shift+Tab 未被列表逻辑处理`)
    if (editor.state.selection.node?.type.name !== 'image') {
      problems.push(`[${listType}] Shift+Tab 后图片 NodeSelection 丢失：${editor.state.selection.constructor.name}`)
    }
    if (selectedImageOccurrence(editor, 'images/a.png') !== 1) {
      problems.push(`[${listType}] Shift+Tab 后恢复到了错误的重复图片`)
    }
    if (selectedImageVisualDepth(editor) !== 1) {
      problems.push(`[${listType}] Shift+Tab 后图片项视觉层级应为 1，实际 ${selectedImageVisualDepth(editor)}`)
    }

    editor.destroy()
  }
  assert.equal(problems.length, 0, `图片列表选中态回归失败：\n${problems.join('\n')}`)
})

// 图片项同样可以成为视觉游离项；列表操作后 NodeSelection 不能丢。
test('图片是列表首项时可缩进为游离项，且选中态保持', () => {
  const window = setupDom()
  const editor = createEditor(window, imageListDoc('bulletList', ['images/only.png']))
  selectImage(editor, 'images/only.png')

  const event = dispatchTab(editor, window, false)
  assert.equal(event.defaultPrevented, true, '一级唯一项 Tab 应被列表逻辑接管')
  assert.equal(editor.state.selection.node?.type.name, 'image', 'Tab 后图片 NodeSelection 应保持')
  assert.equal(selectedImageVisualDepth(editor), 2, '一级唯一图片项应成为视觉二级游离项')
  editor.destroy()
})

// ---- 游离项专项：有序编号 + 待办勾选联动 -------------------------------
//
// 用户确认允许“无父项的二/三级项”后，有序列表和待办列表不能只看结构树：
// 有序编号按视觉层级连续；待办级联按视觉父子关系，不能把视觉上更浅的
// 结构后代误当成子项。
function visualLevelOf(snapshot, text) {
  const item = snapshot.find((entry) => entry.text === text)
  return item ? item.structuralDepth + item.indentLevel + 1 : null
}

test('有序列表游离项：单点逐级缩进、多选各升一级、编号始终连续', () => {
  const window = setupDom()
  const editor = createEditor(window, {
    type: 'doc',
    content: [list('orderedList', 'ABCDEFGHIJKL'.split('').map((text) => listItem(text)))],
  })
  const snap = () => listItemSnapshots(editor.state.doc)
  const tabAt = (text) => {
    editor.chain().focus().setTextSelection(findTextRange(editor, text).from).run()
    return dispatchTab(editor, window, false)
  }

  // A 首次成为一级列表中的游离二级项，再次成为游离三级项。
  // 后面的 B/C/D 仍必须各只升一级，不能复制 A 的三级缩进。
  assert.equal(tabAt('A').defaultPrevented, true)
  assert.equal(visualLevelOf(snap(), 'A'), 2)
  assert.equal(tabAt('A').defaultPrevented, true)
  assert.equal(visualLevelOf(snap(), 'A'), 3)
  for (const text of ['B', 'C', 'D']) {
    assert.equal(tabAt(text).defaultPrevented, true)
    assert.equal(visualLevelOf(snap(), text), 2)
  }
  assert.deepEqual(
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']
      .map((text) => visualLevelOf(snap(), text)),
    [3, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1],
  )

  const numberOf = () => {
    const expected = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']
    const actual = Array.from(editor.view.dom.querySelectorAll('li'))
      .map((item) => Number((item.style.getPropertyValue('--dvn-list-number') || '').replace(/"/g, '')))
    assert.deepEqual(actual, [1, 1, 2, 3, 1, 2, 3, 4, 5, 6, 7, 8])
    return true
  }
  assert.equal(numberOf(), true, 'A 是三级孤立组从 1 开始，B-D 二级组从 1 连续到 3，E-L 根级从 1 连续到 8')

  // A-D 多选 Tab：A 已在三级保持，B/C/D 各升一级到三级；不得出现跳级。
  let from = findTextRange(editor, 'A').from
  let to = findTextRange(editor, 'D').to
  editor.chain().focus().setTextSelection({ from, to }).run()
  assert.equal(dispatchTab(editor, window, false).defaultPrevented, true)
  assert.deepEqual(
    ['A', 'B', 'C', 'D'].map((text) => visualLevelOf(snap(), text)),
    [3, 3, 3, 3],
  )

  // Shift+Tab 后 A-D 全部回到二级，仍可作为游离项存在；编号继续 1..4。
  from = findTextRange(editor, 'A').from
  to = findTextRange(editor, 'D').to
  editor.chain().focus().setTextSelection({ from, to }).run()
  assert.equal(dispatchTab(editor, window, true).defaultPrevented, true)
  assert.deepEqual(
    ['A', 'B', 'C', 'D'].map((text) => visualLevelOf(snap(), text)),
    [2, 2, 2, 2],
  )
  assert.deepEqual(
    Array.from(editor.view.dom.querySelectorAll('li'))
      .slice(0, 4)
      .map((item) => Number((item.style.getPropertyValue('--dvn-list-number') || '').replace(/"/g, ''))),
    [1, 2, 3, 4],
  )

  // 再 Shift+Tab 回到一级；全文 12 项根编号连续 1..12。
  editor.chain().focus().setTextSelection({
    from: findTextRange(editor, 'A').from,
    to: findTextRange(editor, 'D').to,
  }).run()
  assert.equal(dispatchTab(editor, window, true).defaultPrevented, true)
  assert.deepEqual(
    Array.from(editor.view.dom.querySelectorAll('li'))
      .map((item) => Number((item.style.getPropertyValue('--dvn-list-number') || '').replace(/"/g, ''))),
    Array.from({ length: 12 }, (_, index) => index + 1),
  )
  editor.destroy()
})

test('待办游离项：勾选只级联视觉子项，多选 Tab/Shift+Tab 与 Undo/Redo 保状态', () => {
  const window = setupDom()
  const editor = createEditor(window, {
    type: 'doc',
    content: [list('taskList', 'ABCDEFGHIJKL'.split('').map((text) => taskItem(text)))],
  })
  const snap = () => listItemSnapshots(editor.state.doc)
  const levels = () => Object.fromEntries(snap().map((item) => [item.text, item.structuralDepth + item.indentLevel + 1]))
  const checked = () => Object.fromEntries(snap().map((item) => [item.text, Boolean(item.checked)]))
  const tabAt = (text, times = 1) => {
    for (let index = 0; index < times; index += 1) {
      editor.chain().focus().setTextSelection(findTextRange(editor, text).from).run()
      dispatchTab(editor, window, false)
    }
  }
  const check = (text) => {
    editor.chain().focus()
      .setTextSelection(findTextRange(editor, text).from)
      .setTaskChecked(true)
      .run()
  }

  // A 是视觉三级游离项；B/C 和 E/F 是视觉父子对，D 是视觉二级游离项。
  tabAt('A', 2)
  tabAt('B', 1)
  tabAt('C', 2)
  tabAt('D', 1)
  tabAt('E', 1)
  tabAt('F', 2)
  assert.deepEqual(levels(), {
    A: 3, B: 2, C: 3, D: 2, E: 2, F: 3,
    G: 1, H: 1, I: 1, J: 1, K: 1, L: 1,
  })

  check('A')
  assert.deepEqual(checked(), {
    A: true, B: false, C: false, D: false, E: false, F: false,
    G: false, H: false, I: false, J: false, K: false, L: false,
  }, '勾选视觉三级游离项不能联动结构上更浅的 B/C/D')

  check('B')
  assert.equal(checked().B, true)
  assert.equal(checked().C, true, 'B 的视觉三级子项 C 应随 B 勾选')
  assert.equal(checked().D, false, '同级/更浅的 D 不能被 B 联动')

  check('D')
  assert.equal(checked().D, true)
  assert.equal(checked().E, false, 'D 与 E 同为视觉二级，D 不能联动 E')

  check('E')
  assert.equal(checked().E, true)
  assert.equal(checked().F, true, 'E 的视觉三级子项 F 应随 E 勾选')
  const checkedBeforeIndent = checked()

  const selectBF = () => editor.chain().focus().setTextSelection({
    from: findTextRange(editor, 'B').from,
    to: findTextRange(editor, 'F').to,
  }).run()
  selectBF()
  assert.equal(dispatchTab(editor, window, true).defaultPrevented, true)
  assert.deepEqual(
    ['B', 'C', 'D', 'E', 'F'].map((text) => levels()[text]),
    [1, 2, 1, 1, 2],
  )
  assert.deepEqual(checked(), checkedBeforeIndent, 'Shift+Tab 不能改变勾选状态')

  // 单测同步执行时 History 会把相邻按键并成一组；真实 AT 有等待不会这样。
  // 显式关闭上一组，保证这里验证的 Undo 只回退本次批量 Tab。
  editor.view.dispatch(closeHistory(editor.state.tr))
  selectBF()
  assert.equal(dispatchTab(editor, window, false).defaultPrevented, true)
  assert.deepEqual(
    ['B', 'C', 'D', 'E', 'F'].map((text) => levels()[text]),
    [2, 3, 2, 2, 3],
  )
  assert.deepEqual(checked(), checkedBeforeIndent, '批量 Tab 不能改变勾选状态')

  assert.equal(editor.commands.undo(), true)
  assert.deepEqual(
    ['B', 'C', 'D', 'E', 'F'].map((text) => levels()[text]),
    [1, 2, 1, 1, 2],
  )
  assert.deepEqual(checked(), checkedBeforeIndent, 'Undo 后层级和勾选状态都要恢复')
  assert.equal(editor.commands.redo(), true)
  assert.deepEqual(
    ['B', 'C', 'D', 'E', 'F'].map((text) => levels()[text]),
    [2, 3, 2, 2, 3],
  )
  assert.deepEqual(checked(), checkedBeforeIndent)
  editor.destroy()
})

test('待办跳级视觉父子：A(1)->B(3)->C(2)->D(3) 中 B/C 都是 A 的直接子项', () => {
  const window = setupDom()
  const editor = createEditor(window, {
    type: 'doc',
    content: [list('taskList', 'ABCDEFGHIJKL'.split('').map((text) => taskItem(text)))],
  })
  const snap = () => listItemSnapshots(editor.state.doc)
  const levels = () => Object.fromEntries(snap().map((item) => [item.text, item.structuralDepth + item.indentLevel + 1]))
  const checked = () => Object.fromEntries(snap().map((item) => [item.text, Boolean(item.checked)]))
  const tabAt = (text, times = 1) => {
    for (let index = 0; index < times; index += 1) {
      editor.chain().focus().setTextSelection(findTextRange(editor, text).from).run()
      dispatchTab(editor, window, false)
    }
  }
  const check = (text, value) => {
    editor.chain().focus()
      .setTextSelection(findTextRange(editor, text).from)
      .setTaskChecked(value)
      .run()
  }

  tabAt('B', 2)
  tabAt('C', 1)
  tabAt('D', 2)
  assert.deepEqual(
    ['A', 'B', 'C', 'D', 'E'].map((text) => levels()[text]),
    [1, 3, 2, 3, 1],
  )

  // C/D 完成只代表 A 的一个分支；B 仍是 A 的直接视觉子项且未完成，
  // 因此 A 不能提前变成完成态。
  check('C', true)
  assert.deepEqual(checked(), {
    A: false, B: false, C: true, D: true, E: false,
    F: false, G: false, H: false, I: false, J: false, K: false, L: false,
  })

  check('B', true)
  assert.equal(checked().A, true, 'B/C/D 三个视觉子项全部完成后 A 才完成')

  check('C', false)
  assert.equal(checked().A, false, '取消 C 后 A 必须重新变为未完成')
  editor.destroy()
})

test('待办父项级联勾选后 Undo 只回退本次操作，不回退之前的子项勾选', () => {
  const window = setupDom()
  const editor = createEditor(window, {
    type: 'doc',
    content: [list('taskList', 'ABCDE'.split('').map((text) => taskItem(text)))],
  })
  const snap = () => listItemSnapshots(editor.state.doc)
  const checked = () => Object.fromEntries(snap().map((item) => [item.text, Boolean(item.checked)]))
  const tabAt = (text, times = 1) => {
    for (let index = 0; index < times; index += 1) {
      editor.chain().focus().setTextSelection(findTextRange(editor, text).from).run()
      dispatchTab(editor, window, false)
    }
  }
  const setChecked = (text, value) => {
    editor.chain().focus()
      .setTextSelection(findTextRange(editor, text).from)
      .setTaskChecked(value)
      .run()
  }

  tabAt('B', 1)
  tabAt('C', 2)
  tabAt('D', 2)

  setChecked('C', true)
  assert.deepEqual(checked(), { A: false, B: false, C: true, D: false, E: false })
  editor.view.dispatch(closeHistory(editor.state.tr))
  setChecked('B', true)
  assert.deepEqual(checked(), { A: true, B: true, C: true, D: true, E: false })

  // Undo 的 B:true -> false 不能被级联插件解释成“手动取消父项”，
  // 否则 C/D 会被一起取消。
  assert.equal(editor.commands.undo(), true)
  assert.deepEqual(
    checked(),
    { A: false, B: false, C: true, D: false, E: false },
    'Undo 只应回退 B 及本次级联，C 的历史勾选必须保留',
  )

  assert.equal(editor.commands.redo(), true)
  assert.deepEqual(checked(), { A: true, B: true, C: true, D: true, E: false })
  editor.destroy()
})

test('待办父子转有序再转回待办：新子项未勾选时父项必须重新变为未完成', () => {
  const window = setupDom()
  const editor = createEditor(window, {
    type: 'doc',
    content: [list('taskList', 'ABCDE'.split('').map((text) => taskItem(text)))],
  })

  for (const text of ['B', 'C', 'D']) {
    editor.chain().focus().setTextSelection(findTextRange(editor, text).from).run()
    dispatchTab(editor, window, false)
  }
  editor.chain().focus().setTextSelection(findTextRange(editor, 'A').from).run()
  editor.commands.setTaskChecked(true)
  assert.deepEqual(
    listItemSnapshots(editor.state.doc).map((item) => [item.text, Boolean(item.checked)]),
    [['A', true], ['B', true], ['C', true], ['D', true], ['E', false]],
  )

  editor.chain().focus().setTextSelection({
    from: findTextRange(editor, 'B').from,
    to: findTextRange(editor, 'D').to,
  }).run()
  assert.equal(switchSelectedListType(editor, 'orderedList'), true)
  assert.equal(switchSelectedListType(editor, 'taskList'), true)

  const converted = listItemSnapshots(editor.state.doc)
  assert.deepEqual(
    converted.filter((item) => 'ABCD'.includes(item.text)).map((item) => [item.text, Boolean(item.checked)]),
    [['A', false], ['B', false], ['C', false], ['D', false]],
    '转回待办后 A/B/C/D 都应未勾选',
  )
  editor.destroy()
})

test('待办 A 行尾 Enter：视觉同级但结构子项的 C 不能被误判取消勾选', () => {
  const window = setupDom()
  const checkedTask = (text, extra = [], indentLevel = 0, checked = true) => ({
    type: 'taskItem',
    attrs: { checked, dvnIndentLevel: indentLevel },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...extra],
  })
  const c = checkedTask('C', [
    list('taskList', [checkedTask('K', [], 0, true)]),
    list('orderedList', [listItem('X', [], 0)]),
  ], 0, true)
  const a = checkedTask('A', [
    list('taskList', [checkedTask('B', [], 1, true), c]),
  ], 1, true)
  const editor = createEditor(window, {
    type: 'doc',
    content: [list('taskList', [
      a,
      checkedTask('D', [], 1, true),
      checkedTask('E', [], 0, false),
    ])],
  })

  editor.chain().focus().setTextSelection(findTextRange(editor, 'A').to).run()
  const event = new window.KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  })
  editor.view.dom.dispatchEvent(event)

  const after = listItemSnapshots(editor.state.doc)
  const checked = Object.fromEntries(after.map((item) => [item.text, Boolean(item.checked)]))
  assert.equal(checked.B, true, 'B 不能因为位置平移被取消')
  assert.equal(checked.C, true, 'C 不能因为位置平移被取消')
  assert.equal(checked.K, true, 'C 的子项 K 不能联动取消')
  assert.equal(checked.D, true, 'D 不能受影响')
  const blank = after.find((item) => item.text === '')
  assert.equal(Boolean(blank?.checked), true, '新待办已有全部完成的视觉子项 B，应同步完成；不能按新建一律跳过')
  assert.equal(after.map((item) => item.text).join('|'), 'A||B|C|K|X|D|E')
  editor.destroy()
})

test('点击视觉二级 R：只联动其视觉子项 B，不能跨过同级 C 联动 C/K', () => {
  const window = setupDom()
  const checkedTask = (text, extra = [], indentLevel = 0, checked = false) => ({
    type: 'taskItem',
    attrs: { checked, dvnIndentLevel: indentLevel },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...extra],
  })
  const c = checkedTask('C', [
    list('taskList', [checkedTask('K', [], 0, false)]),
    list('orderedList', [listItem('X', [], 0)]),
  ], 0, false)
  const r = checkedTask('R', [
    list('taskList', [checkedTask('B', [], 1, false), c]),
  ], 1, false)
  const editor = createEditor(window, {
    type: 'doc',
    content: [list('taskList', [
      checkedTask('A', [], 1, true),
      r,
      checkedTask('D', [], 1, true),
      checkedTask('E', [], 0, false),
    ])],
  })

  editor.chain().focus().setTextSelection(findTextRange(editor, 'R').from).run()
  editor.commands.setTaskChecked(true)

  const after = listItemSnapshots(editor.state.doc)
  const checked = Object.fromEntries(after.map((item) => [item.text, Boolean(item.checked)]))
  assert.equal(checked.R, true)
  assert.equal(checked.B, true, 'B 是 R 的视觉子项，应联动')
  assert.equal(checked.C, false, 'C 与 R 视觉同级，不能联动')
  assert.equal(checked.K, false, 'K 属于 C，不能跨过 C 联动')
  assert.equal(checked.D, true, 'D 不受影响')
  editor.destroy()
})

test('A Shift+Tab 后 R/C/D 变为视觉子项：C 未勾选时 A 必须取消勾选', () => {
  const window = setupDom()
  const item = (text, extra = [], indentLevel = 0, checked = false) => ({
    type: 'taskItem',
    attrs: { checked, dvnIndentLevel: indentLevel },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...extra],
  })
  const a = item('A', [
    list('taskList', [
      item('R', [list('taskList', [item('B', [], 0, true)])], 0, true),
      item('C', [
        list('taskList', [item('大', [], 0, false)]),
        list('orderedList', [listItem('X', [], 0)]),
      ], 0, false),
      item('D', [], 0, true),
    ]),
  ], 1, true)
  const editor = createEditor(window, {
    type: 'doc',
    content: [list('taskList', [a, item('E', [], 0, false)])],
  })

  editor.chain().focus().setTextSelection(findTextRange(editor, 'A').from).run()
  const event = dispatchTab(editor, window, true)
  assert.equal(event.defaultPrevented, true)

  const after = listItemSnapshots(editor.state.doc)
  const levels = Object.fromEntries(after.map((entry) => [entry.text, entry.structuralDepth + entry.indentLevel + 1]))
  const checked = Object.fromEntries(after.map((entry) => [entry.text, Boolean(entry.checked)]))
  assert.deepEqual(levels, { A: 1, R: 2, B: 3, C: 2, 大: 3, X: 3, D: 2, E: 1 })
  assert.equal(checked.A, false, 'C 未勾选，A 不能继续显示已勾选')
  assert.equal(checked.C, false, 'C 的勾选状态不能被改变')
  assert.equal(checked.大, false, 'C 的子项不能联动')
  assert.equal(checked.R, true)
  assert.equal(checked.D, true)
  editor.destroy()
})

test('A 连续 Shift+Tab 成为未完成父项后，Tab 回同级不能重新勾选 A', () => {
  const window = setupDom()
  const item = (text, indentLevel, checked) => ({
    type: 'taskItem',
    attrs: { checked, dvnIndentLevel: indentLevel },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })
  const editor = createEditor(window, {
    type: 'doc',
    content: [list('taskList', [
      item('A', 2, true),
      item('B', 1, false),
    ])],
  })
  const checked = () => Object.fromEntries(listItemSnapshots(editor.state.doc).map((entry) => [entry.text, Boolean(entry.checked)]))
  const levels = () => Object.fromEntries(listItemSnapshots(editor.state.doc).map((entry) => [entry.text, entry.structuralDepth + entry.indentLevel + 1]))

  editor.chain().focus().setTextSelection(findTextRange(editor, 'A').from).run()
  assert.equal(dispatchTab(editor, window, true).defaultPrevented, true)
  assert.equal(dispatchTab(editor, window, true).defaultPrevented, true)
  assert.deepEqual(levels(), { A: 1, B: 2 })
  assert.deepEqual(checked(), { A: false, B: false }, 'A 成为未完成 B 的父项后必须取消勾选')

  assert.equal(dispatchTab(editor, window, false).defaultPrevented, true)
  assert.deepEqual(levels(), { A: 2, B: 2 }, 'Tab 后 A/B 应回到同一视觉层级')
  assert.deepEqual(checked(), { A: false, B: false }, 'A 变成叶子项后不能恢复历史勾选状态')
  editor.destroy()
})

// ---- 全部组合在模块加载期跑完，这里统一汇报。一次跑出所有坏组合，而不是只报第一个。
test('list indent/outdent matrix', () => {
  assert.equal(FAILURES.length, 0, `矩阵失败 ${FAILURES.length} 例：\n${FAILURES.join('\n')}`)
})

test('DAS 无序父项 Shift+Tab 只移动自身，所有子任务保持原视觉层级', () => {
  const window = setupDom()
  const item = (type, text, children = [], indent = 0, checked = false) => ({
    type: type === 'taskList' ? 'taskItem' : 'listItem',
    attrs: type === 'taskList' ? { dvnIndentLevel: indent, checked } : { dvnIndentLevel: indent },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...children],
  })
  const list = (type, items) => ({ type, attrs: type === 'orderedList' ? { start: 1 } : {}, content: items })
  const editor = createEditor(window, {
    type: 'doc',
    content: [list('taskList', [item('taskList', 'PRE', [
      list('bulletList', [item('bulletList', 'DSA', [
        list('taskList', [
          item('taskList', 'DASD', [list('taskList', [item('taskList', 'DASDDASDAS', [], 0, true)])], 0, true),
          item('bulletList', 'DAS', [list('taskList', [
            item('taskList', 'DASDASDS', [], 0, true),
            item('taskList', 'WDSADSA', [], 0, true),
            item('taskList', 'EDSS', [], 0, true),
          ])]),
          item('taskList', 'R'),
        ]),
      ])]),
      list('bulletList', [item('bulletList', 'F'), item('bulletList', 'G'), item('bulletList', 'H'), item('bulletList', 'I')]),
    ]), item('taskList', 'J')])],
  })
  const levels = () => Object.fromEntries(listItemSnapshots(editor.state.doc).map((entry) => [entry.text, entry.structuralDepth + entry.indentLevel]))
  editor.chain().focus().setTextSelection(findTextRange(editor, 'DAS').from).run()
  liftActiveListItem(editor)
  assert.deepEqual(levels(), {
    PRE: 0, DSA: 1, DASD: 2, DASDDASDAS: 3,
    DAS: 1, DASDASDS: 3, WDSADSA: 3, EDSS: 3, R: 2,
    F: 1, G: 1, H: 1, I: 1, J: 0,
  }, 'DAS 只降一级，子任务的绝对视觉层级不能被一起带走')
  editor.destroy()
})
