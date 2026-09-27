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
    link: { onModel(listener: (id: number) => void): () => void };
    namespace: string | null;
  };
  if (detail.namespace !== null) return;

  detail.link.onModel((id) => {
    const target = editor();
    if (!target) return;
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
