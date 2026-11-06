import base64
import json
import time
from pathlib import Path

import run_list_user_journey as journey
from src.at.executor import handlers
from src.at.executor.runner import run_tests

folder = Path("tests/at/artifacts/duplicate-task-confirmation")
folder.mkdir(parents=True, exist_ok=True)
original_key = handlers.HANDLERS["keyboard_press"]
original_eval = journey.original_eval
armed = False


def capture(name):
    image = handlers._cdp_call("Page.captureScreenshot", {"format": "png"}, port=7777, timeout=5, target_url_contains="tiptap-editor")
    (folder / (name + ".png")).write_bytes(base64.b64decode(image["data"]))
    state = handlers._cdp_runtime_evaluate("({rows:window.__dvnJourney.rows(),doc:window.__dvnTiptapEditor.getJSON(),selection:window.__dvnTiptapEditor.state.selection.toJSON(),domSelection:window.getSelection().toString()})", port=7777, timeout=5, target_url_contains="tiptap-editor")
    (folder / (name + ".json")).write_text(json.dumps(state, ensure_ascii=False, indent=2))
    print("CAPTURE " + name, flush=True)


def inspect_eval(step, context):
    global armed
    result = original_eval(step, context)
    value = step.value if isinstance(step.value, dict) else {}
    if "__dvnJourney.checkpoint(" in value.get("script", "") and "check_branch_7" in value["script"]:
        capture("01-before-click-XA")
        armed = True
    return result


def inspect_key(step, context):
    global armed
    if armed and step.key == "return":
        capture("02-caret-between-X-and-A")
        time.sleep(2)
        result = original_key(step, context)
        time.sleep(1)
        capture("03-after-enter")
        armed = False
        return result
    return original_key(step, context)


handlers.HANDLERS["webengine_mouse_event"] = journey.mouse_by_row
handlers.HANDLERS["webengine_eval_js"] = inspect_eval
handlers.HANDLERS["keyboard_press"] = inspect_key
raise SystemExit(run_tests(test_dir="tests/at/yaml/列表门禁", suite="case_list_user_evolution_discovery_001", spec_ids="journey_split_duplicate_task_text", skip_env_check=True))
