#!/usr/bin/env bash
# First-use AT setup: clear app data and start with no notebooks.
# Exposes InitialInterface / CreateNotebookInitial instead of workspace CreateFolderButton.

set -euo pipefail

APP_NAME="deepin-voice-note"

if [[ -z "${HOME:-}" || "${HOME}" == "/" ]]; then
    echo "Invalid HOME: ${HOME:-<empty>}" >&2
    exit 1
fi

DATA_DIR="${HOME}/.local/share/deepin/deepin-voice-note"
CONFIG_DIR="${HOME}/.config/deepin/deepin-voice-note"

stop_app()
{
    killall -q "${APP_NAME}" 2>/dev/null || true
}

clean_qml_cache()
{
    local cache_dir="${HOME}/.cache/deepin/${APP_NAME}/qmlcache"
    if [[ -d "${cache_dir}" ]]; then
        echo "Clean QML cache: ${cache_dir}"
        rm -rf -- "${cache_dir}"
    fi
    export QML_DISABLE_DISK_CACHE=1
}

stop_app
clean_qml_cache
rm -rf -- "${DATA_DIR}" "${CONFIG_DIR}"
mkdir -p -- "${DATA_DIR}" "${CONFIG_DIR}"

exec "${APP_NAME}"
