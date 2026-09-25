// Decoder and renderer for the BLK2 files extract.py writes, shared by the
// pages. Layout matches the source video: 1920x1080, a 5px black outer frame,
// and a 5px black line wherever two neighbors differ in color. The grid is
// in half-cells, so plain cells are 2x2 blocks that merge back together.
const Replay = (() => {
  const W = 1920, H = 1080;
  const X0 = 2.5, Y0 = 2.5, X1 = 1917.5, Y1 = 1077.5, GAP = 2.5;
  const KEY_EVERY = 30;

  // extract.py gzips its output, and browsers can unzip it natively
  async function load(buf) {
    const head = new Uint8Array(buf, 0, 2);
    if (head[0] === 0x1f && head[1] === 0x8b) {
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
      buf = await new Response(stream).arrayBuffer();
    }
    return parse(buf);
  }

  function parse(buf) {
    const bytes = new Uint8Array(buf);
    const magic = String.fromCharCode(...bytes.subarray(0, 4));
    if (magic !== 'BLK2') throw new Error('not a BLK2 file');
    const cols = bytes[4], rows = bytes[5], fps = bytes[6], n = bytes[7];
    let o = 8;
    const palette = [];
    for (let i = 0; i < n; i++, o += 3) {
      palette.push(`rgb(${bytes[o]},${bytes[o + 1]},${bytes[o + 2]})`);
    }
    const nFrames = new DataView(buf).getUint32(o, true); o += 4;
    const varint = () => {
      let v = 0, shift = 0, b;
      do {
        b = bytes[o++];
        v += (b & 0x7f) * 2 ** shift;
        shift += 7;
      } while (b & 0x80);
      return v;
    };
    // Every frame becomes a flat list of runs: start cell, length, color
    const frames = [];
    for (let f = 0; f < nFrames; f++) {
      const count = varint();
      const runs = new Uint16Array(count * 3);
      let pos = 0;
      for (let i = 0; i < count; i++) {
        pos += varint();
        const packed = varint();
        runs[i * 3] = pos;
        runs[i * 3 + 1] = packed >> 4;
        runs[i * 3 + 2] = packed & 15;
        pos += packed >> 4;
      }
      frames.push(runs);
    }
    // Snapshots so seeking doesn't replay from frame 0 every time
    const keys = [];
    const g = new Uint8Array(cols * rows);
    frames.forEach((ch, f) => {
      apply(g, ch);
      if (f % KEY_EVERY === 0) keys.push(g.slice());
    });
    return { cols, rows, fps, palette, frames, keys, duration: nFrames / fps };
  }

  function apply(g, runs) {
    for (let i = 0; i < runs.length; i += 3) g.fill(runs[i + 2], runs[i], runs[i] + runs[i + 1]);
  }

  // Holds the decoded grid at one frame and walks it to any other frame
  class Cursor {
    constructor(clip) {
      this.clip = clip;
      this.grid = clip.keys[0].slice();
      this.frame = 0;
    }

    // Returns true when the grid moved to a different frame
    seek(target) {
      const { frames, keys } = this.clip;
      target = Math.max(0, Math.min(frames.length - 1, Math.floor(target)));
      if (target === this.frame) return false;
      if (target < this.frame || target - this.frame > KEY_EVERY) {
        const k = Math.floor(target / KEY_EVERY);
        this.grid.set(keys[k]);
        this.frame = k * KEY_EVERY;
      }
      while (this.frame < target) apply(this.grid, frames[++this.frame]);
      return true;
    }
  }

  // Every edge gets rounded to a device pixel once, so merged neighbors
  // share the exact same edge and never show a seam.
  function draw(ctx, clip, grid) {
    const { cols, rows, palette } = clip;
    const cw = ctx.canvas.width, chh = ctx.canvas.height;
    const px = x => Math.round(x * cw / W), py = y => Math.round(y * chh / H);
    const xs = [], ys = [];
    for (let c = 0; c <= cols; c++) xs.push(X0 + (X1 - X0) * c / cols);
    for (let r = 0; r <= rows; r++) ys.push(Y0 + (Y1 - Y0) * r / rows);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, chh);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c, v = grid[i];
        // Same-color neighbors merge, so only inset the sides that face another color
        const x = px(xs[c] + (c > 0 && grid[i - 1] === v ? 0 : GAP));
        const x2 = px(xs[c + 1] - (c < cols - 1 && grid[i + 1] === v ? 0 : GAP));
        const y = py(ys[r] + (r > 0 && grid[i - cols] === v ? 0 : GAP));
        const y2 = py(ys[r + 1] - (r < rows - 1 && grid[i + cols] === v ? 0 : GAP));
        ctx.fillStyle = palette[v];
        ctx.fillRect(x, y, x2 - x, y2 - y);
      }
    }

    // Colors that only touch diagonally still get a square black corner in
    // the video, so blacken every grid point that isn't inside one color
    ctx.fillStyle = '#000';
    for (let r = 1; r < rows; r++) {
      for (let c = 1; c < cols; c++) {
        const i = r * cols + c, v = grid[i];
        if (grid[i - 1] === v && grid[i - cols] === v && grid[i - cols - 1] === v) continue;
        const x = px(xs[c] - GAP), y = py(ys[r] - GAP);
        ctx.fillRect(x, y, px(xs[c] + GAP) - x, py(ys[r] + GAP) - y);
      }
    }
  }

  // Match the canvas backing store to its displayed size, so fullscreen on a
  // retina screen stays sharp. Returns true when the size changed.
  function fitCanvas(canvas) {
    const box = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(box.width * dpr)), h = Math.max(1, Math.round(box.height * dpr));
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    return true;
  }

  return { load, Cursor, draw, fitCanvas };
})();
