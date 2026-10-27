# Replay save durability

The September 2026 recovery contained 568 events and 3,296 buffers. Its JSON-lines
backup expanded to 591,302,742 bytes. The former recorder limit counted only
buffer strings, missing repeated scene and palette metadata. Manual save and
autosave both failed while stringifying the combined project manifest.

Project save now stores nonempty extension data in `buffers/extensions/*.jsonl`.
`project.extensionDataArchive` records the version, root node and ordered entries.
Each node is a scalar, array of earlier node IDs, or object of key/earlier-ID pairs.
Identical values share a node without dropping authoring fields. Chunks target
1 MiB; individual nodes are limited to 16 MiB and the graph to 256 MiB / two
million nodes. Existing archive checksums cover every entry. Load restores the
ordinary extension objects; legacy inline extension data remains readable.

These archives require a reader supporting `extensionDataArchive`. Do not reopen
them in an older Studio build, whose loader does not understand archived extension
data. Archive inspection and repair retain the compact descriptor and its entries.

Replay recording counts the complete expanded JSON representation without
constructing one large string. At 192 MiB it pauses, retains the prior recording,
and leaves artwork saving available. Existing oversized recordings can still be
saved through the archive graph. Pending buffer writes are discarded on capture
failure so rejected captures cannot accumulate behind the paused recorder.

Scope: save/load and recorder capacity. Goblet Replay export uses a separate
playback representation; see [Replay export size](replay-export-size.md).

Verification: codec tests, project archive round trips and corruption rejection,
recorder capacity regression, recovered-event/buffer equality, and production
Studio save/reopen/playback checks. Keep the original recovery artifacts unchanged.

Verified on the recovered document: 47 graph chunks / 55,090,331 bytes before
compression, with every event and buffer equal after decoding. The production
Save File interaction produced a 16,771,283-byte archive. Reopening restored all
568 events and three layers; background autosave completed and IndexedDB readback
restored the same counts. All 15 authored raster/CC payload entries and gradient
definitions matched the original recovery. Four Replay timeline frames at 0%,
25%, 50% and 90% matched before/after save and differed from each other.
The 124 persistence tests, 49 Replay tests, type-check and lint passed.
