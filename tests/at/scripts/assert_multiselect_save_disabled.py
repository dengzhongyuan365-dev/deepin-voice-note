#!/usr/bin/env python3
"""Verify save-as entries are disabled for the selected set containing empty note."""
from __future__ import annotations
import argparse, subprocess, sys, time

YOUQU_ROOT = "/home/dzy/ATUT/youqu-ai"
if YOUQU_ROOT not in sys.path: sys.path.insert(0, YOUQU_ROOT)
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
    try: return [n[i] for i in range(n.childCount)]
    except Exception: return []

def walk(n):
    yield n
    for c in children(n): yield from walk(c)

def app(name0): return DogtailUtils(name0).obj

def find(root, wanted, visible=False):
    for n in walk(root):
        if name(n)==wanted and (not visible or ext(n)): return n
    raise RuntimeError(f"node not found: {wanted}")

def wait(root, wanted, timeout=10, visible=True):
    end=time.time()+timeout; last=None
    while time.time()<end:
        try: return find(root,wanted,visible)
        except Exception as e: last=e; time.sleep(.15)
    raise RuntimeError(str(last))

def enabled(n):
    try:
        st=n.get_state_set()
        from gi.repository import Atspi
        return st.contains(Atspi.StateType.ENABLED) and st.contains(Atspi.StateType.SENSITIVE)
    except Exception:
        try: return bool(n.sensitive)
        except Exception: return False

def rows(a):
    lv=find(a,'NoteItemListView',True); vals=[]
    for n in walk(lv):
        e=ext(n)
        if n is lv or not e or not name(n) or role(n)!='list item': continue
        vals.append((e[1],n))
    return [n for _,n in sorted(vals,key=lambda x:x[0])]

def main():
    p=argparse.ArgumentParser(); p.add_argument('--app',default='deepin-voice-note'); p.add_argument('--timeout',type=float,default=10); a=p.parse_args()
    root=app(a.app)
    rs=rows(root)
    if len(rs)<3: raise RuntimeError(f'need 3 concrete note rows, got {len(rs)}')
    e=ext(rs[0]); subprocess.run(['xdotool','mousemove',str(int(e[0]+e[2]/2)),str(int(e[1]+e[3]/2)),'click','3'],check=True)
    save=wait(root,'保存笔记',a.timeout,True); se=ext(save)
    subprocess.run(['xdotool','mousemove',str(int(se[0]+se[2]/2)),str(int(se[1]+se[3]/2))],check=True); time.sleep(.6)
    states=[]
    for label in ('保存为TXT','保存为HTML'):
        try: states.append((label,enabled(wait(root,label,2,True))))
        except Exception: states.append((label,False))
    if any(v for _,v in states): raise RuntimeError(f'save entries unexpectedly enabled: {states}')
    for label,v in states: print(f'{label}: enabled={v}',flush=True)
    subprocess.run(['xdotool','key','Escape'],check=True)

if __name__=='__main__':
    try: main()
    except Exception as e: print(f'assert_multiselect_save_disabled.py: {e}',file=sys.stderr); raise SystemExit(1)
