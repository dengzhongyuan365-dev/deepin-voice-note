// SPDX-FileCopyrightText: 2026 UnionTech Software Technology Co., Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// AT 侧视觉列表模型：以真实渲染位置为主，逻辑结构只用于补充列表类型和勾选态。
(() => {
  const root = document.querySelector('.ProseMirror')
  if (!root) throw new Error('ProseMirror missing')

  const ownText = (li) => {
    const p = li.querySelector(':scope > p, :scope > div > p')
    return p ? p.textContent : ''
  }
  const listTypeOf = (li) => {
    const list = li.closest('ul,ol')
    if (!list) return 'plain'
    if (list.matches('ol')) return 'orderedList'
    if (list.getAttribute('data-type') === 'taskList') return 'taskList'
    return 'bulletList'
  }
  const structuralDepthOf = (li) => {
    let depth = 0
    let node = li
    while (node && node !== root) {
      if (node.matches?.('li')) depth += 1
      node = node.parentElement
    }
    return depth
  }

  const snapshot = () => {
    const items = Array.from(root.querySelectorAll('li')).map((li, index) => {
      const own = ownText(li)
      const rect = li.getBoundingClientRect()
      const checkbox = li.querySelector(':scope > label > input')
      const structuralDepth = structuralDepthOf(li)
      const indentAttr = Number(li.dataset.dvnIndentLevel || 0)
      return {
        index,
        text: own,
        left: Math.round(rect.left * 100) / 100,
        top: Math.round(rect.top * 100) / 100,
        type: listTypeOf(li),
        checked: checkbox ? Boolean(checkbox.checked) : null,
        indentAttr,
        structuralDepth,
        declaredLevel: Math.min(3, structuralDepth + indentAttr),
        number: (() => {
          const raw = (getComputedStyle(li).getPropertyValue('--dvn-list-number') || '').replace(/"/g, '')
          return raw ? Number(raw) : null
        })(),
        color: (() => {
          const p = li.querySelector(':scope > p, :scope > div > p')
          if (!p) return ''
          const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
          const textNode = walker.nextNode()
          return getComputedStyle(textNode?.parentElement || p).color
        })(),
      }
    })
    // 不能用“当前出现了几个不同的 left”来聚类层级，也不能用所有 li 的
    // 最小 left 当根基线：当选中文档的所有项都缩进到二级时，最小 left 本身
    // 已经是二级，会把整组误判成一级。顶层列表容器不会随 li 的 margin-left
    // 移动，因此用它作为稳定根基线，再按固定 20px 步长计算绝对视觉层级。
    const listContainerLefts = Array.from(root.querySelectorAll('ul,ol'))
      .map((list) => Math.round(list.getBoundingClientRect().left * 100) / 100)
    const baseLeft = listContainerLefts.length
      ? Math.min(...listContainerLefts)
      : (items.length ? Math.min(...items.map((item) => item.left)) : 0)
    for (const item of items) {
      item.renderedLevel = Math.max(1, Math.min(3, Math.round((item.left - baseLeft) / 20) + 1))
      item.visualLevel = item.renderedLevel
    }
    return items
  }

  const find = (items, text) => {
    const item = items.find((candidate) => candidate.text === text)
    if (!item) throw new Error(`visual item missing: ${text}; snapshot=${JSON.stringify(items)}`)
    return item
  }

  const findElement = (text) => {
    const item = Array.from(root.querySelectorAll('li')).find((candidate) => ownText(candidate) === text)
    if (!item) throw new Error(`visual element missing: ${text}`)
    return item
  }

  // AT 里对具体列表项做真实用户动作：把光标放到该项文本开头，或点击它的
  // 待办勾选框。后续选区扩展仍通过 Home/Shift+Down/Shift+End 等真实键盘完成。
  const focusItem = (text) => {
    const item = findElement(text)
    const textblock = item.querySelector(':scope > p, :scope > div > p')
    if (!textblock) throw new Error(`textblock missing: ${text}`)
    root.focus()
    const walker = document.createTreeWalker(textblock, NodeFilter.SHOW_TEXT)
    const textNode = walker.nextNode()
    if (!textNode) throw new Error(`text node missing: ${text}`)
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  }

  const focusParagraph = (text) => {
    const paragraph = Array.from(root.querySelectorAll('p'))
      .find((candidate) => !candidate.closest('li') && candidate.textContent === text)
    if (!paragraph) throw new Error(`plain paragraph missing: ${text}`)
    root.focus()
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
    const textNode = walker.nextNode()
    if (!textNode) throw new Error(`text node missing: ${text}`)
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  }

  const clickCheckbox = (text) => {
    const item = findElement(text)
    const checkbox = item.querySelector(':scope > label > input')
    if (!checkbox) throw new Error(`task checkbox missing: ${text}`)
    checkbox.click()
    return true
  }

  const assertTextOrder = (expected) => {
    const actual = snapshot().map((item) => item.text).filter(Boolean)
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`text order mismatch: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`)
    }
    return true
  }

  // 文档级文本顺序：包含仍在列表里的项和已经退出列表的普通段落。
  // assertTextOrder 只描述列表视觉模型，不能用它判断“退出列表后文本是否丢失”。
  const assertDocumentTextOrder = (expected) => {
    const actual = Array.from(root.querySelectorAll('p'))
      .map((node) => node.textContent)
      .filter(Boolean)
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`document text order mismatch: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`)
    }
    return true
  }

  // 混合选区 Tab 会给普通段落插入 NBSP 文本缩进。校验“文本顺序没有丢项”
  // 时应忽略这些缩进字符，而不是把正常缩进误判成内容变化。
  const assertDocumentTextOrderIgnoringNbsp = (expected) => {
    const actual = Array.from(root.querySelectorAll('p'))
      .map((node) => node.textContent.replace(/\u00a0/g, ''))
      .filter(Boolean)
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`document text order mismatch (ignoring NBSP): expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`)
    }
    return true
  }

  const assertLevels = (expected) => {
    const items = snapshot()
    for (const [text, level] of Object.entries(expected)) {
      const item = find(items, text)
      if (item.visualLevel !== level || item.declaredLevel !== level) {
        throw new Error(`visual level mismatch for ${text}: expected=${level} rendered=${item.visualLevel} declared=${item.declaredLevel} left=${item.left} structuralDepth=${item.structuralDepth} indentAttr=${item.indentAttr} snapshot=${JSON.stringify(items)}`)
      }
    }
    return true
  }

  const assertSameLevel = (...texts) => {
    const items = snapshot()
    const levels = texts.map((text) => find(items, text).visualLevel)
    const lefts = texts.map((text) => find(items, text).left)
    if (new Set(levels).size !== 1 || Math.max(...lefts) - Math.min(...lefts) > 2) {
      throw new Error(`items should share visual level: texts=${JSON.stringify(texts)} levels=${JSON.stringify(levels)} lefts=${JSON.stringify(lefts)}`)
    }
    return true
  }


  const assertNumbers = (expected) => {
    const items = snapshot()
    for (const [text, number] of Object.entries(expected)) {
      const item = find(items, text)
      if (item.type !== 'orderedList' || item.number !== number) {
        throw new Error(`ordered number mismatch for ${text}: expected=${number} actual=${item.number} snapshot=${JSON.stringify(items)}`)
      }
    }
    return true
  }

  // 颜色断言覆盖整个可见文档：退出列表的普通段落也必须有稳定颜色，
  // 不能因为视觉列表快照只包含 li 就跳过它。
  const colorOfParagraph = (paragraph) => {
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
    const textNode = walker.nextNode()
    return getComputedStyle(textNode?.parentElement || paragraph).color
  }

  const assertColors = (expected) => {
    const items = snapshot()
    for (const [text, color] of Object.entries(expected)) {
      const item = items.find((candidate) => candidate.text === text)
      const paragraphs = Array.from(root.querySelectorAll('p'))
        .filter((paragraph) => paragraph.textContent === text)
      const actual = item?.color || (paragraphs.length ? colorOfParagraph(paragraphs[0]) : undefined)
      if (actual !== color) {
        throw new Error(`color mismatch for ${text}: expected=${color} actual=${actual} snapshot=${JSON.stringify(items)} paragraphs=${JSON.stringify(paragraphs.map((p) => p.outerHTML))}`)
      }
    }
    return true
  }

  const assertChecked = (expected) => {
    const items = snapshot()
    for (const [text, checked] of Object.entries(expected)) {
      const item = find(items, text)
      if (item.checked !== checked) {
        throw new Error(`checked mismatch for ${text}: expected=${checked} actual=${item.checked} snapshot=${JSON.stringify(items)}`)
      }
    }
    return true
  }

  const assertListTypes = (expected) => {
    const items = snapshot()
    for (const [text, type] of Object.entries(expected)) {
      const item = find(items, text)
      if (item.type !== type) {
        throw new Error(`list type mismatch for ${text}: expected=${type} actual=${item.type} snapshot=${JSON.stringify(items)}`)
      }
    }
    return true
  }

  // 全树任务一致性：父项 checked 必须等于“所有直接视觉子任务是否全勾选”。
  // 同时把 ordered/bullet 项纳入缩进栈，因为它们可能成为视觉层级边界。
  const assertTaskConsistency = (skipTexts = []) => {
    const items = snapshot()
    const directChildren = (parentIndex) => {
      const parentDepth = items[parentIndex].visualLevel
      const stack = []
      const children = []
      for (let index = parentIndex + 1; index < items.length; index += 1) {
        const depth = items[index].visualLevel
        if (depth <= parentDepth) break
        while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
        if (!stack.length) children.push(index)
        stack.push({ index, depth })
      }
      return children
    }

    for (let index = 0; index < items.length; index += 1) {
      const parent = items[index]
      if (parent.type !== 'taskList' || parent.checked == null) continue
      if (skipTexts.includes(parent.text)) continue
      const childTasks = directChildren(index)
        .map((childIndex) => items[childIndex])
        .filter((child) => child.type === 'taskList' && child.checked != null)
      if (!childTasks.length) continue
      const expected = childTasks.every((child) => child.checked)
      if (parent.checked !== expected) {
        throw new Error(`task parent consistency failed for ${parent.text}: parent=${parent.checked} children=${JSON.stringify(childTasks.map((child) => [child.text, child.checked]))} snapshot=${JSON.stringify(items)}`)
      }
    }
    return true
  }

  const assertPlainParagraph = (text) => {
    const editor = globalThis.__dvnTiptapEditor
    if (!editor) throw new Error('editor instance missing')
    let found = false
    editor.state.doc.descendants((node, pos) => {
      if (found || !node.isTextblock || node.textContent !== text) return true
      const $pos = editor.state.doc.resolve(pos + 1)
      let inList = false
      for (let depth = 1; depth <= $pos.depth; depth += 1) {
        if (['listItem', 'taskItem'].includes($pos.node(depth).type.name)) inList = true
      }
      found = !inList
      return false
    })
    if (!found) throw new Error(`plain paragraph missing: ${text}`)
    return true
  }

  const assertSelectionEmpty = () => {
    const editor = globalThis.__dvnTiptapEditor
    if (!editor) throw new Error('editor instance missing')
    if (!editor.state.selection.empty) {
      throw new Error(`selection should be empty, actual=${JSON.stringify(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n'))}`)
    }
    return true
  }

  // 校验 ProseMirror 的文本选区仍覆盖预期项，防止缩进/勾选后 DOM 高亮或
  // state.selection 被清空，导致下一次 Tab/Shift+Tab 不再作用原范围。
  const assertSelectionText = (expected) => {
    const editor = globalThis.__dvnTiptapEditor
    if (!editor) throw new Error('editor instance missing')
    const { from, to, empty } = editor.state.selection
    if (empty) throw new Error(`selection disappeared, expected=${expected}`)
    const actual = editor.state.doc.textBetween(from, to, '\n')
      .replace(/[\s\u00a0]/g, '')
    const wanted = String(expected).replace(/[\s\u00a0]/g, '')
    if (actual !== wanted) {
      throw new Error(`selection text mismatch: expected=${wanted} actual=${actual}`)
    }
    return true
  }

  globalThis.__dvnVisual = {
    snapshot,
    assertTextOrder,
    assertDocumentTextOrder,
    assertDocumentTextOrderIgnoringNbsp,
    assertLevels,
    assertSameLevel,
    assertChecked,
    assertListTypes,
    assertSelectionText,
    assertSelectionEmpty,
    assertPlainParagraph,
    assertTaskConsistency,
    assertNumbers,
    assertColors,
    focusItem,
    focusParagraph,
    clickCheckbox,
  }
  return true
})()
