#!/usr/bin/env bash
# fetch-noise.sh — download DEMAND 16 kHz noise recordings from Zenodo
# (record 1227121) for 3 field-service-like scenarios, consolidate ONE
# channel per scenario into a 24 kHz mono PCM16 wav, delete the rest.
#
#   bash scripts/fetch-noise.sh            # DKITCHEN SPSQUARE OOFFICE
#   SCENARIOS="DKITCHEN OOFFICE" bash scripts/fetch-noise.sh
#
# Output: .data/noise/<SCEN>/noise-24k.wav + source.json, plus
# .data/noise/manifest.json. Target: well under 400 MB kept on disk
# (the ~100 MB zips are deleted after consolidation).
#
# Env:
#   NOISE_DIR    output dir        (default: <repo>/.data/noise)
#   SCENARIOS    space-separated DEMAND environment names (16k zips)
#   ZENODO_REC   zenodo record id  (default: 1227121)
#   FFPEG/FFMPEG ffmpeg binary     (default: ffmpeg)
#   FFPROBE      ffprobe binary    (default: ffprobe)
#   CURL         curl binary       (default: curl)
#
# Fallback: if Zenodo is unreachable after 3 tries per file, a PLACEHOLDER
# noise (pink/machinery approximation via ffmpeg anoisesrc, clearly labeled
# in the filename, source.json and manifest) is generated so the mixing
# pipeline stays testable. The blocker must be recorded in docs/D2-GATE.md.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
NOISE_DIR="${NOISE_DIR:-$ROOT/.data/noise}"
SCENARIOS="${SCENARIOS:-DKITCHEN SPSQUARE OOFFICE}"
ZENODO_REC="${ZENODO_REC:-1227121}"
FFMPEG_BIN="${FFMPEG:-ffmpeg}"
FFPROBE_BIN="${FFPROBE:-ffprobe}"
CURL_BIN="${CURL:-curl}"
API="https://zenodo.org/api/records/$ZENODO_REC"

mkdir -p "$NOISE_DIR"
WORK="$(mktemp -d "$NOISE_DIR/.fetch.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# fetch <url> <dest> : 3 attempts
fetch() {
  local url="$1" dest="$2" i
  for i in 1 2 3; do
    echo "  download attempt $i: $(basename "$url")"
    if "$CURL_BIN" -L --fail --retry 2 --retry-delay 5 --connect-timeout 30 \
        --progress-bar -o "$dest" "$url"; then
      [ -s "$dest" ] && return 0
    fi
    sleep 5
  done
  return 1
}

# placeholder <scen> <kind> : synthetic stand-in, clearly labeled
gen_placeholder() {
  local scen="$1" kind="$2" out="$NOISE_DIR/$scen"
  mkdir -p "$out"
  local f="$out/noise-24k-PLACEHOLDER.wav"
  echo "  !! PLACEHOLDER noise ($kind) — not DEMAND; document in docs/D2-GATE.md"
  case "$kind" in
    pink) "$FFMPEG_BIN" -y -loglevel error -f lavfi \
            -i "anoisesrc=color=pink:sample_rate=24000:duration=300:amplitude=0.30" \
            -ar 24000 -ac 1 -c:a pcm_s16le "$f" ;;
    machinery) "$FFMPEG_BIN" -y -loglevel error -f lavfi \
            -i "anoisesrc=color=brown:sample_rate=24000:duration=300:amplitude=0.22" \
            -f lavfi -i "sine=frequency=120:sample_rate=24000:duration=300" \
            -filter_complex "[1:a]volume=0.10,tremolo=f=8:d=0.7[h];[0:a][h]amix=inputs=2:duration=first:normalize=0" \
            -ar 24000 -ac 1 -c:a pcm_s16le "$f" ;;
  esac
  cat > "$out/source.json" <<EOF
{
  "scenario": "$scen",
  "placeholder": true,
  "placeholder_kind": "$kind",
  "note": "Zenodo unreachable; synthetic stand-in. Mixing pipeline testable; SNR results are NOT DEMAND-field-representative. Record the blocker in docs/D2-GATE.md.",
  "zenodo_record": "$ZENODO_REC"
}
EOF
}

echo "[fetch-noise] scenarios: $SCENARIOS"
echo "[fetch-noise] record:    $API"

