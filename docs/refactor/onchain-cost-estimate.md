# Studio onchain cost estimate

Studio export results expose a separate, optional **Estimate onchain cost** action.
Publish continues to mean Archive and Dispatch. Estimating never invokes either
publisher, signs a transaction, or imposes a USD/byte budget. The control belongs
to the private Studio extension through `ExportResultControls`; public Vessel has
no local-service control.

The local SUPERVISED preview service accepts Goblet JSON at `POST /api/estimate`.
JSON exports use their actual blob. HTML and ZIP use the export's original
metadata with the existing renderer data-channel encoding. The service packages
this through the canonical onchain packager, including its capability checks.
Unsupported Replay is rejected explicitly. Temporary packaging input is removed;
no preview, archive entry, or publication is created.

The quote is Ethereum mainnet only. It reads fees and the block gas limit from
PublicNode's public Ethereum RPC and ETH/USD spot pricing from Coinbase. There
is no wallet or signer. Provider failures return a generic retryable message.
Changing the artifact or leaving the screen aborts and discards the old request.
The entire request, including response-body parsing, has a 60-second deadline;
timeout restores retry and discards late results. Numeric quote fields must be
finite nonnegative decimal strings, with positive fee and exchange-rate inputs.

The planning model assumes first upload: each distinct chunk costs 216 gas per
byte plus 125,000 gas overhead, then the publisher's existing finalization reserve
and 20% margin apply. Artwork and optional renderer upload are shown separately.
This is a conservative model, not a transaction simulation. Existing uploaded
chunks/renderers are not checked, and final deployment metadata and fees can
change. The block-limit diagnostic is advisory to this action and does not gate
Archive publishing. Live quotes show their timestamp and fee/price inputs.

## Verification, 11 September 2026

The real storage contract was executed in a temporary local Foundry EVM using
solc 0.8.30, optimizer 200, viaIR. For 1 / 1,000 / 24,575-byte all-nonzero chunks,
execution plus transaction and worst-case calldata gas was 81,222 / 297,805 /
5,422,726. The model's corresponding raw chunk reserves were 125,216 / 341,000 /
5,433,200, before the additional 20% margin. These measurements are preserved
as regression bounds in the operator estimate tests.

The rebuilt production Studio completed an actual HTML-export quote using live
RPC and pricing. Publish stayed enabled during and after the request. The only
POST observed was the local `/api/estimate` request. Endpoint tests also verify
that estimates do not materialize previews, high prices remain visible, provider
errors are sanitized, duplicate chunk writes are deduplicated, and unsupported
Replay is rejected. UI tests cover explicit invocation, retry and stale results.

The real Smaller ZIP export also received a live quote with Download enabled.
A Replay-enabled HTML export returned `painting-replay-v1` as a missing renderer
capability while Publish remained enabled. Verification passed 8 operator tests,
5 private Studio/publisher tests, 39 export modal/release tests, the local contract
gas check, Studio type-check and focused ESLint. No chain transactions occurred.

Review follow-up reproduced an indefinitely disabled estimate button under a
controlled network stall in production Studio. After repair, advancing the
browser clock past 60 seconds showed the timeout and enabled retry. A malformed
numeric quote was rejected, followed by a successful real live-service retry.
All 11 focused Studio/publisher tests passed, including late response-body
resolution after retry; Studio type-check and focused lint also passed.
