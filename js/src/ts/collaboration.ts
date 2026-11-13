import type { SpadayCodeMirror, RemoteCursor } from "./index.js";

// The example chooses labels/colors; the editor owns native selection decorations.
document.addEventListener("spaday:wire-client", (event) => {
  const { store, namespace } = (event as CustomEvent).detail;
  if (namespace !== null) return;
  const render = () => {
    const editor = document.querySelector<SpadayCodeMirror>("#shared-editor");
    if (!editor) return;
    editor.remote_cursors = (store.get("remote_cursors") ?? []).flatMap(
      ({ peer, state }: { peer: string; state: any }) =>
        state?.selection && typeof state.selection.anchor === "number"
          ? [
              {
                peer,
                anchor: state.selection.anchor,
                head: state.selection.head,
                label: state.name,
                color: state.color,
              } as RemoteCursor,
            ]
          : [],
    );
  };
  const stop = store.subscribe("remote_cursors", render);
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) stop();
  });
  render();
});
