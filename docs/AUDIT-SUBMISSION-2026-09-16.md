# Auditoría pre-publicación — push público del repo (submission hackathon)

Fecha: 2026-09-16. Ámbito: TODO lo que se haría público con un push de `main`
(107 archivos trackeados + 4 docs nuevos no trackeados + 2 mensajes de commit
no pusheados). Reglas autoritativas aplicadas: `scripts/hooks/commit-msg`,
`scripts/guard-sensitive-content.sh`, `CONTRIBUTING.md` y el precedente del
commit `c75eb27` (ya público: menciones de herramientas de IA como materia de
investigación = aceptado). Esta auditoría NO hizo commit, push ni ningún
comando git que modifique estado.

## 1. Método

Sobre los 107 archivos trackeados (`git ls-files`) y los 4 docs nuevos
(`docs/SUBMISSION.md`, `docs/SUBMISSION-CHECKLIST.md`,
`docs/VIDEO-REVIEW-GUIDE.md`, `docs/VIDEO-REGEN-PROTOCOL.md`):

1. `git grep -inE` (y grep directo para los no trackeados) contra la lista de
   vendors/attribution: claude, anthropic, chatgpt, openai, copilot, gemini,
   gpt, glm, deepseek, z.ai, zai, kimi, qwen, mistral, perplexity,
   ai-generated, generated with, assisted by, co-authored-by, emoji de robot;
   más edge-tts/cartesia por lectura completa de los 4 docs nuevos.
2. Paths absolutos del host: token del home de Linux, token de montaje de
   Windows, perfil Windows crudo.
3. Proyectos hermanos: los identificadores provistos en el encargo (el
   benchmark hermano en sus dos grafías, el workspace de video y otros
   cuatro nombres) + cualquier otro que apareciera por lectura.
4. Secretos: `ASSEMBLYAI_API_KEY`/`CARTESIA_API_KEY` con valor, `sk-…`,
   bearers, base64 largo, contenido de `.env` pegado en docs.
5. localhost/127.0.0.1 en docs de cara a jueces (README, SUBMISSION).
6. Replicación del check del hook (más estricta: archivo completo, no solo
   líneas añadidas): `grep -aFf .git/sensitive-tokens -c <archivo>` por cada
   archivo trackeado y por cada doc nuevo. La lista local tiene **11 líneas**
   y vive en el git dir (fuera del work tree, nunca trackeada — verificado).
7. Mensajes de commits no pusheados: `git log origin/main..main --format='%B'`
   con los mismos greps.
8. Ignora/untracked: `git status --porcelain` + `git check-ignore -v` sobre
   `.env`, `.env.local`, `.vercel`, `.data`, `node_modules`, `AUDIT.md`.

Correlación con la lista de tokens: de 12 strings candidatos probados, 4 son
tokens de la lista (el path del home de Linux, el path de montaje de Windows,
un proyecto hermano de benchmark y un tercer proyecto hermano); **0
ocurrencias** de cualquiera de ellos en contenido trackeado o nuevo.

## 2. Hallazgos por clase

### 2a. Autoría-atribución (AI construyó/el proyecto)

**CERO** en archivos trackeados, docs nuevos y mensajes de commit. Los únicos
matches de las formas prohibidas son el texto de la propia regla:
`CONTRIBUTING.md:9` («No Co-Authored-By: trailers naming an AI vendor…»),
`CONTRIBUTING.md:12`, `scripts/hooks/commit-msg:3,12-13,26-30` (regex y
comentarios del gate). Identidad de autor/committer en los 2 commits no
pusheados: única, humana (el-informatico, email noreply de GitHub).

### 2b. Work-by-model (trabajo descrito como hecho por un modelo/vendor)

| Dónde | Cita | Estado |
|---|---|---|
| `STATUS.md:266` | «**QA visual residual GLM-5.3-Flash** (secundario): 3 runs» | **FIXED** |
| `STATUS.md:270` | «**7/11 PASS** y GLM ahora LEE el texto del caption» | **FIXED** |
| `docs/SUBMISSION.md:111` (lista «Built with») | «**edge-tts** — voice-over for the demo video narration only» | **FIXED** (juicio: ver §3) |
| Commit `75b8334` (asunto) | «QA 9/9 lanes + GLM residual» | **REPORTADO** (§6; no se reescribe historia) |

`e68afed` (el otro commit no pusheado): limpio — 0 vendors, 0 paths, 0 hermanos.

### 2c. Menciones aceptadas con razón (precedente c75eb27 / regla) — SE DEJAN, veto humano

- `docs/video-research-2026-09.md:8,21,26-35,39,42,58,73-81,87-88` —
  GLM-Flash, gpt-4o-mini-tts, z.ai, Cartesia, edge-tts como **materia de
  investigación/comparación** (precios, capacidades, veredictos). Es el doc
  de research del precedente, ya público en `c75eb27`.
