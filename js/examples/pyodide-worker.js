const PYODIDE_VERSION = "314.0.4";

const ready = (async () => {
  self.postMessage({ type: "status", message: "Loading Pyodide…" });
  const { loadPyodide } = await import(
    `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.mjs`
  );
  const pyodide = await loadPyodide();
  await pyodide.loadPackage(["micropip", "anyio"]);

  self.postMessage({ type: "status", message: "Installing example…" });
  const response = await fetch(new URL("./wheels.json", self.location.href));
  if (!response.ok)
    throw new Error(`wheel manifest returned ${response.status}`);
  const wheels = await response.json();
  const urls = Object.fromEntries(
    Object.entries(wheels).map(([name, path]) => [
      name,
      new URL(path, self.location.href).href,
    ]),
  );
  pyodide.globals.set("wheels_json", JSON.stringify(urls));
  await pyodide.runPythonAsync(`
import json
import micropip

wheels = json.loads(wheels_json)
await micropip.install([wheels["spaday"], "starlette", "transports==0.8.0"])
await micropip.install(wheels["codemirror"], deps=False)

from spaday_codemirror.example import styles, worker_app
`);
  return pyodide;
})();

self.addEventListener("message", async (event) => {
  try {
    const pyodide = await ready;
    if (event.data.type === "start") {
      self.postMessage({
        type: "style",
        content: pyodide.runPython("styles"),
      });
      self.postMessage(
        JSON.parse(pyodide.runPython("worker_app.start_json()")),
      );
      return;
    }
    pyodide.globals.set("intent_json", JSON.stringify(event.data));
    self.postMessage(
      JSON.parse(pyodide.runPython("worker_app.dispatch_json(intent_json)")),
    );
  } catch (error) {
    self.postMessage({ type: "error", message: String(error) });
  }
});
