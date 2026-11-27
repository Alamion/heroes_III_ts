# Region atlas validation

Status: planned commands/scenario; not passing evidence until the tasks record results.

1. Run targeted decoder/region tests with synthetic archives and a 2048 page size.
2. Build and run the browser harness with the developer regional EngineOptions opt-in.
   Supply the local base/data/HotA archives and `public/dev-assets/test_map_hota.h3m`.
3. Capture fixed seed/time views on both levels, move to a distant place and issue ten
   rapid requests. Wait for region readiness, not an arbitrary delay. Compare pixels
   against the whole-map engine route and inspect fresh normal/narrow captures.
4. Read resident sprite count/bytes and requested/displayed camera state. Add unseen
   synthetic DEF types: the view's residency must not grow. Verify repeat visits
   overwrite one regional cache slot rather than appending a record per view.
5. Before production default rollout: `yarn build`, `yarn test`, `yarn verify layers`,
   `yarn verify corpus`, `yarn verify budget`, `yarn verify hosts`, package checks.
   Retain game-derived evidence only under `check-reports/`.

Stop after the first real-runtime scenario for maintainer review. Folder preparation,
recovery and the complete host/budget matrix follow that review, not before it.
