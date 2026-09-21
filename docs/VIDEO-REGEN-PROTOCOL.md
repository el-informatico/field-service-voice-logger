# Protocolo de regeneración — demo video D6

Qué regenerar, con qué comando y qué es determinista vs qué necesita re-grabar
o humano. Todos los comandos citados existen tal cual en el workspace de edición;
los flags de ffmpeg citados son los que usan los scripts (no hay flags inventados).

## Nota operativa: dónde vive cada cosa

- **Workspace de edición = EXTERNO al repo**: directorio hermano de edición
  (de aquí en adelante `$VIDEO_WORKSPACE`). Contiene
  escenas, TTS, take, herramientas, reportes QA. El repo NO lo referencia; el
  único punto de contacto con el repo es `scripts/demo-video.sh` (boot del
  dev-server para el take).
- **Entregables** (fuera del repo, el mp4 pesa >10 MB):
  `$DELIVER` = directorio hermano de entregables del proyecto.
- Convenciones: `$REPO` = este repo; `$VIDEO_WORKSPACE` como arriba. Los comandos
  del workspace se ejecutan desde su raíz.

```bash
REPO=<repo>
VIDEO_WORKSPACE=~/projects/<workspace-hermano-de-video>
DELIVER=~/projects/<dir-hermano-de-entregables>
```

**Requisitos verificados del entorno:** node ≥ 22 · ffmpeg/ffprobe del sistema ·
python3 con `edge_tts` (7.x) · `playwright-core` 1.59 (ya en
`$VIDEO_WORKSPACE/node_modules`) + Chromium del caché de Playwright.

**Gate de QA (obligatorio tras CUALQUIER regeneración):**

```bash
cd "$VIDEO_WORKSPACE" && node tools/qa-lanes.mjs
```

9 lanes deterministas; PASS = última línea `=== 9 lanes, 0 FAIL ===` y exit 0.
Compara `build/demo-video-d6.mp4` contra `build/draft.mp4`, el SRT y
`take/assertions.md` — regenerar el final sin regenerar el draft rompe la lane
`captions-visible`.

**Paso final de entrega (tras 9/9):**

```bash
cp "$VIDEO_WORKSPACE/build/demo-video-d6.mp4" "$DELIVER/demo-video-d6.mp4"
cp "$VIDEO_WORKSPACE/build/captions.srt"      "$DELIVER/demo-video-d6.srt"
```

---

## Matriz cambio → categoría

| Categoría | Qué cubre | Costo | Entry points (raíz `$VIDEO_WORKSPACE` salvo indicación) |
|---|---|---|---|
| **A — re-render determinista local** | Escenas estáticas, valores de la escena de métricas, texto de narración, captions (texto y estilo), duración de beats estáticos, loudnorm, ensamblado/captions quemadas | $0, minutos | `tools/render-scenes.mjs` · `tts/gen.sh` · `tools/assemble.mjs` (+ `--final`) · `tools/make-srt.mjs` |
| **B — re-grabación determinista del take** | Cualquier cambio del footage de la app (beats r1–r7 y e-exports) | $0, ~15–25 min, desatendida | repo: `bash scripts/demo-video.sh` (mock forzado) · workspace: `recorder.mjs` · `tools/anchor-scan.mjs` |
| **C — requiere humano** | Identidad de voz nueva (p. ej. Cartesia Sonic con key del usuario) · footage con API real | key + ~$0.2/take | adaptación de `tts/gen.sh` (hoy solo edge-tts) · sesión en vivo según el runbook de `scripts/demo-video.sh` |

Notas de frontera:

- **TTS:** `tts/gen.sh` genera con `python3 -m edge_tts --voice en-US-AndrewNeural
  --rate=+8%` (voz/rate tomados de `narration.json`, con guard que los afirma).
  El "swap de 1 comando" a Cartesia Sonic que describe STATUS.md (bloque D6-video)
  está **pendiente de la `CARTESIA_API_KEY` del usuario** y hoy NO existe como
  comando en el workspace: `tts/gen.sh` solo implementa edge-tts. Con la key, el
  swap real = editar `narration.json` (voice/rate) + la llamada a edge-tts y su
  guard en `tts/gen.sh` (o script equivalente contra la API de Cartesia) →
  categoría C la primera vez; después vuelve a ser A.
