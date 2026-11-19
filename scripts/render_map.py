"""Render the Tin Shui Wai collage map as a lightweight, filter-free SVG for the website.

The hand-made look (wobbly ink lines, torn paper edges, paper grain, drop shadows) is baked
into the geometry instead of SVG filters, so the map stays sharp and fast at any zoom.
Everything south of the MTR line (Ping Shan side) is faded so the Tin Shui Wai loop stands out.

Usage: python3 scripts/render_map.py data/tsw_osm.json data/tsw_poi.json site/img/map.svg site/data/lines.json
Map data (c) OpenStreetMap contributors, ODbL.
"""
import json
import math
import random
import sys

SRC, POI, OUT, LINES = sys.argv[1:5]
S, W_, N, E = 22.4415, 113.9905, 22.4745, 114.0165
WIDTH = 1800
KX = math.cos(math.radians((S + N) / 2))
SCALE = WIDTH / ((E - W_) * KX)
HEIGHT = int((N - S) * SCALE)
rnd = random.Random(7)

INK, PAPER, CARD = "#3B2A20", "#F4EADA", "#FBF6EC"
GREEN, BLUE, LRT, MTR = "#C7DCAE", "#A8D2E2", "#E98B3A", "#B5523A"
FONT = "'LXGW WenKai TC','Hannotate TC','Kaiti TC',serif"


# ---------- geometry helpers ----------
def xy(lat, lon):
    return ((lon - W_) * KX * SCALE, (N - lat) * SCALE)


def pts(geom):
    return [xy(p["lat"], p["lon"]) for p in geom]


def inside(x, y, m=40):
    return m < x < WIDTH - m and m < y < HEIGHT - m


def visible(p, m=60):
    return any(-m < x < WIDTH + m and -m < y < HEIGHT + m for x, y in p)


def wob(x, y, amp, rough=0.0):
    """Smooth hand-drawn displacement, plus optional fine roughness for torn paper."""
    dx = math.sin(x * .031 + y * .017) * .6 + math.sin(x * .093 - y * .051 + 1.7) * .4
    dy = math.sin(y * .029 - x * .021 + .5) * .6 + math.sin(y * .087 + x * .047 + 2.3) * .4
    rx = ry = 0.0
    if rough:
        rx = math.sin(x * .61 + y * .37) * .5 + math.sin(x * 1.37 - y * .91) * .5
        ry = math.sin(y * .57 - x * .43 + 1.1) * .5 + math.sin(y * 1.29 + x * .83) * .5
    return x + dx * amp + rx * rough, y + dy * amp + ry * rough


def densify(p, step):
    out = []
    for i in range(len(p) - 1):
        (x1, y1), (x2, y2) = p[i], p[i + 1]
        n = max(1, int(math.dist(p[i], p[i + 1]) / step))
        out += [(x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n) for k in range(n)]
    return out + [p[-1]]


def d(p, close=False, amp=1.6, step=14, rough=0.0, dx=0.0, dy=0.0):
    if len(p) < 2:
        return ""
    q = [wob(x, y, amp, rough) for x, y in (densify(p, step) if step else p)]
    s = "M" + "L".join(f"{x + dx:.1f} {y + dy:.1f}" for x, y in q)
    return s + ("Z" if close else "")


def assemble(ways):
    key = lambda p: (round(p["lat"], 7), round(p["lon"], 7))
    ways = [list(w) for w in ways if len(w) > 1]
    rings = []
    while ways:
        ring = ways.pop(0)
        changed = True
        while key(ring[0]) != key(ring[-1]) and changed:
            changed = False
            for i, w in enumerate(ways):
                if key(w[0]) == key(ring[-1]):
                    ring += w[1:]
                elif key(w[-1]) == key(ring[-1]):
                    ring += w[::-1][1:]
                elif key(w[-1]) == key(ring[0]):
                    ring = w[:-1] + ring
                elif key(w[0]) == key(ring[0]):
                    ring = w[::-1][:-1] + ring
                else:
                    continue
                ways.pop(i)
                changed = True
                break
        if key(ring[0]) == key(ring[-1]):
            rings.append(ring)
    return rings


