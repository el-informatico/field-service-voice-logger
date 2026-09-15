// loader.js — read + minimally validate artifact/GT files, pair by scenario_id.
// Helpful errors: name the file and the missing key. Zero deps (node:fs).

import { readFileSync } from 'node:fs';

export function readJson(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read file ${path}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${path}: ${err.message}`);
  }
}

export function validateArtifact(a, path) {
  const fail = (key) => new Error(`Invalid artifact ${path}: missing or invalid key "${key}"`);
  if (!a || typeof a !== 'object') throw fail('(root object)');
  if (a.schema_version == null) throw fail('schema_version');
  if (!Array.isArray(a.events)) throw fail('events');
  if (!a.final_form || typeof a.final_form !== 'object') throw fail('final_form');
  if (!a.session_id) throw fail('session_id');
  if (!a.scenario_id) throw fail('scenario_id');
  return a;
}

export function validateGt(g, path) {
  const fail = (key) => new Error(`Invalid ground truth ${path}: missing or invalid key "${key}"`);
  if (!g || typeof g !== 'object') throw fail('(root object)');
  // schema_version is optional in GT files (tolerated when absent).
  if (!g.scenario_id) throw fail('scenario_id');
  if (!g.expected_form || typeof g.expected_form !== 'object') throw fail('expected_form');
  if (!Array.isArray(g.seeded_errors ?? [])) throw fail('seeded_errors');
  return g;
}

/**
 * Load and pair artifacts ↔ GT.
 * gt may be: array of objects, single object, or array of arrays/objects
 * (one GT file may hold many scenarios). Pairing key: scenario_id.
 * @param {string[]} artifactPaths
 * @param {string[]} gtPaths
 * @returns {{artifact, gt}[]}
 */
export function loadSessions(artifactPaths, gtPaths = []) {
  const artifacts = artifactPaths.map((p) => validateArtifact(readJson(p), p));
  const gtList = [];
  for (const p of gtPaths) {
    const parsed = readJson(p);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    for (const g of arr) gtList.push(validateGt(g, p));
  }
  return artifacts.map((artifact) => {
    const gt = gtList.find((g) => g.scenario_id === artifact.scenario_id) ?? null;
    return { artifact, gt };
  });
}
