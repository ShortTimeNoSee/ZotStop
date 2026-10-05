import math


def simplify(points, tolerance=4.0):
    if tolerance < 0 or not math.isfinite(tolerance):
        raise ValueError('Tolerance must be a finite nonnegative number of meters')
    clean = []
    for point in points:
        lon, lat = point
        if not math.isfinite(lon) or not math.isfinite(lat) or abs(lat) > 90 or abs(lon) > 180:
            raise ValueError('Invalid geographic coordinate')
        if not clean or [lon, lat] != clean[-1]:
            clean.append([lon, lat])
    if len(clean) < 3:
        return clean

    closed = clean[0] == clean[-1]
    if closed:
        clean.pop()
        if len(clean) < 3:
            return clean + [clean[0]]

    latitude = math.radians(sum(point[1] for point in clean) / len(clean))
    meters_per_degree = math.pi * 6371008.8 / 180
    planar = [(lon * meters_per_degree * math.cos(latitude), lat * meters_per_degree) for lon, lat in clean]

    def simplify_open(start, end):
        keep = {start, end}
        stack = [(start, end)]
        while stack:
            first, last = stack.pop()
            ax, ay = planar[first]
            bx, by = planar[last]
            dx, dy = bx - ax, by - ay
            length_squared = dx * dx + dy * dy
            index, largest = -1, -1.0
            for at in range(first + 1, last):
                px, py = planar[at]
                fraction = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_squared)) if length_squared else 0.0
                distance_squared = (px - ax - fraction * dx) ** 2 + (py - ay - fraction * dy) ** 2
                if distance_squared > largest:
                    index, largest = at, distance_squared
            if largest > tolerance * tolerance:
                keep.add(index)
                stack.extend(((first, index), (index, last)))
        return keep

    if closed:
        origin = planar[0]
        split = max(range(1, len(planar)), key=lambda i: (planar[i][0] - origin[0]) ** 2 + (planar[i][1] - origin[1]) ** 2)
        planar.append(planar[0])
        clean.append(clean[0])
        kept = simplify_open(0, split) | simplify_open(split, len(clean) - 1)
        return [clean[i] for i in sorted(kept)]

    return [clean[i] for i in sorted(simplify_open(0, len(clean) - 1))]
