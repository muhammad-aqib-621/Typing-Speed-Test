# KeyFlow

A fully client-side typing speed test and practice trainer. No build tools, no dependencies, no accounts. Everything runs locally in your browser.

## Table of Contents

- [Getting Started](#getting-started)
- [Features](#features)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Project Structure](#project-structure)
- [Scoring](#scoring)
- [React Rewrite](#react-rewrite)

## Getting Started

Open `index.html` in any modern browser (Chrome, Edge, or Firefox).

To serve it over HTTP instead:

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080`.

> KeyFlow is designed for a physical keyboard on desktop. Virtual-keyboard events are unreliable.

## Features

### Typing Test

| Mode | Description |
| --- | --- |
| Time | 15, 30, 60, or 120 seconds with a live countdown |
| Words | 10, 25, 50, or 100 words; ends automatically at the last word |
| Quote | Random quotes with attribution |
| Custom text | Paste any text (a paragraph, code snippet, homework) and practice on it. The test ends when the text is finished, and the text is remembered between visits |

Test options:

- **Five difficulty levels:** beginner (most common, shortest words), easy, medium, hard (advanced vocabulary), and expert (rare, long, technical words)
- **Next-word suggestions:** the upcoming three words appear under the text, with the immediate next word underlined. Can be disabled in settings
- **Punctuation and numbers:** injected realistically, with sentence capitalisation and mixed symbols
- **Live stats:** timer or word counter, WPM, and accuracy update as you type
- **Live WPM chart:** net and raw WPM sampled every second, with error markers
- **Progress meter:** a thin bar under the mode selector shows time or word progress
- **Focus mode:** the top bar and config fade away while you type

### Results

- WPM, accuracy, raw WPM, consistency, character breakdown, and a per-second chart
- Grade badge (S to E) and a comparison against your recent average
- Dashed average and best reference lines on the chart, with hover tooltips for exact per-second values
- Personal-best tracking with toast notifications
- **Weak keys drill:** lists your most-missed keys and starts a targeted practice lesson in one click
- **Share results:** copies a formatted result card (WPM, accuracy, consistency) to the clipboard

### Practice

Twelve structured lessons covering home row, top row, bottom row, numbers row, capitals and Shift, punctuation, common words, advanced vocabulary, and a speed drill.

- On-screen keyboard highlights the exact next key, including Shift combinations
- Per-lesson pass thresholds (WPM and accuracy)
- Saved best scores and progress indicators
- Lesson roadmap of twelve numbered dots below the keyboard; click any to jump to that lesson

### History and Statistics

- Every run is logged with mode, WPM, raw WPM, accuracy, consistency, errors, and duration
- Summary cards: best WPM, average of last 10, average accuracy, streak, tests today, and total time typed
- Personal bests tracked per test mode, with a mini WPM bar on each row
- Clear history at any time

### Customisation

- Dark and light themes
- Five accent colors (teal, amber, violet, rose, sky) applied to the caret, highlights, charts, and buttons
- Adjustable text size
- Three caret styles, with optional smooth movement
- Sound feedback generated with WebAudio (no audio files)
- Help dialog (`?`) covering shortcuts, modes, and scoring definitions
- Reduced-motion support and focus-visible outlines
- Open Graph meta tags so shared links preview correctly
- All data stored in `localStorage`; history and settings can be cleared at any time

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Tab` | Start a new test |
| `Esc` | Restart with the same words |
| `Enter` | Next test |
| `?` | Open help dialog |

## Project Structure

```
index.html          Markup
css/style.css       Design system and themes
js/words.js         Word banks, quotes, and lessons
js/keyboard.js      On-screen keyboard rendering
js/chart.js         Dependency-free canvas chart
js/main.js          Engine, test and practice controllers, history, settings
```

## Scoring

| Metric | Formula |
| --- | --- |
| WPM | (correct characters / 5) / elapsed minutes |
| Raw WPM | (all typed characters / 5) / elapsed minutes |
| Accuracy | correct / (correct + wrong + extra characters) |

## React Rewrite

A modern rebuild of the tester is included in this workspace under `typeio/` (Next.js App Router, TypeScript, Tailwind v4). See [`typeio/README.md`](typeio/README.md) for details.

From the workspace root:

```bash
# first time only
npm --prefix typeio install

npm run dev
```

Or from inside `typeio/`:

```bash
npm install && npm run dev
```
