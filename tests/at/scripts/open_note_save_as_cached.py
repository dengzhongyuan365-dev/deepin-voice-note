#!/usr/bin/env python3
"""Open 保存笔记 from a real selected note and trigger one export item.

The row coordinate is only the runtime coordinate captured by the selection
helper. Menu navigation is semantic: locate 保存笔记 and the requested child
through the running application's AT-SPI tree. Do not use fixed Down counts;
Qt Quick menus can omit disabled entries and otherwise route the key to 删除
or 新建笔记.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

CACHE = "/tmp/deepin_voice_note_multiselect_rows.json"
YOUQU_ROOT = "/home/dzy/ATUT/youqu-ai"
if YOUQU_ROOT not in sys.path:
    sys.path.insert(0, YOUQU_ROOT)
from src.dogtail_utils import DogtailUtils


def _ext(node):
    try:
        ext = node.extents
        if ext and ext[2] > 0 and ext[3] > 0:
            return ext
    except Exception:
        pass
    return None


def _click(x: int, y: int, button: int = 1):
    subprocess.run(
        ["xdotool", "mousemove", str(x), str(y), "click", str(button)],
        check=True,
    )


def _screenshot(path: str):
    if os.environ.get("DEBUG_MENU"):
        subprocess.run(["scrot", path], check=False)
        print(f"screenshot: {path}", flush=True)


def _find_visible(dog, name: str):
    found = dog.find_elements_by_attr(f"$//{name}/")
    for node in found or []:
        if _ext(node) is not None:
            return node
    return None


def _wait_visible(dog, name: str, timeout: float):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            node = _find_visible(dog, name)
            if node is not None:
                return node
        except Exception as exc:
            last = exc
        time.sleep(0.1)
    raise RuntimeError(f"timeout waiting visible menu item {name}: {last}")


def _set_focus(node):
    actions = getattr(node, "actions", {})
    if "SetFocus" in actions:
        node.doActionNamed("SetFocus")
        return
    try:
        node.grabFocus()
    except Exception:
        pass


def _press(node):
    actions = getattr(node, "actions", {})
    for action in ("Press", "Click", "Activate"):
        if action in actions:
            node.doActionNamed(action)
            return
    ext = _ext(node)
    if ext is None:
        raise RuntimeError("menu item has no visible extents")
    _click(int(ext[0] + ext[2] / 2), int(ext[1] + ext[3] / 2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("target", choices=["保存为TXT", "保存为HTML"])
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()

    deadline = time.time() + args.timeout
    rows = None
    while time.time() < deadline:
        try:
            with open(CACHE, encoding="utf-8") as f:
                rows = json.load(f)
            if rows:
                break
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    if not rows:
        raise RuntimeError("runtime row cache not found")

    subprocess.run(
        "xdotool search --name '^deepin-voice-note$' windowactivate --sync",
        shell=True,
        check=False,
    )
    x, y = map(int, rows[0])
    _click(x, y, 3)  # 真实已选中笔记条目
    time.sleep(0.8)
    _screenshot("/tmp/deepin-voice-note-menu-1-context.png")

    dog = DogtailUtils("deepin-voice-note")
    try:
        save_note = _wait_visible(dog, "保存笔记", min(args.timeout, 2.0))
        save_ext = _ext(save_note)
        if save_ext is None:
            raise RuntimeError("保存笔记 has no visible extents")

        # Prefer the semantic menu item when the refreshed AT-SPI tree is ready.
        _set_focus(save_note)
        subprocess.run(
            ["xdotool", "mousemove", str(int(save_ext[0] + save_ext[2] / 2)), str(int(save_ext[1] + save_ext[3] / 2))],
            check=True,
        )
        subprocess.run(["xdotool", "key", "Right"], check=True)
        time.sleep(0.8)
    except Exception as exc:
        # After a native folder dialog closes, the visible Qt Quick menu can be
        # present while the old AT-SPI object tree still lacks its extents.
        # Use the same real row's runtime anchor and click the visible menu
        # item; this avoids all ordinal keyboard navigation (especially Delete
        # and New note).  The offsets are relative to this invocation's row,
        # not fixed desktop coordinates.
        print(f"semantic menu refresh delayed, using runtime menu anchor: {exc}", flush=True)
        menu_x = x + 95
        menu_y = y + 84
        _click(menu_x, menu_y)
        time.sleep(0.8)
    _screenshot("/tmp/deepin-voice-note-menu-2-save-submenu.png")

    try:
        target = _wait_visible(dog, args.target, min(args.timeout, 2.0))
        _press(target)
    except Exception as exc:
        print(f"semantic submenu refresh delayed, using runtime submenu anchor: {exc}", flush=True)
        # Save as HTML is the first child; Save as TXT is the second child.
        target_y = y + (84 if args.target == "保存为HTML" else 114)
        _click(x + 240, target_y)
    time.sleep(0.8)
    _screenshot("/tmp/deepin-voice-note-menu-3-file-dialog.png")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"open_note_save_as_cached.py: {exc}", file=sys.stderr)
        raise SystemExit(1)
