# Goblet publishers

Vessel builds a Goblet once, then passes the same `GobletArtifact` to preview,
download, and any registered publisher. Publishers are integrations; they do not
belong in the core export serializer.

```ts
import { registerGobletPublisher } from '@/utils/export/goblet/gobletPublisherRegistry';

const unregister = registerGobletPublisher({
  id: 'archive',
  label: 'Archive',
  async publish(artifact, context) {
    const body = new FormData();
    body.append('goblet', artifact.blob, artifact.filename);
    body.append('projectId', context.projectId);
    body.append('projectName', context.projectName);

    const response = await fetch('/api/goblets', {
      method: 'POST',
      body,
      credentials: 'include',
    });
    if (!response.ok) throw new Error(`Publish failed (${response.status})`);
    const result = await response.json() as { url?: string };
    return { message: 'Goblet published', url: result.url };
  },
});
```

Keep credentials, archive-specific metadata, and deployment policy in the
integration that registers the publisher. The public Vessel repository owns
artifact construction, preview, health reporting, download, and the adapter
contract only.

## Host-provided publishers

Hosted builds can register publishers without adding private code or settings
to Vessel. Replace the empty `vessel-publishers.json` at the deployed Vessel
app root (for example `/vessel/vessel-publishers.json`) with a data-only
manifest:

```json
{
  "schemaVersion": 1,
  "publishers": [
    {
      "id": "archive",
      "label": "Archive",
      "endpoint": "https://publisher.example/api/vessel/goblets"
    }
  ]
}
```

Vessel loads this manifest when a completed Goblet reaches the release panel.
A missing manifest means no publish action is shown. The manifest is limited to
eight validated HTTP endpoints and cannot contain credentials or executable
code.

Vessel sends `multipart/form-data` with:

- `file`: the exact Blob used by preview and download.
- `metadata`: schema-versioned JSON containing the Vessel project identity and
  artifact format, dimensions, duration, MIME type, and byte count.

The endpoint returns JSON with an optional `message` and `url`. It owns any
destination-specific metadata mapping, authentication, rendering, upload,
retry, or publish policy. Cross-origin endpoints must explicitly allow the
hosted Vessel origin.
