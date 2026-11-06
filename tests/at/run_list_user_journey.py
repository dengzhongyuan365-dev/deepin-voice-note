import argparse
import base64
import copy
import json
from pathlib import Path
from datetime import datetime

from src.at.executor import handlers
from src.at.executor.runner import run_tests

ARTIFACTS = Path('tests/at/artifacts/list-user-evolution')
original_mouse = handlers.HANDLERS['webengine_mouse_event']
original_eval = handlers.HANDLERS['webengine_eval_js']


def mouse_by_row(step, context):
    value = step.value if isinstance(step.value, dict) else {}
    if 'journey_index' not in value:
        return original_mouse(step, context)
    index = int(value['journey_index'])
    kind = value.get('journey_kind', 'text')
    selector = handlers._cdp_runtime_evaluate(
        """(() => {
          const root = document.querySelector('.ProseMirror');
          const paragraph = root.querySelectorAll('p')[%d];
          if (!paragraph) throw new Error('paragraph missing');
          let element = %s === 'checkbox' ? paragraph.closest('li').querySelector(':scope > label > input') : paragraph;
          if (!element) throw new Error('target missing');
          const segments = [];
          while (element !== root) {
            segments.unshift(element.tagName.toLowerCase() + ':nth-child(' + (Array.from(element.parentElement.children).indexOf(element) + 1) + ')');
            element = element.parentElement;
          }
          return '.ProseMirror > ' + segments.join(' > ');
        })()""" % (index, json.dumps(kind)),
        port=int(value.get('port', 7777)), timeout=5,
        target_url_contains=value.get('url_contains', 'tiptap-editor'),
    )
    delegated = copy.copy(step)
    delegated.value = {**value, 'selector': selector}
    print(f'JOURNEY_MOUSE row={index} kind={kind} selector={selector}', flush=True)
    return original_mouse(delegated, context)


def eval_with_evidence(step, context):
    try:
        return original_eval(step, context)
    except Exception:
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        try:
            state = handlers._cdp_runtime_evaluate(
                "({trace:window.__dvnJourney?.trace,doc:window.__dvnTiptapEditor?.getJSON(),selection:window.__dvnTiptapEditor?.state.selection.toJSON(),domSelection:window.getSelection().toString()})",
                port=7777, timeout=5, target_url_contains='tiptap-editor',
            )
            (ARTIFACTS / f'{stamp}-state.json').write_text(json.dumps(state, ensure_ascii=False, indent=2))
            image = handlers._cdp_call('Page.captureScreenshot', {'format': 'png'}, port=7777, timeout=5, target_url_contains='tiptap-editor')
            (ARTIFACTS / f'{stamp}.png').write_bytes(base64.b64decode(image['data']))
            print(f'JOURNEY_EVIDENCE {ARTIFACTS / stamp}', flush=True)
        except Exception as evidence_error:
            print(f'JOURNEY_EVIDENCE_FAILED {evidence_error}', flush=True)
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--suite', required=True)
    parser.add_argument('--spec-ids')
    arguments = parser.parse_args()
    handlers.HANDLERS['webengine_mouse_event'] = mouse_by_row
    handlers.HANDLERS['webengine_eval_js'] = eval_with_evidence
    return run_tests(test_dir='tests/at/yaml/列表门禁', suite=arguments.suite,
                     spec_ids=arguments.spec_ids, skip_env_check=True)


if __name__ == '__main__':
    raise SystemExit(main())
