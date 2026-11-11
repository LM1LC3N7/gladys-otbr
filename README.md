# gladys-otbr

A [Gladys Assistant](https://gladysassistant.com) external integration for an
**OpenThread Border Router** (ot-br-posix) that already runs on your network,
read through its local REST API (HTTP, port 8081). The Thread radio stays on
the border router; the Thread devices come into Gladys through Matter.

- One device per border router: Thread role, Thread network up, Thread
  routers, network name, channel, PAN ID, extended PAN ID, active dataset
  present, last action.
- The network key and the PSKc of the active dataset are never kept, logged,
  shown, published nor written to `/data`: only the public fields of the
  dataset are copied out of the answer.
- Two buttons of the configuration screen, off by default, never a switch nor
  a feature of the device, two clicks each: **Disable Thread** and **Enable
  Thread** (`PUT /node/state`), the outcome read back.

**Never tested with a real border router**: follows the REST API of
ot-br-posix (`openapi.yaml`) and python-otbr-api (MIT), tested against a fake
server and against ot-br-posix in Docker with a simulated Thread radio.

Unofficial integration, not affiliated with the OpenThread project nor Google.

- User documentation: [English](docs/en.md), [français](docs/fr.md).
- Status, decisions and next steps: [TODO.md](TODO.md).
- Rules for contributors: [CLAUDE.md](CLAUDE.md).
- Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
node scripts/mutants.mjs      # mutation check of the guards (one at a time)
```

License: Apache-2.0 ([LICENSE](LICENSE)).
