(() => {
  const root = document.querySelector('.ProseMirror')
  if (!root) throw new Error('editor missing')
  const paragraphs = () => Array.from(root.querySelectorAll('p'))
  const rows = () => {
    const lists = Array.from(root.querySelectorAll('ul,ol'))
    const base = lists.length ? Math.min(...lists.map(node => node.getBoundingClientRect().left)) : 0
    return paragraphs().map(paragraph => {
      const item = paragraph.closest('li')
      const list = item?.parentElement
      const checkbox = item?.querySelector(':scope > label > input')
      const number = item ? getComputedStyle(item).getPropertyValue('--dvn-list-number').replace(/"/g, '').trim() : ''
      const rawLevel = item ? (item.getBoundingClientRect().left - base) / 20 + 1 : 0
      return {
        text: paragraph.textContent,
        type: !item ? 'plain' : list.tagName === 'OL' ? 'ordered' : checkbox ? 'task' : 'bullet',
        level: Math.round(rawLevel),
        checked: checkbox ? checkbox.checked : null,
        number: list?.tagName === 'OL' && number ? Number(number) : null,
        rawLevel,
      }
    })
  }
  const trace = []
  const checkpoint = (name, expected) => {
    const actual = rows()
    trace.push({name, actual})
    const fail = message => {
      throw new Error(JSON.stringify({checkpoint: name, message, expected, actual, previous: trace.slice(-3), doc: window.__dvnTiptapEditor.getJSON()}))
    }
    if (actual.length !== expected.length) fail('row count changed')
    expected.forEach((row, index) => {
      const wanted = {text: row[0], type: row[1], level: row[2], checked: row[3], number: row[4]}
      for (const key of Object.keys(wanted)) {
        if (actual[index][key] !== wanted[key]) fail(`row ${index} ${key}: expected=${wanted[key]} actual=${actual[index][key]}`)
      }
      if (Math.abs(actual[index].rawLevel - actual[index].level) > 0.12) fail(`row ${index} is between visual levels`)
    })
    return {checkpoint: name, rows: actual}
  }
  window.__dvnJourney = {checkpoint, rows, trace}
  return true
})()
