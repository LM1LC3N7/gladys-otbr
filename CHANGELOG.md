# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: one OpenThread Border Router read through its local REST API
  (`GET /node`, `GET /node/dataset/active`): Thread role, Thread network up,
  Thread routers, network name, channel, PAN ID, extended PAN ID, active
  dataset present, last action; camelCase and PascalCase servers.
- The network key and the PSKc of the active dataset are never kept, logged,
  shown, published nor written to `/data`.
- "Disable Thread" and "Enable Thread" buttons of the configuration screen,
  refused unless allowed, two clicks, the same border router checked, the
  outcome read back; never a switch nor a feature of the device.
