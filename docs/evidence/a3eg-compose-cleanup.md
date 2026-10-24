# a3eg: bounded Compose test teardown

Repeated tenant tests left their Docker networks allocated until Docker exhausted its automatic address pools.
`prepareComposeTenant().stop()` now brings down its captured, uniquely named Compose project, including its
one-off containers. It supplies neither volume nor image removal flags. It never prunes Docker resources or
accepts another project's name from the returned metadata object.

The owner authorized this in supportagents-a3eg comment 36: test-created Docker networks hold no data; only the
test's own project may be torn down, with volumes and retained logs preserved. This follows Docker's documented
[`compose down` defaults](https://docs.docker.com/reference/cli/docker/compose/down/).

The helper verifies that its project has no remaining networks, its named database/log volumes remain, and its
already captured `evidence.json` bytes have not changed. A companion `cleanup.json` records these checks without
retaining arbitrary Docker diagnostic text. A failed command, failed inventory or retention mismatch fails the
test hook. Logs are captured by the existing browser teardown before the project is brought down.

Validation on Node 24.22.1 and Bun 1.4.4:

- All four `tests/e2e/tenants.spec.ts` cases pass.
- All 20 browser cases pass, with no skips, retries or flaky results.
- Full Vitest: 186/186 pass; the final cleanup unit file independently passes 3/3 after refining its fake to
  distinguish `stop` (networks retained) from `down` (project networks removed).
- Typecheck, lint and formatting pass. Targeted UBS reports zero critical findings and two reviewed warnings for
  strict parsing of test-produced JSON. Full UBS is explicitly partial: JavaScript timed out, while Bash/Python
  completed; no full-scan pass is claimed.
- Across the focused and complete browser runs, four real tenant projects remove eight owned networks, retain
  eight named volumes, preserve all four original evidence files, and scan 56 canaries with zero matches.

The focused run built the browser server and clock/production Docker images. The full run reused the unchanged
Next/clock builds with skip-build flags; all 20 cases still executed, including the production-image/refusal builds.
The product application and deliberate DEF-01 to DEF-06 behavior are unchanged by this test-only fix.

Durable counts, source hashes, resource proofs and artifact checksums are retained in SupportAgents
[`docs/evidence/a3eg-validation.json`](https://github.com/IainLickerish/SupportAgents/blob/main/docs/evidence/a3eg-validation.json).
