"""Generate natural narration clips for the demo video with Kokoro (open-source neural TTS, runs locally).

    pip install "kokoro>=0.9" soundfile "misaki[en]"   # plus `brew install espeak-ng`
    node video/record.js --export-script               # writes video/out/narration.json
    python video/tts.py [voice]                        # writes video/voice/s00.wav ... (default voice: af_heart)
    node video/record.js http://localhost:3100         # picks the clips up automatically

Voices: af_heart, af_bella, af_nicole (female) · am_michael, am_fenrir, am_puck (male) · bf_emma, bm_george (British)
"""
import json, re, sys
from pathlib import Path
import numpy as np
import soundfile as sf

# espeakng-loader's bundled data path is broken on some macOS installs; prefer Homebrew's espeak-ng
try:
    import espeakng_loader
    for prefix in ("/opt/homebrew", "/usr/local"):
        if Path(f"{prefix}/share/espeak-ng-data").exists():
            espeakng_loader.get_data_path = lambda p=prefix: f"{p}/share/espeak-ng-data"
            espeakng_loader.get_library_path = lambda p=prefix: f"{p}/lib/libespeak-ng.dylib"
            break
except ImportError:
    pass
from kokoro import KPipeline

HERE = Path(__file__).parent
voice = sys.argv[1] if len(sys.argv) > 1 else "af_heart"
speed = float(sys.argv[2]) if len(sys.argv) > 2 else 1.05
scenes = json.loads((HERE / "out" / "narration.json").read_text())
out = HERE / "voice"
out.mkdir(exist_ok=True)

# spellings written for macOS `say`, rewritten for a neural voice
FIXES = [
    (r"are-you-a-geni\.us", "are-you-a-genius"), (r"\bdot U S\b", "dot U.S."), (r"\bgeni dot u s\b", "geni dot U.S."),
    (r"\bI D\b", "ID"), (r"\bGenius I Q\b", "Genius IQ"), (r"\bL M S R\b", "L.M.S.R."), (r"point zero five SOL", "0.05 sol"),
    (r"\bSOL\b", "sol"), (r"\bset window fields\b", "set-window-fields"), (r"load bearing", "load-bearing"),
]
pipe = KPipeline(lang_code="b" if voice[0] == "b" else "a", repo_id="hexgrad/Kokoro-82M")
lead = np.zeros(int(24000 * 0.15), dtype=np.float32)
for s in scenes:
    text = s["text"]
    for a, b in FIXES:
        text = re.sub(a, b, text)
    audio = np.concatenate([np.asarray(a) for _, _, a in pipe(text, voice=voice, speed=speed)])
    sf.write(out / f"{s['id']}.wav", np.concatenate([lead, audio, lead]), 24000)
    print(f"{s['id']}  {len(audio) / 24000:5.1f}s  {text[:70]}…")
print(f"wrote {len(scenes)} clips to {out} with voice {voice}")
