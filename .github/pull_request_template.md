## Summary

- 

## Validation

- [ ] `npm run type-check`
- [ ] `npm run lint`
- [ ] `npm test`

## Color Cycle / Render Sync Checklist

- [ ] If this PR changes CC/render behavior, both Vessel runtime and Goblet runtime were updated together.
- [ ] If this PR changes CC/render behavior, parity fixtures/tests were updated or `npm run test:cc-runtime-parity` was explicitly confirmed unchanged.
- [ ] If this PR changes playback-sensitive files, `npm run verify:cc-render-gate` passes or the companion parity/shared-source change is included.
- [ ] If this PR changes Goblet runtime source, generated runtime assets were regenerated via `npm run build:goblet-inline`, and `npm run verify:goblet-runtime` passes before any write-mode build.
