// Executable finite abstraction of docs/state-machine.md, NOT the Corkoro CLI.
// No filesystem mutation, network, dependency installation, or production data.
import assert from 'node:assert/strict';
import { verifyProtocol } from './cli-protocol-model.mjs';

const copy = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const enabled = s => s.entries.flatMap((value, i) => value === 2 ? [i] : []);
const hasFile = (s, i) => (s.files & (1 << i)) !== 0;
const commands = ['inspect', 'init', 'list', 'add0', 'add1', 'remove0', 'remove1', 'check', 'plan', 'build'];

function assessment(s) {
  const articles = enabled(s);
  const empty = articles.length === 0 && s.site === 0;
  const blocked = !s.sourceSafe || !s.outputSafe ||
    articles.some(i => !hasFile(s, i)) ||
    (s.complete && s.link && articles.includes(0) && !articles.includes(1));
  return {
    blocked, empty,
    buildable: blocked || empty ? false : s.complete ? true : null,
  };
}

// One transition is a successfully isolated command, or a pre-commit failure.
// Identity/route are fixed injective mappings of the two article indices.
// Invalid schema/identity/route configurations are represented by kind=invalid.
function step(before, command, fault = false) {
  const s = copy(before);
  const fail = code => ({ state: copy(before), ok: false, code });
  const done = data => ({ state: s, ok: true, data });
  if (fault) return fail('IO_ERROR_BEFORE_COMMIT');
  if (command === 'inspect') return done({ candidates: s.files });
  if (command === 'init') {
    if (s.kind !== 'missing') return fail('CONFIG_EXISTS');
    if (!s.sourceSafe || !s.outputSafe) return fail('PATH_OUT_OF_SCOPE');
    s.kind = 'valid'; s.entries = [0, 0]; s.site = 0; s.theme = 0;
    return done({ changed: true });
  }
  if (s.kind !== 'valid') return fail(s.kind === 'missing' ? 'CONFIG_NOT_FOUND' : 'INVALID_CONFIG');
  if (command === 'list') return done({ entries: s.entries });
  if (command.startsWith('add')) {
    const i = Number(command.at(-1));
    if (!s.sourceSafe || !hasFile(s, i)) return fail('MISSING_OR_UNSAFE_SOURCE');
    const changed = s.entries[i] !== 2;
    s.entries[i] = 2;
    return done({ changed });
  }
  if (command.startsWith('remove')) {
    const i = Number(command.at(-1));
    if (s.entries[i] === 0) return fail('UNKNOWN_ID');
    const changed = s.entries[i] !== 1;
    s.entries[i] = 1;
    return done({ changed });
  }
  if ((command === 'plan' || command === 'build') && !s.complete) return fail('UNSUPPORTED_COMMAND');
  const result = assessment(s);
  if (result.blocked) return fail('CONTENT_BLOCKED');
  if (command === 'check' || command === 'plan') return done(result);
  if (result.buildable !== true) return fail('EMPTY_SELECTION');
  s.output = {
    articles: enabled(s), site: s.site,
    // Only these abstract public inputs, never unselected document content.
    origin: { entries: copy(s.entries), site: s.site, files: s.files, link: s.link },
  };
  return done({ committed: true });
}

let states = 0, transitions = 0, repairs = 0, siteOnlyBuilds = 0;
for (const kind of ['missing', 'invalid', 'valid'])
for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++)
for (let site = 0; site < 8; site++) // bits: page, profile, friends
for (let files = 0; files < 4; files++)
for (const link of [false, true])
for (const sourceSafe of [false, true])
for (const outputSafe of [false, true])
for (const complete of [false, true]) {
  const s = {
    kind, entries: [a, b], site, files, link, sourceSafe, outputSafe, complete,
    theme: 1, output: { generation: 'previous-valid-output' }, remote: 'unchanged',
  };
  states++;
  for (const command of commands) for (const fault of [false, true]) {
    const r = step(s, command, fault); transitions++;
    const n = r.state;
    assert.equal(n.files, s.files, 'commands must not write source documents');
    assert.equal(n.link, s.link);
    assert.equal(n.remote, s.remote, 'local commands must not deploy');
    if (!r.ok) assert.deepEqual(n, s, 'pre-commit failure must preserve durable state');
    if (['inspect', 'list', 'check', 'plan'].includes(command)) assert.deepEqual(n, s);
    if (command !== 'build') assert.deepEqual(n.output, s.output);
    if (command !== 'init') {
      assert.equal(n.site, s.site, 'content mutations must preserve site');
      assert.equal(n.theme, s.theme, 'content mutations must preserve theme');
    }
    if (r.ok && command === 'init') {
      assert.deepEqual(n.entries, [0, 0]); assert.equal(n.site, 0);
    }
    if (r.ok && /^(add|remove)/.test(command)) {
      const i = Number(command.at(-1));
      assert.equal(n.entries[1 - i], s.entries[1 - i]);
      const repeated = step(n, command);
      assert.equal(repeated.ok, true);
      assert.equal(repeated.data.changed, false);
      assert.deepEqual(repeated.state, n, 'selection operations must be idempotent');
      if (command.startsWith('remove') && !hasFile(s, i)) repairs++;
    }
    if (r.ok && command === 'build') {
      assert.equal(assessment(s).buildable, true);
      assert.deepEqual(n.output.articles, enabled(s));
      assert.ok(enabled(s).length > 0 || site !== 0);
      if (enabled(s).length === 0) siteOnlyBuilds++;
    }
    if (r.ok && command === 'check') assert.equal(r.data.buildable, assessment(s).buildable);
  }
}
assert.ok(repairs > 0 && siteOnlyBuilds > 0, 'important scenarios must not be vacuous');

