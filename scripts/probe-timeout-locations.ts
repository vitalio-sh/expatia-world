/** Live JEV timeout decisions from explicitly relocated QA fixture positions.
 * Initial bar knowledge is legally observed, timeout scanning uses production
 * code, and the chosen drop route is advanced by the authoritative world clock.
 * This does not measure real browser time, human travel or speech latency. */
import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { answerCall, createGame, recordSpeech, rememberObservations, tickGame } from '../src/server/game.js';
import { resolveTimeout } from '../src/server/jev.js';
import { barcelonaTime, distance, segmentClear, type Point } from '../src/shared/world.js';
import { flushUsage, usageSummary } from '../src/server/usage.js';

config({ path: '.env.local', quiet: true });
if (!process.env.JEV_API_KEY) throw new Error('JEV_API_KEY is required for this actual-provider probe.');
const started = Date.now();
const fixtures = [
  { name: 'northwest start', x: 210, y: 250 },
  { name: 'northeast', x: 730, y: 250 },
  { name: 'east', x: 730, y: 460 },
  { name: 'southeast', x: 730, y: 640 },
  { name: 'south home entrance', x: 480, y: 645 },
];
function routeDistance(start: Point, route: Point[]) {
  let anchor = start, total = 0;
  for (const point of route) { total += distance(anchor, point); anchor = point; }
  return total;
}

const cases = await Promise.all(fixtures.map(async fixture => {
  const game = createGame(undefined, started); answerCall(game, started);
  recordSpeech(game, 'Hola, buenas, tengo tu paquete y estoy cerca de un bar. ¿Por dónde voy?', 'authored-qa-opening', started);
  const initiallyObserved = Object.keys(game.knowledge);
  // Explicit authored test setup; this relocation is not a production movement.
  Object.assign(game.courier, { x: fixture.x, y: fixture.y, direction: 'north', moving: false });
  rememberObservations(game, started);
  const deadline = game.deadline!;
  tickGame(game, deadline, 0);
  const decision = await resolveTimeout(game, undefined, { now: () => deadline });
  if (!decision) throw new Error(`Missing timeout decision for ${fixture.name}.`);
  const origin = { x: game.courier.x, y: game.courier.y };
  const drops = decision.candidates.filter(candidate => candidate.type === 'drop').map(candidate => ({
    id: candidate.id, targetId: candidate.targetId, label: candidate.label,
    routeDistance: routeDistance(origin, candidate.route || []),
  })).sort((a, b) => a.routeDistance - b.routeDistance);
  let anchor = origin, routeLegal = true;
  for (const point of game.route) { routeLegal = routeLegal && segmentClear(anchor, point); anchor = point; }
  const chosenDistance = routeDistance(origin, game.route);
  const selectedTarget = decision.action.targetId;
  const parcelBeforeTravel = game.parcel;
  tickGame(game, deadline + 14_000, 14);
  const physicallyReachedTarget = decision.action.target ? distance(game.courier, decision.action.target) < 1 : null;
  const truthfulOutcome = decision.action.type === 'drop'
    ? game.parcel === 'drop' && game.dropLocationId === selectedTarget && game.outcome?.kind === 'collection' && physicallyReachedTarget
    : decision.action.type === 'return' && game.parcel === 'returned' && game.outcome?.kind === 'returned';
  return {
    name: fixture.name, authoredFixturePosition: origin, initiallyObserved, knownAfterTimeoutScan: Object.keys(game.knowledge),
    availableDrops: drops, nearestEligibleDrop: drops[0]?.id || null,
    selected: decision.selected, source: decision.source, model: decision.model, probabilities: decision.probabilities,
    elapsedMs: decision.elapsedMs, selectedNearestEligible: !drops.length ? decision.selected === 'return' : decision.selected === drops[0].id,
    chosenRouteDistance: chosenDistance, routeLegal, parcelBeforeTravel, physicallyReachedTarget,
    actualDropLocation: game.dropLocationId, parcelAfterTravel: game.parcel, outcome: game.outcome,
    usage: usageSummary(game.id), pass: decision.source === 'jev' && !decision.discarded && routeLegal && Boolean(truthfulOutcome),
  };
}));
await flushUsage();
const report = {
  at: new Date().toISOString(), frozenScenarioTime: new Date(started).toISOString(), barcelonaTime: barcelonaTime(started).label,
  scope: 'Five actual JEV requests. Authored QA fixture relocation preserves legitimately observed initial bar memory; production timeout scan and legal-route distance select candidates. Chosen routes are physically advanced by 14 simulated authoritative seconds. No browser latency, live movement or invoice claim.',
  weatherScope: 'Default offline weather fixture, no asserted real rain.',
  distinctDropLocations: [...new Set(cases.map(row => row.actualDropLocation).filter(Boolean))],
  pass: cases.every(row => row.pass), cases,
};
writeFileSync('docs/qa/timeout-locations-live.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ pass: report.pass, barcelonaTime: report.barcelonaTime, distinctDropLocations: report.distinctDropLocations, cases: cases.map(({ name, selected, nearestEligibleDrop, selectedNearestEligible, actualDropLocation, routeLegal, pass }) => ({ name, selected, nearestEligibleDrop, selectedNearestEligible, actualDropLocation, routeLegal, pass })) }, null, 2));
if (!report.pass) process.exitCode = 1;