def chain(ways):
    ways = [list(w) for w in ways if len(w) > 1]
    out = []
    while ways:
        c = ways.pop(0)
        grew = True
        while grew:
            grew = False
            for i, w in enumerate(ways):
                if w[0] == c[-1]:
                    c += w[1:]
                elif w[-1] == c[-1]:
                    c += w[::-1][1:]
                elif w[-1] == c[0]:
                    c = w[:-1] + c
                elif w[0] == c[0]:
                    c = w[::-1][:-1] + c
                else:
                    continue
                ways.pop(i)
                grew = True
                break
        out.append(c)
    return out


def length(c):
    return sum(math.dist(c[i], c[i + 1]) for i in range(len(c) - 1))


def in_poly(x, y, poly):
    c = False
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-9) + x1:
            c = not c
    return c


# ---------- read OSM ----------
L = {k: [] for k in ["water", "green", "pitch", "bldg", "major", "minor", "lrt", "mtr", "waterway"]}
parks, stations = [], {}
for el in json.load(open(SRC))["elements"]:
    t = el.get("tags", {})
    if el["type"] == "node":
        name = t.get("name:zh") or t.get("name")
        if name and t.get("railway") in ("station", "halt", "tram_stop"):
            stations.setdefault(name, xy(el["lat"], el["lon"]))
        continue
    if el["type"] == "relation":
        if t.get("natural") == "water":
            rings = []
            for role in ("outer", "inner"):
                rings += assemble([m["geometry"] for m in el.get("members", []) if m.get("role") == role and "geometry" in m])
            L["water"] += [pts(r) for r in rings if visible(pts(r))]
        continue
    g = el.get("geometry")
    if not g:
        continue
    p = pts(g)
    if not visible(p):
        continue
    if t.get("natural") == "water":
        L["water"].append(p)
    elif "waterway" in t:
        L["waterway"].append(p)
    elif t.get("leisure") == "pitch":
        L["pitch"].append(p)
    elif t.get("leisure") in ("park", "garden", "nature_reserve", "playground") or \
            t.get("landuse") in ("grass", "forest", "recreation_ground"):
        L["green"].append(p)
        if t.get("leisure") in ("park", "garden", "nature_reserve") or t.get("landuse") in ("forest", "grass"):
            parks.append(p)
    elif "building" in t:
        L["bldg"].append(p)
    elif t.get("railway") == "light_rail":
        L["lrt"].append(p)
    elif t.get("railway") in ("rail", "subway"):
        L["mtr"].append(p)
    elif t.get("highway") in ("motorway", "trunk", "primary", "secondary", "tertiary"):
        L["major"].append(p)
    elif t.get("highway") in ("residential", "unclassified", "pedestrian"):
        L["minor"].append(p)

estates = []
for el in json.load(open(POI))["elements"]:
    t = el.get("tags", {})
    c = el.get("center") or ({"lat": el["lat"], "lon": el["lon"]} if "lat" in el else None)
    name = t.get("name:zh") or t.get("name")
    if c and t.get("landuse") == "residential" and name and any("一" <= ch <= "鿿" for ch in name):
        x, y = xy(c["lat"], c["lon"])
        if inside(x, y):
            estates.append((x, y, name))

# ---------- the MTR line splits Tin Shui Wai (north) from Ping Shan (south) ----------
mtr_main = max(chain([[(round(x, 1), round(y, 1)) for x, y in p] for p in L["mtr"]]), key=length)
if mtr_main[0][0] > mtr_main[-1][0]:
    mtr_main = mtr_main[::-1]
south_poly = mtr_main + [(WIDTH + 100, mtr_main[-1][1]), (WIDTH + 100, HEIGHT + 100), (-100, HEIGHT + 100), (-100, mtr_main[0][1])]


def south(x, y):
    return in_poly(x, y, south_poly)


