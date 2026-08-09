# Staged artwork collaboration

Vessel's collaboration bridge is deliberately artwork-agnostic. A staged
workflow lives in the local client and expands one caller-defined stage at a
time into a generic `artwork-job`. Vessel remains responsible for canonical
marks, authoritative geometry validation, Color Cycle finalization, checkpoint
capture, and the returned revision fence.

## Workflow cache

Precompute immutable source-derived candidates, but derive every repair from
the latest authoritative checkpoint. Stage names, budgets, and capture policies
are supplied by the workflow; they are not hard-coded as portrait concepts.
No geometry may be dispatched without a matching project-revision and planning-
checkpoint fence.

```json
{
  "schemaVersion": 2,
  "workflowId": "reference-study-v1",
  "cacheIdentity": {
    "referenceContentFingerprint": "sha256:reference-content-hash",
    "referenceTransformFingerprint": "sha256:crop-and-transform-hash",
    "plannerSchemaVersion": "mass-planner-v2",
    "coordinateConvention": "vessel-canvas-pixels-v1"
  },
  "project": { "id": "project-1", "width": 512, "height": 640 },
  "priorityMasks": [
    {
      "id": "subject-priority",
      "spans": [{ "y": 180, "xStart": 120, "xEndExclusive": 390 }]
    }
  ],
  "stages": [
    {
      "id": "broad-structure",
      "capture": "final-thumbnail",
      "thumbnailMaxSize": 512,
      "gestureBudget": 12,
      "pointBudget": 4000,
      "payloadByteBudget": 500000,
      "setupOperations": [{ "action": "set-tool", "tool": "brush" }],
      "candidates": [
        {
          "id": "dominant-mass",
          "parentMassId": "whole-canvas",
          "sourceRegionId": "reference-region-1",
          "operations": [
            {
              "action": "shape",
              "phase": "primary",
              "points": [
                { "x": 80, "y": 70 },
                { "x": 360, "y": 60 },
                { "x": 390, "y": 430 },
                { "x": 90, "y": 450 }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "close-review",
      "capture": "full",
      "gestureBudget": 0,
      "pointBudget": 0,
      "payloadByteBudget": 500000,
      "candidates": []
    }
  ]
}
```

The cache fingerprint incorporates reference content, reference crop/transform,
canvas dimensions, planner/schema version, and coordinate convention. The
expander rereads the file identity before every stage; changing any cache
content invalidates the in-process entry. Source-derived candidates stay
reusable only while all five identity inputs remain unchanged.

Send an `artwork-stage` command through the persistent client. Select cached
candidates, optionally transform them, and add only genuinely new residual
operations. The expander validates the complete expanded request, enforces all
post-transform gesture, point, and serialized-byte ceilings, and appends exactly
one named checkpoint after the operations.

```json
{
  "requestId": "study-broad-structure-1",
  "action": "artwork-stage",
  "cacheFile": "/absolute/path/study-cache.json",
  "workflowId": "reference-study-v1",
  "stageId": "broad-structure",
  "runtimeFence": {
    "expectedProjectId": "project-1",
    "expectedProjectRevision": 42,
    "expectedCheckpointId": "previous-command:primary-2"
  },
  "decision": {
    "status": "repair-current",
    "basedOnRevision": 42,
    "basedOnCheckpointId": "previous-command:primary-2"
  },
  "candidateIds": ["dominant-mass"],
  "adjustments": {
    "dominant-mass": { "translateX": 3, "translateY": -2 }
  },
  "priorityMaskId": "subject-priority",
  "coverageBaselineRevision": 38,
  "residualOperations": [
    {
      "id": "jaw-shadow-repair-1",
      "action": "shape",
      "phase": "revision",
      "basedOnRevision": 42,
      "parentMassId": "head-shadow",
      "sourceRegionId": "reference-region-17",
      "points": [{ "x": 180, "y": 210 }, { "x": 250, "y": 205 }, { "x": 225, "y": 270 }]
    }
  ]
}
```

Vessel supplies canonical evidence; it does not make the artistic decision.
After inspecting the returned frame, the caller records `advance`,
`repair-current`, or `blocked`. The next dispatch includes that decision and the
exact revision and checkpoint receipt on which it was made. Residual operations
must also name their parent mass, source region, and `basedOnRevision`; a stale
residual fails before mutation.

Repeat or extend a stage when inspection returns `repair-current`. A workflow's
planned stage budget is an initial plan, not a ceiling, and must expand whenever
the committed checkpoint remains underdeveloped. `gestureBudget` remains only a
technical per-dispatch safety ceiling, not an artistic stage-total or completion
threshold. Send another locally validated, fenced dispatch for the same stage
and use `residualOperations` for new structure revealed by the current
checkpoint. The original source-derived candidates remain immutable while the
five-part cache identity remains valid.

