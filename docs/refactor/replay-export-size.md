# Replay export size

Replay export v2 stores shared palette, layer and scene tables. Events refer to
scenes; scenes refer to layers; CC layers refer to palettes. Only playback stop
position, colour, opacity and seam profile survive in the palette table. Authoring
hashes and source stops remain in project saves, not playback exports. Event
contributions, timing, arrangement, channel references and required buffers remain
intact. The player reconstructs the ordinary v1 recording and still accepts v1.

Packed layers use `colorCycle`, not `cc`: Goblet's recursive property expansion
interprets `cc` as `colorCycle`. A regression covers this minify/expand boundary.

Replay lives in `metadata.extensions['private-practice.replay.v1']` once per
metadata payload. Its player listens for `vessel-goblet-metadata` after successful
rendering. The viewer template, Single HTML and ZIP autoload paths all emit this
event. There is no additional dedicated recording script. Smaller ZIP stores
metadata as a sidecar; Compatible ZIP intentionally retains its existing complete
metadata fallback as well as the sidecar, so that format still duplicates metadata.

## Recovered painting verification, 11 September 2026

The full recovery has 568 events and 3,296 buffers. Its JSON-lines backup was
591,302,742 bytes uncompressed and 97,205,830 bytes gzip-compressed. Packed Replay
is 49,444,974 JSON bytes and 12,853,218 gzip bytes, with 866 palettes, 583 layer
states and 568 scene states. Every recovered event's definition IDs, rendered
stops and seam profile matched after packing/unpacking. Native saves retain all
authoring fields and all three layers.

The actual default export includes two visible layers, with one hidden CC layer
excluded. Its scoped recording has 53 events and 281 buffers. This follows the
existing export-layer selection; it is not recording truncation. The real Single
HTML export is 31,835,433 bytes. Its decoded metadata is 31,472,075 JSON bytes
(9,887,725 gzip bytes). The 281 buffer records declare 115,671,040 decoded bytes
in aggregate; this is not a measurement of peak browser memory. Native CC buffers
and the alpha mask decode to 2,293,760 bytes, excluding canvases, images and GPU
copies.

Smaller ZIP is 10,005,363 bytes (18 entries / 34,153,263 bytes inflated). Its
134,555-byte HTML contains no inline recording payload; metadata comes from the
JSON sidecar. The initial test exposed footer overflow: four nowrap release
buttons exceeded the modal width, moving Download outside the clipped panel.
`ExportProgressView` now wraps the footer actions. A normal pointer click on
Download successfully saved the recovered painting's ZIP in the rebuilt Studio.
The 29 export-modal/release-panel tests, Studio type-check and lint passed.

A fresh 256 by 256 CC painting also passed manual save, reopen and IndexedDB
autosave. All three Replay events and 21 buffers matched by SHA-256 after both
round trips; the reopened CC layer retained native content. No new artwork byte
cap was added: the existing publisher estimates gas and USD cost before signing,
with an adjustable soft cost threshold. Its three budget tests passed.

The actual exported player matched the original recovered recording at 0%, 25%,
50% and 90% of the 10.6-second scoped timeline. Canvas byte hashes were
3375144389, 732398113, 498597688 and 1713581664 for both representations.
The extracted Smaller ZIP player matched those same four frames. Validation also
passed 54 Replay tests, 16 export contract tests, 11 Goblet runtime tests, 51
operator capability/publication tests, Studio type-check and Vessel lint.

With Include replay unchecked, actual native JSON was 4,048,373 bytes. The local
onchain packager accepted it: artwork 679,746 compressed bytes / 3,951,445 inflated
bytes / 28 chunks; shared renderer 74,220 compressed bytes / 4 chunks. This was an
offline dry run using a placeholder work hash; publication metadata can slightly
change final size. No chain transactions or deployments were performed.

The current onchain renderer has no painting Replay capability. The operator now
requires `painting-replay-v1` whenever that extension is present, for both v1 and
v2, and rejects unsupported packages instead of silently shipping inert history.
The actual exported Replay metadata was rejected by this gate. A future onchain
Replay release needs a compatible runtime and explicit decoded-buffer budgets.
