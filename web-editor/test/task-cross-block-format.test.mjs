// SPDX-FileCopyrightText: 2026 UnionTech Software Technology Co., Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import { Editor } from '@tiptap/core'
import { createTiptapExtensions } from '../src/runtime/tiptap-extensions.js'
import { normalizeTaskParentCheckedStates } from '../src/runtime/task-list-cascade.js'

function setup() {
  const window = new Window()
  for (const [key, value] of Object.entries({
    window, document: window.document, navigator: window.navigator,
    Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
    DocumentFragment: window.DocumentFragment, Event: window.Event,
    KeyboardEvent: window.KeyboardEvent, CustomEvent: window.CustomEvent,
    MutationObserver: window.MutationObserver,
  })) Object.defineProperty(globalThis, key, {value, writable:true, configurable:true})
  globalThis.getComputedStyle = window.getComputedStyle.bind(window)
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
  const element = window.document.createElement('div')
  window.document.body.append(element)
  return {window, element}
}
const text = (value, marks) => ({type:'paragraph',content:[{type:'text',text:value,...(marks ? {marks} : {})}]})
const item = (name, checked, indent=0, children=[]) => ({
  type:'taskItem',attrs:{checked,dvnIndentLevel:indent},content:[text(name),...children],
})
const list = items => ({type:'taskList',content:items})
const ancestor = list([item('ROOT',true,0,[list([item('A',true,0,[list([item('P2',true)])])])])])
const separated = list([item('O',false,2)])
function editorFor(content) {
  const {window,element}=setup()
  return {window,editor:new Editor({element,extensions:createTiptapExtensions(),content:{type:'doc',content}})}
}
function taskStates(doc) {
  const result=[]
  doc.descendants(node => {
    if(node.type.name==='taskItem') result.push([node.firstChild.textContent,node.attrs.checked])
  })
  return result
}

test('adjacent top-level task blocks rejoin visual parents, plain paragraph remains a hard boundary', () => {
  const {editor}=editorFor([ancestor,separated])
  const tr=editor.state.tr
  assert.equal(normalizeTaskParentCheckedStates(tr),true)
  assert.deepEqual(taskStates(tr.doc),[['ROOT',false],['A',false],['P2',true],['O',false]])
  editor.destroy()

  const withPlain=editorFor([ancestor,text('O'),separated]).editor
  const splitTr=withPlain.state.tr
  assert.equal(normalizeTaskParentCheckedStates(splitTr),false)
  assert.deepEqual(taskStates(splitTr.doc),[['ROOT',true],['A',true],['P2',true],['O',false]])
  withPlain.destroy()

  // 邻接列表如果新块从一级开始，不能把它误接到上一个待办子树。
  const independent=editorFor([ancestor,list([item("O",false,0)])]).editor
  const independentTr=independent.state.tr
  assert.equal(normalizeTaskParentCheckedStates(independentTr),false)
  assert.deepEqual(taskStates(independentTr.doc),[["ROOT",true],["A",true],["P2",true],["O",false]])
  independent.destroy()
})

test('completed formatted task Enter preserves typing marks while parent check states recalculate', () => {
  const marks=[{type:'bold'},{type:'highlight',attrs:{color:'rgb(251, 212, 0)'}}]
  const content=list([item('ROOT',true,0,[list([item('A',true,0,[list([
    {type:'taskItem',attrs:{checked:true,dvnIndentLevel:0},content:[text('P2',marks)]},
  ])])])])])
  const {editor,window}=editorFor([content])
  let end=null
  editor.state.doc.descendants((node,pos)=>{if(node.isText && node.text==='P2')end=pos+2})
  assert.ok(end)
  editor.commands.setTextSelection(end)
  editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))
  assert.deepEqual(taskStates(editor.state.doc),[['ROOT',false],['A',false],['P2',true],['',false]])
  assert.deepEqual(editor.state.storedMarks?.map(mark => mark.type.name).sort(),['bold','highlight'])
  editor.commands.insertContent('P3')
  let newMarks=null
  editor.state.doc.descendants(node=>{if(node.isText && node.text==='P3')newMarks=node.marks.map(mark=>mark.type.name).sort()})
  assert.deepEqual(newMarks,['bold','highlight'])
  editor.destroy()
})

