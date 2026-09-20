#!/usr/bin/env python3
"""Create five notes and enter multi-select state without desktop-wide scans."""
from __future__ import annotations

import argparse
import subprocess
import sys
import time

try:
    from src.dogtail_utils import DogtailUtils
except ModuleNotFoundError:
    root = "/home/dzy/ATUT/youqu-ai"
    if root not in sys.path:
        sys.path.insert(0, root)
    from src.dogtail_utils import DogtailUtils


def name(node):
    try: return node.name or ""
    except Exception: return ""


def role(node):
    try: return node.roleName or ""
    except Exception: return ""


def ext(node):
    try:
        value = node.extents
        return value if value and value[2] > 0 and value[3] > 0 else None
    except Exception:
        return None


def children(node):
    try: return list(node.children)
    except Exception: return []


def walk(node, depth=0):
    yield node
    if depth >= 6: return
    for child in children(node):
        yield from walk(child, depth + 1)


def find(dog, wanted, visible=True):
    nodes = dog.find_elements_by_attr(f"$//{wanted}/") or []
    for node in nodes:
        if not visible or ext(node): return node
    raise RuntimeError(f"node not found: {wanted}")


def wait(dog, wanted, timeout, visible=True):
    end = time.time() + timeout; last = None
    while time.time() < end:
        try: return find(dog, wanted, visible)
        except Exception as exc: last = exc; time.sleep(.1)
    raise RuntimeError(str(last) if last else f"timeout waiting {wanted}")


def press(node):
    actions = getattr(node, "actions", {}) or {}
    for action in ("Press", "Click", "Activate"):
        try:
            if action in actions:
                node.doActionNamed(action); return
        except Exception:
            continue
    try:
        node.click(); return
    except Exception:
        pass
    e = ext(node)
    if not e: raise RuntimeError(f"node not visible: {name(node)}")
    click(e)


def click(e, modifiers=()):
    x, y = int(e[0] + e[2] / 2), int(e[1] + e[3] / 2)
    for key in modifiers: subprocess.run(["xdotool", "keydown", key], check=True)
    try: subprocess.run(["xdotool", "mousemove", str(x), str(y), "click", "1"], check=True)
    finally:
        for key in reversed(tuple(modifiers)): subprocess.run(["xdotool", "keyup", key], check=True)
    time.sleep(.3)


def rows(dog):
    lv = find(dog, "NoteItemListView")
    lvext = ext(lv); result=[]
    for node in walk(lv):
        if node is lv or role(node) != "list item" or not name(node): continue
        e=ext(node)
        if not e: continue
        if lvext and not (lvext[0] <= e[0] < lvext[0]+lvext[2] and lvext[1] <= e[1] < lvext[1]+lvext[3]): continue
        if e[2] >= 40 and e[3] >= 20: result.append((e[1],e[0],node))
    result.sort(key=lambda x:(x[0],x[1]))
    out=[]; seen=set()
    for y,_x,node in result:
        bucket=int(y/8)
        if bucket not in seen: seen.add(bucket); out.append(node)
    return out


def main():
    p=argparse.ArgumentParser(); p.add_argument('--app',default='deepin-voice-note'); p.add_argument('--timeout',type=float,default=10); a=p.parse_args()
    dog=DogtailUtils(a.app)
    new=wait(dog,'NewNoteButton',a.timeout)
    for _ in range(5): press(new); time.sleep(.4)
    end=time.time()+a.timeout; items=[]
    while time.time()<end:
        items=rows(dog)
        if len(items)>=5: break
        time.sleep(.2)
    if len(items)<5: raise RuntimeError(f"need at least five visible note items, got {len(items)}")
    click(ext(items[0])); click(ext(items[2]), ('Control_L',)); click(ext(items[4]), ('Shift_L',))
    wait(dog,'MultipleChoicesView',a.timeout)
    return 0

if __name__=='__main__':
    try: raise SystemExit(main())
    except Exception as exc: print(f"multi_select_five_notes.py: {exc}",file=sys.stderr); raise SystemExit(1)
