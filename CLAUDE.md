# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for an OpenThread Border Router
(ot-br-posix): a Node.js service (Node 22+, ESM, no build step) that runs in
its own sandboxed Docker container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It reads one border router through its local
REST API (plain HTTP, no login) and offers two Thread actions, off by
default. See `TODO.md` for the status and every decision.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "disable"  # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run cover                             # regenerate cover.png (plain Node)
node scripts/mutants.mjs [3,7]            # mutation check of the guards (memcap)
```

## Architecture

```
index.js                 SDK wiring only (src/handlers.js)
src/handlers.js          every SDK handler, registered before connect()
src/app.js               OtbrApp: start, /data, pace, pause, states, the two actions
src/otbr/client.js       the routes of the REST API
src/otbr/http.js         the only network access (HTTP, bounded, no redirect, beforeSend)
src/otbr/parse.js        answers -> plain values (both key spellings, dataset whitelist)
src/otbr/errors.js       error codes
src/devices.js           the device (pure), never fewer features
src/config.js            DEFAULTS (mirror the manifest) + normalization
src/store.js             /data: last attempt, pause, last action
src/publisher.js         states within 300 per minute
src/i18n.js              statuses and messages (en / fr)
scripts/mutants.*        mutation list and runner (not in the image, not in CI)
test/                    node --test, fake Gladys (SDK) + fake border router + loopback HTTP
```

## Rules

- **External ids are forever**: `otbr:<border agent id>` and the feature keys
  of `src/constants.js`; the same goes for the manifest keys and the action
  keys.
- **The Thread actions** are buttons of the configuration screen (manifest
  `actions`), never a feature of the device, never a switch: refused unless
  "Allow Thread actions" is on (checked at the click, after the fresh read and
  in `beforeSend`), two clicks bound to the border agent id, the outcome read
  back. Any new action needs Louis's decision, off by default. Gladys never
  disables nor enables Thread by itself.
- **The active dataset holds the network key and the PSKc**: only the
  whitelisted fields of `parseDataset` leave the answer; never log, quote,
  keep nor publish an answer of `/node/dataset/active` (`test/app.test.js`
  and `test/parse.test.js` check it). Writing the dataset is out of v1.
- **Secondary routes** (`/node/dataset/active`, `/node/ba-id`) never pause
  nor stop a reading.
- **/data**: every read and write bounded in time; a FIFO never waited for;
  unreadable is not empty (nothing written), read again every 10 s, one read
  at a time.
- **Clocks**: one read of the monotonic clock per decision; the wall clock
  only for /data. The tests use a clock that moves at every read, and
  `test/realclock.test.js` runs on the real clock.
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  them by hand (0.1.0 was set by hand once). `test/manifest.test.js` checks
  they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`.
- **Manifest.** Texts are `{ "en": ..., "fr": ... }`; no secret field (the
  REST API has no login).
- **Units**: only those the core lists for the category (none here).
- **Encoding.** UTF-8 without BOM, no mojibake (`test/encoding.test.js`).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (loopback only).
