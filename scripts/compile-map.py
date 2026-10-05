import json
import math
import sys
import urllib.error
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

from geometry import simplify

ROOT = Path(__file__).resolve().parents[1]
FEED = ROOT / 'apps/web/public/data/routes.min.json'
OUTPUT_DIR = ROOT / 'apps/web/public/data'
ROAD_CLASSES = {'primary', 'secondary', 'tertiary', 'residential', 'living_street', 'service', 'pedestrian', 'footway', 'path', 'cycleway', 'unclassified'}
AREA_TAGS = {'park', 'garden', 'grass', 'meadow', 'wood', 'forest', 'water', 'reservoir', 'basin', 'wetland', 'university', 'college', 'school'}


def existing_map_is_usable():
    try:
        for name, minimum in (('roads', 100), ('areas', 100), ('places', 1)):
            collection = json.loads((OUTPUT_DIR / f'{name}.geojson').read_text())
            if collection.get('type') != 'FeatureCollection' or len(collection.get('features', [])) < minimum:
                return False
        return True
    except (OSError, ValueError, TypeError, AttributeError):
        return False


def bounds_from_feed():
    feed = json.loads(FEED.read_text())
    points = [point for route in feed['routes'] for point in route['shape']]
    if not points:
        raise ValueError('Route feed has no geometry')
    latitude = sum(point[1] for point in points) / len(points)
    margin_lat = 300 / 111_195
    margin_lon = margin_lat / math.cos(math.radians(latitude))
    return (min(point[0] for point in points) - margin_lon, min(point[1] for point in points) - margin_lat,
            max(point[0] for point in points) + margin_lon, max(point[1] for point in points) + margin_lat)


def main(keep_existing_on_fetch_error=False):
    west, south, east, north = bounds_from_feed()
    box = f'{south:.6f},{west:.6f},{north:.6f},{east:.6f}'
    query = f"""[out:xml][timeout:90][bbox:{box}];
    (way[highway];way[waterway];way[building];way[leisure];way[landuse];way[natural];way[amenity];
    node[name][amenity];node[name][tourism];node[name][leisure];);
    out body;>;out skel qt;"""
    request = urllib.request.Request(
        'https://overpass-api.de/api/interpreter',
        data=urllib.parse.urlencode({'data': query}).encode(),
        headers={'User-Agent': 'ZotStop/1.0.0 (+https://github.com/ShortTimeNoSee/ZotStop)', 'Content-Type': 'application/x-www-form-urlencoded'},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            root = ET.fromstring(response.read())
    except (urllib.error.URLError, TimeoutError, ET.ParseError) as error:
        if not keep_existing_on_fetch_error or not existing_map_is_usable():
            raise
        print(f'Keeping validated street map after source download failed: {error}')
        return
    nodes, ways = {}, {}
    for item in root.findall('node'):
        tags = {tag.attrib['k']: tag.attrib['v'] for tag in item.findall('tag')}
        key = item.attrib['id']
        previous = nodes.get(key)
        if previous:
            tags = {**previous[1], **tags}
        nodes[key] = ([float(item.attrib['lon']), float(item.attrib['lat'])], tags)
    for item in root.findall('way'):
        tags = {tag.attrib['k']: tag.attrib['v'] for tag in item.findall('tag')}
        ways[item.attrib['id']] = (tags, [ref.attrib['ref'] for ref in item.findall('nd')])

    roads, areas, places = [], [], []
    for coordinates, tags in nodes.values():
        if tags.get('name') and (tags.get('amenity') or tags.get('tourism') or tags.get('leisure')):
            places.append({'name': tags['name'], 'kind': tags.get('amenity') or tags.get('tourism') or tags.get('leisure'), 'point': coordinates})
    for tags, refs in ways.values():
        if any(ref not in nodes for ref in refs):
            continue
        points = [nodes[ref][0] for ref in refs]
        if tags.get('highway') in ROAD_CLASSES and len(points) >= 2:
            roads.append({'kind': tags['highway'], 'name': tags.get('name', ''), 'points': [[round(lon, 6), round(lat, 6)] for lon, lat in simplify(points, 4)]})
        if tags.get('waterway') in {'river', 'stream', 'canal', 'drain'} and len(points) >= 2:
            roads.append({'kind': f"waterway:{tags['waterway']}", 'name': tags.get('name', ''),
                          'points': [[round(lon, 6), round(lat, 6)] for lon, lat in simplify(points, 4)]})
        if len(points) >= 4 and points[0] == points[-1]:
            kind = 'building' if tags.get('building') and tags['building'] != 'no' else tags.get('leisure') or tags.get('landuse') or tags.get('natural') or tags.get('amenity')
            if kind == 'building' or kind in AREA_TAGS:
                ring = [[round(lon, 6), round(lat, 6)] for lon, lat in simplify(points, 2)]
                if len(ring) >= 4:
                    areas.append({'kind': kind, 'name': tags.get('name', ''), 'points': ring})
                    if tags.get('name') and kind != 'building':
                        places.append({'name': tags['name'], 'kind': kind, 'point': [sum(p[0] for p in points[:-1]) / (len(points) - 1), sum(p[1] for p in points[:-1]) / (len(points) - 1)]})
    if len(roads) < 100 or len(areas) < 100:
        raise ValueError('OpenStreetMap download appears incomplete')
    generated_at = datetime.now(timezone.utc).isoformat()
    collections = {
        'roads': [{'type': 'Feature', 'properties': {'kind': road['kind'], 'name': road['name']},
                   'geometry': {'type': 'LineString', 'coordinates': road['points']}} for road in roads],
        'areas': [{'type': 'Feature', 'properties': {'kind': area['kind'], 'name': area['name']},
                   'geometry': {'type': 'Polygon', 'coordinates': [area['points']]}} for area in areas],
        'places': [{'type': 'Feature', 'properties': {'kind': place['kind'], 'name': place['name']},
                    'geometry': {'type': 'Point', 'coordinates': place['point']}} for place in places],
    }
    for name, features in collections.items():
        output = OUTPUT_DIR / f'{name}.geojson'
        temporary = output.with_suffix('.tmp')
        temporary.write_text(json.dumps({'type': 'FeatureCollection', 'generatedAt': generated_at,
                                         'features': features}, separators=(',', ':')))
        temporary.replace(output)
    print(f'Compiled {len(roads)} roads, {len(areas)} areas, {len(places)} places')


if __name__ == '__main__':
    main('--keep-existing-on-fetch-error' in sys.argv[1:])
