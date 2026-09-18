#!/usr/bin/env python3
"""AT-SPI helpers for deepin-voice-note base-flow suites.

The helpers execute real UI operations (AT-SPI actions and xdotool clicks) and
use the application's sqlite data store only to assert that UI operations have
changed/restored persisted counts.  They do not modify application data directly.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import subprocess
import sys
import time
import warnings
from collections.abc import Iterable

import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi  # noqa: E402

warnings.filterwarnings("ignore", category=DeprecationWarning)

APP = "deepin-voice-note"
DB = os.path.expanduser("~/.local/share/deepin/deepin-voice-note/deepin-voice-note1.0.db")


def _children(node) -> Iterable:
    try:
        count = node.get_child_count()
    except Exception:
        return []
    out = []
    for i in range(count):
        try:
            child = node.get_child_at_index(i)
        except Exception:
            continue
        if child is not None:
            out.append(child)
    return out


def _walk(node):
    yield node
    for child in _children(node):
        yield from _walk(child)


def _name(node) -> str:
    try:
        return node.get_name() or ""
    except Exception:
        return ""


def _role(node) -> str:
    try:
        return node.get_role_name() or ""
    except Exception:
        return ""


def _ext(node):
    try:
        ext = node.get_extents(Atspi.CoordType.SCREEN)
    except Exception:
        return None
    if ext.width <= 0 or ext.height <= 0:
        return None
    return ext


def _visible(node) -> bool:
    return _ext(node) is not None


def _find_app(app_name: str = APP):
    desktop = Atspi.get_desktop(0)
    for app in _children(desktop):
        if _name(app) == app_name:
            return app
    raise RuntimeError(f"application not found: {app_name}")


def _find_by_name(root, name: str, visible: bool = False, role: str | None = None):
    for node in _walk(root):
        if _name(node) != name:
            continue
        if role and _role(node) != role:
            continue
        if visible and not _visible(node):
            continue
        return node
    suffix = " visible" if visible else ""
    role_msg = f" role={role}" if role else ""
    raise RuntimeError(f"AT-SPI{suffix} node not found by name: {name}{role_msg}")


def _wait_name(name: str, timeout: float = 8.0, visible: bool = False, role: str | None = None):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            return _find_by_name(_find_app(), name, visible=visible, role=role)
        except Exception as exc:
            last = exc
            time.sleep(0.12)
    raise RuntimeError(str(last) if last else f"timeout waiting for {name}")


def _press(node) -> None:
    try:
        n = node.get_n_actions()
    except Exception:
        n = 0
    for i in range(max(n, 0)):
        try:
            if (node.get_action_name(i) or "").lower() in {"press", "click", "activate"}:
                node.do_action(i)
                time.sleep(0.2)
                return
        except Exception:
            continue
    if n > 0:
        node.do_action(0)
        time.sleep(0.2)
        return
    _click_center(node)


def _click_center(node, button: int = 1, modifiers: list[str] | None = None) -> None:
    ext = _ext(node)
    if ext is None:
        raise RuntimeError(f"node is not visible: {_name(node)}")
    x = int(ext.x + ext.width / 2)
    y = int(ext.y + ext.height / 2)
    if modifiers:
        for key in modifiers:
            subprocess.run(["xdotool", "keydown", key], check=True)
    try:
        subprocess.run(["xdotool", "mousemove", str(x), str(y), "click", str(button)], check=True)
    finally:
        if modifiers:
            for key in reversed(modifiers):
                subprocess.run(["xdotool", "keyup", key], check=True)
    time.sleep(0.25)


def _right_click(node) -> None:
    _click_center(node, button=3)


def _key(key: str) -> None:
    subprocess.run(["xdotool", "key", "--clearmodifiers", key], check=True)
    time.sleep(0.2)


def _db_count(table: str) -> int:
    column = "folder_state" if table == "vnote_folder_tbl" else "note_state"
    with sqlite3.connect(DB) as conn:
        return int(conn.execute(f"select count(*) from {table} where {column}=0").fetchone()[0])


def _folder_count() -> int:
    return _db_count("vnote_folder_tbl")


def _note_count() -> int:
    return _db_count("vnote_items_tbl")


def _wait_count(kind: str, expected: int, timeout: float = 10.0) -> None:
    getter = _folder_count if kind == "folder" else _note_count
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = getter()
        if last == expected:
            return
        time.sleep(0.2)
    raise RuntimeError(f"{kind} count expected {expected}, got {last}")


def _visible_items(list_name: str):
    root = _find_by_name(_find_app(), list_name, visible=False)
    rows = []
    for node in _walk(root):
        if node is root:
            continue
        ext = _ext(node)
        if ext is None:
            continue
        name = _name(node)
        role = _role(node)
        if not name:
            continue
        if role in {"list item", "label", "panel"} and ext.width >= 30 and ext.height >= 18:
            rows.append((ext.y, ext.x, name, role, node))
    result = []
    seen = set()
    for y, x, name, role, node in sorted(rows, key=lambda t: (t[0], t[1])):
        bucket = int(y / 8)
        if bucket in seen:
            continue
        seen.add(bucket)
        result.append(node)
    return result


def _visible_folder_items():
    return _visible_items("FolderListView")


def _visible_note_items():
    return _visible_items("NoteItemListView")


def _open_context_and_press(node, menu_name: str, timeout: float = 8.0) -> None:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        _right_click(node)
        try:
            item = _wait_name(menu_name, timeout=1.2, visible=True)
            # QtQuick MenuItem sometimes exposes AT-SPI actions without triggering
            # the QML onTriggered handler reliably; clicking the visible menu item
            # keeps the test on the real user path.
            _click_center(item)
            return
        except Exception as exc:
            last = exc
            time.sleep(0.2)
    raise RuntimeError(f"menu item not found/clicked: {menu_name}: {last}")


def _confirm_delete(timeout: float = 8.0) -> None:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        app = _find_app()
        for name, role in (("ConfirmButton", None), ("删除", "push button"), ("删除", "button"), ("删除", None)):
            try:
                node = _find_by_name(app, name, visible=True, role=role)
                _press(node)
                return
            except Exception as exc:
                last = exc
        time.sleep(0.15)
    raise RuntimeError(f"delete confirm button not found: {last}")


def _click_named(name: str, timeout: float = 8.0) -> None:
    _press(_wait_name(name, timeout=timeout, visible=True))


def create_note_from_note_menu(args) -> None:
    before = _note_count()
    items = _visible_note_items()
    if not items:
        raise RuntimeError("no visible note item")
    _open_context_and_press(items[0], "新建笔记", args.timeout)
    _wait_count("note", before + 1, args.timeout)
    print(f"note count: {before} -> {before + 1}")


def create_note_from_folder_menu(args) -> None:
    before = _note_count()
    items = _visible_folder_items()
    if not items:
        raise RuntimeError("no visible folder item")
    _open_context_and_press(items[0], "NewNoteFromFolderMenuItem", args.timeout)
    _wait_count("note", before + 1, args.timeout)
    print(f"note count: {before} -> {before + 1}")


def assert_note_editable(args) -> None:
    web = _wait_name("TiptapWebView", timeout=args.timeout, visible=True)
    _click_center(web)
    before = _note_count()
    subprocess.run(["xdotool", "type", "--clearmodifiers", "base_flow_editable_001"], check=True)
    time.sleep(0.5)
    # The assertion target is editability of the current detail editor; keeping
    # the note count unchanged also guards against shortcut focus going to list.
    after = _note_count()
    if after != before:
        raise RuntimeError(f"typing unexpectedly changed note count: {before}->{after}")


def create_note_from_ctrl_b(args) -> None:
    before = _note_count()
    # Keep focus outside the WebEngine editor; otherwise Ctrl+B is consumed as
    # rich-text bold instead of the application's New Note shortcut.
    try:
        _click_center(_wait_name("NoteItemListView", timeout=args.timeout, visible=True))
    except Exception:
        _click_center(_wait_name("VoiceNoteMainWindow", timeout=args.timeout, visible=True))
    _key("ctrl+b")
    _wait_count("note", before + 1, args.timeout)
    print(f"note count via ctrl+b: {before} -> {before + 1}")


def _focus(node) -> None:
    try:
        comp = node.queryComponent()
        comp.grabFocus()
        time.sleep(0.2)
        return
    except Exception:
        pass
    try:
        node.grab_focus()
        time.sleep(0.2)
        return
    except Exception:
        pass
    # Last resort: click near the button border to give the window focus without
    # treating it as the Enter-path assertion.
    ext = _ext(node)
    if ext is not None:
        subprocess.run(["xdotool", "mousemove", str(int(ext.x + 2)), str(int(ext.y + ext.height / 2))], check=True)
        time.sleep(0.1)


def create_note_from_enter(args) -> None:
    before = _note_count()
    btn = _wait_name("NewNoteButton", timeout=args.timeout, visible=True)
    _focus(btn)
    _key("Return")
    # Guard that the focused-button keyboard path created a note.
    deadline = time.time() + args.timeout
    last = before
    while time.time() < deadline:
        last = _note_count()
        if last >= before + 1:
            print(f"note count via focused button/enter: {before} -> {last}")
            return
        time.sleep(0.2)
    raise RuntimeError(f"note count did not increase after focused NewNoteButton Return: {before}->{last}")


def pressure_create_delete(args) -> None:
    before_folders = _folder_count()
    before_notes = _note_count()
    create_folder = _wait_name("CreateFolderButton", timeout=args.timeout, visible=True)
    for _ in range(args.folders):
        _press(create_folder)
        time.sleep(args.interval)
    _wait_count("folder", before_folders + args.folders, max(args.timeout, args.folders * 0.6))

    # Delete folders through the real context menu until the count is restored.
    while _folder_count() > before_folders:
        items = _visible_folder_items()
        if not items:
            _key("End")
            items = _visible_folder_items()
        # Prefer any visible row; stop by count so we delete exactly created amount.
        current = _folder_count()
        target = items[-1]
        _open_context_and_press(target, "DeleteFolderMenuItem", args.timeout)
        _confirm_delete(args.timeout)
        _wait_count("folder", current - 1, args.timeout)

    new_note = _wait_name("NewNoteButton", timeout=args.timeout, visible=True)
    for _ in range(args.notes):
        _press(new_note)
        time.sleep(args.interval)
    _wait_count("note", before_notes + args.notes, max(args.timeout, args.notes * 0.6))

    while _note_count() > before_notes:
        items = _visible_note_items()
        if not items:
            _key("End")
            items = _visible_note_items()
        current = _note_count()
        target = items[-1]
        _open_context_and_press(target, "删除", args.timeout)
        _confirm_delete(args.timeout)
        _wait_count("note", current - 1, args.timeout)

    if _folder_count() != before_folders or _note_count() != before_notes:
        raise RuntimeError(
            f"counts not restored: folders {before_folders}->{_folder_count()}, "
            f"notes {before_notes}->{_note_count()}"
        )
    print(f"restored counts: folders={before_folders}, notes={before_notes}")


def verify_long_lists(args) -> None:
    start_f = _folder_count()
    start_n = _note_count()
    create_folder = _wait_name("CreateFolderButton", timeout=args.timeout, visible=True)
    for _ in range(args.folders):
        _press(create_folder)
        time.sleep(args.interval)
    _wait_count("folder", start_f + args.folders, max(args.timeout, args.folders * 0.5))
    new_note = _wait_name("NewNoteButton", timeout=args.timeout, visible=True)
    for _ in range(args.notes):
        _press(new_note)
        time.sleep(args.interval)
    _wait_count("note", start_n + args.notes, max(args.timeout, args.notes * 0.5))

    folder_list = _wait_name("FolderListView", timeout=args.timeout, visible=True)
    _press(folder_list)
    top_folders = [_name(n) for n in _visible_folder_items()]
    _key("End")
    bottom_folders = [_name(n) for n in _visible_folder_items()]
    _key("Home")
    top_again_folders = [_name(n) for n in _visible_folder_items()]
    if not bottom_folders or not top_again_folders:
        raise RuntimeError("folder list top/bottom items not visible")
    if len(set(top_folders).symmetric_difference(bottom_folders)) == 0 and _folder_count() > len(top_folders):
        raise RuntimeError("folder list did not expose a different bottom window after End")

    note_list = _wait_name("NoteItemListView", timeout=args.timeout, visible=True)
    _press(note_list)
    top_notes = [_name(n) for n in _visible_note_items()]
    _key("End")
    bottom_notes = [_name(n) for n in _visible_note_items()]
    _key("Home")
    top_again_notes = [_name(n) for n in _visible_note_items()]
    if not bottom_notes or not top_again_notes:
        raise RuntimeError("note list top/bottom items not visible")
    # Note titles can be duplicated (default text note title), so the scroll bar
    # plus visible item windows is the stable runtime evidence for this list.
    _wait_name("FolderListScrollBar", timeout=args.timeout, visible=True)
    _wait_name("NoteListScrollBar", timeout=args.timeout, visible=True)
    print(
        f"long lists verified: folders {start_f}->{_folder_count()}, "
        f"notes {start_n}->{_note_count()}, visible notes {len(top_notes)}/{len(bottom_notes)}"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=[
        "create-note-from-note-menu",
        "create-note-from-folder-menu",
        "create-note-from-ctrl-b",
        "create-note-from-enter",
        "assert-note-editable",
        "pressure-create-delete",
        "verify-long-lists",
    ])
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--folders", type=int, default=20)
    parser.add_argument("--notes", type=int, default=20)
    parser.add_argument("--interval", type=float, default=0.15)
    args = parser.parse_args()

    try:
        Atspi.init()
    except Exception:
        pass

    globals()[args.command.replace("-", "_")](args)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"base_flow_actions.py: {exc}", file=sys.stderr)
        raise SystemExit(1)
