# Staged artwork collaboration

Vessel's collaboration bridge is artwork-agnostic. A staged workflow expands
one caller-defined batch at a time into a generic `artwork-job`. Vessel owns
canonical gestures, technical geometry validation, Color Cycle finalization,
checkpoint capture, and the returned revision fence. The caller owns looking,
remembering, mass selection, and artistic signoff.

## Run preflight

Before every fresh run, ask exactly:

- **Canvas resolution:** exact width × height, or “match reference aspect”?
- **Reference:** which attached image or file?
- **Brush(es):** which brush, and what role/layer for each if multiple?
- **Run type:** full one-shot or pause at checkpoints?

Do not repeat settings already owned by the selected brush profile unless Jason
asks for an override.

## Artistic contract

The workflow repeats:

```text
look -> hold a mass in memory -> draw it -> look again -> respond
```

Every filled mass contains 20-60 meaningful boundary anchors describing
remembered turns, curvature changes, corners, flats, notches, bulges, tapers,
interruptions, occlusions, and closure. Uniform interpolation may add pointer
samples for continuity but cannot substitute for observation.

Once a valid artistic mark commits, it stays. Later marks may overlap,
contradict, absorb, or redirect it. A stale fence, malformed polygon, canonical
no-op, or unpublished delta is an uncommitted technical attempt, not an
artistic mark and not an aesthetic rejection.

## Three conceptual passes

Workflows use the collaboration phase vocabulary:

1. `establish` — approximately 5% of planned shapes;
2. `develop` — approximately 15%; and
3. `deepen` — approximately 80%.

The percentages describe planned shape count, not canvas coverage or a signoff
quota. Deepen contains most of the sustained looking and nested construction,
but it keeps varied physical scales and may include large responsive masses.

One conceptual pass may contain several bounded `artwork-stage` dispatches.
Those checkpoints are pauses inside the pass, not extra passes. After looking
at the returned frame, the caller records `advance`, `continue-current`, or
`blocked`. `continue-current` keeps the current pass open without undoing or
removing committed work.

## Brush profiles and pass speed

The selected preset owns its collaboration settings and ranges through
`artworkProfile`. Profiled options currently include:

- `color-cycle-flat-dither` for observed filled masses; and
- `color-cycle-stroke` for genuinely linear contours, seams, signals, and links.

Flat Dither speed is selected from the range assigned to the current conceptual
pass, not held constant for the whole run:

| Pass | Speed tier | Range |
| --- | --- | --- |
| `establish` | quiet | `0.005–0.010` |
| `develop` | secondary | `0.015–0.020` |
| `deepen` | foreground | `0.050–0.075` |

Very selective Flat Dither focal accents may use `0.055–0.080`. Its absolute
authored ceiling is `0.08`. Color Cycle Stroke keeps its separately owned
foreground range of `0.030–0.045` and focal range of `0.055–0.060`.
Each brush also separately owns its dither Res control: Flat Dither uses
`fillResolution`; Color Cycle Stroke uses `colorCycleStampDitherPixelSize`.

For Flat Dither shapes, the sampled linear-gradient starts at the mass centroid
and targets 4–8 times the farthest boundary span. Its endpoint may leave the
canvas. This keeps the colour passage broad enough to read across the whole mass
instead of compressing into a short internal band.

Flat Dither's final mid-periphery response is a connected cluster of 3–5
overlapping, medium-sized Res 8 masses at secondary speed (`0.015–0.020`). It
is not a set of oversized shapes scattered around the canvas.

Color Cycle Stroke uses one consistent line weight across the artwork: nominally
4 px at a 512 px canvas short edge, scaled proportionally for other canvas sizes.
Pass changes affect Speed and stamp-dither Res, not stroke Size.

## Workflow cache

Precompute immutable source-derived candidates, but derive every continued
response from the latest authoritative checkpoint. Cache identity includes the
reference content and transform, canvas dimensions, planner/schema version,
and coordinate convention. No geometry may be dispatched without matching
project-revision and planning-checkpoint fences.

