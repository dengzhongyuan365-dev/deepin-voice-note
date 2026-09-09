#!/usr/bin/env python3
"""
assert_tiptap_scenario_db.py — 验证 deepin-voice-note DB 中目标笔记的 Tiptap 内容。

用法:
  # 检查 marks 包含 bold, italic, underline
  python3 assert_tiptap_scenario_db.py \
      --note-text richtextformat006 \
      --marks-contains bold,italic,underline

  # 检查 node_type 包含 orderedList 或 bulletList
  python3 assert_tiptap_scenario_db.py \
      --note-text listformat006 \
      --node-type-contains orderedList,bulletList

  # 指定 DB 路径（默认 ~/.local/share/deepin/deepin-voice-note/deepin-voice-note1.0.db）
  python3 assert_tiptap_scenario_db.py \
      --db-path /path/to/deepin-voice-note1.0.db \
      --note-text richtextformat006 \
      --marks-contains bold,italic,underline

退出码:
  0 — 所有检查通过
  1 — 检查失败（DB 不可达、笔记未找到、marks/node_type 不匹配）
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from typing import Any


DEFAULT_DB_PATH = os.path.expanduser(
    "~/.local/share/deepin/deepin-voice-note/deepin-voice-note1.0.db"
)

# HTML tag → Tiptap mark type 映射
_HTML_MARK_MAP = {
    "strong": "bold",
    "b": "bold",
    "em": "italic",
    "i": "italic",
    "u": "underline",
    "s": "strike",
    "del": "strike",
    "strike": "strike",
}

# HTML tag → Tiptap node type 映射
_HTML_NODE_MAP = {
    "ol": "orderedList",
    "ul": "bulletList",
}


def _extract_meta_data_json(raw: str) -> dict[str, Any] | None:
    """从 vnote_items_tbl.meta_data 列解析出 JSON dict。

    meta_data 可能是纯 JSON 字符串，也可能包含嵌套的 JSON。
    常见格式: {"htmlCode": "<p>...</p>"}
    也可能出现 Tiptap JSON: {"tiptap": {"type":"doc",...}} 或
    {"format":"tiptap","content":{"type":"doc",...}}
    """
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


def _extract_tiptap_doc(meta: dict[str, Any]) -> dict[str, Any] | None:
    """从 meta_data dict 中提取 Tiptap doc JSON。

    支持的格式:
    1. {"content": {"type": "doc", ...}}          — Tiptap envelope
    2. {"tiptap": {"type": "doc", ...}}            — tiptap 字段
    3. {"type": "doc", ...}                         — 直接是 doc
    4. 无 Tiptap JSON 时返回 None（回退到 HTML 解析）
    """
    if not isinstance(meta, dict):
        return None

    content = meta.get("content")
    if isinstance(content, dict) and content.get("type") == "doc":
        return content

    tiptap = meta.get("tiptap")
    if isinstance(tiptap, dict) and tiptap.get("type") == "doc":
        return tiptap

    if meta.get("type") == "doc":
        return meta

    return None


def _collect_marks_from_tiptap(node: Any, marks_set: set[str]) -> None:
    """递归遍历 Tiptap JSON 树，收集所有 mark type。"""
    if isinstance(node, dict):
        for mark in node.get("marks", []) or []:
            mark_type = mark.get("type")
            if mark_type:
                marks_set.add(mark_type)
        for child in node.get("content", []) or []:
            _collect_marks_from_tiptap(child, marks_set)
    elif isinstance(node, list):
        for item in node:
            _collect_marks_from_tiptap(item, marks_set)


def _collect_node_types_from_tiptap(node: Any, node_types: set[str]) -> None:
    """递归遍历 Tiptap JSON 树，收集所有 node type。"""
    if isinstance(node, dict):
        node_type = node.get("type")
        if node_type:
            node_types.add(node_type)
        for child in node.get("content", []) or []:
            _collect_node_types_from_tiptap(child, node_types)
    elif isinstance(node, list):
        for item in node:
            _collect_node_types_from_tiptap(item, node_types)


def _collect_marks_from_html(html: str, marks_set: set[str]) -> None:
    """从 HTML 字符串中解析 mark type（基于标签名）。"""
    for match in re.finditer(r"<\s*(\w+)", html):
        tag = match.group(1).lower()
        if tag in _HTML_MARK_MAP:
            marks_set.add(_HTML_MARK_MAP[tag])


def _collect_node_types_from_html(html: str, node_types: set[str]) -> None:
    """从 HTML 字符串中解析 node type（基于列表标签）。"""
    for match in re.finditer(r"<\s*(\w+)", html):
        tag = match.group(1).lower()
        if tag in _HTML_NODE_MAP:
            node_types.add(_HTML_NODE_MAP[tag])


def _extract_text_from_html(html: str) -> str:
    """粗略提取 HTML 中的可见文本。"""
    text = re.sub(r"<[^>]+>", "", html)
    return text.strip()


def _extract_text_from_tiptap(node: Any) -> str:
    """递归提取 Tiptap JSON 中所有 text 节点的文本内容。"""
    parts: list[str] = []
    if isinstance(node, dict):
        if node.get("type") == "text" and isinstance(node.get("text"), str):
            parts.append(node["text"])
        for child in node.get("content", []) or []:
            parts.append(_extract_text_from_tiptap(child))
    elif isinstance(node, list):
        for item in node:
            parts.append(_extract_text_from_tiptap(item))
    return "".join(parts)


def find_target_note(
    conn: sqlite3.Connection, note_text: str
) -> dict[str, Any] | None:
    """在 vnote_items_tbl 中查找包含指定文本的笔记，返回最近修改的一条。"""
    rows = conn.execute(
        "SELECT note_id, note_title, meta_data, modify_time "
        "FROM vnote_items_tbl WHERE note_state = 0 "
        "ORDER BY modify_time DESC"
    ).fetchall()

    for row in rows:
        note_id, note_title, raw_meta, modify_time = row
        meta = _extract_meta_data_json(raw_meta)
        if meta is None:
            continue

        # 尝试从 Tiptap JSON 提取文本
        tiptap_doc = _extract_tiptap_doc(meta)
        if tiptap_doc is not None:
            text_content = _extract_text_from_tiptap(tiptap_doc)
        else:
            html_code = meta.get("htmlCode", "")
            text_content = _extract_text_from_html(html_code)

        if note_text in text_content:
            return {
                "note_id": note_id,
                "note_title": note_title,
                "meta_data": meta,
                "modify_time": modify_time,
            }

    return None


def analyze_note(note: dict[str, Any]) -> tuple[set[str], set[str], str]:
    """分析笔记，返回 (marks, node_types, text_content)。"""
    meta = note["meta_data"]
    marks: set[str] = set()
    node_types: set[str] = set()

    tiptap_doc = _extract_tiptap_doc(meta)
    if tiptap_doc is not None:
        _collect_marks_from_tiptap(tiptap_doc, marks)
        _collect_node_types_from_tiptap(tiptap_doc, node_types)
        text_content = _extract_text_from_tiptap(tiptap_doc)
    else:
        html_code = meta.get("htmlCode", "")
        _collect_marks_from_html(html_code, marks)
        _collect_node_types_from_html(html_code, node_types)
        text_content = _extract_text_from_html(html_code)

    return marks, node_types, text_content


def main() -> int:
    parser = argparse.ArgumentParser(
        description="验证 deepin-voice-note DB 中目标笔记的 Tiptap 内容"
    )
    parser.add_argument(
        "--db-path",
        default=DEFAULT_DB_PATH,
        help=f"数据库路径（默认: {DEFAULT_DB_PATH}）",
    )
    parser.add_argument(
        "--note-text",
        required=True,
        help="在笔记内容中搜索的关键文本（如 richtextformat006）",
    )
    parser.add_argument(
        "--marks-contains",
        default="",
        help="逗号分隔的 mark 类型列表（bold,italic,underline,strike）",
    )
    parser.add_argument(
        "--node-type-contains",
        default="",
        help="逗号分隔的 node type 列表（orderedList,bulletList）",
    )
    args = parser.parse_args()

    # 连接数据库
    if not os.path.isfile(args.db_path):
        print(f"ERROR: DB file not found: {args.db_path}", file=sys.stderr)
        return 1

    try:
        conn = sqlite3.connect(args.db_path)
    except sqlite3.Error as exc:
        print(f"ERROR: Cannot open DB: {exc}", file=sys.stderr)
        return 1

    # 查找目标笔记
    note = find_target_note(conn, args.note_text)
    conn.close()

    if note is None:
        print(
            f"ERROR: No note containing '{args.note_text}' found in DB",
            file=sys.stderr,
        )
        return 1

    print(
        f"Found note: id={note['note_id']}, title='{note['note_title']}'",
        file=sys.stderr,
    )

    marks, node_types, text_content = analyze_note(note)

    print(f"Note text content: {text_content[:200]}", file=sys.stderr)
    print(f"Detected marks: {sorted(marks)}", file=sys.stderr)
    print(f"Detected node types: {sorted(node_types)}", file=sys.stderr)

    all_passed = True

    # 检查 marks
    if args.marks_contains:
        required_marks = {
            m.strip() for m in args.marks_contains.split(",") if m.strip()
        }
        missing_marks = required_marks - marks
        if missing_marks:
            print(
                f"FAIL: Missing marks: {sorted(missing_marks)} "
                f"(found: {sorted(marks)})",
                file=sys.stderr,
            )
            all_passed = False
        else:
            print(
                f"PASS: All required marks present: {sorted(required_marks)}",
                file=sys.stderr,
            )

    # 检查 node types
    if args.node_type_contains:
        required_types = {
            t.strip() for t in args.node_type_contains.split(",") if t.strip()
        }
        found_types = required_types & node_types
        if not found_types:
            print(
                f"FAIL: None of required node types found: "
                f"{sorted(required_types)} (found: {sorted(node_types)})",
                file=sys.stderr,
            )
            all_passed = False
        else:
            print(
                f"PASS: Required node types present: {sorted(found_types)}",
                file=sys.stderr,
            )

    if all_passed:
        print("ALL CHECKS PASSED", file=sys.stderr)
        return 0
    else:
        print("SOME CHECKS FAILED", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
