// Pluggable speech-to-text interface (T11). Voice notes are transcribed through
// this seam so tests need no real STT service and production can wire any
// provider (Whisper, Google, etc.).
//
//   setTranscriber(async ({ mediaRef }) => 'transcribed text');  // install
//   resetTranscriber();                                          // back to default

// Default transcriber: no real STT wired. Returns a clearly-marked placeholder
// so the request is still recorded and a human can follow up.
async function defaultTranscriber({ mediaRef }) {
  return `[voice note ${mediaRef ?? 'unknown'} — transcription unavailable]`;
}

let transcriber = defaultTranscriber;

/** Install a transcriber: async ({ mediaRef }) => string. */
export function setTranscriber(fn) {
  transcriber = typeof fn === 'function' ? fn : defaultTranscriber;
}

/** Restore the default (placeholder) transcriber. */
export function resetTranscriber() {
  transcriber = defaultTranscriber;
}

/** Transcribe a voice note by its media reference. Never throws. */
export async function transcribe({ mediaRef }) {
  try {
    const text = await transcriber({ mediaRef });
    return (typeof text === 'string' && text.trim())
      ? text.trim()
      : `[voice note ${mediaRef ?? 'unknown'} — empty transcription]`;
  } catch {
    return `[voice note ${mediaRef ?? 'unknown'} — transcription failed]`;
  }
}
