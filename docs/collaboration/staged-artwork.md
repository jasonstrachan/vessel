# Staged artwork collaboration

Vessel's collaboration bridge is deliberately artwork-agnostic. A staged
workflow lives in the local client and expands one caller-defined stage at a
time into a generic `artwork-job`. Vessel remains responsible for canonical
marks, authoritative geometry validation, Color Cycle finalization, checkpoint
capture, and the returned revision fence.

## Workflow cache

Build candidate geometry once and place it in an immutable cache file. Stage
names, budgets, and capture policies are supplied by the workflow; they are not
hard-coded as portrait concepts.

```json
{
  "schemaVersion": 1,
  "workflowId": "reference-study-v1",
  "sourceFingerprint": "sha256:reference-content-hash",
  "project": { "id": "project-1", "width": 512, "height": 640 },
  "stages": [
    {
      "id": "broad-structure",
      "capture": "final-thumbnail",
      "thumbnailMaxSize": 512,
      "gestureBudget": 12,
      "setupOperations": [{ "action": "set-tool", "tool": "brush" }],
      "candidates": [
        {
          "id": "dominant-mass",
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
      "candidates": []
    }
  ]
}
```

Send an `artwork-stage` command through the persistent client. Select cached
candidates, optionally transform them, and add only genuinely new residual
operations. The expander enforces the configured gesture ceiling and appends
exactly one named checkpoint.

```json
{
  "requestId": "study-broad-structure-1",
  "action": "artwork-stage",
  "cacheFile": "/absolute/path/study-cache.json",
  "workflowId": "reference-study-v1",
  "sourceFingerprint": "sha256:reference-content-hash",
  "stageId": "broad-structure",
  "candidateIds": ["dominant-mass"],
  "adjustments": {
    "dominant-mass": { "translateX": 3, "translateY": -2 }
  }
}
```

Repeat a stage when inspection returns `repair-current`. A gesture budget is a
per-dispatch ceiling, not a completion count. Use `residualOperations` for new
structure revealed by the current checkpoint; the original candidate cache
remains immutable for the lifetime of the persistent client.

## One tool response

`scripts/vessel-collab-tool.mjs` adapts the persistent bridge client to a local
tool host that can reach the localhost bridge and emit images. Create one
session and reuse it for the complete artwork:

```js
const vesselModule = await import('./scripts/vessel-collab-tool.mjs');
const vesselSession = await vesselModule.createVesselCollaborationToolSession({
  session: 'artwork',
  emitImage: (image) => toolResponse.emitImage(image),
});
return vesselSession.observe();
```

Then send a stage in one Node tool call:

```js
return vesselSession.send({
  requestId: 'artwork-stage-1',
  action: 'artwork-stage',
  cacheFile: '/absolute/path/study-cache.json',
  stageId: 'broad-structure',
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