```json
{
  "schemaVersion": 4,
  "workflowId": "reference-study-v1",
  "cacheIdentity": {
    "referenceContentFingerprint": "sha256:reference-content-hash",
    "referenceTransformFingerprint": "sha256:crop-and-transform-hash",
    "plannerSchemaVersion": "mass-planner-v3",
    "coordinateConvention": "vessel-canvas-pixels-v1"
  },
  "massObservationPlan": {
    "schemaVersion": 3,
    "checkpointId": "reference-observation-1",
    "fingerprint": "sha256:mass-observation-plan-hash",
    "observedMassCount": 300
  },
  "project": { "id": "project-1", "width": 512, "height": 640 },
  "stages": [
    {
      "id": "establish-1",
      "capture": "final-thumbnail",
      "gestureBudget": 8,
      "pointBudget": 4000,
      "payloadByteBudget": 500000,
      "setupOperations": [{ "action": "set-tool", "tool": "brush" }],
      "candidates": []
    }
  ]
}
```

Each selected shape operation uses phase `establish`, `develop`, or `deepen`,
names its unique `sourceRegionId`, supplies `boundaryAnchorCount`, and supplies
its complete ordered gesture path. Develop and deepen shapes also name their
`parentMassId`. The Supervised mass planner owns the full schema-v3 observation:
source crop, interior samples, neighbour/occlusion relations, edge events, and
ordered source-to-remembered anchor correspondence. Vessel binds the compact
plan fingerprint and provenance to execution, then permits additional transport
samples after interpolation. Artwork jobs reject eraser selection,
configuration, and eraser strokes so a committed mark cannot be removed by a
later batch.

Send an `artwork-stage` command through the persistent client:

```json
{
  "requestId": "study-establish-1",
  "action": "artwork-stage",
  "cacheFile": "/absolute/path/study-cache.json",
  "workflowId": "reference-study-v1",
  "stageId": "establish-1",
  "runtimeFence": {
    "expectedProjectId": "project-1",
    "expectedProjectRevision": 42,
    "expectedCheckpointId": "previous-command:establish-1"
  },
  "decision": {
    "status": "continue-current",
    "basedOnRevision": 42,
    "basedOnCheckpointId": "previous-command:establish-1"
  },
  "candidateIds": ["dominant-mass"],
  "residualOperations": []
}
```

Residual operations must name their parent mass, source region, and
`basedOnRevision`. The name is retained for protocol compatibility; artistically
they are continued responses to the visible work, not repairs to be erased.

## Preflight and execution

Before Vessel commits the first mark, the expander validates cache identity,
mass-plan schema and fingerprint, observed-mass capacity, unique source-region
provenance, 20-60 meaningful boundary-anchor counts, transforms, unique
operation IDs, required phases, geometry,
gesture and point ceilings, and serialized payload size. Separate polygons may
overlap freely. Footprint and priority-coverage evidence are optional
diagnostics; they do not grade committed marks for removal.

Execution is recoverable rather than transactional. Marks commit one canonical
operation at a time. If a later operation fails, the result returns `ok: false`,
the authoritative revision, `completedOperations`, and `committedOperationIds`.
Never retry the job automatically. Preserve the committed work and plan a new
fenced continuation from the returned revision.

`requestId` is an idempotency key. Identical input returns the original command
and result, including after bridge restart. Conflicting content fails. An
unfinished recovered request is never re-enqueued automatically.

## Budgets and evidence

The artwork planner distributes expected shape count approximately 5/15/80
across establish, develop, and deepen. A complex portrait is expected to derive
hundreds of shapes from its explicit observation inventory; 300 observed masses,
for example, implies approximately 15/45/240. Stage gesture, point, and payload
budgets remain per-dispatch technical ceilings. They are not artistic completion
rules and cannot manufacture generic filler when observation is absent.

Record cumulative footprint statistics when useful: `p10`, `p50`, `p90`,
maximum, `p90 / p10`, and occupied scale bands. Variation must come from
observed hierarchy rather than resizing a generic polygon. Count only
canonically committed marks in artistic totals.

## One persistent tool response path

`scripts/vessel-collab-tool.mjs` adapts the persistent bridge client to a local
tool host. `vesselSession` remains a module-level singleton for the complete
artwork:

```js
let vesselSession;

export async function getVesselSession(toolResponse) {
  if (!vesselSession) {
    const vesselModule = await import('./scripts/vessel-collab-tool.mjs');
    vesselSession = await vesselModule.createVesselCollaborationToolSession({
      session: 'artwork',
      emitImage: (image) => toolResponse.emitImage(image),
    });
  }
  return vesselSession;
}
```

The response contains the committed checkpoint image and compact completion
evidence together. The tool never saves, publishes, or mints an artwork unless
a separate explicit command requests that consequential action.