- `docs/research/assemblyai-notes.md:438` — «BYO LLM tipo Claude vía gateway»:
  nota de facturación de AssemblyAI (materia de producto, no autoría). Ya
  adjudicada no-atribución por la auditoría local previa (AUDIT.md, fuera del
  repo).
- Competidores del landscape (research): `README.md:21,145`;
  `STATUS.md:10,75,133,160`; `docs/video-recording-plan.md:60`;
  `docs/research/competitor-landscape-2026-09-15.md:14,20,95-97,173`
  (AutoCopilot, KiaOra, «copilots»).
- Toolchain operativa edge-tts/Cartesia (runbook/log, no research):
  `STATUS.md:230-234`, `docs/VIDEO-REGEN-PROTOCOL.md:55,59-65,253-258`,
  `docs/D2-GATE.md:255`, `scripts/tts-synth.mjs` (passim). Razón para dejar:
  el nombre del paquete es información operativa load-bearing (el comando
  `python3 -m edge_tts …` no se puede neutralizar sin destruir el runbook) —
  mismo estatus que ffmpeg/Playwright; la regla solo prohíbe la forma cuando
  «una descripción neutral preserva el hecho», y aquí no lo preserva.
- `docs/VIDEO-REVIEW-GUIDE.md:128` — «QA visual asistido residual»: sin
  vendor nombrado, ya neutral.
- `CONTRIBUTING.md` + `scripts/hooks/commit-msg`: texto de la regla.

### 2d. Paths del host

0 ocurrencias de los tokens de path (home Linux, montaje Windows, perfil
Windows) en trackeados y docs nuevos. Nota de mecanismo: los 4 docs nuevos
usan la convención deliberada `~/projects/…`
(`docs/SUBMISSION-CHECKLIST.md:14,20,25,34,35,39,41`;
`docs/VIDEO-REVIEW-GUIDE.md:7`; `docs/VIDEO-REGEN-PROTOCOL.md:10,15,20-22`),
declarada a propósito en `docs/SUBMISSION-CHECKLIST.md` §5 («en docs se
escribe con `~/`»). Advertencia honesta: `~/…` NO matchea el token literal del
home, así que el guard no lo ve — es una convención de comportamiento, no una
garantía mecánica. Riesgo residual bajo (revela el layout `~/projects`, no el
username). Solo los paths `~/projects/field-service-voice-logger*` (proyecto
propio y sus entregables) aparecen escritos; ningún hermano con path completo.

### 2e. Identificadores de proyectos hermanos

- Tokens de hermanos en la lista local: 0 ocurrencias en todo el contenido.
- `video-d6-work` (NO es token; los hooks no lo bloquean) aparece crudo en:
  `docs/VIDEO-REVIEW-GUIDE.md:11,180` («directorio hermano video-d6-work») y
  `docs/VIDEO-REGEN-PROTOCOL.md:10,21` (definición de `$VIDEO_WORKSPACE`).
  Es el workspace de edición de video de ESTE proyecto. La regla
  comportamental de CONTRIBUTING pide referencias de categoría («workspace
  hermano»); el doc ya usa esa forma en prosa y reserva el nombre crudo para
  la asignación bash del runbook. Se DEJA (no es clase de fix de esta
  auditoría) — si el humano quiere genericizarlo, el cambio mínimo es
  escribir la asignación como
  `VIDEO_WORKSPACE=~/projects/<workspace-hermano-de-video>` en
  VIDEO-REGEN-PROTOCOL.md:21 y «workspace hermano de edición» en las 2 líneas
  de VIDEO-REVIEW-GUIDE (el runbook pierde copy-paste exacto).

### 2f. Secretos

- `.env.example` (trackeado): placeholders vacíos, sin valores. OK.
- 0 valores de key en todo el contenido trackeado y nuevo: solo nombres de
  variable (`STATUS.md:230,236`; `api/selfcheck.sh:46`; `docs/D2-GATE.md:13`;
  `scripts/demo-video.sh:13`; `scripts/realgate.mjs:96`;
  `docs/VIDEO-REGEN-PROTOCOL.md:62,67,258`), 0 `sk-…`, 0 bearers, 0 base64
  largo, 0 contenido de `.env` pegado en docs.
- Check del hook replicado: **0 matches** en los 107 trackeados y 0 en cada
  uno de los 4 docs nuevos (grep de archivo completo, más estricto que el
  staged-lines del pre-commit). Al commitearse, pasan.

### 2g. localhost en docs de cara a jueces

`README.md:171` y `docs/SUBMISSION-CHECKLIST.md:73` — ambos en instrucciones
de «correr local» / Plan B (permitido por regla). `docs/SUBMISSION.md`: 0
(usa URLs públicas vercel.app/github). Nada que confundiría a jueces.

### 2h. Falsos positivos (breve)

