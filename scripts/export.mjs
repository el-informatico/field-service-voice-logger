#!/usr/bin/env node
/**
 * export.mjs — CLI de exportación de una orden cerrada (zero-dep, Node >= 22).
 *
 *   node scripts/export.mjs <artefacto.json> [--out <dir>]
 *
 * Produce, con los MISMOS builders que usa el botón "CSV" del navegador
 * (web/js/export.js), dos archivos:
 *
 *   orden-<id>-<yyyymmdd-hhmm>.csv   ficha en dos bloques + detalle de piezas
 *                                    (BOM UTF-8 + CRLF; formato en web/README.md)
 *   orden-<id>-<yyyymmdd-hhmm>.md    versión humana de la orden con la nota de
 *                                    auditoría de voz
 *
 * El sello del nombre de archivo sale del cierre de la sesión (ended_at, con
 * fallback a started_at), así que la salida es determinista para métricas/CI.
 * Sin --out, los archivos se escriben junto al artefacto de entrada.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildOrdenCsv,
  buildOrdenMarkdown,
  ordenFilename,
} from '../web/js/export.js';

const HELP = `Uso: node scripts/export.mjs <artefacto.json> [--out <dir>]

Exporta el cierre de una sesión de voz: artefacto §6 (docs/architecture.md)
→ CSV de dos bloques (ficha + piezas) y un markdown legible de la orden.

  <artefacto.json>  ruta al artefacto de sesión (p. ej. .data/smoke/artifact-s1-happy-path.json)
  --out <dir>       directorio de salida (default: junto al artefacto de entrada)
  -h, --help        esta ayuda

El CSV es idéntico al que descarga el navegador (builders compartidos con
web/js/export.js): BOM UTF-8 para Excel, finales CRLF, todo entrecomillado
(RFC 4180). Salida: 0 si escribió ambos archivos, 1 en caso contrario.`;

function fail(msg) {
  console.error(`export.mjs: ${msg}`);
  console.error('Corre con --help para el uso.');
  process.exit(1);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(HELP);
    process.exit(0);
  }
  const positional = [];
  let outDir = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') {
      outDir = args[++i];
      if (!outDir) fail('la opción --out necesita un directorio.');
    } else if (a.startsWith('--')) {
      fail(`opción desconocida: ${a}`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) fail('se espera exactamente un archivo de artefacto.');
  return { artifactPath: positional[0], outDir };
}

async function main() {
  const { artifactPath, outDir } = parseArgs(process.argv);

  let raw;
  try {
    raw = await readFile(artifactPath, 'utf8');
  } catch (err) {
    fail(`no pude leer ${artifactPath} (${err.code || err.message}).`);
  }
  let artifact;
  try {
    artifact = JSON.parse(raw);
  } catch (err) {
    fail(`${artifactPath} no es JSON válido (${err.message}).`);
  }
  const ff = artifact && artifact.final_form;
  if (!ff || typeof ff !== 'object' || Array.isArray(ff)) {
    fail('el artefacto no trae final_form (¿es un artefacto §6 cerrado?).');
  }

  // Sello determinista: el cierre de la sesión, no el reloj del que corre el CLI.
  const cierre = new Date(artifact.ended_at || artifact.started_at || Date.now());
  const csvName = ordenFilename(ff.order_id || artifact.order_id, cierre);
  const mdName = csvName.replace(/\.csv$/, '.md');

  const dir = outDir || path.dirname(path.resolve(artifactPath));
  const csvPath = path.join(dir, csvName);
  const mdPath = path.join(dir, mdName);

  const csv = buildOrdenCsv(artifact);
  const md = buildOrdenMarkdown(artifact, { generatedAt: cierre.toISOString() });

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(csvPath, csv, 'utf8');
    await writeFile(mdPath, `${md}\n`, 'utf8');
  } catch (err) {
    fail(`no pude escribir la exportación en ${dir} (${err.code || err.message}).`);
  }

  const piezas = Array.isArray(ff.piezas) ? ff.piezas.length : 0;
  console.log(`export.mjs: orden ${ff.order_id || '(sin id)'} (${piezas} pieza${piezas === 1 ? '' : 's'})`);
  console.log(`  CSV : ${csvPath}`);
  console.log(`  MD  : ${mdPath}`);
}

main().catch((err) => fail(err && err.stack ? err.stack : String(err)));
