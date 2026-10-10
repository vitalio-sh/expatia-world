/** Authored scenario geometry, not live claims about real Barcelona businesses. */
export interface Point { x: number; y: number }
export type Direction = 'north' | 'east' | 'south' | 'west';
export interface Actor extends Point { direction: Direction; moving: boolean }
export interface Weather {
  temperature: number | null; description: string; code: number | null; isRain: boolean;
  retrievedAt: string; status: 'live' | 'stale' | 'offline'; timeZone: 'Europe/Madrid';
  source?: 'Open-Meteo' | 'MET Norway'; validAt?: string; checkedAt?: string;
  diagnostics?: { source: string; outcome: 'live' | 'http_error' | 'invalid_data' | 'network_error'; status?: number; error?: string; elapsedMs: number }[];
}
export interface OpeningInterval { days: number[]; from: string; to: string }
export interface Building {
  id: string; name: string; category: string; footprint: Point[]; entrance: Point;
  sign: Point; openingHours: OpeningInterval[]; acceptsParcels: boolean;
  accessible: boolean; sheltered: boolean; color: string;
}
export interface HistoryEntry { role: 'player' | 'courier' | 'event'; text: string; at: number; turnId?: string }
export interface KnownBuilding {
  id: string; name: string; category: string; entrance: Point; observedAt: number;
  source: 'observed'; acceptsParcels: boolean; accessible: boolean; sheltered: boolean;
  openingHours: OpeningInterval[];
}
export interface Observation extends KnownBuilding { distance: number; direction: Direction; open: boolean }
export interface ActionCandidate {
  id: string; type: 'describe' | 'reveal' | 'clarify' | 'wait' | 'move' | 'continue' | 'drop' | 'return';
  label: string; reason: string; target?: Point; targetId?: string; route?: Point[];
}
export interface Decision {
  id: string; sequence: number; trigger: 'opening' | 'directions' | 'timeout';
  source: 'jev' | 'fallback'; model: string | null; selected: string;
  action: ActionCandidate; candidates: ActionCandidate[];
  probabilities: Record<string, number> | null; confidence: number | null;
  evidence: string[]; reason: string; elapsedMs: number; discarded: boolean;
  usage?: { inputTokens?: number; outputTokens?: number; estimatedUsd?: number };
}
export interface Outcome { kind: 'received' | 'collection' | 'returned'; title: string; detail: string; feedback: string }
export interface Game {
  id: string; phase: 'incoming' | 'active' | 'timeout' | 'resolved';
  startedAt: number | null; deadline: number | null; updatedAt: number;
  courier: Actor; resident: Actor; route: Point[]; routeTargetId: string | null;
  previousDestination: Point | null; parcel: 'courier' | 'resident' | 'drop' | 'returned';
  dropLocationId: string | null; outcome: Outcome | null; history: HistoryEntry[];
  weather: Weather; knowledge: Record<string, KnownBuilding>;
  facts: { homeSide: Direction | null; signDisclosed: boolean; firstClueSpoken: boolean; lastClarification: string | null };
  decision: Decision | null; decisions: Decision[]; sequence: number;
  timeoutPending: boolean; timeoutStartedAt: number | null; arrivalSequence: number;
}

