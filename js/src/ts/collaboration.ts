import {
  connectCursorAwareness,
  type CursorAwarenessClient,
  type SpadayCodeMirror,
} from "./index.js";

const editor = (): SpadayCodeMirror | null =>
  document.querySelector<SpadayCodeMirror>("#shared-editor");

document.addEventListener("spaday:wire-client", (event) => {
  const detail = (event as CustomEvent).detail as {
    client: CursorAwarenessClient;
    namespace: string | null;
  };
  if (detail.namespace !== null) return;

  const stopWaiting = detail.client.onChange(({ id }) => {
    const target = editor();
    if (!target) return;
    stopWaiting();
    connectCursorAwareness(target, detail.client, id, {
      local: () => ({
        name: target.dataset.userName,
        color: target.dataset.userColor,
      }),
      remote: (_peer, state) => ({
        label: typeof state.name === "string" ? state.name : undefined,
        color: typeof state.color === "string" ? state.color : undefined,
      }),
    });
  });
});