declare -A STATUS
for SCEN in $SCENARIOS; do
  ZIP="$SCEN"_16k.zip
  URL="$API/files/$ZIP/content"
  OUT="$NOISE_DIR/$SCEN"
  echo "[fetch-noise] === $SCEN ($ZIP) ==="

  if [ -s "$OUT/noise-24k.wav" ] || [ -s "$OUT/noise-24k-PLACEHOLDER.wav" ]; then
    echo "  already consolidated, skipping (delete $OUT to re-fetch)"
    STATUS[$SCEN]="cached"
    continue
  fi

  if ! fetch "$URL" "$WORK/$ZIP"; then
    echo "  ZENODO UNREACHABLE for $ZIP"
    case "$SCEN" in
      DKITCHEN)   gen_placeholder "$SCEN" machinery ;;
      SPSQUARE)   gen_placeholder "$SCEN" pink ;;
      *)          gen_placeholder "$SCEN" pink ;;
    esac
    STATUS[$SCEN]="PLACEHOLDER"
    continue
  fi

  # Provenance: the zip's md5 from the record metadata + local md5 of the
  # consolidated wav (node is a repo requirement; JSON in bash is fragile).
  SUM="$( ("$CURL_BIN" -sS --max-time 30 "$API" | node -e '
    let s = ""; process.stdin.on("data", (d) => { s += d; });
    process.stdin.on("end", () => {
      try {
        const zip = process.argv[1];
        const f = (JSON.parse(s).files || []).find((x) => x.key === zip);
        if (f) console.log(f.checksum || "");
      } catch { /* best effort */ }
    });' "$ZIP") || true)"
  mkdir -p "$WORK/$SCEN" "$OUT"
  unzip -o -q "$WORK/$ZIP" -d "$WORK/$SCEN"

  # Keep ONE channel (first ch*.wav / *.wav in sort order) of the multichannel
  # set; DEMAND zips carry per-channel mono wavs.
  SRC="$(find "$WORK/$SCEN" -type f -iname '*.wav' | sort | head -1)"
  if [ -z "$SRC" ]; then
    echo "  !! no wav inside $ZIP — generating placeholder"
    gen_placeholder "$SCEN" pink
    STATUS[$SCEN]="PLACEHOLDER"
    continue
  fi
  NCH="$(find "$WORK/$SCEN" -type f -iname '*.wav' | wc -l)"
  echo "  consolidating 1 of $NCH channel files: $(basename "$SRC")"
  "$FFMPEG_BIN" -y -loglevel error -i "$SRC" -ar 24000 -ac 1 -c:a pcm_s16le "$OUT/noise-24k.wav"
  DUR="$("$FFPROBE_BIN" -v error -show_entries format=duration -of default=nw=1:nk=1 "$OUT/noise-24k.wav")"
  WAV_MD5="$(md5sum "$OUT/noise-24k.wav" | cut -d" " -f1)"
  rm -rf "$WORK/$SCEN" "$WORK/$ZIP"

  cat > "$OUT/source.json" <<EOF
{
  "scenario": "$SCEN",
  "placeholder": false,
  "dataset": "DEMAND (multi-channel environmental noise recordings)",
  "zenodo_record": "$ZENODO_REC",
  "file": "$ZIP",
  "url": "$URL",
  "zip_checksum": "${SUM:-unavailable}",
  "consolidated_wav_md5": "${WAV_MD5:-unavailable}",
  "channel_file_kept": "$(basename "$SRC")",
  "channels_in_zip": $NCH,
  "converted": { "sample_rate": 24000, "channels": 1, "codec": "pcm_s16le", "duration_s": "$DUR" },
  "license_note": "DEMAND is distributed via Zenodo for research use; cite the record in any published results."
}
EOF
  STATUS[$SCEN]="ok"
done

# Overall manifest
{
  echo '{'
  echo '  "dataset": "DEMAND via Zenodo record '"$ZENODO_REC"'",'
  echo '  "scenarios": ['
  FIRST=1
  for SCEN in $SCENARIOS; do
    [ $FIRST -eq 0 ] && echo '    ,'
    FIRST=0
    PH=false; [ "${STATUS[$SCEN]}" = "PLACEHOLDER" ] && PH=true
    echo '    { "scenario": "'"$SCEN"'", "status": "'"${STATUS[$SCEN]}"'", "placeholder": '"$PH"', "file": "'"$SCEN"'/noise-24k'"$([ "$PH" = true ] && echo -n -PLACEHOLDER)"'.wav" }'
  done
  echo ''
  echo '  ]'
  echo '}'
} > "$NOISE_DIR/manifest.json"

echo "[fetch-noise] DONE -> $NOISE_DIR"
for SCEN in $SCENARIOS; do
  echo "  $SCEN: ${STATUS[$SCEN]}"
done
du -sh "$NOISE_DIR" || true