## Execution and retry contract

Expansion, transforms, cached candidates, setup operations, residual operations,
provenance, masks, and all complexity limits are prevalidated before Vessel
commits the first mark. This is **preflight-complete, execution-recoverable**—not
transactional rollback. Marks commit one canonical operation at a time.

The single checkpoint is reached only after every preceding operation succeeds.
If execution fails after a partial commit, the result returns `ok: false`, the
authoritative revision, `completedOperations`, and `committedOperationIds`.
Never automatically retry that job; inspect or recover its result, then plan a
new fenced repair from the returned revision.

`requestId` is the idempotency key. Reusing it with canonically identical input
returns the original command and result, including after bridge restart. Reusing
it with different content fails. An unfinished recovered request is never
reenqueued automatically.

## Expandable completion contract

The named checkpoints define the minimum construction sequence, not a maximum
number of passes. Make each coherent batch large enough to materially resolve
its named relationship. Complete at least one revision pass, and continue with
`repair-current` while important residuals remain.

After nested construction and, where applicable, likeness are secure, perform a
selective final-detail pass. Details may include small masses, precise
transitions, edge interruptions, highlights, and linear structures, but must
remain anchored to the underlying form rather than becoming a generic overlay.

For priority-mask evidence, 30% unique meaningful pixel coverage is a floor,
not a target or stopping condition. Continue until the priority forms are
convincingly constructed at multiple scales and the important residuals have
materially diminished.

Coverage is computed from the current committed authored buffers against the
frozen baseline—not from animation frames and not from a sum of per-mark areas.
Checkpoint evidence returns `priorityMaskId`, mask fingerprint, mask pixels,
unique meaningfully changed pixels, cumulative percentage, baseline revision,
and current revision. If the browser runtime no longer owns the requested
baseline snapshot, the job is blocked rather than silently rebased.

## Multiscale footprint contract

Each stage must preserve substantial physical-size variation among its shapes.
The stage's dominant scale is not a single target diameter: primary stages may
be led by massive coverage forms while also containing smaller interlocks;
developed stages mix large corrections, medium subdivisions, and small
transitions; focal and revision stages may favour smaller forms but still use
larger corrections when the unresolved structure demands them.

The local planner must calculate each filled shape's canvas-area footprint and
its footprint relative to the parent or priority region before dispatch. Record
`p10`, `p50`, `p90`, maximum area, `p90 / p10`, and occupied meaningful scale
bands in cumulative checkpoint evidence. A small repair dispatch inherits only
previously committed footprint evidence; failed or merely planned shapes do not
enter the distribution. When the source supports it, `p90 / p10` should approach
or exceed 10 with shapes occupying at least three meaningful scale bands. Reject the batch
locally when footprints cluster around one size, the extremes differ only
cosmetically, or a shared segmentation radius or contour template determines
the geometry.

Footprint variation must come from the observed hierarchy: merged source masses
for anchors, nested colour/value regions for medium forms, and edge or
transition residuals for smaller forms. Scaling one generic polygon to several
sizes is invalid. Point count, gesture count, and cumulative pixel coverage are
separate evidence and cannot substitute for a genuine size distribution.

Late-stage coverage may therefore be achieved by many unequal, overlapping
forms that collectively alter the priority region. It must not be achieved with
equal slabs or equal token details. If the checkpoint still reads as one
repeated footprint, return `repair-current` even when every operation committed.

## One tool response

`scripts/vessel-collab-tool.mjs` adapts the persistent bridge client to a local
tool host that can reach the localhost bridge and emit images. `vesselSession`
must be a module-level singleton inside one persistent Node process. Create it
once and reuse it for the complete artwork; do not recreate it for each stage:

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

Then send a stage in one Node tool call:

```js
const vesselSession = await getVesselSession(toolResponse);
return vesselSession.send({
  requestId: 'artwork-stage-1',
  action: 'artwork-stage',
  cacheFile: '/absolute/path/study-cache.json',
  stageId: 'broad-structure',
  decision: {
    status: 'advance',
    basedOnRevision: 42,
    basedOnCheckpointId: 'previous-command:primary-2',
  },
});
```

That response contains the committed checkpoint image and compact completion
evidence together. Full-resolution stages use `capture: "full"`; structural
checks normally use `capture: "final-thumbnail"`.

The host must be allowed to connect to the local bridge. If an in-process tool
sandbox blocks localhost, run the same adapter in an approved persistent local
Node host and forward `emitImage` plus the compact return value through one
outer tool response. Request IDs are generated automatically when omitted.

The tool never saves or publishes an artwork unless a separate explicit Vessel
command requests that consequential action.
