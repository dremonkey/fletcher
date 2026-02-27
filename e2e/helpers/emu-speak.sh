#!/usr/bin/env bash
set -euo pipefail

# emu-speak.sh — Inject audio into the Android emulator's microphone via PipeWire
#
# Usage:
#   ./emu-speak.sh <wav-file>              Play a WAV file into the emulator mic
#   ./emu-speak.sh --tone [duration]       Generate and play a 440Hz sine tone (default: 2s)
#   ./emu-speak.sh --speech [duration]     Generate and play speech-like audio (default: 3s)
#
# Requires: pw-cat, pw-cli, ffmpeg (for tone/speech generation)
#
# The script finds the emulator's PipeWire input node and routes audio directly
# to it, bypassing the physical microphone.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAPTURES_DIR="$SCRIPT_DIR/../captures"
FFMPEG="${FFMPEG:-$(command -v ffmpeg 2>/dev/null || echo "")}"

mkdir -p "$CAPTURES_DIR"

die() { echo "FAIL  $*" >&2; exit 1; }

# --- Find emulator's PipeWire input node serial ---
find_emu_input_serial() {
    local serial
    # The node block has object.serial before media.class, so grab enough
    # context before the media.class line to capture both serial and app name.
    serial=$(pw-cli list-objects 2>/dev/null \
        | command grep -B8 'media.class = "Stream/Input/Audio"' \
        | command grep -B6 'qemu-system-x86_64' \
        | command grep 'object.serial' \
        | command grep -oP '\d+' \
        | head -1)

    if [ -z "$serial" ]; then
        die "Cannot find emulator audio input node in PipeWire. Is the emulator running?"
    fi
    echo "$serial"
}

# --- Generate a sine tone WAV ---
generate_tone() {
    local duration="${1:-2}"
    local outfile="$CAPTURES_DIR/_tone_${duration}s.wav"

    if [ -z "$FFMPEG" ]; then
        die "ffmpeg not found. Set FFMPEG= or provide a WAV file instead."
    fi

    "$FFMPEG" -y -f lavfi -i "sine=frequency=440:duration=${duration}" \
        -ar 48000 -ac 1 -sample_fmt s16 "$outfile" \
        -loglevel error 2>&1
    echo "$outfile"
}

# --- Generate speech-like audio (vowel formants + amplitude modulation) ---
generate_speech() {
    local duration="${1:-3}"
    local outfile="$CAPTURES_DIR/_speech_${duration}s.wav"

    if [ -z "$FFMPEG" ]; then
        die "ffmpeg not found. Set FFMPEG= or provide a WAV file instead."
    fi

    # Simulate speech: mix formant frequencies typical of vowel sounds
    # with amplitude modulation to mimic natural speech rhythm.
    # F1~500Hz, F2~1500Hz, F3~2500Hz with slow AM at ~4Hz (syllable rate)
    "$FFMPEG" -y \
        -f lavfi -i "sine=frequency=500:duration=${duration}" \
        -f lavfi -i "sine=frequency=1500:duration=${duration}" \
        -f lavfi -i "sine=frequency=2500:duration=${duration}" \
        -f lavfi -i "sine=frequency=4:duration=${duration}" \
        -filter_complex "[0][1]amix=inputs=2[mix1];[mix1][2]amix=inputs=2[mix2];[mix2][3]amix=inputs=2:weights=8 1[out]" \
        -map "[out]" -ar 48000 -ac 1 -sample_fmt s16 "$outfile" \
        -loglevel error 2>&1
    echo "$outfile"
}

# --- Play WAV into emulator mic ---
play_to_emu() {
    local wav_file="$1"
    local serial

    if [ ! -f "$wav_file" ]; then
        die "WAV file not found: $wav_file"
    fi

    serial=$(find_emu_input_serial)
    echo "Injecting $(basename "$wav_file") → emulator mic (PipeWire node $serial)"

    pw-cat --playback --target="$serial" "$wav_file" 2>&1
    echo "Done"
}

# --- Main ---
if [ $# -lt 1 ]; then
    echo "Usage: emu-speak.sh <wav-file>|--tone [duration]|--speech [duration]" >&2
    exit 1
fi

case "$1" in
    --tone)
        wav=$(generate_tone "${2:-2}")
        play_to_emu "$wav"
        ;;
    --speech)
        wav=$(generate_speech "${2:-3}")
        play_to_emu "$wav"
        ;;
    *)
        play_to_emu "$1"
        ;;
esac
