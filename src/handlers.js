// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so
// the tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // --- Discovery and device lifecycle ------------------------------------------
  // The known border router, never a reading (the next one comes at its time).
  gladys.onScanRequest(() => app.publishDiscovery());
  // Created: the last reading, dated, when it is recent.
  gladys.onDeviceCreated((device) => app.deviceCreated(device));

  // --- No command: every feature is read only (the Thread actions are buttons
  // of the configuration screen, never a feature).
  gladys.onSetValue(() => {
    throw new Error('Read-only device: use the actions of the configuration screen');
  });

  // --- Configuration screen buttons --------------------------------------------
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onAction(ACTIONS.DISABLE, () => app.threadAction('disable'));
  gladys.onAction(ACTIONS.ENABLE, () => app.threadAction('enable'));

  // --- Configuration saved by the user -------------------------------------------
  gladys.onConfigUpdated((config) => {
    logger?.info('Configuration updated');
    return app.start(config);
  });

  // --- Connection lifecycle: every connection reads the configuration and
  // sends the status and Discovery again; the same address keeps the pace and
  // the pause. A configuration Gladys does not give is asked again without
  // end (5 s, 10 s... 5 min at most).
  gladys.on('connected', () =>
    app.startFromGladys().catch((err) => logger?.error(`Start failed (${err?.name ?? 'Error'})`)),
  );
  gladys.on('disconnected', () => app.pause());
}