const rect = (x: number, y: number, width: number, height: number): Point[] => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
];
const week = [0, 1, 2, 3, 4, 5, 6];
const hours = (from: string, to: string, days = week): OpeningInterval[] => [{ days, from, to }];
export const HOME_POLYGON: Point[] = [
  { x: 364, y: 220 }, { x: 594, y: 220 }, { x: 679, y: 304 }, { x: 679, y: 537 },
  { x: 592, y: 629 }, { x: 364, y: 629 }, { x: 279, y: 543 }, { x: 279, y: 304 },
];
export const HOME_ENTRANCE: Point = { x: 480, y: 645 };
export const BUILDINGS: Building[] = [
  { id: 'bar-llevant', name: 'Bar Llevant', category: 'bar', footprint: rect(60, 0, 220, 155), entrance: { x: 150, y: 175 }, sign: { x: 150, y: 155 }, openingHours: hours('08:00', '23:30'), acceptsParcels: true, accessible: true, sheltered: true, color: '#b66759' },
  { id: 'bar-ponent', name: 'Bar Ponent', category: 'bar', footprint: rect(340, 0, 220, 155), entrance: { x: 430, y: 175 }, sign: { x: 430, y: 155 }, openingHours: hours('10:00', '22:00', [1, 2, 3, 4, 5, 6]), acceptsParcels: false, accessible: true, sheltered: true, color: '#59847e' },
  { id: 'mercat', name: 'Mercat del Barri', category: 'supermarket', footprint: rect(660, 0, 240, 155), entrance: { x: 780, y: 175 }, sign: { x: 780, y: 155 }, openingHours: hours('08:00', '21:00', [1, 2, 3, 4, 5, 6]), acceptsParcels: true, accessible: true, sheltered: true, color: '#84a167' },
  { id: 'fruita', name: 'Fruita Fresca', category: 'fruit shop', footprint: rect(0, 295, 175, 230), entrance: { x: 195, y: 460 }, sign: { x: 175, y: 460 }, openingHours: [...hours('08:00', '14:00', [1, 2, 3, 4, 5, 6]), ...hours('17:00', '20:00', [1, 2, 3, 4, 5])], acceptsParcels: false, accessible: true, sheltered: false, color: '#d8a759' },
  { id: 'forn', name: 'Forn de la Plaça', category: 'bakery', footprint: rect(785, 295, 175, 235), entrance: { x: 765, y: 460 }, sign: { x: 785, y: 460 }, openingHours: hours('06:30', '20:00'), acceptsParcels: true, accessible: true, sheltered: true, color: '#c88b64' },
  { id: 'perruqueria', name: 'Perruqueria Ona', category: 'hairdresser', footprint: rect(340, 710, 280, 185), entrance: { x: 480, y: 915 }, sign: { x: 480, y: 895 }, openingHours: hours('09:00', '19:00', [2, 3, 4, 5, 6]), acceptsParcels: false, accessible: true, sheltered: true, color: '#9294ad' },
];
export const WORLD_MAP = { size: 960, home: { id: 'home', name: 'Your home', footprint: HOME_POLYGON, entrance: HOME_ENTRANCE }, buildings: BUILDINGS, sightRange: 310, sightDescription: 'Four cardinal viewing sectors, 310 units, with solid-building occlusion.' };
export const SIGHT_RANGE = 310;
export const ACTOR_RADIUS = 10;
export const COURIER_SPEED = 118;
export const RESIDENT_SPEED = 132;
export const ROUND_MS = 60_000;
export const DEFAULT_WEATHER: Weather = { temperature: null, description: 'Weather unavailable', code: null, isRain: false, retrievedAt: new Date(0).toISOString(), status: 'offline', timeZone: 'Europe/Madrid' };

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function directionBetween(a: Point, b: Point): Direction {
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'south' : 'north');
}
export function insidePolygon(p: Point, polygon: readonly Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (((a.y > p.y) !== (b.y > p.y)) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Resident can walk through the authored foyer; courier must stay outside. */
export function walkable(p: Point, actor: 'courier' | 'resident' = 'courier') {
  for (const o of [{ x: 0, y: 0 }, { x: ACTOR_RADIUS, y: 0 }, { x: -ACTOR_RADIUS, y: 0 }, { x: 0, y: ACTOR_RADIUS }, { x: 0, y: -ACTOR_RADIUS }]) {
    const q = { x: p.x + o.x, y: p.y + o.y };
    if (q.x < 12 || q.x > 948 || q.y < 12 || q.y > 948) return false;
    if (BUILDINGS.some(b => insidePolygon(q, b.footprint))) return false;
    if (insidePolygon(q, HOME_POLYGON) && !(actor === 'resident' && q.x >= 450 && q.x <= 510 && q.y >= 530)) return false;
  }
  return true;
}
export function segmentClear(a: Point, b: Point, actor: 'courier' | 'resident' = 'courier') {
  const steps = Math.max(1, Math.ceil(distance(a, b) / 5));
  for (let i = 0; i <= steps; i++) if (!walkable({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }, actor)) return false;
  return true;
}
export function visiblePoint(a: Point, b: Point, excludedBuilding?: string) {
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  if (distance(a, b) > SIGHT_RANGE || Math.min(dx, dy) > 36 + Math.max(dx, dy) * 0.38) return false;
  const steps = Math.ceil(distance(a, b) / 4);
  for (let i = 1; i < steps; i++) {
    const p = { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps };
    if (insidePolygon(p, HOME_POLYGON) || BUILDINGS.some(building => building.id !== excludedBuilding && insidePolygon(p, building.footprint))) return false;
  }
  return true;
}
export function barcelonaTime(now: number) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday), minutes: Number(values.hour) * 60 + Number(values.minute), label: `${values.weekday}, ${values.hour}:${values.minute}`, date: `${values.year}-${values.month}-${values.day}`, timeZone: 'Europe/Madrid' };
}
export function isOpen(building: Pick<Building, 'openingHours'>, now: number) {
  const { day, minutes } = barcelonaTime(now);
  const clock = (v: string) => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };
  return building.openingHours.some(interval => {
    const from = clock(interval.from), to = clock(interval.to);
    if (from <= to) return interval.days.includes(day) && minutes >= from && minutes < to;
    return (interval.days.includes(day) && minutes >= from) || (interval.days.includes((day + 6) % 7) && minutes < to);
  });
}

