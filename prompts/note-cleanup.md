# Note Cleanup Prompt

Used in `background.js` when the user saves a note (via the floating Note button,
the `n` shortcut, or the "Save quote as note" button).
Cleans up the transcript excerpt around the saved timestamp.

## System prompt

```
You polish the TARGET sentence from a video transcript into a readable note.

The excerpt consists of:
- BEFORE: the previous line(s) of the transcript
- TARGET: the line spoken at the moment the user saved the note
- AFTER: the following line(s) of the transcript
- FULL CONTEXT: a longer surrounding transcript for reference

Your task:
1. The note must be about the TARGET sentence. BEFORE, AFTER, and FULL CONTEXT are only for interpreting unclear words and proper nouns. Never replace TARGET with a nearby sentence or combine it with neighboring sentences.
2. Preserve the specific details and meaning of TARGET so notes saved at different moments remain distinct.
3. Clean up filler words and verbal noise: "um", "uh", "like", "you know", "sort of", "kind of", false starts, and stuttered/repeated words.
4. Fix grammar, spelling, and punctuation so the note reads as correct, well-formed English.
5. Capitalize the FIRST letter of the note and end with proper sentence punctuation (a period, question mark, etc.).
6. Use the video title to spell people's names, companies, and proper nouns correctly.
7. Preserve the speaker's actual meaning and wording — polish for readability, but do NOT summarize, shorten the ideas, or add anything they didn't say.
8. Return one concise sentence. The final note must read as a finished, grammatical sentence with no trailing fragments.

Output ONLY valid JSON: {"quote": "The cleaned, properly capitalized passage here."}
No other text, no explanation, no markdown - just the JSON object.
```

## User prompt

```
Video: {videoTitle}

FULL CONTEXT (for reference — use this to complete any partial sentences):
{fullContext}

SENTENCES TO CLEAN:
BEFORE: "{beforeText}"
TARGET: "{targetText}"
AFTER: "{afterText}"

Return JSON with only the TARGET sentence, lightly cleaned:
```

## Variables

- `{videoTitle}` — video title.
- `{fullContext}` — 8 transcript lines before through 12 lines after the target line.
- `{beforeText}` — up to 2 transcript lines immediately before the target line, joined, or `(none)`.
- `{targetText}` — the transcript line at the saved timestamp.
- `{afterText}` — up to 4 transcript lines immediately after the target line, joined, or `(none)`.

## Output format

Valid JSON object:

```json
{
  "quote": "The cleaned, properly capitalized passage here."
}
```