test('Enter on an empty third-level task moves to second level without resetting active text marks', () => {
  const marks=[{type:'bold'},{type:'highlight',attrs:{color:'rgb(251, 212, 0)'}}]
  const content=list([item('ROOT',true,0,[list([item('A',true,0,[list([
    {type:'taskItem',attrs:{checked:true,dvnIndentLevel:0},content:[text('P2',marks)]},
  ])])])])])
  const {editor,window}=editorFor([content])
  let end=null
  editor.state.doc.descendants((node,pos)=>{if(node.isText && node.text==='P2')end=pos+2})
  editor.commands.setTextSelection(end)
  const enter=() => editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))
  enter()
  editor.commands.insertContent('P3')
  enter() // 新建空的三级待办
  assert.deepEqual(editor.state.storedMarks?.map(mark=>mark.type.name).sort(),['bold','highlight'])
  enter() // 空待办下沉为视觉二级，不应当改变下一次输入的格式
  assert.deepEqual(editor.state.storedMarks?.map(mark=>mark.type.name).sort(),['bold','highlight'])
  editor.commands.insertContent('NEXT')
  let nextMarks=null
  editor.state.doc.descendants(node=>{if(node.isText && node.text==='NEXT')nextMarks=node.marks.map(mark=>mark.type.name).sort()})
  assert.deepEqual(nextMarks,['bold','highlight'])
  editor.destroy()
})

test('empty third-level item with visual-only indent keeps typing marks when Enter moves it to second level', () => {
  const marks=[{type:'bold'},{type:'highlight',attrs:{color:'rgb(251, 212, 0)'}}]
  const {editor,window}=editorFor([list([
    {type:'taskItem',attrs:{checked:false,dvnIndentLevel:2},content:[text('P2',marks)]},
  ])])
  let end=null
  editor.state.doc.descendants((node,pos)=>{if(node.isText && node.text==='P2')end=pos+2})
  editor.commands.setTextSelection(end)
  const enter=() => editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))
  enter()
  assert.deepEqual(editor.state.storedMarks?.map(mark=>mark.type.name).sort(),['bold','highlight'])
  enter()
  assert.deepEqual(editor.state.storedMarks?.map(mark=>mark.type.name).sort(),['bold','highlight'])
  editor.commands.insertContent('NEXT')
  let nextMarks=null
  editor.state.doc.descendants(node=>{if(node.isText && node.text==='NEXT')nextMarks=node.marks.map(mark=>mark.type.name).sort()})
  assert.deepEqual(nextMarks,['bold','highlight'])
  editor.destroy()
})

test('Shift-Tab outdent of an empty third-level task also retains explicit typing marks', () => {
  const marks=[{type:'bold'},{type:'highlight',attrs:{color:'rgb(251, 212, 0)'}}]
  const content=list([item('ROOT',true,0,[list([item('A',true,0,[list([
    {type:'taskItem',attrs:{checked:true,dvnIndentLevel:0},content:[text('P2',marks)]},
  ])])])])])
  const {editor,window}=editorFor([content])
  let end=null
  editor.state.doc.descendants((node,pos)=>{if(node.isText && node.text==='P2')end=pos+2})
  editor.commands.setTextSelection(end)
  editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))
  assert.deepEqual(editor.state.storedMarks?.map(mark=>mark.type.name).sort(),['bold','highlight'])
  editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}))
  assert.deepEqual(editor.state.storedMarks?.map(mark=>mark.type.name).sort(),['bold','highlight'])
  editor.destroy()
})

test('Tab indent of an empty formatted task keeps active typing marks', () => {
  const marks=[{type:'bold'},{type:'highlight',attrs:{color:'rgb(251, 212, 0)'}}]
  const {editor,window}=editorFor([list([
    {type:'taskItem',attrs:{checked:false,dvnIndentLevel:1},content:[text('P2',marks)]},
  ])])
  let end=null
  editor.state.doc.descendants((node,pos)=>{if(node.isText && node.text==='P2')end=pos+2})
  editor.commands.setTextSelection(end)
  editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))
  assert.deepEqual(editor.state.storedMarks?.map(mark=>mark.type.name).sort(),['bold','highlight'])
  editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}))
  assert.deepEqual(editor.state.storedMarks?.map(mark=>mark.type.name).sort(),['bold','highlight'])
  editor.destroy()
})
