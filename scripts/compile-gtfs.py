import csv
import io
import json
import sqlite3
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from geometry import simplify

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://ucirvine.transloc.com/Secure/Admin/Reports/GTFSDownload.aspx'
OUT = ROOT / 'packages/transit-engine/assets'
PUBLIC = ROOT / 'apps/web/public/data'
CONFIG = json.loads((ROOT / 'packages/transit-engine/src/agency.json').read_text())
KEEP = set(CONFIG['includedRouteNames'])


def read_table(archive, name):
    return list(csv.DictReader(io.TextIOWrapper(archive.open(name), encoding='utf-8-sig')))


def parse_time(value):
    if not value:
        return None
    hour, minute, second = map(int, value.split(':'))
    return hour * 3600 + minute * 60 + second


def compile_timepoints(route_trips, grouped_times):
    rows = [row for trip in route_trips for row in grouped_times.get(trip['trip_id'], [])]
    if not rows or 'timepoint' not in rows[0]:
        return None
    agreed = {}
    for row in rows:
        agreed[row['stop_id']] = agreed.get(row['stop_id'], True) and row.get('timepoint') == '1'
    return {stop_id for stop_id, holds in agreed.items() if holds}


def route_stops(ordered_rows, stop_lookup, timepoints):
    seen = set()
    compiled = []
    for item in ordered_rows:
        stop_id = item['stop_id']
        if stop_id in seen:
            continue
        seen.add(stop_id)
        stop = stop_lookup[stop_id]
        entry = {
            'id': stop_id,
            'code': stop['stop_code'],
            'name': stop['stop_name'],
            'lat': float(stop['stop_lat']),
            'lon': float(stop['stop_lon']),
        }
        if timepoints is not None:
            entry['timepoint'] = stop_id in timepoints
        compiled.append(entry)
    return compiled


def compile_timing_segments(route_trips, grouped_times):
    runtimes = defaultdict(Counter)
    for trip in route_trips:
        ordered = sorted(grouped_times[trip['trip_id']], key=lambda item: int(item['stop_sequence']))
        timed = []
        for item in ordered:
            arrival = parse_time(item['arrival_time'])
            departure = parse_time(item['departure_time'])
            if arrival is not None or departure is not None:
                timed.append((item['stop_id'], arrival, departure))
        for before, after in zip(timed, timed[1:]):
            start = before[2] if before[2] is not None else before[1]
            end = after[1] if after[1] is not None else after[2]
            if start is not None and end is not None and end - start >= 30:
                runtimes[(before[0], after[0])][end - start] += 1
    return [
        {'fromStopId': pair[0], 'toStopId': pair[1], 'scheduledSeconds': counts.most_common(1)[0][0]}
        for pair, counts in runtimes.items()
    ]


def main():
    request = urllib.request.Request(SOURCE, headers={'User-Agent': 'ZotStop/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read()
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        required = {'routes.txt', 'trips.txt', 'stops.txt', 'stop_times.txt', 'shapes.txt'}
        if not required.issubset(archive.namelist()):
            raise ValueError('GTFS feed is missing required tables')
        routes = read_table(archive, 'routes.txt')
        trips = read_table(archive, 'trips.txt')
        stops = read_table(archive, 'stops.txt')
        times = read_table(archive, 'stop_times.txt')
        shapes = read_table(archive, 'shapes.txt')
        calendars = read_table(archive, 'calendar.txt')
        exceptions = read_table(archive, 'calendar_dates.txt')
    selected = {row['route_id']: row for row in routes if row['route_long_name'] in KEEP}
    if {row['route_long_name'] for row in selected.values()} != KEEP:
        raise ValueError('Configured routes are missing from the official GTFS feed')
    stop_lookup = {row['stop_id']: row for row in stops}
    grouped_shapes = defaultdict(list)
    for row in shapes:
        grouped_shapes[row['shape_id']].append((int(row['shape_pt_sequence']), [float(row['shape_pt_lon']), float(row['shape_pt_lat'])]))
    grouped_times = defaultdict(list)
    for row in times:
        grouped_times[row['trip_id']].append(row)
    output_routes = []
    for route_id, row in selected.items():
        route_trips = [trip for trip in trips if trip['route_id'] == route_id]
        if not route_trips:
            raise ValueError(f'No trips for {route_id}')
        shape_id = route_trips[0]['shape_id']
        points = [point for _, point in sorted(grouped_shapes[shape_id])]
        ordered_stops = sorted(grouped_times[route_trips[0]['trip_id']], key=lambda item: int(item['stop_sequence']))
        compiled_stops = route_stops(ordered_stops, stop_lookup, compile_timepoints(route_trips, grouped_times))
        output_routes.append({
            'id': route_id,
            'name': row['route_long_name'],
            'letter': row['route_long_name'][0],
            'color': '#' + row['route_color'],
            'shape': simplify(points),
            'stops': compiled_stops,
            'timingSegments': compile_timing_segments(route_trips, grouped_times),
        })
    output_routes.sort(key=lambda item: CONFIG['includedRouteNames'].index(item['name']))
    payload = {'source': SOURCE, 'generatedAt': datetime.now(timezone.utc).isoformat(), 'routes': output_routes, 'calendar': calendars, 'exceptions': exceptions}
    OUT.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(payload, separators=(',', ':'))
    db_path = OUT / 'gtfs.sqlite'
    db_temporary = OUT / 'gtfs.sqlite.tmp'
    if db_temporary.exists():
        db_temporary.unlink()
    db = sqlite3.connect(db_temporary)
    db.execute('CREATE TABLE route (id TEXT PRIMARY KEY, name TEXT NOT NULL, letter TEXT NOT NULL, color TEXT NOT NULL)')
    db.execute('CREATE TABLE stop (route_id TEXT NOT NULL, position INTEGER NOT NULL, id TEXT NOT NULL, code TEXT, name TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, timepoint INTEGER, PRIMARY KEY(route_id, position))')
    db.execute('CREATE TABLE shape_point (route_id TEXT NOT NULL, position INTEGER NOT NULL, lon REAL NOT NULL, lat REAL NOT NULL, PRIMARY KEY(route_id, position))')
    for route in output_routes:
        db.execute('INSERT INTO route VALUES (?, ?, ?, ?)', (route['id'], route['name'], route['letter'], route['color']))
        db.executemany('INSERT INTO stop VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [(route['id'], index, stop['id'], stop['code'], stop['name'], stop['lat'], stop['lon'], 1 if stop.get('timepoint') else 0 if 'timepoint' in stop else None) for index, stop in enumerate(route['stops'])])
        db.executemany('INSERT INTO shape_point VALUES (?, ?, ?, ?)', [(route['id'], index, point[0], point[1]) for index, point in enumerate(route['shape'])])
    db.commit()
    integrity = db.execute('PRAGMA integrity_check').fetchone()[0]
    db.close()
    if integrity != 'ok':
        db_temporary.unlink(missing_ok=True)
        raise ValueError('Compiled route database failed integrity check')
    db_temporary.replace(db_path)
    for target in (OUT / 'routes.min.json', PUBLIC / 'routes.min.json'):
        temporary = target.with_suffix('.json.tmp')
        temporary.write_text(encoded)
        temporary.replace(target)
    print(f'Compiled {len(output_routes)} routes, {sum(len(route["stops"]) for route in output_routes)} route stops, {len(encoded)} web bytes')


if __name__ == '__main__':
    main()
