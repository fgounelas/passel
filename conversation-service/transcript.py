"""A bounded logical transcript over explicitly validated continuation segments.

Offsets in the original file remain unchanged. Copied continuation history is
excluded, so paging and bookmarks retain their existing numeric message IDs.
"""
import bisect
import os
import stat
from pathlib import Path
from types import SimpleNamespace


class TranscriptPath(str):
    def __new__(cls, root, segments, resume_session):
        value = super().__new__(cls, root)
        value.segments = tuple(segments)
        value.resume_session = resume_session
        return value


class TranscriptStream:
    def __init__(self, path):
        self.files = []
        self.starts = []
        self.ends = []
        self.position = 0
        identities = []
        total = 0
        try:
            if not 1 <= len(path.segments) <= 8:
                raise ValueError('Too many transcript continuations')
            for name, start, end, device, inode in path.segments:
                if Path(name).resolve() != Path(name):
                    raise ValueError('Aliased transcript segment')
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                stream = os.fdopen(fd, 'rb')
                self.files.append(stream)
                info = os.fstat(fd)
                if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                        or (info.st_dev, info.st_ino) != (device, inode)
                        or not 0 <= start <= end <= info.st_size):
                    raise ValueError('Invalid transcript segment')
                self.starts.append(start)
                total += end - start
                self.ends.append(total)
                identities.append((info.st_dev, info.st_ino, start))
            self.info = SimpleNamespace(st_dev=identities[0][0], st_ino=tuple(identities),
                                        st_size=total, st_uid=os.getuid(), st_mode=stat.S_IFREG)
        except BaseException:
            self.close()
            raise

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        for stream in self.files:
            stream.close()

    def tell(self):
        return self.position

    def seek(self, position, whence=0):
        if whence == 1:
            position += self.position
        elif whence == 2:
            position += self.info.st_size
        elif whence != 0:
            raise ValueError('Invalid seek')
        if position < 0:
            raise ValueError('Invalid transcript position')
        self.position = position
        return position

    def _read(self, size, line):
        if size < 0:
            raise ValueError('Transcript reads must be bounded')
        parts = []
        while size and self.position < self.info.st_size:
            index = bisect.bisect_right(self.ends, self.position)
            before = self.ends[index - 1] if index else 0
            stream = self.files[index]
            stream.seek(self.starts[index] + self.position - before)
            amount = min(size, self.ends[index] - self.position)
            data = stream.readline(amount) if line else stream.read(amount)
            if not data:
                raise ValueError('Transcript changed during reading')
            parts.append(data)
            self.position += len(data)
            size -= len(data)
            if line and data.endswith(b'\n'):
                break
        return b''.join(parts)

    def read(self, size):
        return self._read(size, False)

    def readline(self, size):
        return self._read(size, True)


def open_transcript(path):
    if isinstance(path, TranscriptPath):
        return TranscriptStream(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    return os.fdopen(fd, 'rb')


def transcript_info(stream):
    return stream.info if isinstance(stream, TranscriptStream) else os.fstat(stream.fileno())
