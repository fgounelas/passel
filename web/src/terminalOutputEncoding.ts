const TERMINAL_OUTPUT_FRAME_RAW = 0;
const TERMINAL_OUTPUT_FRAME_GZIP = 1;
export type TerminalGrid = { cols: number; rows: number; full: boolean };

export function isTerminalGridAcknowledgement(message: string): boolean {
  try {
    const value = JSON.parse(message);
    return value.type === "terminal_output_encoding" && value.grid_version === 1;
  } catch { return false; }
}

export function parseTerminalGridFrames(payload: Uint8Array) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const records: { grid: TerminalGrid; bytes: Uint8Array }[] = [];
  let offset = 0;
  while (offset < payload.length) {
    if (records.length >= 256 || payload.length - offset < 9) throw new Error("Invalid terminal grid frame");
    const cols = view.getUint16(offset, true), rows = view.getUint16(offset + 2, true);
    const full = view.getUint8(offset + 4), size = view.getUint32(offset + 5, true);
    offset += 9;
    if (cols < 1 || rows < 1 || cols > 500 || rows > 200 || full > 1 || size > 32 * 1024 * 1024 || size > payload.length - offset) {
      throw new Error("Invalid terminal grid dimensions or payload");
    }
    records.push({ grid: { cols, rows, full: full === 1 }, bytes: payload.subarray(offset, offset + size) });
    offset += size;
  }
  return records;
}

type TerminalOutputFrameDecoder = {
  enqueue(frame: Uint8Array): Promise<void>;
  cancel(): void;
};

export function isTerminalOutputGzipAcknowledgement(message: string): boolean {
  try {
    const parsed = JSON.parse(message) as { type?: unknown; encoding?: unknown };
    return parsed.type === "terminal_output_encoding" && parsed.encoding === "gzip";
  } catch {
    return false;
  }
}

export function terminalOutputGzipSupported(): boolean {
  return typeof DecompressionStream === "function";
}

export function createTerminalOutputFrameDecoder(
  write: (output: Uint8Array, grid?: TerminalGrid) => void,
  onError: (error: Error) => void,
): TerminalOutputFrameDecoder {
  let decodeChain = Promise.resolve();
  let canceled = false;
  let failed = false;

  return {
    enqueue(frame) {
      decodeChain = decodeChain
        .then(async () => {
          if (canceled || failed) {
            return;
          }
          const output = await decodeTerminalOutputFrame(frame);
          if (!canceled && !failed) {
            if (frame[0] === 2 || frame[0] === 3) {
              for (const record of parseTerminalGridFrames(output)) write(record.bytes, record.grid);
            } else write(output);
          }
        })
        .catch((error: unknown) => {
          if (!canceled && !failed) {
            failed = true;
            onError(
              error instanceof Error
                ? error
                : new Error("Terminal output decompression failed", { cause: error }),
            );
          }
        });
      return decodeChain;
    },
    cancel() {
      canceled = true;
    },
  };
}

export async function decodeTerminalOutputFrame(frame: Uint8Array): Promise<Uint8Array> {
  const frameType = frame[0];
  const payload = frame.subarray(1);
  if (frameType === TERMINAL_OUTPUT_FRAME_RAW || frameType === 2) {
    return payload;
  }
  if (frameType !== TERMINAL_OUTPUT_FRAME_GZIP && frameType !== 3) {
    throw new Error(`Unsupported terminal output frame type: ${frameType}`);
  }

  // subarray() keeps the ArrayBufferLike base type, which Blob rejects under strict
  // TypeScript. Copy into a fresh ArrayBuffer-backed view before streaming.
  const compressedBytes = Uint8Array.from(payload);
  const decompressed = new Blob([compressedBytes.buffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(decompressed).arrayBuffer());
}
