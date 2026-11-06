"""Run the real-input journey and retain success/failure evidence at the split checkpoint."""
import base64
import json
from pathlib import Path
from datetime import datetime
import run_list_user_journey as journey

original_eval = journey.original_eval

def capture_split(step, context):
    try:
        return original_eval(step, context)
    finally:
        value = step.value if isinstance(step.value, dict) else {}
        if 'checkpoint("bugfix_split_parent_and_children_checked"' in value.get('script', ''):
            directory = Path('tests/at/artifacts/task-split-fix')
            directory.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
            state = journey.handlers._cdp_runtime_evaluate(
                '({trace:window.__dvnJourney.trace,doc:window.__dvnTiptapEditor.getJSON()})',
                port=7777, timeout=5, target_url_contains='tiptap-editor')
            (directory / f'{stamp}-split.json').write_text(json.dumps(state, ensure_ascii=False, indent=2))
            image = journey.handlers._cdp_call('Page.captureScreenshot', {'format':'png'}, port=7777, timeout=5, target_url_contains='tiptap-editor')
            (directory / f'{stamp}-split.png').write_bytes(base64.b64decode(image['data']))
            print('SPLIT_EVIDENCE', directory / stamp, flush=True)

journey.original_eval = capture_split
if __name__ == '__main__':
    raise SystemExit(journey.main())
