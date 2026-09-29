#!/usr/bin/env node
/**
 * export.mjs — CLI de exportación de una orden cerrada (zero-dep, Node >= 22).
 *
 *   node scripts/export.mjs <artefacto.json> [--out <dir>]
 *
 * Produce, con los MISMOS builders que usa el botón "CSV" del navegador
 * (web/js/export.js), dos archivos:
 *
 *   order-<id>-<yyyymmdd-hhmm>.csv   ficha en dos bloques + detalle de piezas
 *                                    (BOM UTF-8 + CRLF; formato en web/README.md)
 *   order-<id>-<yyyymmdd-hhmm>.md    versión humana de la orden con la nota de
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

const HELP = `Usage: node scripts/export.mjs <artifact.json> [--out <dir>]

Exports the close of a voice session: §6 artifact (docs/architecture.md)
→ two-block CSV (form + parts) and a human-readable markdown of the order.

  <artifact.json>   path to the session artifact (e.g. .data/smoke/artifact-s1-happy-path.json)
  --out <dir>       output directory (default: next to the input artifact)
  -h, --help        this help

The CSV is identical to what the browser downloads (builders shared with
web/js/export.js): UTF-8 BOM for Excel, CRLF endings, everything quoted
(RFC 4180). Exit code: 0 if both files were written, 1 otherwise.`;

function fail(msg) {
  console.error(`export.mjs: ${msg}`);
  console.error('Run with --help for usage.');
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
      if (!outDir) fail('--out needs a directory.');
    } else if (a.startsWith('--')) {
      fail(`unknown option: ${a}`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) fail('exactly one artifact file is expected.');
  return { artifactPath: positional[0], outDir };
}

async function main() {
  const { artifactPath, outDir } = parseArgs(process.argv);

  let raw;
  try {
    raw = await readFile(artifactPath, 'utf8');
  } catch (err) {
    fail(`could not read ${artifactPath} (${err.code || err.message}).`);
  }
  let artifact;
  try {
    artifact = JSON.parse(raw);
  } catch (err) {
    fail(`${artifactPath} is not valid JSON (${err.message}).`);
  }
  const ff = artifact && artifact.final_form;
  if (!ff || typeof ff !== 'object' || Array.isArray(ff)) {
    fail('the artifact has no final_form (is it a closed §6 artifact?).');
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
    fail(`could not write the export to ${dir} (${err.code || err.message}).`);
  }

  const piezas = Array.isArray(ff.piezas) ? ff.piezas.length : 0;
  console.log(`export.mjs: order ${ff.order_id || '(no id)'} (${piezas} part${piezas === 1 ? '' : 's'})`);
  console.log(`  CSV : ${csvPath}`);
  console.log(`  MD  : ${mdPath}`);
}

main().catch((err) => fail(err && err.stack ? err.stack : String(err)));