def paths(ps, **kw):
    return "".join(f'<path d="{d(p, **kw)}"/>' for p in ps if len(p) > 1)


# ---------- SVG ----------
TREE = '<path d="M12 21v-6" fill="none"/><path d="M6 12c-2-4 2-8 5-7 2-3 7-1 6 3 3 1 2 6-2 6-2 2-6 2-9-2z" fill="#B9D29C"/>'
grain = "".join(f'<circle cx="{rnd.uniform(0, 160):.0f}" cy="{rnd.uniform(0, 160):.0f}" r="{rnd.uniform(.5, 1.3):.1f}" '
                f'fill="{INK}" opacity="{rnd.uniform(.05, .14):.2f}"/>' for _ in range(90))
defs = (f'<defs>'
        f'<pattern id="grain" width="160" height="160" patternUnits="userSpaceOnUse">{grain}</pattern>'
        f'<pattern id="tone" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><circle cx="3" cy="3" r="1.8" fill="#fff" opacity=".7"/></pattern>'
        f'<pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0v7" stroke="{INK}" stroke-width="1" opacity=".18"/></pattern>'
        f'<pattern id="tape" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="16" height="16" fill="#EFC9B4"/><rect width="8" height="16" fill="#F7DFD2"/></pattern>'
        f'<symbol id="tree" viewBox="0 0 24 24"><g stroke="{INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{TREE}</g></symbol>'
        f'</defs>')
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" width="{WIDTH}" height="{HEIGHT}" '
       f'shape-rendering="geometricPrecision" text-rendering="geometricPrecision">',
       defs,
       f'<rect width="100%" height="100%" fill="{PAPER}"/><rect width="100%" height="100%" fill="url(#grain)"/>']

# Torn paper pieces: soft shadow, white backing, colour (+ screentone for water).
for key, fill, tone in (("green", GREEN, False), ("water", BLUE, True)):
    ps = L[key]
    svg.append(f'<g fill="#5a3d22" opacity=".1" fill-rule="evenodd"><path d="{"".join(d(p, True, 3, 6, 1.4, 2, 4) for p in ps)}"/></g>')
    svg.append(f'<g fill="{CARD}" stroke="{CARD}" stroke-width="8" stroke-linejoin="round" fill-rule="evenodd"><path d="{"".join(d(p, True, 3, 6, 1.4) for p in ps)}"/></g>')
    body = "".join(d(p, True, 3, 6, .6) for p in ps)
    svg.append(f'<path d="{body}" fill="{fill}" fill-rule="evenodd"/>')
    if tone:
        svg.append(f'<path d="{body}" fill="url(#tone)" fill-rule="evenodd"/>')
svg.append(f'<g fill="none" stroke="{BLUE}" stroke-width="8" stroke-linecap="round">{paths(L["waterway"])}</g>')
svg.append(f'<g fill="url(#hatch)" stroke="{INK}" stroke-width="1.5" stroke-opacity=".5">{paths(L["pitch"], close=True, amp=1, step=0)}</g>')

# Roads: wobbly ink double line.
svg.append(f'<g fill="none" stroke-linecap="round" stroke-linejoin="round">'
           f'<g stroke="{INK}" stroke-width="9" opacity=".75">{paths(L["major"])}</g>'
           f'<g stroke="{INK}" stroke-width="6" opacity=".45">{paths(L["minor"])}</g>'
           f'<g stroke="{CARD}" stroke-width="5.5">{paths(L["major"])}</g>'
           f'<g stroke="{CARD}" stroke-width="3">{paths(L["minor"])}</g></g>')

# Buildings: paper colour, thin ink outline.
svg.append(f'<g fill="{CARD}" stroke="{INK}" stroke-width="1.3" stroke-opacity=".42" stroke-linejoin="round">'
           f'{paths(L["bldg"], close=True, amp=1.1, step=0)}</g>')

