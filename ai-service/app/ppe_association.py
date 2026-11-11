"""Deterministic PPE-to-Person association (SRS §6.2). Pure functions, pixel coordinates."""

# Vertical band of the Person box (fraction of its height) where each region's center must fall.
BANDS = {"NO_HELMET": (0.0, 0.40), "NO_VEST": (0.20, 0.85)}
# Logical labels: indication of violation (positive) vs visible PPE (negative).
LABELS = {"NO_HELMET": ("no_helmet", "helmet"), "NO_VEST": ("no_vest", "vest")}
MIN_REGION_PX = 12


def _in_band(person, box, band):
    x1, y1, x2, y2 = person
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    if not (x1 <= cx <= x2 and y1 <= cy <= y2):
        return False
    rel = (cy - y1) / max(y2 - y1, 1e-9)
    return band[0] <= rel <= band[1]


def associate(persons, regions, types, min_conf):
    """persons: list of xyxy. regions: list of (label, conf, xyxy).

    Returns, per person, a list of {"type","state","confidence","bbox"} (bbox in pixels or None).
    """
    out = [[] for _ in persons]
    for vtype in types:
        band, (pos_label, neg_label) = BANDS[vtype], LABELS[vtype]
        hits = [{"pos": [], "neg": [], "ambiguous": False} for _ in persons]
        for label, conf, box in regions:
            if label not in (pos_label, neg_label) or conf < min_conf:
                continue
            if box[2] - box[0] < MIN_REGION_PX or box[3] - box[1] < MIN_REGION_PX:
                continue
            owners = [i for i, p in enumerate(persons) if _in_band(p, box, band)]
            if len(owners) > 1:
                for i in owners:
                    hits[i]["ambiguous"] = True
            elif owners:
                hits[owners[0]]["pos" if label == pos_label else "neg"].append((conf, box))
        for i, h in enumerate(hits):
            entry = {"type": vtype, "state": "unknown", "confidence": None, "bbox": None}
            if not h["ambiguous"] and bool(h["pos"]) != bool(h["neg"]):
                conf, box = max(h["pos"] or h["neg"], key=lambda r: r[0])
                entry.update(state="positive" if h["pos"] else "negative", confidence=conf, bbox=box)
            out[i].append(entry)
    return out


def normalize(box, width, height):
    """Clip a pixel xyxy box to the frame and scale to [0,1]; None if degenerate."""
    x1, y1, x2, y2 = (min(max(v / d, 0.0), 1.0) for v, d in zip(box, (width, height, width, height)))
    if x1 >= x2 or y1 >= y2:
        return None
    return [round(x1, 4), round(y1, 4), round(x2, 4), round(y2, 4)]
