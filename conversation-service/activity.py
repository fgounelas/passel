"""One bounded, transient tool preview; never part of conversation history."""
import json
import re

COMMAND_LIMIT = 2000
OUTPUT_LIMIT = 4000
ANSI = re.compile(r'\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))')


def preview(value, limit):
    if not isinstance(value, str):
        return ''
    # Bound before cleaning; do not export terminal control sequences.
    value = ANSI.sub('', value[:limit * 2])
    value = ''.join(c for c in value if c in '\n\t' or ord(c) >= 32 and ord(c) != 127)
    return value[:limit] + ('…' if len(value) > limit else '')


def text_output(value):
    if isinstance(value, str):
        return preview(value, OUTPUT_LIMIT)
    if isinstance(value, dict):
        return text_output(value.get('content', []))
    if isinstance(value, list):
        parts = []
        remaining = OUTPUT_LIMIT
        for block in value[:32]:
            if not isinstance(block, dict) or block.get('type') not in ('text', 'input_text', 'output_text'):
                continue
            text = preview(block.get('text'), remaining)
            parts.append(text)
            remaining -= len(text) + 1
            if remaining <= 0:
                break
        return '\n'.join(parts)[:OUTPUT_LIMIT]
    return ''


def arguments(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return preview(value, COMMAND_LIMIT)
    if isinstance(value, dict):
        for key in ('cmd', 'command', 'code'):
            if isinstance(value.get(key), str):
                return preview(value[key], COMMAND_LIMIT)
        return preview(json.dumps(value, ensure_ascii=False), COMMAND_LIMIT)
    return ''


class Activity:
    def __init__(self):
        self.current = None
        self.turn_active = None

    def replace(self, identity, command, output=''):
        if self.turn_active is False:
            return
        self.current = {'id': str(identity)[:200], 'command': preview(command, COMMAND_LIMIT),
                        'output': text_output(output)}

    def update_claude(self, event):
        if event.get('isSidechain'):
            return
        if event.get('type') == 'system' and event.get('subtype') == 'turn_duration':
            self.current = None
            self.turn_active = False
            return
        message = event.get('message', {})
        if not isinstance(message, dict):
            return
        content = message.get('content', [])
        if event.get('type') == 'user':
            from claude import display_message
            if display_message(event, 0):
                self.current = None
                self.turn_active = True
        if not isinstance(content, list):
            return
        for block in content:
            if not isinstance(block, dict):
                continue
            if event.get('type') == 'assistant' and block.get('type') == 'tool_use':
                self.turn_active = True
                self.replace(block.get('id', ''), str(block.get('name', 'Tool')) + '\n' + arguments(block.get('input')))
            elif (event.get('type') == 'user' and block.get('type') == 'tool_result'
                    and self.current and block.get('tool_use_id') == self.current['id']):
                self.current['output'] = text_output(block.get('content'))
        if event.get('type') == 'assistant' and message.get('stop_reason') == 'end_turn':
            self.current = None
            self.turn_active = False

    def update(self, event):
        if event.get('type') in ('user', 'assistant', 'system'):
            self.update_claude(event)
            return
        payload = event.get('payload', {})
        if not isinstance(payload, dict):
            return
        kind = payload.get('type')
        if event.get('type') == 'event_msg':
            if kind in ('task_complete', 'turn_aborted'):
                self.current = None
                self.turn_active = False
            elif kind == 'task_started':
                self.current = None
                self.turn_active = True
            elif kind == 'item_completed':
                item = payload.get('item', {})
                if not isinstance(item, dict):
                    return
                item_kind = item.get('type')
                if item_kind == 'CommandExecution':
                    parsed = item.get('parsed_cmd', [])
                    command = '\n'.join(p['cmd'] for p in parsed[:8] if isinstance(p, dict) and isinstance(p.get('cmd'), str))
                    if not command:
                        command = ' '.join(str(p) for p in item.get('command', [])[:32])
                    self.replace(item.get('id', ''), command, item.get('aggregated_output') or item.get('formatted_output') or item.get('stdout', ''))
                elif item_kind == 'McpToolCall':
                    command = str(item.get('server', '')) + '.' + str(item.get('tool', '')) + '\n' + arguments(item.get('arguments'))
                    self.replace(item.get('id', ''), command, item.get('result'))
            return
        if event.get('type') != 'response_item':
            return
        if kind in ('function_call', 'custom_tool_call'):
            name = str(payload.get('name', 'Tool'))
            if name in ('wait', 'wait_agent', 'sleep'):
                return
            # A canonical new call also supports logs without task_started.
            self.turn_active = True
            detail = arguments(payload.get('arguments')) if kind == 'function_call' else preview(payload.get('input'), COMMAND_LIMIT)
            self.replace(payload.get('call_id', ''), name + ('\n' + detail if detail else ''))
        elif kind in ('function_call_output', 'custom_tool_call_output'):
            if self.current and payload.get('call_id') == self.current['id']:
                self.current['output'] = text_output(payload.get('output'))
