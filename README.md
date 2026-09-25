# Demain in blocks (ptitbelliveau)

P'tit Belliveau's Demain clip, rebuilt as a grid of blocks that plays in your browser. The sound comes from the official YouTube video and the lyrics come from LRCLIB.

It lives at https://lululombard.github.io/ptitbelliveau/

## Watching it

Open the page and hit play. The small YouTube player in the corner is where the sound comes from, so leave it be.

- Space or `k` plays and pauses
- `f` goes fullscreen, double-clicking the blocks works too
- `c` turns the lyrics on or off
- The arrow keys skip 5 seconds

If your browser wants the very first play to happen on the YouTube player itself, that's its autoplay rules talking. Hit play there once and the blocks follow.

## Running it on your machine

The page has to be served over http. Opening `index.html` straight from disk won't work, since YouTube wants a real origin and the page fetches `events.bin`.

```bash
python3 -m http.server 8123
```

Then open http://localhost:8123. That server doesn't send cache headers, so hard-refresh (Cmd+Shift+R) after you change something.

## Rebuilding events.bin

You only need this if you touch `extract.py`. You'll need `ffmpeg`, `python3` with `numpy`, and your own 1080p copy of the clip in `work/clip_hd.mp4` (`work/` is gitignored).

```bash
python3 extract.py work/clip_hd.mp4 events.bin
```

It takes about a minute here and spits out an 83 KB file.

## Finding your way around

- `extract.py` reads the video through ffmpeg, samples the middle of every half-cell, snaps it to the clip's 11 colors, and writes only what changed, as runs, gzipped
- `replay.js` unzips and decodes that, then draws it the way the clip does: same-color neighbors merge, with a 5px black line wherever two colors meet
- `index.html` is the page itself. It follows the YouTube player's clock, so the blocks stay within a frame of the sound
- `viewer.html` plays the blocks with no sound, steps frame by frame with the arrow keys, and opens any `.bin` you drop on it

The clip is drawn on a 57 x 32 grid, but we sample 114 x 64. Blame the boat around 2:20, it sails in half-cell steps.

## Comparing it with the real clip

- The whole 3:44 replay fits in 83 KB. That's 3.1 seconds' worth of YouTube's 1080p version of the clip, whose video alone is 6 MB, so this is 72 times smaller
- Held up against 20 frames of the real 1080p clip, 98.3% of pixels match on average, and 96.4% on the busiest frame. Every pixel that's off sits within 3px of a black line, so it's line edges, not wrong blocks
- It's 6,739 frames at 30 fps, drawn from 11 colors, stored as 802,583 runs of changed cells

## Committing changes

:warning: Never commit the song's audio or the source video. The `.gitignore` keeps `work/`, `*.mp4` and `*.m4a` out, so keep it that way.

## Living with the rough edges

- The end credits from 3:36 aren't grid art, so the logos come out as rough blocks
- No YouTube means no sound and no clock. `viewer.html` still plays the blocks silently
- The lyrics on LRCLIB are timed for the album version, so we show each line 0.75s early to line up with the clip. If LRCLIB is down or someone edits that entry, you get no lyrics or odd timing
- There's no fullscreen button on iPhone, since Safari there can't fullscreen part of a page
- It's been tested in Firefox, Chrome and Safari on a Mac, phones not so much