- **API real en footage:** con `ASSEMBLYAI_API_KEY` en `.env` el badge pasa a
  "real" y cada sesión cuesta ~$0.2 (texto de `scripts/demo-video.sh`).
  `recorder.mjs` está escrito para el mock auto-replay (i2) — un take real
  requiere conducir la sesión en vivo (hablar los beats del runbook): categoría C.

---

## Caso 1 — Cambiar una cifra o texto de narración (A)

La narración vive en `narration.json` (1 objeto por segmento, campo `text`; el
orden de `segments` es el orden del video). El texto de las captions y el SRT
**derivan** de ahí — no se editan por separado (aserción dura de word-count en
`tools/make-srt.mjs`: narración == cues o exit 1).

```bash
cd "$VIDEO_WORKSPACE"
# 1) editar el campo text del segmento en narration.json
# 2) invalidar el caché de TTS de ese segmento (gen.sh salta si el mp3 pesa >2KB):
rm tts/<id>.mp3          # p. ej. tts/r4-prodstg.mp3
bash tts/gen.sh          # regenera SOLO el segmento borrado (el resto queda en caché)
# 3) medir la nueva duración y actualizar tts/durations.json (campo duration_s
#    del segmento; "fits" = duration <= target_s - 0.5). No hay script que
#    regenere durations.json — es edición manual:
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 tts/<id>.mp3
# 4) re-ensamblar y re-timer TODO (los tiempos de todos los beats posteriores
#    se recalculan solos via build/segments.json):
node tools/assemble.mjs            # segmentos + draft.mp4 + segments.json
node tools/make-srt.mjs            # captions.srt + captions.ass re-timed
node tools/assemble.mjs --final    # quema captions.ass + loudnorm -> build/demo-video-d6.mp4
# 5) gate + entrega:
node tools/qa-lanes.mjs            # esperar 9/9
cp build/demo-video-d6.mp4 "$DELIVER/demo-video-d6.mp4"
cp build/captions.srt      "$DELIVER/demo-video-d6.srt"
```

Ojo: `node tools/assemble.mjs --final` re-hace los pasos previos (segmentos y
draft) y encima añade el burn final — es determinista, solo cuesta tiempo de
re-encode. Ese orden (assemble → make-srt → assemble --final) es el verificado.

---

## Caso 2 — Actualizar la escena de métricas a N=10 (A) — el más probable

Ver DECISIÓN #1 en `docs/VIDEO-REVIEW-GUIDE.md`. Afecta a UN beat (`m-metrics`)
pero toca escena + narración + lista de QA.

```bash
cd "$VIDEO_WORKSPACE"
# 1) scenes/m-metrics.html: reemplazar los valores de la tabla por los del
#    README §Metrics actual (N=10), el kicker ("N=5" -> "N=10") y la nota
#    honesta (la historia v3/"2 of 5 collapsed" -> la nota actual: 2/10
#    truncadas por watchdog, fix narrativo v4). Fuente de verdad: README.
#    Restricción de layout: la tabla debe terminar por encima de y~930 (banda
#    de captions). Verificar con:
node tools/measure-scenes.mjs      # bounding boxes reales; busca "⚠️-CAPTION"
# 2) narration.json, segmento "m-metrics": reescribir text con las frases N=10
#    (p. ej. "Ten real voice sessions...", p50 "one point six seconds"...)
# 3) regenerar TTS + duraciones:
rm tts/m-metrics.mp3 && bash tts/gen.sh
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 tts/m-metrics.mp3
#    -> editar tts/durations.json (duration_s de m-metrics)
# 4) re-render de la escena a PNG:
node tools/render-scenes.mjs       # escenas/png/m-metrics.png (re-renderiza las 4)
# 5) ACTUALIZAR LA LISTA DE QA: la lane metrics-verbatim tiene HARDCODEADA la
#    lista N=5 (array readmeNums en tools/qa-lanes.mjs). Reemplazar por los 15
#    strings nuevos tomados VERBATIM del README §Metrics (la lane hace grep
#    literal contra scenes/m-metrics.html — si no se toca, la lane FALLA).
# 6) re-ensamblar:
node tools/assemble.mjs
node tools/make-srt.mjs
node tools/assemble.mjs --final
# 7) gate + entrega:
node tools/qa-lanes.mjs            # 9/9 (el word-count total cambia de 377: OK,
                                   # la lane aserta narración==cues, no el 377)
cp build/demo-video-d6.mp4 "$DELIVER/demo-video-d6.mp4"
cp build/captions.srt      "$DELIVER/demo-video-d6.srt"
```

