// SPDX-FileCopyrightText: 2026 UnionTech Software Technology Co., Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { createTiptapExtensions } from '../src/runtime/tiptap-extensions.js'

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


const paragraph = text => ({ type: 'paragraph', content: text ? [{type:'text',text}] : [] })
const list = content => ({type:'taskList',content})
const task = (text, checked, children=[]) => ({type:'taskItem',attrs:{checked},content:[paragraph(text),...children]})
function makeEditor(suffix='A', later='A', childStates=[true,true]) {
  const window=setupDom()
  const element=document.createElement('div'); document.body.appendChild(element)
  const content={type:'doc',content:[list([
    task('ROOT',false,[list([
      task('X'+suffix,childStates.every(Boolean),[
        list([task('P',childStates[0]),task('P2',childStates[1])]),
        {type:'orderedList',attrs:{start:1},content:['O','O2'].map(text=>({type:'listItem',content:[paragraph(text)]}))},
        {type:'bulletList',content:[{type:'listItem',content:[paragraph('U')]}]},
      ]),
      task(later,true,[list([task('Q',true)])]),task('TAIL',false),
    ])]),
  ])]}
  const editor=new Editor({element,extensions:createTiptapExtensions(),content})
  return {editor,window}
}
function tasks(editor) {
  const result=[]
  editor.state.doc.descendants((node,pos)=>{if(node.type.name==='taskItem')result.push({pos,text:node.firstChild.textContent,checked:node.attrs.checked})})
  return result
}
function split(editor,window) {
  const target=tasks(editor)[1]
  editor.commands.setTextSelection(target.pos+3) // first text character X, followed by caret
  editor.view.dispatch(closeHistory(editor.state.tr))
  editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))
}
function click(editor,window,index,checked) {
  const input=editor.view.dom.querySelectorAll('input[type=checkbox]')[index]
  input.checked=checked
  input.dispatchEvent(new window.Event('change',{bubbles:true}))
}
for (const [suffix,later] of [['A','A'],['A','a'],['待办','待办'],['',''],['🙂','🙂']]) {
  for (const childStates of [[true,true],[true,false],[false,false]]) {
    test(`split ${JSON.stringify(suffix)} / existing ${JSON.stringify(later)} preserves ${childStates} and computes new parent`,()=>{
      const {editor,window}=makeEditor(suffix,later,childStates)
      const before=editor.getJSON()
      split(editor,window)
      const after=tasks(editor)
      assert.deepEqual(after.map(x=>x.text),['ROOT','X',suffix,'P','P2',later,'Q','TAIL'])
      assert.deepEqual(after.slice(3,5).map(x=>x.checked),childStates)
      assert.equal(after[2].checked,childStates.every(Boolean))
      assert.deepEqual(after.slice(5,7).map(x=>x.checked),[true,true])
      const splitDoc=editor.getJSON()
      assert.equal(editor.commands.undo(),true);assert.deepEqual(editor.getJSON(),before)
      assert.equal(editor.commands.redo(),true);assert.deepEqual(editor.getJSON(),splitDoc)
      editor.commands.setContent(splitDoc);assert.deepEqual(editor.getJSON(),splitDoc)
      editor.destroy()
    })
  }
}
test('checkbox explicit intent cascades only its branch; child completion bubbles up; undo/redo restores exactly',()=>{
  const {editor,window}=makeEditor()
  split(editor,window)
  const before=editor.getJSON()
  editor.view.dispatch(closeHistory(editor.state.tr))
  click(editor,window,2,false)
  assert.deepEqual(tasks(editor).map(x=>x.checked),[false,true,false,false,false,true,true,false])
  const cancelled=editor.getJSON()
  editor.commands.undo();assert.deepEqual(editor.getJSON(),before)
  editor.commands.redo();assert.deepEqual(editor.getJSON(),cancelled)
  click(editor,window,3,true);assert.equal(tasks(editor)[2].checked,false)
  click(editor,window,4,true);assert.equal(tasks(editor)[2].checked,true)
  click(editor,window,5,false)
  assert.deepEqual(tasks(editor).map(x=>x.checked),[false,true,true,true,true,false,false,false])
  editor.destroy()
})
test('raw attribute edit is not a checkbox intent and cannot uncheck existing children',()=>{
  const {editor}=makeEditor()
  const parent=tasks(editor)[1]
  editor.view.dispatch(editor.state.tr.setNodeMarkup(parent.pos,undefined,{...editor.state.doc.nodeAt(parent.pos).attrs,checked:false}))
  assert.deepEqual(tasks(editor).slice(1,4).map(x=>x.checked),[true,true,true])
  editor.destroy()
})
test('checkbox readonly behavior remains upstream-controlled',()=>{
  const {editor,window}=makeEditor()
  const before=editor.getJSON();editor.setEditable(false)
  click(editor,window,1,false)
  assert.deepEqual(editor.getJSON(),before)
  assert.equal(editor.view.dom.querySelectorAll('input')[1].checked,true)
  editor.destroy()
})
test('explicit command maps its target across later insertion in the same chain',()=>{
  const {editor}=makeEditor()
  const pos=tasks(editor)[1].pos
  editor.chain().setTaskChecked(false,pos).insertContentAt(0,paragraph('prefix')).run()
  assert.deepEqual(tasks(editor).slice(1,4).map(x=>x.checked),[false,false,false])
  assert.deepEqual(tasks(editor).slice(4,6).map(x=>x.checked),[true,true])
  editor.destroy()
})

test('Enter after a completed leaf creates an unchecked leaf and invalidates only its parent',()=>{
  const {editor,window}=makeEditor()
  const leaf=tasks(editor)[3] // P2, below XA
  editor.commands.setTextSelection(leaf.pos+2+leaf.text.length)
  editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))
  assert.deepEqual(tasks(editor).map(x=>[x.text,x.checked]),[
    ['ROOT',false],['XA',false],['P',true],['P2',true],['',false],['A',true],['Q',true],['TAIL',false],
  ])
  editor.destroy()
})

test('deleted explicit checkbox target does not cascade onto the next task',()=>{
  const {editor}=makeEditor()
  const parent=tasks(editor)[1]
  const size=editor.state.doc.nodeAt(parent.pos).nodeSize
  editor.chain().setTaskChecked(false,parent.pos).deleteRange({from:parent.pos,to:parent.pos+size}).run()
  assert.deepEqual(tasks(editor).map(x=>[x.text,x.checked]),[['ROOT',false],['A',true],['Q',true],['TAIL',false]])
  editor.destroy()
})
