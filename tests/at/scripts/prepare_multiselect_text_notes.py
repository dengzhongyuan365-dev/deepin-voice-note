#!/usr/bin/env python3
"""Create/select the note sets required by save_exp_003.

Uses YouQu's dogtail resolver instead of scanning the raw desktop with gi
Atspi; the latter can block on stale desktop entries on this host.  This
helper only performs UI actions: it creates an empty note and Shift-selects
visible concrete note rows.  It never types text and never opens menus.
"""
from __future__ import annotations
import argparse, subprocess, sys, time

YOUQU_ROOT = "/home/dzy/ATUT/youqu-ai"
if YOUQU_ROOT not in sys.path:
    sys.path.insert(0, YOUQU_ROOT)
from src.dogtail_utils import DogtailUtils


def name(n):
    try: return n.name or ""
    except Exception: return ""


def role(n):
    try: return n.roleName or ""
    except Exception: return ""


def ext(n):
    try:
        e = n.extents
        return e if e and e[2] > 0 and e[3] > 0 else None
    except Exception: return None


def children(n):
    try: return [n[i] for i in range(n.childCount)]
    except Exception: return []


def walk(n):
    yield n
    for c in children(n): yield from walk(c)


def find(root, wanted):
    for n in walk(root):
        if name(n) == wanted: return n
    raise RuntimeError(f"node not found: {wanted}")


def app(name0): return DogtailUtils(name0).obj


def wait_node(app_name, wanted, timeout):
    end = time.time() + timeout; last = None
    while time.time() < end:
        try: return find(app(app_name), wanted)
        except Exception as e: last = e; time.sleep(.15)
    raise RuntimeError(str(last))


def rows(a):
    lv = find(a, "NoteItemListView"); vals=[]
    for n in walk(lv):
        e=ext(n)
        if n is lv or not e or not name(n) or role(n) != "list item": continue
        vals.append((e[1], n))
    return [n for _, n in sorted(vals, key=lambda x:x[0])]


def click(e, shift=False):
    x=int(e[0]+e[2]/2); y=int(e[1]+e[3]/2)
    if shift: subprocess.run(["xdotool","keydown","Shift_L"],check=True)
    try: subprocess.run(["xdotool","mousemove",str(x),str(y),"click","1"],check=True)
    finally:
        if shift: subprocess.run(["xdotool","keyup","Shift_L"],check=True)
    time.sleep(.5)


def press(n):
    try:
        for i in range(n.get_n_actions()):
            if (n.get_action_name(i) or "").lower() in {"press","click","activate"}:
                n.do_action(i); time.sleep(.5); return
    except Exception: pass
    e=ext(n)
    if not e: raise RuntimeError(f"not visible: {name(n)}")
    click(e)


def select_range(app_name, count, timeout):
    a=app(app_name); rs=rows(a)
    if len(rs)<count: raise RuntimeError(f"need {count} note rows, got {len(rs)}")
    click(ext(rs[0])); click(ext(rs[count-1]), shift=True)
    wait_node(app_name, "MultipleChoicesView", timeout)


def main():
    p=argparse.ArgumentParser(); p.add_argument('--app',default='deepin-voice-note'); p.add_argument('--add-empty',action='store_true'); p.add_argument('--timeout',type=float,default=10); p.add_argument('--count',type=int,default=2); a=p.parse_args()
    if a.add_empty:
        press(wait_node(a.app, 'NewNoteButton', a.timeout)); time.sleep(1)
        select_range(a.app, 3, a.timeout)
        print('created empty note and selected three concrete note rows', flush=True)
    else:
        select_range(a.app, a.count, a.timeout)
        print(f'selected {a.count} concrete note rows', flush=True)


if __name__ == '__main__':
    try: main()
    except Exception as e: print(f'prepare_multiselect_text_notes.py: {e}', file=sys.stderr); raise SystemExit(1)
