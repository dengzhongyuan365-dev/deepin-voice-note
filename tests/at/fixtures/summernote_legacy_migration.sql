-- Summernote legacy migration fixture for S005 tests
-- Creates a vnote DB with one folder (记事本1) and one note (文本)
-- whose meta_data is in legacy Summernote htmlCode format (NOT Tiptap).
--
-- Usage:  sqlite3 <db_path> < this_file

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS vnote_folder_tbl (
    folder_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id   INT DEFAULT 0,
    folder_name   TEXT NOT NULL,
    default_icon  INT DEFAULT 0,
    icon_path     TEXT,
    folder_state  INT DEFAULT 0,
    max_noteid    INT DEFAULT 0,
    create_time   DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now','localtime')),
    modify_time   DATETEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now','localtime')),
    delete_time   DATETEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now','localtime')),
    expand_filed1 INT,
    expand_filed2 INT,
    expand_filed3 INT,
    expand_filed4 TEXT,
    expand_filed5 TEXT,
    expand_filed6 TEXT
);

CREATE TABLE IF NOT EXISTS vnote_items_tbl (
    note_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id     INTEGER,
    note_type     INT NOT NULL DEFAULT 0,
    note_title    TEXT NOT NULL,
    meta_data     TEXT,
    note_state    INT DEFAULT 0,
    create_time   DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now','localtime')),
    modify_time   DATETEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now','localtime')),
    delete_time   DATETEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now','localtime')),
    expand_filed1 INT,
    expand_filed2 INT,
    expand_filed3 INT,
    expand_filed4 TEXT,
    expand_filed5 TEXT,
    expand_filed6 TEXT
);

CREATE TABLE IF NOT EXISTS vnote_category_tbl (
    id            INT DEFAULT 0,
    name          TEXT NOT NULL,
    icon          INT DEFAULT 0,
    state         INT DEFAULT 0,
    max_id        INT DEFAULT 0,
    meta_data     TEXT,
    create_time   DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now','localtime')),
    modify_time   DATETEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now','localtime')),
    delete_time   DATETEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now','localtime')),
    expand_filed1 INT,
    expand_filed2 INT,
    expand_filed3 INT,
    expand_filed4 TEXT,
    expand_filed5 TEXT,
    expand_filed6 TEXT
);

-- Folder: 记事本1 (folder_id=1, folder_state=0 means active)
INSERT INTO vnote_folder_tbl (folder_id, category_id, folder_name, default_icon, folder_state, max_noteid)
VALUES (1, 0, '记事本1', 4, 0, 1);

-- Note: 文本 (note_id=1, folder_id=1, note_state=0 means active)
-- meta_data is Summernote htmlCode format — NOT Tiptap JSON envelope
INSERT INTO vnote_items_tbl (note_id, folder_id, note_type, note_title, meta_data, note_state)
VALUES (1, 1, 0, '文本', '{"htmlCode":"<p>migrationlegacy001</p>"}', 0);
