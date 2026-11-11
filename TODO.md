# TODO — OpenThread Border Router v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `gi ci` (Prettier, ESLint, tests on Node 24 and 22,
  Docker build, store validator), `npm audit --omit=dev`, the mutants
  (`node scripts/mutants.mjs`, under `memcap`), then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. The claim is in /t/10385 (lot 21, reply 475).

## Status

- [x] **Milestone 1 — core** (2026-11-11): the REST API of ot-br-posix
      (after python-otbr-api 3.1.0, MIT, and `openapi.yaml`): the node
      (`GET /node`, needed; camelCase and PascalCase, role as a word or a
      number), the border agent id (`GET /node/ba-id`) when the node lacks it,
      the active dataset (`GET /node/dataset/active`, secondary, whitelist of
      its public fields); one device `otbr:<border agent id>` (9 read-only
      features); the pace on a monotonic clock, the attempt written to /data
      before each reading; a pause on 429/5xx of the node (Retry-After, 60 s
      to 6 h, in /data); "Disable Thread" / "Enable Thread" actions of the
      configuration screen, off by default, two clicks bound to the border
      agent id, option checked at the click, after the fresh read and in
      `beforeSend`, a 20 s send deadline, the outcome read back (confirmed /
      not applied yet / without confirmation / refused / nothing sent).
- [x] **Review r1** (2026-11-11): actions refused until the configuration
      is read again after a reconnection; old device unreachable after an
      address change; 8 minor points; tests for every surviving mutant of the
      reviewer (merged into `scripts/mutants.json`).
- [ ] Count of the Thread end devices (see Decisions).
- [ ] Feedback of users with a real border router (Home Assistant add-on,
      Raspberry Pi with an RCP dongle).

## Decisions

- **Version 0.1.0** set by hand in package.json, package-lock.json and the
  manifest (`docker_image` `ghcr.io/lm1lc3n7/gladys-otbr:0.1.0`); the Release
  workflow owns it afterwards.
- **No `keywords` nor `countries`** in the manifest: `keywords` needs
  `gladys_version >= 5.3.0` and the module is for every country. To add when
  the floor moves: keywords "thread", "openthread", "otbr", "matter",
  "border router".
- **Category `network`**: the module watches a piece of the home network; it
  brings no device of its own into Gladys (the Thread devices come through
  the Matter service), so not `protocols`.
- **The actions are manifest actions** (buttons of the configuration screen),
  not features of the device: nothing in a scene, a voice assistant or MCP can
  reach them. Both disable and enable are sensitive (brief of lot 21), off by
  default, two clicks. Their answers are `{ en, fr }` texts (a refusal starts
  with "Refused" / "Nothing sent"), never a thrown error, so the user reads
  them in his language.
- **Identity** = the border agent id (`baId` of `/node`, else `/node/ba-id`):
  a border router without one is refused (status said). Another id at the
  same address is another device; the old one is marked unreachable.
- **The dataset**: read in JSON (the TLV form would need a parser for no
  gain); only channel, PAN ID, extended PAN ID, network name and timestamp
  leave `parseDataset`. Detached or disabled, `/node` keeps leftovers (the
  default "OpenThread" name): the name and the extended PAN ID of the dataset
  are shown then.
- **"Number of nodes" = Thread routers** (`routerCount` of `/node`, local to
  the border router). Counting the end devices needs an
  `updateDeviceCollectionTask` (network diagnostics sent to every router and
  child: it wakes the sleepy devices) and `/api/devices` only holds what such
  a task found; left out of v1, to discuss with Louis.
- **No pause** from the secondary routes (dataset, ba-id); a 404 on
  `/node/ba-id` means "too old", any other failure there is a failed reading.
- **The PUT is never retried** by the integration: the outcome is read back
  (1 s, then 2 s, then 4 s later) and a reading follows (1 s after a confirmed
  action, 20 s after one not confirmed).
- **Tested on a simulated border router**: `openthread/otbr` (Docker Hub,
  built 2026-11-11) with a static `ot-rcp` simulation built from openthread
  `e5629fa` (Alpine, `-DOT_PLATFORM=simulation`), radio
  `spinel+hdlc+forkpty:///ot/ot-rcp?forkpty-arg=1`, `FIREWALL=0 NAT64=0`,
  `--cap-add NET_ADMIN --device /dev/net/tun`. The scenarios ran outside the
  repository (not in CI).

- **Equivalent mutants left out** of `scripts/mutants.json` (review r1):
  `runAction` not re-checking the generation after its read (`beforeSend`
  does it right before the first byte), a numeric role read as
  `ROLES[value] ?? null` (same result), the persisted pause lifted only with
  the RAM one (both are set together). The dead branch "answer before the
  request" of `src/otbr/http.js` was removed (the request is written at
  `connect`, before any answer can be read).

## Next

- Ask on the forum for testers with a real border router.
- Maybe: count the end devices on demand (a button), if Louis agrees.