# Trees sprinkled inside parks.
trees = []
for poly in parks:
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    area = (max(xs) - min(xs)) * (max(ys) - min(ys))
    for _ in range(min(140, int(area / 1600))):
        x, y = rnd.uniform(min(xs), max(xs)), rnd.uniform(min(ys), max(ys))
        if inside(x, y) and in_poly(x, y, poly):
            trees.append((x, y, rnd.uniform(18, 26)))
svg.append("".join(f'<use href="#tree" x="{x - s / 2:.1f}" y="{y - s * .8:.1f}" width="{s:.0f}" height="{s:.0f}"/>' for x, y, s in trees))

# Light rail: split every track into the Tin Shui Wai part (drawn normally) and the part that
# leaves south (route 751 etc.), which fades out after it crosses the MTR line.
def split_runs(p):
    north_runs, south_runs, run, side = [], [], [], None
    for q in densify(p, 10):
        s = south(*q)
        if side is not None and s != side:
            (south_runs if side else north_runs).append(run + [q])
            run = [run[-1]] if run else []
        run.append(q)
        side = s
    if len(run) > 1:
        (south_runs if side else north_runs).append(run)
    return north_runs, south_runs


lrt_n, lrt_s = [], []
for p in L["lrt"]:
    a, b = split_runs(p)
    lrt_n += a
    lrt_s += b


def rail(ps):
    return (f'<g stroke="{INK}" stroke-width="9">{paths(ps)}</g><g stroke="{LRT}" stroke-width="5.5">{paths(ps)}</g>'
            f'<g stroke="#FFF4DD" stroke-width="1.8" stroke-dasharray="6 7">{paths(ps)}</g>')


svg.append(f'<g fill="none" stroke-linecap="round" stroke-linejoin="round">{rail(lrt_n)}</g>')

# Estate names: quiet background text, so they never compete with stickers.
seen = set()
for x, y, name in estates:
    if name in seen:
        continue
    seen.add(name)
    svg.append(f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="middle" font-size="17" font-family="{FONT}" fill="{INK}" fill-opacity=".42" '
               f'stroke="{PAPER}" stroke-width="5" stroke-opacity=".9" paint-order="stroke" '
               f'transform="rotate({rnd.uniform(-4, 4):.1f} {x:.1f} {y:.1f})">{name}</text>')

# Fade the Ping Shan side: a paper veil south of the MTR line, then the MTR line itself, softer.
veil = "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in south_poly) + "Z"
svg.append(f'<path d="{veil}" fill="{PAPER}" opacity=".62"/>')
svg.append(f'<g fill="none" stroke-linecap="round" opacity=".55"><g stroke="{INK}" stroke-width="12">{paths(L["mtr"])}</g>'
           f'<g stroke="{MTR}" stroke-width="7.5">{paths(L["mtr"])}</g></g>')
# Southbound light rail: full strength at Tin Shui Wai station, fading to nothing ~300px out.
hx, hy = stations.get("天水圍", (WIDTH / 2, HEIGHT * .8))
svg.append(f'<defs><radialGradient id="leave" gradientUnits="userSpaceOnUse" cx="{hx:.0f}" cy="{hy:.0f}" r="320">'
           f'<stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#fff" stop-opacity=".85"/>'
           f'<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
           f'<mask id="leave-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="{WIDTH}" height="{HEIGHT}">'
           f'<rect width="{WIDTH}" height="{HEIGHT}" fill="url(#leave)"/></mask></defs>')
svg.append(f'<g mask="url(#leave-mask)" fill="none" stroke-linecap="round" stroke-linejoin="round">{rail(lrt_s)}</g>')

# Station names: low-key handwriting beside a small stop dot (no paper card, so only stickers look like "tags").
kept = []
for name, (x, y) in stations.items():
    if not inside(x, y, 30) or south(x, y + 12):
        continue
    kept.append({"name": name, "x": round(x, 1), "y": round(y, 1)})
    svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="6.5" fill="{CARD}" stroke="{INK}" stroke-width="2.5"/>'
               f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2.4" fill="{LRT}"/>'
               f'<text x="{x + 12:.1f}" y="{y - 10:.1f}" font-size="21" font-family="{FONT}" fill="{INK}" fill-opacity=".78" '
               f'stroke="{PAPER}" stroke-width="5" stroke-opacity=".95" paint-order="stroke">{name}</text>')

