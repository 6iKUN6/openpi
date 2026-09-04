import assert from "node:assert/strict";
import test from "node:test";
import {
  createBackendStartupMonitor,
  parseDevelopmentPort,
  resolveDevelopmentPorts,
  selectDevelopmentPort,
} from "../../scripts/dev-web-support.ts";

test("development ports keep an available default", async () => {
  const probes: number[] = [];
  const selected = await selectDevelopmentPort({
    environmentValue: undefined,
    environmentName: "OPENPI_WEB_UI_PORT",
    preferredPort: 5173,
    probe: async (port) => {
      probes.push(port);
      return true;
    },
  });

  assert.deepEqual(selected, {
    port: 5173,
    preferredPort: 5173,
    explicit: false,
  });
  assert.deepEqual(probes, [5173]);
});

test("development ports avoid occupied defaults within a bounded range", async () => {
  const probes: number[] = [];
  const selected = await selectDevelopmentPort({
    environmentValue: undefined,
    environmentName: "OPENPI_WEB_BACKEND_PORT",
    preferredPort: 57_107,
    probe: async (port) => {
      probes.push(port);
      return port === 57_109;
    },
  });

  assert.deepEqual(selected, {
    port: 57_109,
    preferredPort: 57_107,
    explicit: false,
  });
  assert.deepEqual(probes, [57_107, 57_108, 57_109]);
});

test("explicit development ports fail instead of silently changing", async () => {
  const probes: number[] = [];
  await assert.rejects(
    selectDevelopmentPort({
      environmentValue: "5173",
      environmentName: "OPENPI_WEB_UI_PORT",
      preferredPort: 5173,
      probe: async (port) => {
        probes.push(port);
        return false;
      },
    }),
    /OPENPI_WEB_UI_PORT=5173.*already in use.*OPENPI_WEB_UI_PORT=5174/u,
  );
  assert.deepEqual(probes, [5173]);
});

test("development port parsing rejects invalid and unsafe values", () => {
  for (const value of ["", "0", "1.5", "65536", "port"]) {
    assert.throws(
      () => parseDevelopmentPort(value, "OPENPI_WEB_UI_PORT"),
      /OPENPI_WEB_UI_PORT must be an integer between 1 and 65535/u,
    );
  }
  assert.equal(parseDevelopmentPort("5174", "OPENPI_WEB_UI_PORT"), 5174);
});

test("default development-port fallback stops after 100 candidates", async () => {
  let probes = 0;
  await assert.rejects(
    selectDevelopmentPort({
      environmentValue: undefined,
      environmentName: "OPENPI_WEB_UI_PORT",
      preferredPort: 5173,
      probe: async () => {
        probes++;
        return false;
      },
    }),
    /No available OpenPI Web development port.*5173.*5272/u,
  );
  assert.equal(probes, 100);
});

test("resolved development origins use the selected ports", async () => {
  const unavailable = new Set([5173, 57_107]);
  const resolved = await resolveDevelopmentPorts({}, async (port) => {
    return !unavailable.has(port);
  });

  assert.equal(resolved.ui.port, 5174);
  assert.equal(resolved.backend.port, 57_108);
  assert.equal(resolved.uiOrigin, "http://127.0.0.1:5174");
  assert.equal(resolved.backendOrigin, "http://127.0.0.1:57108");
});

test("development UI and backend never select the same loopback port", async () => {
  const resolved = await resolveDevelopmentPorts(
    { OPENPI_WEB_BACKEND_PORT: "5173" },
    async () => true,
  );

  assert.equal(resolved.backend.port, 5173);
  assert.equal(resolved.ui.port, 5174);
});

test("backend startup monitor reports a split failure without waiting", async () => {
  const monitor = createBackendStartupMonitor(96);
  monitor.push(`ignored-${"x".repeat(128)}\nFailed to start OpenPI Web`);
  monitor.push(
    " Workbench: Web Host runtime is already owned by live PID 52690\n",
  );

  const failure = await monitor.waitForFailure();
  assert.match(failure.message, /already owned by live PID 52690/u);
  assert.ok(Buffer.byteLength(monitor.getTail(), "utf8") <= 96);
});
