# Slide deck (submission-required PDF)

`voice-incident-reporter-deck.pdf` — 11 slides, 16:9, EN, built from `deck.html`.
All figures are verbatim from [README.md](../../README.md) §Metrics and
[docs/SUBMISSION.md](../SUBMISSION.md); the deck introduces no new claims.

## Rebuild

The source is plain HTML+CSS with no dependencies; any headless Chromium
print-to-pdf works. Example:

```bash
chrome-headless-shell --headless --disable-gpu --no-sandbox \
  --print-to-pdf=docs/deck/voice-incident-reporter-deck.pdf \
  --no-pdf-header-footer file://"$PWD/docs/deck/deck.html"
```

(Google Chrome: `google-chrome --headless=new …` with the same flags.)
The PDF is committed so the submission link field can point at the repo
directly; regenerate it whenever `deck.html` changes.