svg.append(f'<text x="{WIDTH - 24}" y="{HEIGHT - 20}" text-anchor="end" font-size="18" fill="#8A7458" font-family="sans-serif">'
           f'Map data © OpenStreetMap contributors</text></svg>')
open(OUT, "w").write("".join(svg))

# Routes 705/706: the circular line round Tin Shui Wai. Build it as one closed path by walking the
# track graph station to station (shortest path between consecutive stops).
import heapq

graph = {}
for p in L["lrt"]:
    q = [(round(x, 1), round(y, 1)) for x, y in p]
    for a, b in zip(q, q[1:]):
        w = math.dist(a, b)
        graph.setdefault(a, []).append((b, w))
        graph.setdefault(b, []).append((a, w))
nodes = list(graph)


def nearest(pt):
    return min(nodes, key=lambda n: (n[0] - pt[0]) ** 2 + (n[1] - pt[1]) ** 2)


def shortest(a, b):
    dist, prev_, pq = {a: 0}, {}, [(0, a)]
    while pq:
        dcur, u = heapq.heappop(pq)
        if u == b:
            break
        if dcur > dist[u]:
            continue
        for v, w in graph[u]:
            nd = dcur + w
            if nd < dist.get(v, 1e18):
                dist[v], prev_[v] = nd, u
                heapq.heappush(pq, (nd, v))
    out = [b]
    while out[-1] != a:
        out.append(prev_[out[-1]])
    return out[::-1]


LOOP_STOPS = ["天水圍", "天耀", "樂湖", "天瑞", "頌富", "天富", "天逸", "天恒", "濕地公園",
              "天秀", "天悅", "天榮", "銀座", "天湖", "天慈", "天水圍"]
loop = []
for s1, s2 in zip(LOOP_STOPS, LOOP_STOPS[1:]):
    seg = shortest(nearest(stations[s1]), nearest(stations[s2]))
    loop += seg if not loop else seg[1:]


def drop_detours(p, tol=7.0, window=700.0):
    """Remove out-and-back excursions (e.g. into a station siding) where the path returns
    close to a point it already passed; trains would otherwise visibly reverse there."""
    p = densify(p, 4)
    out, i = [], 0
    while i < len(p):
        out.append(p[i])
        far, run = None, 0.0
        for j in range(i + 1, len(p)):
            run += math.dist(p[j - 1], p[j])
            if run > window:
                break
            if run > 4 * tol and math.dist(p[i], p[j]) < tol:
                far = j
        i = far if far else i + 1
    # Closing seam: the start and end may share a stub at 天水圍; trim to where they meet.
    best = None
    head = 0.0
    for a in range(1, len(out)):
        head += math.dist(out[a - 1], out[a])
        if head > window:
            break
        tail = 0.0
        for b in range(len(out) - 2, 0, -1):
            tail += math.dist(out[b + 1], out[b])
            if tail > window:
                break
            if math.dist(out[a], out[b]) < tol:
                best = (a, b)
    if best:
        out = out[best[0]:best[1] + 1]
    # Thin back out: keep a point every ~6px.
    thin = [out[0]]
    for q in out[1:]:
        if math.dist(q, thin[-1]) >= 6:
            thin.append(q)
    return [(round(x, 1), round(y, 1)) for x, y in thin]


before = round(length(loop))
loop = drop_detours(loop)
print(f"loop: {before}px -> {round(length(loop))}px after removing detours")
json.dump({"loop": [list(p) for p in loop], "stations": kept}, open(LINES, "w"), ensure_ascii=False)
print(f"wrote {OUT} {WIDTH}x{HEIGHT}; stations kept={len(kept)} estates={len(seen)} trees={len(trees)} "
      f"705/706 loop length={round(length(loop))}px, south lrt runs={len(lrt_s)}")
