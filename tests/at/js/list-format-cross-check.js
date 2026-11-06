(() => {
  const editor = window.__dvnTiptapEditor
  if (!editor) throw new Error('editor missing')
  const snapshot = () => {
    const rows = []
    editor.state.doc.descendants(node => {
      if (node.type.name !== 'paragraph') return true
      const runs = []
      node.forEach(child => {
        if (child.isText) runs.push({text: child.text, marks: Object.fromEntries(child.marks.map(mark => [mark.type.name, mark.attrs]))})
      })
      const p = document.querySelectorAll('.ProseMirror p')[rows.length]
      if (!p || p.textContent !== node.textContent) throw new Error('paragraph DOM/document mismatch at ' + rows.length)
      rows.push({text: node.textContent, runs,
        rendered: [...p.querySelectorAll('span,strong,em,u')].map(el => ({text:el.textContent, tag:el.tagName, style:el.getAttribute('style')}))})
      return false
    })
    return rows
  }
  const assert = (label, index, text, wanted) => {
    const all = snapshot()
    const row = all[index]
    if (!row || row.text !== text) throw new Error(JSON.stringify({label, index, text, row, all}))
    const marks = row.runs.flatMap(run => Array.from({length:run.text.length}, () => run.marks))
    if (marks.length !== [...text].length) throw new Error(JSON.stringify({label, text, row, marks}))
    for (const [type, expected] of Object.entries(wanted)) {
      for (const [offset, mark] of marks.entries()) {
        const actual = mark[type]
        if (expected === false ? actual !== undefined : !actual || (typeof expected === 'string' && !Object.values(actual).includes(expected))) {
          throw new Error(JSON.stringify({label,index,text,type,expected,actual,offset,row,all}))
        }
      }
    }
    // Check that marked text actually renders inside a corresponding element, not only in model JSON.
    for (const type of ['bold','color','highlight','fontSize','fontFamily','underline']) {
      if (!wanted[type] || wanted[type] === false) continue
      const p = document.querySelectorAll('.ProseMirror p')[index]
      const selector = {bold:'strong',color:'span[style*=color]',highlight:'mark',fontSize:'span[style*=font-size]',fontFamily:'span[style*=font-family]',underline:'u'}[type]
      if (!p.querySelector(selector)) {
        throw new Error(JSON.stringify({label,index,text,type,reason:'mark not rendered',html:p.outerHTML}))
      }
    }
    if (typeof wanted.color === 'string') {
      const element = document.querySelectorAll('.ProseMirror p')[index].querySelector('span[style*=color]')
      const probe = document.createElement('span')
      probe.style.color = wanted.color
      document.body.append(probe)
      const expected = getComputedStyle(probe).color
      probe.remove()
      if (getComputedStyle(element).color !== expected) throw new Error(JSON.stringify({label,type:'color',expected,actual:getComputedStyle(element).color}))
    }
    if (typeof wanted.fontSize === 'string') {
      const element = document.querySelectorAll('.ProseMirror p')[index].querySelector('span[style*=font-size]')
      if (getComputedStyle(element).fontSize !== wanted.fontSize) throw new Error(JSON.stringify({label,type:'fontSize',expected:wanted.fontSize,actual:getComputedStyle(element).fontSize}))
    }
    return {label,index,text,marks:row.runs,rendered:row.rendered}
  }
  const assertPartial = (label, index, text, from, to, spec) => {
    const row = snapshot()[index]
    if (!row || row.text !== text) throw new Error(JSON.stringify({label,index,text,row}))
    const letters = row.runs.flatMap(run => Array.from(run.text, char => ({char,marks:run.marks})))
    if (letters.length !== [...text].length) throw new Error(JSON.stringify({label,row,letters}))
    for (const [type, expected] of Object.entries(spec)) {
      letters.forEach((letter, offset) => {
        const actual = letter.marks[type]
        const selected = offset >= from && offset < to
        if (selected ? !actual || (typeof expected==='string' && !Object.values(actual).includes(expected)) : actual !== undefined) {
          throw new Error(JSON.stringify({label,index,text,offset,type,expected,selected,actual,row}))
        }
      })
    }
    // Verify the rendered DOM per character as well, not just ProseMirror's mark metadata.
    const paragraph = document.querySelectorAll('.ProseMirror p')[index]
    const selectors = {bold:'strong',italic:'em',underline:'u',strike:'s',highlight:'mark',color:'span[style*=color]',fontSize:'span[style*=font-size]',fontFamily:'span[style*=font-family]'}
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
    let offset = 0
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const [type] of Object.entries(spec)) {
        const selector = selectors[type]
        if (!selector) continue
        const rendered = !!node.parentElement?.closest(selector) && paragraph.contains(node.parentElement.closest(selector))
        for (let char = 0; char < [...node.textContent].length; char++) {
          const expected = offset + char >= from && offset + char < to
          if (rendered !== expected) throw new Error(JSON.stringify({label,index,text,type,offset:offset+char,expected,rendered,html:paragraph.outerHTML}))
        }
      }
      offset += [...node.textContent].length
    }
    if (offset !== [...text].length) throw new Error(JSON.stringify({label,index,text,reason:'rendered text mismatch',offset,html:paragraph.outerHTML}))
    return {label,index,text,row}
  }
  window.__dvnFormatCross = {snapshot,assert,assertPartial}
  return true
})()
