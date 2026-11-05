import json
from pathlib import Path
import tempfile
import unittest
from claude import match_session, resolve_continuations
from collector import Reader
from history import read_history
from bookmarks import read_message
from transcript import open_transcript, transcript_info

ROOT = '75f008f9-ee36-48f2-9b1c-3d37c1209de4'
CHILD = '85f008f9-ee36-48f2-9b1c-3d37c1209de4'
NEXT = '95f008f9-ee36-48f2-9b1c-3d37c1209de4'
CWD = '/work/math'


def message(text, uid, session=ROOT, role='assistant', **extra):
    return {'type': role, 'uuid': f'{uid:08d}-1111-1111-1111-111111111111',
            'sessionId': session, 'cwd': CWD, 'isSidechain': False,
            'message': {'role': role, 'content': [{'type': 'text', 'text': text}]}, **extra}


def lines(events):
    return b''.join((json.dumps(e) + '\n').encode() for e in events)


def handoff(session=ROOT, child=CHILD):
    return {'type': 'continued-in', 'sessionId': session, 'continuedInSessionId': child}


class Continuations(unittest.TestCase):
    def fixture(self, tmp):
        profile = Path(tmp).resolve()
        project = profile / 'projects/-work-math'
        project.mkdir(parents=True)
        (profile / 'sessions').mkdir()
        (profile / 'sessions/123.json').write_text(json.dumps({
            'pid': 123, 'procStart': '456', 'sessionId': ROOT, 'cwd': CWD,
            'kind': 'interactive', 'entrypoint': 'cli'}))
        old = [message('Question π?', 1, role='user'), message('Original conclusion', 2)]
        root = project / (ROOT + '.jsonl')
        root.write_bytes(lines(old + [handoff()]))
        child = project / (CHILD + '.jsonl')
        copies = [{**e, 'sessionId': CHILD, 'sessionKind': 'bg'} for e in old]
        child.write_bytes(lines([{'type': 'ai-title', 'sessionId': CHILD}] + copies +
                               [message('New mathematical conclusion', 3, CHILD, cwd=CWD+'/project')]))
        return profile, root, child, old, copies

    def test_updates_history_search_and_original_pins_without_duplicate_copied_messages(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile, root, child, old, copies = self.fixture(tmp)
            source, session = match_session(profile, '123', '456', CWD)
            self.assertEqual(session, ROOT)
            self.assertEqual(str(source), str(root))
            self.assertEqual(source.resume_session, CHILD)
            reader = Reader(source)
            messages = reader.update()
            self.assertEqual([m['text'] for m in messages], ['Question π?', 'Original conclusion', 'New mathematical conclusion'])
            old_answer_offset = len(lines(old[:1]))
            self.assertEqual(messages[1]['id'], str(old_answer_offset))
            self.assertEqual(read_message(source, str(old_answer_offset))['text'], 'Original conclusion')
            self.assertEqual(read_history(source, 'start', 0)['messages'], messages)
            self.assertEqual(read_history(source, 'search', 0, 'new mathematical')['messages'], messages[-1:])
            self.assertEqual(read_history(source, 'before', int(messages[-1]['id']))['messages'], messages[:2])
            with child.open('ab') as stream:
                stream.write(lines([message('Next live update', 4, CHILD)]))
            reader.path = match_session(profile, '123', '456', CWD)[0]
            updated = reader.update()
            self.assertEqual(updated[:3], messages)
            self.assertEqual(updated[-1]['text'], 'Next live update')
            self.assertEqual(read_message(reader.path, updated[-1]['id']), updated[-1])

    def test_multiple_handoffs_and_seek_across_segment_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile, root, child, old, copies = self.fixture(tmp)
            child_events = [*copies, message('New mathematical conclusion', 3, CHILD, cwd=CWD+'/project')]
            with child.open('ab') as stream:
                stream.write(lines([handoff(CHILD, NEXT)]))
            target = child.parent / (NEXT + '.jsonl')
            target.write_bytes(lines([{**e, 'sessionId': NEXT} for e in child_events] + [message('Final result', 4, NEXT)]))
            source, _ = match_session(profile, '123', '456', CWD)
            self.assertEqual(source.resume_session, NEXT)
            self.assertEqual([m['text'] for m in Reader(source).update()], ['Question π?', 'Original conclusion', 'New mathematical conclusion', 'Final result'])
            with open_transcript(source) as stream:
                info = transcript_info(stream)
                boundary = root.stat().st_size
                stream.seek(boundary - 1)
                self.assertEqual(stream.read(1), b'\n')
                self.assertTrue(stream.readline(2 * 1024 * 1024).endswith(b'\n'))
                self.assertLessEqual(info.st_size, sum(p.stat().st_size for p in (root, child, target)))
                with self.assertRaises(ValueError): stream.read(-1)

    def test_invalid_target_and_anchors_fail_closed(self):
        for mode in ('foreign-session', 'sidechain', 'wrong-first', 'wrong-last', 'alias', 'missing', 'cycle', 'path-injection'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                profile, root, child, old, copies = self.fixture(tmp)
                if mode == 'foreign-session': child.write_bytes(lines([{**e, 'sessionId': NEXT} for e in copies]))
                elif mode == 'sidechain': child.write_bytes(lines([{**e, 'isSidechain': True} for e in copies]))
                elif mode == 'wrong-first': child.write_bytes(lines([message('Unrelated project', 99, CHILD), copies[1]]))
                elif mode == 'wrong-last': child.write_bytes(lines([copies[0], {**copies[1], 'message': {'role': 'assistant', 'content': 'different'}}]))
                elif mode == 'alias':
                    other = child.with_suffix('.other'); child.rename(other); child.symlink_to(other)
                elif mode == 'missing': child.unlink()
                elif mode == 'cycle':
                    with child.open('ab') as stream: stream.write(lines([handoff(CHILD, ROOT)]))
                elif mode == 'path-injection': root.write_bytes(lines(old + [handoff(child='../../outside')]))
                self.assertIsNone(match_session(profile, '123', '456', CWD))

    def test_cached_anchor_is_revalidated_after_same_inode_rewrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile, root, child, old, copies = self.fixture(tmp)
            self.assertIsNotNone(match_session(profile, '123', '456', CWD))
            child.write_bytes(child.read_bytes().replace(b'Original conclusion', b'Invented conclusion'))
            self.assertIsNone(match_session(profile, '123', '456', CWD))

    def test_new_parent_messages_retire_the_old_handoff(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile, root, child, old, copies = self.fixture(tmp)
            with root.open('ab') as stream: stream.write(lines([message('Back in the main TUI', 5)]))
            self.assertEqual(resolve_continuations(root, ROOT, CWD), str(root))

    def test_partial_append_is_retried_and_chain_growth_rebuilds_bounded_reader(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile, root, child, old, copies = self.fixture(tmp)
            reader = Reader(match_session(profile, '123', '456', CWD)[0]); reader.update()
            extra = lines([message('Complete later', 4, CHILD)])
            with child.open('ab') as stream: stream.write(extra[:-1])
            reader.path = match_session(profile, '123', '456', CWD)[0]
            self.assertEqual(reader.update()[-1]['text'], 'New mathematical conclusion')
            with child.open('ab') as stream: stream.write(b'\n')
            reader.path = match_session(profile, '123', '456', CWD)[0]
            self.assertEqual(reader.update()[-1]['text'], 'Complete later')

    def test_segment_replacement_between_mapping_and_open_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile, root, child, old, copies = self.fixture(tmp)
            source, _ = match_session(profile, '123', '456', CWD)
            # Allocate the replacement while the original exists: unlink/create
            # can immediately reuse the same inode on Linux filesystems.
            replacement = child.with_suffix('.replacement')
            replacement.write_bytes(child.read_bytes())
            replacement.replace(child)
            with self.assertRaises(ValueError):
                with open_transcript(source):
                    pass
