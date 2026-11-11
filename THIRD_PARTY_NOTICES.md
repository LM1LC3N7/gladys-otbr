# Third-party notices

Nothing but the Gladys SDK is installed at runtime. No code of another project
is bundled; what was taken from the projects below is listed with them.

## python-otbr-api

- Project: <https://github.com/home-assistant-libs/python-otbr-api>, version
  3.1.0 (commit `80fc347`, 2026-11-10), the client of the OpenThread Border
  Router REST API used by the `otbr` integration of Home Assistant.
- License: MIT License, Copyright (c) 2023 ESPHome.

What is used: the routes it calls (`GET /node/ba-id`, `GET /node/state` /
`PUT /node/state` with `"enable"` / `"disable"`, `GET
/node/dataset/active` answering 204 without a dataset), and the table of the
PascalCase keys of the servers older than ot-br-posix #2514 (September 2025)
to read both spellings. Ported to JavaScript (`src/otbr/client.js`,
`src/otbr/parse.js`); no Python code is copied.

```
MIT License

Copyright (c) 2023 ESPHome

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ot-br-posix (REST API only)

- Project: <https://github.com/openthread/ot-br-posix> (commit `3dc609c`,
  2026-11-10), the OpenThread Border Router.
- License: BSD-3-Clause, Copyright (c) 2017, The OpenThread Authors.

What is used: the interface described by `src/rest/openapi.yaml` (the routes
above, `GET /node` and its fields, the roles of `/node/state`, the fields of
the active dataset). No C++ code is copied.

The tests were also run against the `openthread/otbr` Docker image (built
2026-11-11) with a simulated radio (`ot-rcp` of
<https://github.com/openthread/openthread>, BSD-3-Clause, commit `e5629fa`),
outside this repository: nothing of either is in it.

No logo nor trademark of OpenThread or Thread is used: the cover image is
drawn by `scripts/cover.mjs`.
