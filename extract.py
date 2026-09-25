#!/usr/bin/env python3
"""Turn a block-grid video into a stream of cell change events.

Usage: python3 extract.py video.mp4 out.bin [--start 0] [--duration 5]

Reads the video through ffmpeg at 1920x1080, samples the middle of every
half-cell, snaps it to the palette, and writes only the ones that changed.
"""
import argparse
import gzip
import struct
import subprocess

import numpy as np

# The art sits on a 57x32 grid, but some of it (like the boat around 2:20)
# moves in half-cell steps, so we sample a grid twice as fine each way
COLS, ROWS = 57 * 2, 32 * 2
W, H = 1920, 1080
# The outer frame's black line is centered 2.5px in from each edge
X0, Y0 = 2.5, 2.5
PX, PY = 1915 / COLS, 1075 / ROWS

PALETTE = np.array([
    (0x00, 0x00, 0x00),  # black, also what the borders are made of
    (0x00, 0x9c, 0xe3),  # blue
    (0xfd, 0x18, 0x31),  # red
    (0x00, 0x81, 0x3e),  # green
    (0xfd, 0xc8, 0x00),  # yellow
    (0x95, 0xaa, 0xb0),  # grey
    (0xfe, 0x65, 0xd1),  # pink
    (0xa3, 0x03, 0x95),  # purple
    (0xfe, 0xfe, 0xfe),  # white
    (0xfd, 0xb9, 0xb7),  # light pink
    (0xb4, 0x60, 0x00),  # brown
])

# A sample further than this from every palette color is a fade or blur,
# so we keep whatever the cell was before instead of guessing.
MAX_DIST = 60


def sample_points():
    cx = np.round(X0 + PX * (np.arange(COLS) + 0.5)).astype(int)
    cy = np.round(Y0 + PY * (np.arange(ROWS) + 0.5)).astype(int)
    return cx, cy


def classify(frame, cx, cy, prev):
    # 5x5 spread of samples around each half-cell center, median kills
    # speckles, and +-4px stays clear of the 5px border lines
    offs = range(-4, 5, 2)
    patch = np.stack([frame[cy[:, None] + dy, cx[None, :] + dx] for dy in offs for dx in offs])
    color = np.median(patch, axis=0).reshape(-1, 3)
    dist = np.linalg.norm(color[:, None, :] - PALETTE[None, :, :], axis=2)
    idx = dist.argmin(axis=1)
    sure = dist.min(axis=1) < MAX_DIST
    return np.where(sure, idx, prev).astype(np.uint8)


def runs(changed, cur):
    """Group changed cells into runs of neighbors that got the same color."""
    out = []
    for cell in changed:
        cell, color = int(cell), int(cur[cell])
        if out and out[-1][0] + out[-1][1] == cell and out[-1][2] == color:
            out[-1][1] += 1
        else:
            out.append([cell, 1, color])
    return out


def varint(v):
    out = bytearray()
    while v >= 0x80:
        out.append(v & 0x7F | 0x80)
        v >>= 7
    out.append(v)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--start", type=float, default=0)
    ap.add_argument("--duration", type=float)
    ap.add_argument("--fps", type=int, default=30)
    args = ap.parse_args()

    cmd = ["ffmpeg", "-v", "error", "-ss", str(args.start)]
    if args.duration:
        cmd += ["-t", str(args.duration)]
    cmd += ["-i", args.video, "-vf", f"fps={args.fps},scale={W}:{H}",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)

    cx, cy = sample_points()
    prev = np.zeros(COLS * ROWS, np.uint8)
    frames = []
    size = W * H * 3
    while True:
        buf = proc.stdout.read(size)
        if len(buf) < size:
            break
        frame = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(int)
        cur = classify(frame, cx, cy, prev)
        changed = np.nonzero(cur != prev)[0] if frames else np.arange(COLS * ROWS)
        frames.append(runs(changed, cur))
        prev = cur

    # Each frame is a run count, then per run the cells skipped since the
    # last run and its length shifted left 4 with the color in the low bits,
    # all varints. Gzipped with mtime 0 so the same video gives the same file.
    assert len(PALETTE) <= 16
    out = bytearray(b"BLK2")
    out += struct.pack("<BBBB", COLS, ROWS, args.fps, len(PALETTE))
    out += PALETTE.astype(np.uint8).tobytes()
    out += struct.pack("<I", len(frames))
    for frame_runs in frames:
        out += varint(len(frame_runs))
        pos = 0
        for start, length, color in frame_runs:
            out += varint(start - pos) + varint(length << 4 | color)
            pos = start + length
    packed = gzip.compress(bytes(out), compresslevel=9, mtime=0)
    with open(args.out, "wb") as f:
        f.write(packed)

    total = sum(len(r) for r in frames)
    print(f"{len(frames)} frames, {total} runs, {len(packed) / 1000:.0f} KB written to {args.out}")


if __name__ == "__main__":
    main()
