import { createServer } from "node:net";

export const DEVELOPMENT_PORT_SEARCH_LIMIT = 100;
export const DEVELOPMENT_STARTUP_ERROR_MAX_BYTES = 8 * 1024;

type PortProbe = (port: number) => Promise<boolean>;

interface SelectDevelopmentPortOptions {
  environmentValue: string | undefined;
  environmentName: string;
  preferredPort: number;
  probe?: PortProbe;
}

export function parseDevelopmentPort(value: string, environmentName: string) {
  if (!/^\d+$/u.test(value)) {
    throw new Error(
      `${environmentName} must be an integer between 1 and 65535`,
    );
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `${environmentName} must be an integer between 1 and 65535`,
    );
  }
  return port;
}

export function probeLoopbackPort(port: number) {
  return new Promise<boolean>((resolve, reject) => {
    const server = createServer();
    let finished = false;
    const finish = (error: Error | undefined, available = false) => {
      if (finished) return;
      finished = true;
      server.removeAllListeners();
      if (error) reject(error);
      else resolve(available);
    };
    server.unref();
    server.once("error", (error) => {
      if ("code" in error && error.code === "EADDRINUSE") {
        finish(undefined, false);
      } else {
        finish(error);
      }
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => finish(error ?? undefined, true));
    });
  });
}

export async function selectDevelopmentPort({
  environmentValue,
  environmentName,
  preferredPort,
  probe = probeLoopbackPort,
}: SelectDevelopmentPortOptions) {
  const explicit = environmentValue !== undefined;
  const firstPort = explicit
    ? parseDevelopmentPort(environmentValue, environmentName)
    : preferredPort;
  const attempts = explicit
    ? 1
    : Math.min(DEVELOPMENT_PORT_SEARCH_LIMIT, 65_536 - firstPort);

  for (let offset = 0; offset < attempts; offset++) {
    const port = firstPort + offset;
    if (await probe(port)) {
      return { port, preferredPort, explicit };
    }
  }

  if (explicit) {
    const suggestion =
      firstPort < 65_535
        ? ` Try ${environmentName}=${firstPort + 1}.`
        : ` Choose another ${environmentName} value.`;
    throw new Error(
      `${environmentName}=${firstPort} is already in use on 127.0.0.1.${suggestion}`,
    );
  }

  const lastPort = firstPort + attempts - 1;
  throw new Error(
    `No available OpenPI Web development port from ${firstPort} through ${lastPort}`,
  );
}

export async function resolveDevelopmentPorts(
  environment: NodeJS.ProcessEnv = process.env,
  probe: PortProbe = probeLoopbackPort,
) {
  const explicitBackendPort =
    environment.OPENPI_WEB_BACKEND_PORT === undefined
      ? undefined
      : parseDevelopmentPort(
          environment.OPENPI_WEB_BACKEND_PORT,
          "OPENPI_WEB_BACKEND_PORT",
        );
  const ui = await selectDevelopmentPort({
    environmentValue: environment.OPENPI_WEB_UI_PORT,
    environmentName: "OPENPI_WEB_UI_PORT",
    preferredPort: 5173,
    probe: async (port) => port !== explicitBackendPort && probe(port),
  });
  const backend = await selectDevelopmentPort({
    environmentValue: environment.OPENPI_WEB_BACKEND_PORT,
    environmentName: "OPENPI_WEB_BACKEND_PORT",
    preferredPort: 57_107,
    probe: async (port) => port !== ui.port && probe(port),
  });
  return {
    ui,
    backend,
    uiOrigin: `http://127.0.0.1:${ui.port}`,
    backendOrigin: `http://127.0.0.1:${backend.port}`,
  };
}

function utf8Tail(text: string, maxBytes: number) {
  let bytes = 0;
  let start = text.length;
  for (const character of Array.from(text).reverse()) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) break;
    bytes += characterBytes;
    start -= character.length;
  }
  return text.slice(start);
}

export function createBackendStartupMonitor(
  maxBytes = DEVELOPMENT_STARTUP_ERROR_MAX_BYTES,
) {
  let tail = "";
  let failure: Error | undefined;
  let resolveFailure!: (error: Error) => void;
  const failureSignal = new Promise<Error>((resolve) => {
    resolveFailure = resolve;
  });

  const fail = (error: unknown) => {
    if (failure) return;
    failure = error instanceof Error ? error : new Error(String(error));
    resolveFailure(failure);
  };

  return {
    push(chunk: Buffer | string) {
      tail = utf8Tail(`${tail}${String(chunk)}`, maxBytes);
      const startupFailure = [...tail.split(/\r?\n/u)]
        .reverse()
        .find((line) => line.includes("Failed to start OpenPI Web Workbench:"));
      if (startupFailure) fail(new Error(startupFailure.trim()));
    },
    fail,
    getFailure() {
      return failure;
    },
    waitForFailure() {
      return failureSignal;
    },
    getTail() {
      return tail;
    },
  };
}
