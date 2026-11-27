# Region atlas data model

- `ObjectRegion`: integer `level`, inclusive tile `range` (`x0`, `y0`, `x1`, `y1`).
  Bounds may extend off-map for border views. Reject non-finite/inverted ranges or levels
  outside the world; do not silently build a whole-map atlas for invalid input.
- `ObjectsResult.identity`: existing source/seed/page-size identity, suffixed with
  canonical region coordinates when regional. The returned objects are the conservatively
  selected subset, with their original ordering/IDs/phases unchanged.
- `RegionalCacheEntry`: full exact result identity plus serialized existing result payload;
  at most one current seed/region in each map/archive/profile slot.
- Engine target camera: latest requested place. Displayed camera: camera matching the
  resident atlas. While work is pending these may differ; statistics distinguish them.
- A region result transitions requested → ready → resident only if still current.
  Superseded/failed results cannot replace the displayed scene.
