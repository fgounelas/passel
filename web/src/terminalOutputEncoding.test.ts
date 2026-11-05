import { describe, expect, it } from "vitest";
import {
  createTerminalOutputFrameDecoder,
  decodeTerminalOutputFrame,
  isTerminalOutputGzipAcknowledgement,
  isTerminalGridAcknowledgement,
  parseTerminalGridFrames,
} from "./terminalOutputEncoding";

const HELLO_TERMINAL = new TextEncoder().encode("hello terminal\n");

function gridRecord(cols: number, rows: number, full: boolean, text: string) {
  const bytes = new TextEncoder().encode(text), record = new Uint8Array(9 + bytes.length);
  const view = new DataView(record.buffer);
  view.setUint16(0, cols, true); view.setUint16(2, rows, true); view.setUint8(4, Number(full)); view.setUint32(5, bytes.length, true);
  record.set(bytes, 9); return record;
}
it("decodes batched grid records in order with dimensions beside each payload", async () => {
  const first=gridRecord(248,67,true,'first'),second=gridRecord(100,40,false,'second');
  const payload=new Uint8Array([...first,...second]);
  const writes: unknown[]=[];
  const decoder=createTerminalOutputFrameDecoder((bytes,grid)=>writes.push([new TextDecoder().decode(bytes),grid]),error=>{throw error;});
  const compressed=await new Response(new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  await decoder.enqueue(new Uint8Array([3,...new Uint8Array(compressed)]));
  expect(writes).toEqual([['first',{cols:248,rows:67,full:true}],['second',{cols:100,rows:40,full:false}]]);
  expect(isTerminalGridAcknowledgement('{"type":"terminal_output_encoding","encoding":"identity","grid_version":1}')).toBe(true);
  expect(isTerminalGridAcknowledgement('{"type":"terminal_output_encoding","encoding":"gzip"}')).toBe(false);
});
it("rejects incomplete, oversized and invalid grid records before writing",()=>{
  for(const record of [gridRecord(501,40,true,'x'),gridRecord(80,201,true,'x'),gridRecord(0,40,true,'x'),gridRecord(80,40,true,'x').subarray(0,9)]) {
    expect(()=>parseTerminalGridFrames(record)).toThrow();
  }
});

const HELLO_TERMINAL_GZIP = new Uint8Array([
  31, 139, 8, 0, 0, 0, 0, 0, 4, 255, 203, 72, 205, 201, 201, 87, 40, 73, 45, 202, 205, 204, 75, 204,
  225, 2, 0, 235, 80, 240, 178, 15, 0, 0, 0,
]);

describe("decodeTerminalOutputFrame", () => {
  it("returns raw terminal output without changing its bytes", async () => {
    const frame = new Uint8Array([0, ...HELLO_TERMINAL]);

    await expect(decodeTerminalOutputFrame(frame)).resolves.toEqual(HELLO_TERMINAL);
  });

  it("decompresses gzip terminal output", async () => {
    const frame = new Uint8Array([1, ...HELLO_TERMINAL_GZIP]);

    await expect(decodeTerminalOutputFrame(frame)).resolves.toEqual(HELLO_TERMINAL);
  });

  it("rejects unknown terminal output frame types", async () => {
    await expect(decodeTerminalOutputFrame(new Uint8Array([4, 1, 2, 3]))).rejects.toThrow(
      "Unsupported terminal output frame type: 4",
    );
  });
});

describe("isTerminalOutputGzipAcknowledgement", () => {
  it("accepts gzip encoding acknowledgements", () => {
    expect(
      isTerminalOutputGzipAcknowledgement(
        JSON.stringify({ type: "terminal_output_encoding", encoding: "gzip" }),
      ),
    ).toBe(true);
    expect(
      isTerminalOutputGzipAcknowledgement(
        JSON.stringify({ encoding: "gzip", type: "terminal_output_encoding" }),
      ),
    ).toBe(true);
    expect(isTerminalOutputGzipAcknowledgement(JSON.stringify({ type: "closed" }))).toBe(false);
    expect(isTerminalOutputGzipAcknowledgement("not json")).toBe(false);
  });
});

describe("createTerminalOutputFrameDecoder", () => {
  it("writes decoded terminal output in WebSocket frame order", async () => {
    const writes: string[] = [];
    const decoder = createTerminalOutputFrameDecoder(
      (output) => writes.push(new TextDecoder().decode(output)),
      () => {},
    );

    const compressedFirst = decoder.enqueue(new Uint8Array([1, ...HELLO_TERMINAL_GZIP]));
    const rawSecond = decoder.enqueue(new Uint8Array([0, ...new TextEncoder().encode("second")]));
    await Promise.all([compressedFirst, rawSecond]);

    expect(writes).toEqual(["hello terminal\n", "second"]);
  });

  it("discards queued output after its WebSocket closes", async () => {
    const writes: Uint8Array[] = [];
    const decoder = createTerminalOutputFrameDecoder(
      (output) => writes.push(output),
      () => {},
    );

    const pending = decoder.enqueue(new Uint8Array([1, ...HELLO_TERMINAL_GZIP]));
    decoder.cancel();
    await pending;

    expect(writes).toEqual([]);
  });

  it("reports a decoding error once and stops the stream", async () => {
    const writes: Uint8Array[] = [];
    const errors: Error[] = [];
    const decoder = createTerminalOutputFrameDecoder(
      (output) => writes.push(output),
      (error) => errors.push(error),
    );

    await decoder.enqueue(new Uint8Array([2, 1, 2, 3]));
    await decoder.enqueue(new Uint8Array([0, ...HELLO_TERMINAL]));

    expect(errors).toHaveLength(1);
    expect(writes).toEqual([]);
  });
});
