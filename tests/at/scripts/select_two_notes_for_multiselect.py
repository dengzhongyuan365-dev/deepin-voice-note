#!/usr/bin/env python3
"""Select two concrete visible note rows using runtime AT-SPI extents."""
from __future__ import annotations

import argparse
import subprocess
import sys
import time

try:
    from src.dogtail_utils import DogtailUtils
except ModuleNotFoundError:
    root = "/home/dzy/ATUT/youqu-ai"
    if root not in sys.path: sys.path.insert(0, root)
    from src.dogtail_utils import DogtailUtils


def name(n):
    try: return n.name or ""
    except Exception: return ""

def role(n):
    try: return n.roleName or ""
    except Exception: return ""

def ext(n):
    try:
        e=n.extents
        return e if e and e[2]>0 and e[3]>0 else None
    except Exception: return None

def children(n):
    try: return list(n.children)
    except Exception: return []

def walk(n, depth=0):
    yield n
    if depth >= 6: return
    for c in children(n): yield from walk(c, depth+1)

def find(dog,wanted,visible=True):
    ns=dog.find_elements_by_attr(f"$//{wanted}/") or []
    for n in ns:
        if not visible or ext(n): return n
    raise RuntimeError(f"node not found: {wanted}")

def wait(dog,wanted,timeout,visible=True):
    end=time.time()+timeout; last=None
    while time.time()<end:
        try:return find(dog,wanted,visible)
        except Exception as e:last=e;time.sleep(.1)
    raise RuntimeError(str(last) if last else f"timeout waiting {wanted}")

def rows(dog):
    lv=find(dog,'NoteItemListView'); le=ext(lv); found=[]
    for n in walk(lv):
        if n is lv or role(n)!='list item' or not name(n): continue
        e=ext(n)
        if not e: continue
        if le and not (le[0] <= e[0] < le[0]+le[2] and le[1] <= e[1] < le[1]+le[3]): continue
        if e[2]>=40 and e[3]>=20: found.append((e[1],e[0],n))
    found.sort(key=lambda x:(x[0],x[1])); out=[];seen=set()
    for y,_x,n in found:
        b=int(y/8)
        if b not in seen:seen.add(b);out.append(n)
    return out

def click(e,shift=False):
    x=int(e[0]+e[2]/2);y=int(e[1]+e[3]/2)
    if shift: subprocess.run(['xdotool','keydown','Shift_L'],check=True)
    try: subprocess.run(['xdotool','mousemove',str(x),str(y),'click','1'],check=True)
    finally:
        if shift: subprocess.run(['xdotool','keyup','Shift_L'],check=True)
    time.sleep(.5)

def press(n):
    actions=getattr(n,'actions',{}) or {}
    for a in ('Press','Click','Activate'):
        try:
            if a in actions:n.doActionNamed(a);return
        except Exception:continue
    try:n.click();return
    except Exception:pass
    e=ext(n)
    if not e:raise RuntimeError(f'not visible: {name(n)}')
    click(e)

def main():
    p=argparse.ArgumentParser();p.add_argument('--app',default='deepin-voice-note');p.add_argument('--timeout',type=float,default=10);p.add_argument('--existing',action='store_true');a=p.parse_args()
    dog=DogtailUtils(a.app)
    if not a.existing:
        new=wait(dog,'NewNoteButton',a.timeout);press(new);time.sleep(.5);press(new);time.sleep(.8)
    end=time.time()+a.timeout; items=[]
    while time.time()<end:
        items=rows(dog)
        if len(items)>=2:break
        time.sleep(.2)
    if len(items)<2:raise RuntimeError(f'need at least two visible note items, got {len(items)}')
    click(ext(items[0]));click(ext(items[1]),shift=True)
    wait(dog,'MultipleChoicesView',a.timeout)
    return 0
if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as e:print(f'select_two_notes_for_multiselect.py: {e}',file=sys.stderr);raise SystemExit(1)
