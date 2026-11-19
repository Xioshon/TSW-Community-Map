"""Build the team's 2026-11-06 night-walk route (the night-mode easter egg).

The route comes from the team's own Google Earth tracing (data/walk_trace.json: vertices
georeferenced from their screenshots, about +/-25 m). Each stretch between two traced
vertices is snapped onto the OSM footpath graph when that gives a sensible path, so the line
follows real pavements; 龍園 → 銀座 was an underground tunnel and stays a straight line.

Usage: python3 scripts/walk_route.py data/tsw_osm.json data/walk_trace.json site/data/lines.json site/data/walk.json
Map data (c) OpenStreetMap contributors, ODbL.
"""
import heapq
import json
import math
import sys

SRC, TRACE, LINES, OUT = sys.argv[1:5]
S, W_, N, E = 22.4415, 113.9905, 22.4745, 114.0165
WIDTH = 1800
KX = math.cos(math.radians((S + N) / 2))
SCALE = WIDTH / ((E - W_) * KX)
M_PER_PX = 111320 / SCALE


def xy(lat, lon):
    return ((lon - W_) * KX * SCALE, (N - lat) * SCALE)


stations = {s["name"]: (s["x"], s["y"]) for s in json.load(open(LINES))["stations"]}
trace = json.load(open(TRACE))

# ---------- walking graph ----------
COST = {"footway": 1.0, "pedestrian": 1.0, "cycleway": 1.1, "service": 1.3, "residential": 1.3,
        "unclassified": 1.3, "tertiary": 1.6, "secondary": 2.2, "primary": 2.6}
coord, graph = {}, {}
for e in json.load(open(SRC))["elements"]:
    hw = e.get("tags", {}).get("highway")
    if hw not in COST or "nodes" not in e or "geometry" not in e:
        continue
    for i, g in zip(e["nodes"], e["geometry"]):
        coord[i] = xy(g["lat"], g["lon"])
    for a, b in zip(e["nodes"], e["nodes"][1:]):
        w = math.dist(coord[a], coord[b])
        graph.setdefault(a, []).append((b, w * COST[hw], w))
        graph.setdefault(b, []).append((a, w * COST[hw], w))
nodes = list(graph)


def nearest(pt):
    n = min(nodes, key=lambda k: (coord[k][0] - pt[0]) ** 2 + (coord[k][1] - pt[1]) ** 2)
    return n, math.dist(coord[n], pt)


def shortest(a, b):
    dist, prev, pq = {a: 0}, {}, [(0, a)]
    while pq:
        dc, u = heapq.heappop(pq)
        if u == b:
            break
        if dc > dist[u]:
            continue
        for v, w, _ in graph[u]:
            if dc + w < dist.get(v, 1e18):
                dist[v], prev[v] = dc + w, u
                heapq.heappush(pq, (dc + w, v))
    if b not in dist:
        return None
    out = [b]
    while out[-1] != a:
        out.append(prev[out[-1]])
    return [coord[n] for n in out[::-1]]


def plen(p):
    return sum(math.dist(a, b) for a, b in zip(p, p[1:]))


def snap(a, b):
    """Follow real paths between two traced vertices, unless that wanders off the tracing."""
    (na, da), (nb, db) = nearest(a), nearest(b)
    if da * M_PER_PX > 30 or db * M_PER_PX > 30 or na == nb:
        return [a, b]
    p = shortest(na, nb)
    if not p or plen(p) > 1.25 * math.dist(a, b) + 15 / M_PER_PX:
        return [a, b]
    return [a] + p + [b]


def simplify(p, tol=1.2):
    if len(p) < 3:
        return p
    (x1, y1), (x2, y2) = p[0], p[-1]
    L = math.dist(p[0], p[-1]) or 1e-9
    dmax, idx = 0, 0
    for i in range(1, len(p) - 1):
        x0, y0 = p[i]
        dd = abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1) / L
        if dd > dmax:
            dmax, idx = dd, i
    if dmax <= tol:
        return [p[0], p[-1]]
    return simplify(p[: idx + 1], tol)[:-1] + simplify(p[idx:], tol)


# ---------- the walk, in order, with the team's memo stops ----------
# Indices refer to trace["main"] (the loop as traced, starting on the east side and going north).
MEMO = {11: "天水圍公園", 19: "天瑞街市", 20: "燈口", 22: "近醫院小徑", 23: "醫院旁行人路",
        25: "天水圍醫院", 27: "迴旋處 & 臭河旁", 28: "臭河"}
main = trace["main"]
seq = []  # (point, stop name or None, leg-into-this-point is a tunnel)
for i, v in enumerate(main):
    if v == "DRAGON":
        seq += [(xy(*p), None, False) for p in trace["dragon_out"][1:]]
        seq.append((xy(*trace["dragon_park"]), "龍園", False))
        seq += [(xy(*p), None, False) for p in trace["dragon_back"]]
        seq.append((xy(*trace["tunnel_end"]), "銀座（隧道出口）", True))
        continue
    seq.append((xy(*v), MEMO.get(i), False))

# Start (and finish) at 天慈 stop: rotate the loop to the traced point nearest the station.
t0 = stations["天慈"]
k = min(range(len(seq) - 1), key=lambda i: math.dist(seq[i][0], t0))
seq = [(t0, "天慈（出發）", False)] + seq[k + 1:-1] + seq[:k + 1] + [(t0, None, False)]

legs, stops, cur, total = [], [], [seq[0][0]], 0.0
stops.append({"name": seq[0][1], "at": 0.0, "pt": seq[0][0]})
for (a, _, _), (b, name, tunnel) in zip(seq, seq[1:]):
    if tunnel:
        if len(cur) > 1:
            legs.append({"tunnel": False, "pts": cur})
        legs.append({"tunnel": True, "pts": [a, b]})
        cur = [b]
    else:
        cur += snap(a, b)[1:]
    total += math.dist(a, b) if tunnel else plen(snap(a, b))
    if name:
        stops.append({"name": name, "at": total, "pt": b})
legs.append({"tunnel": False, "pts": cur})
raw_total = total

for l in legs:
    l["pts"] = simplify(l["pts"])
    l["len"] = round(plen(l["pts"]), 1)
    l["pts"] = [[round(x, 1), round(y, 1)] for x, y in l["pts"]]
total = sum(l["len"] for l in legs)
json.dump({
    "date": "2026-11-06",
    "stops": [{"name": s["name"], "x": round(s["pt"][0], 1), "y": round(s["pt"][1], 1),
               "at": round(s["at"] / raw_total, 4)} for s in stops],
    "legs": legs,
    "km": round(total * M_PER_PX / 1000, 2),
}, open(OUT, "w"), ensure_ascii=False)
print(f"{len(legs)} legs, {len(stops)} stops, ~{total * M_PER_PX / 1000:.2f} km")