**Documentación que acompaña este caso** (fuera del workspace): ajustar la nota
de divergencia en `docs/SUBMISSION.md` (la frase "recorded against the earlier
five-session table" deja de aplicar) y, si procede, `STATUS.md`. Los docs que
citan "47 cues / 377 palabras" (esta y la guía de revisión) se actualizan con el
nuevo conteo que imprime `tools/make-srt.mjs`.

---

## Caso 3 — Acortar / alargar un beat (A)

- **Beat estático** (`s1-pain`, `m-metrics`, `a-arch`, `c-close`): editar
  `target_s` del segmento en `narration.json`. La duración real del beat es
  `max(target_s, vo + 1.6)` (regla en `tools/assemble.mjs`) — no puede quedar
  por debajo de la narración.
- **Beat del take** (`r1`–`r7`, `e-exports`): los cortes viven en la tabla
  `cuts` de `tools/assemble.mjs` (derivada de `take/events.json` con offsets
  ajustables); la duración mínima es `vo + 1.1` (si la ventana es corta, el
  script congela el último frame con `tpad`).
- El fundido entre beats es fijo: constante `X = 0.4` s en `tools/assemble.mjs`.
- Tras editar: pasos 4–5 del Caso 1 (assemble → make-srt → assemble --final →
  qa-lanes → copia). La lane `duration` exige total en 150–300 s.

---

## Caso 4 — Cambiar captions (A)

- **Texto:** no es editable por separado — es el Caso 1 (deriva de
  `narration.json`; word-count asertado en SRT y en el `.ass` gemelo).
- **Estilo** (fuente/caja/posición): es la línea `Style: Cap,...` del header ASS
  en `tools/make-srt.mjs` — hoy DejaVu Sans 26 px, caja opaca negra 60 %
  (BorderStyle=3, Outline=8 = padding), blanco, MarginV=40, MarginL/R=120,
  PlayRes 1920×1080. Tras editarla:
  ```bash
  cd "$VIDEO_WORKSPACE"
  node tools/assemble.mjs && node tools/make-srt.mjs && node tools/assemble.mjs --final
  node tools/caption-scan.mjs    # criterio: caja fuerte (Δluma>8) confinada a
                                 # y>=945, NADA sobre y930
  node tools/qa-lanes.mjs        # 9/9 (incluye lane captions-visible)
  # + copia a $DELIVER (paso final de entrega)
  ```
- **No volver al filtro `subtitles` con SRT crudo:** es el defecto corregido en
  build (libass escala ×3.75 con PlayRes 384×288 y BorderStyle=3+Outline=0 no
  dibuja caja → captions invisibles). El burn final usa `ass=build/captions.ass`.

---

## Caso 5 — Re-grabar el take de la app (B, determinista, $0)

Solo si cambia el footage (UI de la app, comportamiento visible). Sesión mock
desatendida (auto-replay del escenario i2-servicio-confundido, incidente
IC-2001). La nueva grabación alimenta los mismos cortes.

```bash
# 1) boot del servidor en mock FORZADO (la var de entorno vacía GANA a .env —
#    verificado en scripts/dev-server.mjs). Selftest corre antes; Ctrl-C apaga:
cd "$REPO" && ASSEMBLYAI_API_KEY= bash scripts/demo-video.sh   # :3199, badge "modo mock"
# 2) en otra terminal, grabar el take (~3 min, desatendido; auto-replay queda
#    marcado por defecto). Escribe take/take-main.webm, take/events.json,
#    take/assertions.md y re-shoot de scenes/png:
cd "$VIDEO_WORKSPACE" && node recorder.mjs
# 3) invalidar la normalización cacheada del take viejo:
rm build/take-norm.mp4
# 4) IMPORTANTE — recortar por anclas nuevas: los cortes de r7-ficha y
#    e-exports están HARDCODEADOS en tools/assemble.mjs a las anclas SSIM del
#    take anterior (r7 in 113.4 / out 122.2 ; e-exports 122.2→133.0) por el
#    drift del reloj de WSL2. Tras un take nuevo:
node tools/anchor-scan.mjs        # SSIM de build/take-norm.mp4 vs take/04..07-*.png
#    -> actualizar cuts['r7-ficha'] y cuts['e-exports'] en tools/assemble.mjs
#    con los tiempos reales nuevos (r1-r6 se recortan solos via events.json)
# 5) re-ensamblar + gate + entrega:
node tools/assemble.mjs
node tools/make-srt.mjs
node tools/assemble.mjs --final
node tools/qa-lanes.mjs           # lane take-assertions lee el assertions.md NUEVO
cp build/demo-video-d6.mp4 "$DELIVER/demo-video-d6.mp4"
cp build/captions.srt      "$DELIVER/demo-video-d6.srt"
```

Verificar en `take/assertions.md`: 14 PASS / 0 FAIL (banner 05:40, staging,
producción, severidad ALTA, CSV, footer del print-view, ack FSM). Si el drift
de reloj no aparece en el nuevo take, los cortes por eventos alcanzan y las
anclas solo confirman.

---

## Caso 6 — Regenerar TODO el video (A)

```bash
cd "$VIDEO_WORKSPACE"
bash tts/gen.sh                   # respeta caché; rm tts/<id>.mp3 para forzar
#    -> revisar tts/durations.json contra ffprobe si se regeneró algún mp3
node tools/render-scenes.mjs      # PNGs de las 4 escenas estáticas
node tools/assemble.mjs           # normaliza take + segmentos + draft.mp4
node tools/make-srt.mjs           # captions.srt + captions.ass
node tools/assemble.mjs --final   # burn captions + loudnorm (I=-14:TP=-1.5:LRA=11)
node tools/qa-lanes.mjs           # gate 9/9
cp build/demo-video-d6.mp4 "$DELIVER/demo-video-d6.mp4"
cp build/captions.srt      "$DELIVER/demo-video-d6.srt"
```

El take NO se re-graba aquí (se reusa `take/take-main.webm`); para footage nuevo,
Caso 5 primero. Tiempo típico: ~30 min de máquina, $0.

---

## Caso 7 — Cambiar la voz (C la primera vez)

1. La VO es TTS declarado (nunca se presenta como audio de sesión real — ver
   `docs/SUBMISSION.md`). Hoy: edge-tts `en-US-AndrewNeural`, rate +8%.
2. **Otra voz edge-tts:** editar `voice`/`rate` en `narration.json` Y la llamada
   `--voice ... --rate=...` + el guard python de `tts/gen.sh` (el guard rechaza
   cualquier valor que no coincida con lo hardcodeado). Luego: `rm tts/*.mp3`,
   `bash tts/gen.sh`, durations.json, y pasos de ensamblado del Caso 6.
3. **Cartesia Sonic:** requiere `CARTESIA_API_KEY` del usuario en `.env`
   (regla del proyecto: no se crean keys del usuario). No hay comando en el
   workspace hoy — adaptar `tts/gen.sh` (o equivalente) a esa API, luego el
   flujo del punto 2. Diseñado como swap del proveedor de `tts/` únicamente.

---

## Referencia rápida del pipeline (qué toca cada pieza)

| Pieza | Rol |
|---|---|
| `narration.json` | Orden de segmentos + texto de narración + voice/rate + `target_s` (duración de beats estáticos) |
| `scenes/*.html` → `tools/render-scenes.mjs` → `scenes/png/*.png` | Las 4 escenas estáticas (s1-pain, m-metrics, a-arch, c-close) |
| `tts/gen.sh` + `tts/*.mp3` + `tts/durations.json` | VO por segmento (caché >2KB; durations.json es entrada, edición manual) |
| `take/take-main.webm` + `take/events.json` + `take/assertions.md` | Grabación de la app (mock determinista, Playwright) |
| `tools/assemble.mjs` | Cortes del take (tabla `cuts`), label DETERMINISTIC REPLAY quemado en r1–r7, PNG→segmento, mezcla VO, xfade/acrossfade 0.4 s → `build/draft.mp4`; con `--final` quema `ass=build/captions.ass` + `loudnorm=I=-14:TP=-1.5:LRA=11` → `build/demo-video-d6.mp4` |
| `tools/make-srt.mjs` | SRT + gemelo ASS (PlayRes 1920×1080) con aserción dura de word-count |
| `tools/qa-lanes.mjs` | Gate determinista 9 lanes (duración, word-count, decode, blank frames, métricas verbatim — lista `readmeNums` hardcoded en el script, assertions del take, loudness, streams, captions visibles) |
| `tools/measure-scenes.mjs`, `tools/caption-scan.mjs`, `tools/anchor-scan.mjs` | QA de layout de escenas / render de captions / anclas SSIM del take |
| repo: `scripts/demo-video.sh` | Boot del dev-server :3199 + runbook de grabación (mock por defecto, real con key en `.env`) |