~20 matches de `ares` dentro de «pares confundibles» (STATUS.md, data/*.md,
scripts, web/js) y «shares» (`LICENSE:21`); 0 hermanos reales con esos
nombres. `copilot`/`copilots` en README/STATUS = competidores (research, 2c).

## 3. Fixes aplicados (3, mínimo-edit, hechos con Edit; sin commit)

1. `STATUS.md:266`: «**QA visual residual GLM-5.3-Flash**» → «**QA visual
   residual con modelo de visión externo**». Hechos intactos: 3 runs, run 1
   (4 FAIL, 1 defecto real corregido), run 2 invirtió veredictos sobre
   píxeles idénticos (inestable en frames borderline), run 3 7/11 PASS, los 4
   FAIL explicados = 0 defectos accionables, gate = lanes deterministas.
2. `STATUS.md:270`: «y GLM ahora LEE el texto del caption» → «y el modelo
   ahora LEE el texto del caption».
3. `docs/SUBMISSION.md:111` (Built with): «**edge-tts** — voice-over…» →
   «**Synthetic narration (TTS)** — voice-over…». **REVERTIDO por el
   orquestador el mismo día** (se restauró «edge-tts»): nombrar la herramienta
   de narración es un tool-credit (mismo estatus que Vercel/Node en la misma
   lista), no autoría-atribución; es más honesto (la narración sintética ya
   está declarada en `docs/SUBMISSION.md:47`) y consistente con STATUS.md y el
   protocolo de regeneración, que la nombran como toolchain operativa (§2c).
   El humano puede re-aplicar la forma neutral si la prefiere en el texto
   público.

Re-verificación post-fix: `git grep` de vendors sobre trackeados excluyendo
los archivos aceptados (2c) → solo quedan `assemblyai-notes.md:438` y
`video-recording-plan.md:60` (ambos clase research, aceptados); `STATUS.md` y
`README.md` → 0; los 4 docs nuevos → 0. `git status --porcelain`: `M STATUS.md`
+ los 4 docs sin trackear (el edit de SUBMISSION.md vive en el archivo no
trackeado).

## 4. Estado de secrets/ignores/untracked

- `.env`, `.env.local` → ignorados por `.gitignore:18` (`.env*`); no
  trackeados. `.vercel` → `.gitignore:4`. `.data/` → `.gitignore:7`.
  `node_modules/` → patrón presente (`.gitignore`); el directorio no existe en
  disco y 0 archivos trackeados. Todo verificado con `git check-ignore -v`.
- `.git/sensitive-tokens`: dentro del git dir, NO en el work tree (verificado
  con realpath); 11 líneas; nunca trackeado.
- `AUDIT.md` (raíz): existe en disco pero excluido local-only vía
  `.git/info/exclude` → nunca será pusheado (contiene un path del host en sus
  ejemplos de comando; irrelevante para publicación).
- `LICENSE`: Apache-2.0 en raíz; `README.md:188-190` §License consistente
  («Apache-2.0 — see LICENSE. © 2026 el-informatico»).

## 5. Hallazgos de git (REPORTADOS, historia intacta)

Commits no pusheados (`origin/main..main`):

- `e68afed` METRICS-N10… — mensaje limpio (0 hallazgos).
- `75b8334` «D6-video: demo generado (3:13, QA 9/9 lanes + GLM residual),
  entregado fuera del repo (>10MB)» — **«GLM residual» = clase work-by-model
  en mensaje**; el push lo haría permanente. ÚNICO bloqueador.

Plan de reword sugerido (cherry-pick sin cambios de contenido; lo ejecuta el
orquestador/humano, no esta auditoría; el hook commit-msg corre en cada paso y
el mensaje nuevo pasa):

```bash
git branch backup-pre-reword main                # respaldo de solo lectura
git checkout -b submit-reword c75eb27            # padre REAL de 75b8334 (corregido: no 5f3e19e, que saltaría c75eb27 ya pusheado)
git cherry-pick 75b8334                          # luego reword:
git commit --amend -m "D6-video: demo generado (3:13, QA 9/9 lanes + QA visual residual), entregado fuera del repo (>10MB)"
git cherry-pick e68afed                          # sin cambios
git range-diff c75eb27..backup-pre-reword c75eb27..submit-reword  # debe mostrar SOLO el mensaje cambiado
git checkout main && git merge --ff-only submit-reword && git branch -d submit-reword
# push SOLO con YES explícito del humano
```

## 6. Veredicto final

**PUSH-SAFE condicional — 1 bloqueador restante:** el mensaje del commit
`75b8334` («GLM residual») debe reword-erse ANTES del push (plan en §5; sin
ese reword, el push publica una mención work-by-model permanente en historia).
Contenido de archivos: limpio tras los 3 fixes de §3; secrets/ignores: limpios
(§4); hook check replicado: 0 matches en los 4 docs nuevos.

Decisiones que quedan al humano (no bloquean): (a) veto sobre las menciones
aceptadas de §2c (en particular edge-tts/Cartesia operativos en STATUS y el
protocolo de regeneración); (b) genericizar o no el identificador
`video-d6-work` en los 2 docs de video (§2e); (c) el fix de
`docs/SUBMISSION.md:111` fue revertido por el orquestador (ver §3.3) —
re-aplicar la forma neutral si se prefiere.
