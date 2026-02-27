#!/usr/bin/env bash
set -euo pipefail

# emu-speak.sh — Inject audio into the Android emulator's microphone via PipeWire
#
# Usage:
#   ./emu-speak.sh <fixture-name>                  Play a committed fixture WAV
#   ./emu-speak.sh --generate "text" <name>        Generate a new fixture via Cartesia TTS
#   ./emu-speak.sh --file <wav-file>               Play an arbitrary WAV file
#   ./emu-speak.sh --tone [duration]               Generate and play a 440Hz sine tone
#
# Fixtures live in e2e/fixtures/audio/<name>.wav and should be committed to git.
# Use --generate once when adding a new test case, then reference by name.
#
# Environment:
#   CARTESIA_API_KEY    Required for --generate (loaded from .env if present)
#   CARTESIA_VOICE_ID   Voice to use (default: Barbershop Man)
#   CARTESIA_MODEL      Model to use (default: sonic-3)
#   FFMPEG              Path to ffmpeg binary (required for --tone only)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/../.."
FIXTURES_DIR="$SCRIPT_DIR/../fixtures/audio"
FFMPEG="${FFMPEG:-$(command -v ffmpeg 2>/dev/null || echo "")}"

# Default Cartesia voice: "Barbershop Man" (commonly used in examples)
CARTESIA_VOICE_ID="${CARTESIA_VOICE_ID:-a0e99841-438c-4a64-b679-ae501e7d6091}"
CARTESIA_MODEL="${CARTESIA_MODEL:-sonic-3}"

mkdir -p "$FIXTURES_DIR"

die() { echo "FAIL  $*" >&2; exit 1; }

# --- Load .env if CARTESIA_API_KEY is not set ---
load_env() {
    if [ -n "${CARTESIA_API_KEY:-}" ]; then
        return
    fi
    local env_file="$REPO_ROOT/.env"
    if [ -f "$env_file" ]; then
        local val
        val=$(command grep '^CARTESIA_API_KEY=' "$env_file" | head -1 | cut -d= -f2-)
        if [ -n "$val" ]; then
            export CARTESIA_API_KEY="$val"
        fi
    fi
}

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

# --- Generate a fixture via Cartesia TTS (one-time) ---
generate_fixture() {
    local text="$1"
    local name="$2"
    local outfile="$FIXTURES_DIR/${name}.wav"

    if [ -f "$outfile" ]; then
        echo "Fixture already exists: $outfile"
        echo "Delete it first if you want to regenerate."
        return
    fi

    load_env
    if [ -z "${CARTESIA_API_KEY:-}" ]; then
        die "CARTESIA_API_KEY not set. Add it to .env or export it."
    fi

    echo "Generating fixture: \"$text\" → $name.wav"

    local response_code
    response_code=$(curl -s -w '%{http_code}' -o "$outfile" \
        --request POST \
        --url 'https://api.cartesia.ai/tts/bytes' \
        --header "Authorization: Bearer ${CARTESIA_API_KEY}" \
        --header 'Cartesia-Version: 2025-04-16' \
        --header 'Content-Type: application/json' \
        --data "$(cat <<ENDJSON
{
    "model_id": "${CARTESIA_MODEL}",
    "transcript": $(printf '%s' "$text" | jq -Rs .),
    "voice": {
        "mode": "id",
        "id": "${CARTESIA_VOICE_ID}"
    },
    "output_format": {
        "container": "wav",
        "encoding": "pcm_s16le",
        "sample_rate": 48000
    },
    "language": "en"
}
ENDJSON
)")

    if [ "$response_code" != "200" ]; then
        local err
        err=$(cat "$outfile" 2>/dev/null || echo "unknown error")
        rm -f "$outfile"
        die "Cartesia TTS failed (HTTP $response_code): $err"
    fi

    # Verify we got a valid WAV (should start with RIFF header)
    if ! head -c4 "$outfile" | command grep -q 'RIFF'; then
        local err
        err=$(cat "$outfile" 2>/dev/null || echo "unknown error")
        rm -f "$outfile"
        die "Cartesia TTS returned invalid WAV: $err"
    fi

    local size
    size=$(du -h "$outfile" | cut -f1)
    echo "Created: $outfile ($size)"
    echo "Commit this file to git so it's available for future test runs."
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

# --- Resolve a fixture name to its WAV path ---
resolve_fixture() {
    local name="$1"
    local wav_file="$FIXTURES_DIR/${name}.wav"

    if [ ! -f "$wav_file" ]; then
        die "Fixture not found: $wav_file
Generate it first with: emu-speak.sh --generate \"your text here\" $name"
    fi
    echo "$wav_file"
}

# --- Main ---
if [ $# -lt 1 ]; then
    cat >&2 <<'USAGE'
Usage: emu-speak.sh <fixture-name>                Play a committed fixture
       emu-speak.sh --generate "text" <name>      Generate a new fixture (one-time)
       emu-speak.sh --file <wav-file>             Play an arbitrary WAV file
       emu-speak.sh --tone [duration-secs]        Play a 440Hz sine tone
USAGE
    exit 1
fi

case "$1" in
    --generate)
        [ $# -ge 3 ] || die "Usage: emu-speak.sh --generate \"text to speak\" <fixture-name>"
        generate_fixture "$2" "$3"
        ;;
    --file)
        [ $# -ge 2 ] || die "Missing WAV file path"
        play_to_emu "$2"
        ;;
    --tone)
        local_tone="/tmp/emu-speak-tone-${2:-2}s.wav"
        if [ ! -f "$local_tone" ]; then
            if [ -z "$FFMPEG" ]; then
                die "ffmpeg not found. Set FFMPEG= or install it."
            fi
            "$FFMPEG" -y -f lavfi -i "sine=frequency=440:duration=${2:-2}" \
                -ar 48000 -ac 1 -sample_fmt s16 "$local_tone" \
                -loglevel error 2>&1
        fi
        play_to_emu "$local_tone"
        ;;
    --help|-h)
        "$0" # re-run with no args to show usage
        ;;
    *)
        wav=$(resolve_fixture "$1")
        play_to_emu "$wav"
        ;;
esac