// Enumerate ALL schedules of two writers, each reading/checking/committing once.
// The repaired model's lock covers reading through committing, not only rename.
function exploreWriters(locked) {
  const initial = { value: { selection: 0, profile: 0 }, owner: null,
    writers: [{ pc: 0, base: null }, { pc: 0, base: null }] };
  const queue = [{ s: initial, trace: [] }]; const seen = new Set();
  let terminals = 0, witness = null;
  for (let head = 0; head < queue.length; head++) {
    const { s, trace } = queue[head];
    const key = JSON.stringify(s);
    if (seen.has(key)) continue;
    seen.add(key);
    if (s.writers.every(w => w.pc === 3)) {
      terminals++;
      if (s.value.selection !== 1 || s.value.profile !== 1) witness ??= trace;
      continue;
    }
    let possible = false;
    for (let i = 0; i < 2; i++) {
      const w = s.writers[i];
      if (w.pc === 3 || (locked && s.owner !== null && s.owner !== i)) continue;
      possible = true;
      const n = copy(s), nw = n.writers[i];
      let action;
      if (w.pc === 0) {
        if (locked) n.owner = i;
        nw.base = copy(s.value); nw.pc = 1; action = 'read';
      } else if (w.pc === 1) {
        if (!same(w.base, s.value)) {
          nw.pc = 0; nw.base = null; n.owner = null; action = 'retry-conflict';
        } else { nw.pc = 2; action = 'compare'; }
      } else {
        n.value = { ...w.base, [i === 0 ? 'selection' : 'profile']: 1 };
        nw.pc = 3; n.owner = null; action = 'replace';
      }
      queue.push({ s: n, trace: [...trace, `writer${i}.${action}`] });
    }
    assert.ok(possible, 'no internal deadlock in finite writer protocol');
  }
  return { states: seen.size, terminals, witness };
}
const unsafeWriters = exploreWriters(false), safeWriters = exploreWriters(true);
assert.ok(unsafeWriters.witness, 'naive compare/replace must exhibit lost update');
assert.equal(safeWriters.witness, null);
assert.ok(safeWriters.terminals > 0);

// Enumerate all orders of capture -> validate -> render, with one outside edit.
// A boolean models whether the document bytes contain an unpublished embed.
function exploreBuild(snapshot) {
  const queue = [{ pc: 0, live: false, captured: null, valid: false, edited: false, trace: [] }];
  let terminals = 0, witness = null;
  for (let head = 0; head < queue.length; head++) {
    const s = queue[head];
    if (s.pc === 3) {
      terminals++;
      if (s.leaked) witness ??= s.trace;
      continue;
    }
    if (!s.edited) queue.push({ ...s, live: true, edited: true, trace: [...s.trace, 'editor.add-private-embed'] });
    const n = { ...s, pc: s.pc + 1, trace: [...s.trace, ['capture', 'validate', 'render'][s.pc]] };
    if (s.pc === 0) n.captured = s.live;
    if (s.pc === 1) n.valid = !s.captured;
    if (s.pc === 2) n.leaked = s.valid && (snapshot ? s.captured : s.live);
    queue.push(n);
  }
  return { schedules: terminals, witness };
}
const unsafeBuild = exploreBuild(false), safeBuild = exploreBuild(true);
assert.ok(unsafeBuild.witness, 'rereading live files must exhibit check/use mismatch');
assert.equal(safeBuild.witness, null);

// Commit and acknowledgement are different events: an error message cannot undo a commit.
const commitOutcomes = [
  { trace: ['prepare', 'crash'], durable: 'old', response: 'unknown' },
  { trace: ['prepare', 'commit', 'crash'], durable: 'new', response: 'unknown' },
  { trace: ['prepare', 'commit', 'ack'], durable: 'new', response: 'success' },
];
assert.ok(commitOutcomes.some(x => x.response === 'unknown' && x.durable === 'new'));

console.log(JSON.stringify({
  scope: 'finite abstract contract; not runtime verification or unbounded machine proof',
  commandModel: { states, transitions, missingSourceRemovals: repairs, siteOnlyBuilds },
  writerModel: { unsafe: unsafeWriters, locked: safeWriters },
  buildModel: { unsafe: unsafeBuild, snapshot: safeBuild },
  commitOutcomes,
  protocolModel: verifyProtocol(),
  result: 'all assertions passed; expected counterexamples reproduced',
}, null, 2));