/** Shortest legal grid route, simplified only across collision-clear segments. */
export function findRoute(start: Point, target: Point): Point[] | null {
  if (!walkable(start) || !walkable(target)) return null;
  if (segmentClear(start, target)) return [{ ...target }];
  const size = 20, count = 48, key = (x: number, y: number) => y * count + x;
  const point = (index: number) => ({ x: (index % count) * size + 10, y: Math.floor(index / count) * size + 10 });
  const nearest = (p: Point) => {
    const matches: { index: number; d: number }[] = [];
    for (let y = Math.max(0, Math.floor(p.y / size) - 2); y <= Math.min(count - 1, Math.floor(p.y / size) + 2); y++) for (let x = Math.max(0, Math.floor(p.x / size) - 2); x <= Math.min(count - 1, Math.floor(p.x / size) + 2); x++) {
      const index = key(x, y), q = point(index); if (segmentClear(p, q)) matches.push({ index, d: distance(p, q) });
    }
    return matches.sort((a, b) => a.d - b.d)[0]?.index;
  };
  const first = nearest(start), last = nearest(target);
  if (first === undefined || last === undefined) return null;
  const open = new Set([first]), costs = new Map([[first, 0]]), previous = new Map<number, number>();
  while (open.size) {
    let current = first, score = Infinity;
    for (const candidate of open) { const f = costs.get(candidate)! + distance(point(candidate), point(last)); if (f < score) { score = f; current = candidate; } }
    if (current === last) {
      const reverse: Point[] = [target]; let p = last; reverse.push(point(p));
      while (previous.has(p)) { p = previous.get(p)!; reverse.push(point(p)); }
      const raw = [start, ...reverse.reverse()], result: Point[] = []; let anchor = 0;
      while (anchor < raw.length - 1) { let next = raw.length - 1; while (next > anchor + 1 && !segmentClear(raw[anchor], raw[next])) next--; result.push(raw[next]); anchor = next; }
      return result;
    }
    open.delete(current);
    const x = current % count, y = Math.floor(current / count);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= count || ny >= count) continue;
      const next = key(nx, ny); if (!segmentClear(point(current), point(next))) continue;
      const cost = costs.get(current)! + Math.hypot(dx, dy) * size;
      if (cost < (costs.get(next) ?? Infinity)) { costs.set(next, cost); previous.set(next, current); open.add(next); }
    }
  }
  return null;
}
