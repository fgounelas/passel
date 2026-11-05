export function parseTerminalScrollSpeed(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(50, Math.min(300, Math.round(value / 25) * 25)) : 100;
}

/** Preserve sub-line trackpad movement without rounding each event up. */
export class WheelLineAccumulator {
  private remainder = 0;
  private lastTime = -Infinity;
  take(delta: number, now: number) {
    if (now - this.lastTime > 150 || delta * this.remainder < 0) this.remainder = 0;
    this.lastTime = now;
    this.remainder += delta;
    const lines = Math.trunc(this.remainder);
    this.remainder -= lines;
    return lines || 0;
  }
}

/** One bounded animation per renderer; never holds terminal history. */
export class TerminalTouchMomentum {
  private frame: number | null = null;
  private velocity = 0;
  private generation = 0;
  private sampleTime = 0;
  constructor(private readonly send: (lines: number) => void) {}

  stop = () => {
    this.generation++;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.velocity = 0;
  };

  begin(now: number) {
    this.stop();
    this.sampleTime = now;
  }

  sample(lines: number, now: number) {
    const elapsed = now - this.sampleTime;
    if (elapsed <= 0) return;
    const speed = Math.max(-0.25, Math.min(0.25, lines / Math.max(8, elapsed)));
    this.velocity = elapsed > 100 || speed * this.velocity < 0
      ? speed : this.velocity * 0.35 + speed * 0.65;
    this.sampleTime = now;
  }

  release(now: number) {
    if (now - this.sampleTime > 100 || Math.abs(this.velocity) < 0.015) {
      this.stop();
      return;
    }
    const generation = this.generation;
    const velocity = this.velocity;
    let previous = now;
    let pending = 0;
    const tick = (time: number) => {
      this.frame = null;
      const age = time - now;
      if (age > 1000 || time - previous > 100) { this.stop(); return; }
      if (time - previous >= 32) {
        // Integrate exponential decay, independent of display refresh rate.
        pending += velocity * 220 * (Math.exp(-(previous - now) / 220) - Math.exp(-age / 220));
        previous = time;
        const lines = Math.trunc(pending);
        pending -= lines;
        if (lines) this.send(lines);
      }
      if (generation !== this.generation) return;
      if (Math.abs(velocity * Math.exp(-age / 220)) < 0.004) { this.stop(); return; }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
}
