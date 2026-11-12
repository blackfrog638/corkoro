// Finite contract model, not the OS lock adapter or a CLI implementation.
import assert from 'node:assert/strict';

export function verifyProtocol() {
  const phases = ['locate', 'locked', 'read', 'prepared', 'committing', 'committed', 'done'];
  const events = ['advance', 'cancel', 'fault', 'crash', 'busy', 'unsupported',
    'conflict', 'noop', 'reject', 'commit-old', 'commit-new', 'commit-unknown', 'cleanup-failed'];
  const terminal = (s, exit, effect, durable = s.durable) =>
    ({ ...s, phase: 'done', exit, effect, durable, held: false });
  function step(s, event) {
    if (s.phase === 'done') return s;
    if (event === 'crash') {
      // At the commit boundary, either complete version is possible.
      const values = s.phase === 'committing' ? ['old', 'new'] : [s.durable];
      return values.map(durable => terminal(s, null, null, durable));
    }
    if (s.phase === 'committing') {
      if (event === 'cancel') return { ...s, cancel: true };
      if (event === 'commit-old') return terminal(s, s.cancel ? 130 : 4, 'none');
      if (event === 'commit-new') return { ...s, phase: 'committed', durable: 'new' };
      if (event === 'commit-unknown' || event === 'fault') {
        return ['old', 'new'].map(durable => terminal(s, 5, 'unknown', durable));
      }
      return s; // Not applicable at this phase; no implicit transition.
    }
    if (s.phase === 'committed') {
      if (event === 'fault') return terminal(s, 1, 'committed');
      if (['advance', 'cancel', 'cleanup-failed'].includes(event)) return terminal(s, 0, 'committed');
      return s;
    }
    if (event === 'cancel') return terminal(s, 130, 'none');
    if (event === 'fault') return terminal(s, 4, 'none');
    if (s.phase === 'locate' && ['busy', 'unsupported'].includes(event)) return terminal(s, 4, 'none');
    if (s.phase === 'prepared' && event === 'conflict') return terminal(s, 4, 'none');
    if (s.phase === 'read' && event === 'noop') return terminal(s, 0, 'none');
    if (s.phase === 'read' && event === 'reject') return terminal(s, 3, 'none');
    if (event === 'advance') {
      return { ...s, phase: phases[phases.indexOf(s.phase) + 1], held: true };
    }
    return s;
  }
  const initial = { phase: 'locate', held: false, durable: 'old', cancel: false, exit: null, effect: null };
  const queue = [initial], seen = new Set(), terminals = new Set();
  let edges = 0;
  for (let head = 0; head < queue.length; head++) {
    const s = queue[head], key = JSON.stringify(s);
    if (seen.has(key)) continue;
    seen.add(key);
    if (s.phase === 'done') terminals.add(`${s.exit}/${s.effect}/${s.durable}`);
    for (const event of events) {
      const value = step(s, event);
      for (const n of Array.isArray(value) ? value : [value]) {
        edges++;
        assert.ok(phases.includes(n.phase));
        if (s.phase === 'done') assert.deepEqual(n, s, 'terminal result cannot be revised');
        if (n.effect === 'none' || n.exit === 130) assert.equal(n.durable, 'old');
        if (n.effect === 'committed') assert.equal(n.durable, 'new');
        if (n.effect === 'unknown') assert.equal(n.exit, 5);
        if (n.phase === 'done') assert.equal(n.held, false, 'release process lock on termination');
        if (s.durable === 'new') assert.equal(n.durable, 'new', 'no post-commit rollback');
        if (event === 'busy' && s.phase === 'locate') assert.equal(n.phase, 'done', 'no waiting loop');
        if (s.phase === 'committing' && event === 'cancel') assert.equal(n.phase, 'committing');
        queue.push(n);
      }
    }
  }
  for (const outcome of ['130/none/old', '0/none/old', '0/committed/new',
    '5/unknown/old', '5/unknown/new', 'null/null/old', 'null/null/new']) {
    assert.ok(terminals.has(outcome), `missing outcome ${outcome}`);
  }

  // Check add/remove guards as mutually exclusive AND exhaustive partitions.
  // Common argument/config/IO gates are modeled separately below.
  let partitions = 0;
  for (const sourceSafe of [false, true]) for (const exists of [false, true])
  for (const state of ['absent', 'disabled', 'enabled'])
  for (const match of [false, true]) for (const collision of [false, true]) {
    const validTarget = sourceSafe && exists, registered = state !== 'absent';
    const add = [
      !sourceSafe,
      sourceSafe && !exists,
      validTarget && registered && !match,
      validTarget && registered && match && state === 'enabled',
      validTarget && registered && match && state === 'disabled',
      validTarget && !registered && collision,
      validTarget && !registered && !collision,
    ];
    assert.equal(add.filter(Boolean).length, 1, 'add guards must partition the domain');
    const remove = [state === 'absent', state === 'disabled', state === 'enabled'];
    assert.equal(remove.filter(Boolean).length, 1);
    partitions += 2;
  }

  // A stage stops on failure; do not inspect later inputs to change that result.
  let gates = 0;
  for (const args of [false, true]) for (const capability of [false, true])
  for (const readable of [false, true]) for (const shape of [false, true]) {
    const choices = [!args, args && !capability, args && capability && !readable,
      args && capability && readable && !shape, args && capability && readable && shape];
    assert.equal(choices.filter(Boolean).length, 1); gates++;
  }
  // Simultaneous diagnostics within one completed stage: deterministic class order.
  const priorities = [1, 2, 4, 3];
  let combinations = 0;
  for (let mask = 0; mask < 16; mask++) {
    const errors = priorities.filter((_, i) => mask & (1 << i));
    const choose = xs => priorities.find(code => xs.includes(code)) ?? 0;
    assert.equal(choose(errors), choose([...errors].reverse()));
    assert.equal(choose(errors), errors[0] ?? 0); combinations++;
  }
  // A stale carrier file is not a held process lock; a new inode lock is unsafe.
  let lockCases = 0;
  for (const carrierExists of [false, true]) for (const ownerAlive of [false, true]) {
    if (!carrierExists && ownerAlive) continue; // not a valid carrier-backed lock state
    const acquire = ownerAlive ? 'CONFIG_BUSY' : 'acquired';
    if (carrierExists && !ownerAlive) assert.equal(acquire, 'acquired');
    if (ownerAlive) assert.equal(acquire, 'CONFIG_BUSY');
    lockCases++;
  }
  const inodeCounterexample = ['A locks old config inode', 'A replaces config inode',
    'B locks new config inode while A still holds old inode'];
  // Stable sidecar identity does not change when the configuration is replaced.
  const slot = { lockIdentity: 'canonical-parent-and-filename', configIdentity: 'old' };
  const replaced = { ...slot, configIdentity: 'new' };
  assert.equal(slot.lockIdentity, replaced.lockIdentity);

  return { states: seen.size, edges, terminalOutcomes: [...terminals].sort(),
    selectionPartitions: partitions, admissionPartitions: gates,
    errorCombinations: combinations, lockCases, inodeCounterexample,
    scope: 'finite event abstraction; no real filesystem locks, signals, or JSON validators tested' };
}
