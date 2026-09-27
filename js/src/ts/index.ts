import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type ChangeDesc,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  defaultHighlightStyle,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";

export type Language = "python" | "javascript" | "json" | "markdown" | "plain";
export type Theme = "light" | "dark";
export interface Selection {
  anchor: number;
  head?: number;
}
export interface RemoteCursor extends Selection {
  peer: string;
  label?: string;
  color?: string;
}
export type CursorAwarenessState = Record<string, unknown> & {
  selection?: Selection;
};
export interface CursorAwarenessClient {
  awareness?(id: number): ReadonlyMap<string, unknown>;
  onAwareness(
    listener: (update: {
      id: number;
      peer: string;
      state: unknown | null;
    }) => void,
  ): () => void;
  onChange(listener: (change: { id: number }) => void): () => void;
  setAwareness(id: number, state: CursorAwarenessState | null): boolean;
}
export interface CursorAwarenessOptions {
  local?: () => Record<string, unknown>;
  remote?: (
    peer: string,
    state: CursorAwarenessState,
  ) => Pick<RemoteCursor, "label" | "color">;
}
export interface CursorAwarenessBinding {
  publish(): boolean;
  disconnect(): void;
}
export interface Change {
  from: number;
  to: number;
  insert: string;
}
export interface EditorChangeDetail {
  doc: string;
  changes: Change[];
  selection: Required<Selection>;
}
export interface EditorSelectionDetail {
  selection: Required<Selection>;
}

export const LANGUAGES: readonly Language[] = [
  "python",
  "javascript",
  "json",
  "markdown",
  "plain",
];
export const THEMES: readonly Theme[] = ["light", "dark"];

// Marks transactions that originate from property assignment so they don't echo back as events.
const external = Annotation.define<boolean>();
const setRemoteCursors = StateEffect.define<RemoteCursor[]>();

function remoteCursor(cursor: RemoteCursor, length: number): RemoteCursor {
  const { anchor, head } = clampSelection(cursor, length);
  const color =
    typeof cursor.color === "string" &&
    typeof CSS !== "undefined" &&
    CSS.supports("color", cursor.color)
      ? cursor.color
      : undefined;
  return {
    peer: String(cursor.peer),
    anchor,
    head,
    ...(typeof cursor.label === "string" ? { label: cursor.label } : {}),
    ...(color ? { color } : {}),
  };
}

class RemoteCursorWidget extends WidgetType {
  constructor(private readonly cursor: RemoteCursor) {
    super();
  }

  eq(other: RemoteCursorWidget): boolean {
    return (
      this.cursor.peer === other.cursor.peer &&
      this.cursor.label === other.cursor.label &&
      this.cursor.color === other.cursor.color
    );
  }

  toDOM(): HTMLElement {
    const caret = document.createElement("span");
    caret.className = "cm-remote-cursor";
    caret.dataset.peer = this.cursor.peer;
    if (this.cursor.color)
      caret.style.setProperty("--spa-remote-cursor", this.cursor.color);
    if (this.cursor.label) {
      const label = document.createElement("span");
      label.className = "cm-remote-cursor-label";
      label.textContent = this.cursor.label;
      caret.append(label);
    }
    return caret;
  }
}

function remoteCursorDecorations(
  cursors: RemoteCursor[],
  length: number,
): DecorationSet {
  const ranges = [];
  for (const cursor of cursors) {
    const { anchor, head } = clampSelection(cursor, length);
    const color = cursor.color
      ? `--spa-remote-cursor: ${cursor.color}`
      : undefined;
    if (anchor !== head)
      ranges.push(
        Decoration.mark({
          class: "cm-remote-selection",
          attributes: {
            "data-peer": cursor.peer,
            ...(color ? { style: color } : {}),
          },
        }).range(Math.min(anchor, head), Math.max(anchor, head)),
      );
    ranges.push(
      Decoration.widget({
        widget: new RemoteCursorWidget(cursor),
        side: 1,
      }).range(head),
    );
  }
  return Decoration.set(ranges, true);
}

type RemoteCursorState = {
  cursors: RemoteCursor[];
  decorations: DecorationSet;
};

function mapRemoteCursors(
  cursors: RemoteCursor[],
  changes: ChangeDesc,
): RemoteCursor[] {
  return cursors.map((cursor) => ({
    ...cursor,
    anchor: changes.mapPos(cursor.anchor),
    ...(cursor.head === undefined ? {} : { head: changes.mapPos(cursor.head) }),
  }));
}

const remoteCursorField = StateField.define<RemoteCursorState>({
  create: () => ({ cursors: [], decorations: Decoration.none }),
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setRemoteCursors)) {
        const cursors = [
          ...new Map(
            effect.value.map((cursor) => [cursor.peer, cursor]),
          ).values(),
        ].map((cursor) => remoteCursor(cursor, transaction.state.doc.length));
        return {
          cursors,
          decorations: remoteCursorDecorations(
            cursors,
            transaction.state.doc.length,
          ),
        };
      }
    const cursors = mapRemoteCursors(value.cursors, transaction.changes);
    return {
      cursors,
      decorations: value.decorations.map(transaction.changes),
    };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

const languageExtensions: Record<Language, () => Extension> = {
  python: () => python(),
  javascript: () => javascript(),
  json: () => json(),
  markdown: () => markdown(),
  plain: () => [],
};

const PROPERTIES = [
  "doc",
  "language",
  "theme",
  "read_only",
  "line_numbers",
  "tab_size",
  "selection",
  "remote_cursors",
] as const;

// Attributes share the property names so HTML, the manifest, and the Python binding agree.
const ATTRIBUTES = [
  "doc",
  "language",
  "theme",
  "read_only",
  "line_numbers",
  "tab_size",
] as const;

function clampSelection(
  selection: Selection,
  length: number,
): Required<Selection> {
  const clamp = (n: number) =>
    Math.max(0, Math.min(length, Math.trunc(Number(n) || 0)));
  const anchor = clamp(selection.anchor);
  return {
    anchor,
    head: selection.head === undefined ? anchor : clamp(selection.head),
  };
}

export class SpadayCodeMirror extends HTMLElement {
  static get observedAttributes(): string[] {
    return [...ATTRIBUTES];
  }

  private _doc = "";
  private _language: Language = "plain";
  private _theme: Theme = "light";
  private _readOnly = false;
  private _lineNumbers = true;
  private _tabSize = 4;
  private _selection: Selection | null = null;
  private _remoteCursors: RemoteCursor[] = [];
  private _view: EditorView | null = null;
  private readonly _compartments = {
    language: new Compartment(),
    theme: new Compartment(),
    readOnly: new Compartment(),
    lineNumbers: new Compartment(),
    tabSize: new Compartment(),
  };

  /** The live CodeMirror view, or null while disconnected. */
  get view(): EditorView | null {
    return this._view;
  }

  get doc(): string {
    return this._view ? this._view.state.doc.toString() : this._doc;
  }

  set doc(value: string) {
    const next = value == null ? "" : String(value);
    this._doc = next;
    const view = this._view;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === next) return;
    // Replace only the differing middle so scroll position and unrelated selections survive.
    let start = 0;
    const max = Math.min(current.length, next.length);
    while (start < max && current.charCodeAt(start) === next.charCodeAt(start))
      start++;
    let end = 0;
    while (
      end < max - start &&
      current.charCodeAt(current.length - 1 - end) ===
        next.charCodeAt(next.length - 1 - end)
    )
      end++;
    view.dispatch({
      changes: {
        from: start,
        to: current.length - end,
        insert: next.slice(start, next.length - end),
      },
      annotations: [external.of(true), Transaction.addToHistory.of(false)],
    });
  }

  get language(): Language {
    return this._language;
  }

  set language(value: Language) {
    const next = LANGUAGES.includes(value) ? value : "plain";
    if (next === this._language) return;
    this._language = next;
    this._reconfigure(this._compartments.language, this._languageExtension());
  }

  get theme(): Theme {
    return this._theme;
  }

  set theme(value: Theme) {
    const next = THEMES.includes(value) ? value : "light";
    if (next === this._theme) return;
    this._theme = next;
    this.dataset.theme = next;
    this._reconfigure(this._compartments.theme, this._themeExtension());
  }

  get read_only(): boolean {
    return this._readOnly;
  }

  set read_only(value: boolean) {
    const next = Boolean(value);
    if (next === this._readOnly) return;
    this._readOnly = next;
    this._reconfigure(this._compartments.readOnly, this._readOnlyExtension());
  }

  get line_numbers(): boolean {
    return this._lineNumbers;
  }

  set line_numbers(value: boolean) {
    const next = Boolean(value);
    if (next === this._lineNumbers) return;
    this._lineNumbers = next;
    this._reconfigure(
      this._compartments.lineNumbers,
      this._lineNumbersExtension(),
    );
  }

  get tab_size(): number {
    return this._tabSize;
  }

  set tab_size(value: number) {
    const parsed = Math.trunc(Number(value));
    const next = Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
    if (next === this._tabSize) return;
    this._tabSize = next;
    this._reconfigure(this._compartments.tabSize, this._tabSizeExtension());
  }

  get selection(): Required<Selection> | null {
    if (this._view) return this._serializeSelection(this._view.state);
    return this._selection
      ? clampSelection(this._selection, this._doc.length)
      : null;
  }

  set selection(value: Selection | null) {
    this._selection =
      value == null ? null : { anchor: value.anchor, head: value.head };
    const view = this._view;
    if (!view || !this._selection) return;
    const { anchor, head } = clampSelection(
      this._selection,
      view.state.doc.length,
    );
    view.dispatch({
      selection: EditorSelection.single(anchor, head),
      annotations: external.of(true),
    });
  }

  get remote_cursors(): RemoteCursor[] {
    const cursors = this._view
      ? this._view.state.field(remoteCursorField).cursors
      : this._remoteCursors;
    return cursors.map((cursor) => ({ ...cursor }));
  }

  set remote_cursors(value: RemoteCursor[]) {
    this._remoteCursors = Array.isArray(value)
      ? value.map((cursor) =>
          remoteCursor(
            cursor,
            this._view?.state.doc.length ?? this._doc.length,
          ),
        )
      : [];
    this._view?.dispatch({
      effects: setRemoteCursors.of(this._remoteCursors),
      annotations: external.of(true),
    });
  }

  connectedCallback(): void {
    for (const name of PROPERTIES) this._upgradeProperty(name);
    this.dataset.theme = this._theme;
    if (!this._view) {
      this._view = new EditorView({ state: this._createState(), parent: this });
      if (this._remoteCursors.length)
        this._view.dispatch({
          effects: setRemoteCursors.of(this._remoteCursors),
          annotations: external.of(true),
        });
    }
  }

  disconnectedCallback(): void {
    const view = this._view;
    if (!view) return;
    this._doc = view.state.doc.toString();
    this._selection = this._serializeSelection(view.state);
    this._remoteCursors = view.state
      .field(remoteCursorField)
      .cursors.map((cursor) => ({ ...cursor }));
    view.destroy();
    this._view = null;
  }

  attributeChangedCallback(
    name: string,
    _old: string | null,
    value: string | null,
  ): void {
    switch (name) {
      case "doc":
        this.doc = value ?? "";
        break;
      case "language":
        this.language = (value ?? "plain") as Language;
        break;
      case "theme":
        this.theme = (value ?? "light") as Theme;
        break;
      case "read_only":
        this.read_only = value !== null && value !== "false";
        break;
      case "line_numbers":
        this.line_numbers = value === null || value !== "false";
        break;
      case "tab_size":
        this.tab_size = value === null ? 4 : Number(value);
        break;
    }
  }

  // Properties assigned before the element was upgraded shadow the accessors; re-route them.
  private _upgradeProperty(name: (typeof PROPERTIES)[number]): void {
    if (Object.prototype.hasOwnProperty.call(this, name)) {
      const value = (this as Record<string, unknown>)[name];
      delete (this as Record<string, unknown>)[name];
      (this as Record<string, unknown>)[name] = value;
    }
  }

  private _createState(): EditorState {
    const selection = this._selection
      ? clampSelection(this._selection, this._doc.length)
      : undefined;
    return EditorState.create({
      doc: this._doc,
      selection: selection
        ? EditorSelection.single(selection.anchor, selection.head)
        : undefined,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        remoteCursorField,
        this._compartments.language.of(this._languageExtension()),
        this._compartments.theme.of(this._themeExtension()),
        this._compartments.readOnly.of(this._readOnlyExtension()),
        this._compartments.lineNumbers.of(this._lineNumbersExtension()),
        this._compartments.tabSize.of(this._tabSizeExtension()),
        EditorView.updateListener.of((update) => {
          if (update.transactions.some((tr) => tr.annotation(external))) return;
          const selection = this._serializeSelection(update.state);
          if (update.docChanged) {
            const changes: Change[] = [];
            update.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
              changes.push({ from, to, insert: inserted.toString() });
            });
            this._emit<EditorChangeDetail>("editor-change", {
              doc: update.state.doc.toString(),
              changes,
              selection,
            });
          } else if (update.selectionSet) {
            this._emit<EditorSelectionDetail>("editor-selection", {
              selection,
            });
          }
        }),
      ],
    });
  }

  private _languageExtension(): Extension {
    return languageExtensions[this._language]();
  }

  private _themeExtension(): Extension {
    const dark = this._theme === "dark";
    const theme = EditorView.theme(
      {
        "&": {
          color: "var(--_spa-codemirror-text)",
          backgroundColor: "var(--_spa-codemirror-surface)",
        },
        ".cm-content": { caretColor: "var(--_spa-codemirror-cursor)" },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: "var(--_spa-codemirror-cursor)",
        },
        ".cm-remote-selection": {
          backgroundColor:
            "color-mix(in srgb, var(--spa-remote-cursor, var(--_spa-codemirror-cursor)) 24%, transparent)",
        },
        ".cm-remote-cursor": {
          borderLeft:
            "2px solid var(--spa-remote-cursor, var(--_spa-codemirror-cursor))",
          height: "1.2em",
          marginLeft: "-1px",
          pointerEvents: "none",
          position: "relative",
        },
        ".cm-remote-cursor-label": {
          backgroundColor:
            "var(--spa-remote-cursor, var(--_spa-codemirror-cursor))",
          borderRadius: "3px 3px 3px 0",
          color: "white",
          font: "11px/1.4 system-ui, sans-serif",
          left: "-2px",
          padding: "1px 4px",
          position: "absolute",
          top: "-1.5em",
          whiteSpace: "nowrap",
        },
        "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
          { backgroundColor: "var(--_spa-codemirror-selection)" },
        ".cm-activeLine": {
          backgroundColor: "var(--_spa-codemirror-active-line)",
        },
        ".cm-gutters": {
          backgroundColor: "var(--_spa-codemirror-gutter-surface)",
          color: "var(--_spa-codemirror-gutter-text)",
          borderColor: "var(--_spa-codemirror-border)",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "var(--_spa-codemirror-active-line-gutter)",
        },
        ".cm-panels": {
          backgroundColor: "var(--_spa-codemirror-gutter-surface)",
          color: "var(--_spa-codemirror-text)",
        },
        ".cm-panels-top": {
          borderBottomColor: "var(--_spa-codemirror-border)",
        },
        ".cm-panels-bottom": {
          borderTopColor: "var(--_spa-codemirror-border)",
        },
      },
      { dark },
    );
    return dark ? [oneDark, theme] : theme;
  }

  private _readOnlyExtension(): Extension {
    return [
      EditorState.readOnly.of(this._readOnly),
      EditorView.editable.of(!this._readOnly),
    ];
  }

  private _lineNumbersExtension(): Extension {
    return this._lineNumbers
      ? [lineNumbers(), highlightActiveLineGutter()]
      : [];
  }

  private _tabSizeExtension(): Extension {
    return [
      EditorState.tabSize.of(this._tabSize),
      indentUnit.of(" ".repeat(this._tabSize)),
    ];
  }

  private _reconfigure(compartment: Compartment, extension: Extension): void {
    this._view?.dispatch({
      effects: compartment.reconfigure(extension),
      annotations: external.of(true),
    });
  }

  private _serializeSelection(state: EditorState): Required<Selection> {
    const { anchor, head } = state.selection.main;
    return { anchor, head };
  }

  private _emit<T>(type: string, detail: T): void {
    this.dispatchEvent(
      new CustomEvent<T>(type, { detail, bubbles: true, composed: true }),
    );
  }
}

/** Sync this editor's selection through one model's ephemeral transports awareness. */
export function connectCursorAwareness(
  editor: SpadayCodeMirror,
  client: CursorAwarenessClient,
  modelId: number,
  options: CursorAwarenessOptions = {},
): CursorAwarenessBinding {
  let active = true;
  const publish = (): boolean => {
    if (!active) return false;
    const selection = editor.selection;
    return selection
      ? client.setAwareness(modelId, { ...options.local?.(), selection })
      : false;
  };
  const receive = ({
    id,
    peer,
    state,
  }: {
    id: number;
    peer: string;
    state: unknown | null;
  }): void => {
    if (!active || id !== modelId) return;
    const remote = new Map(
      editor.remote_cursors.map((cursor) => [cursor.peer, cursor]),
    );
    if (
      state &&
      typeof state === "object" &&
      "selection" in state &&
      state.selection &&
      typeof state.selection === "object" &&
      "anchor" in state.selection &&
      typeof state.selection.anchor === "number"
    ) {
      const awareness = state as CursorAwarenessState;
      remote.set(peer, {
        peer,
        ...awareness.selection!,
        ...options.remote?.(peer, awareness),
      });
    } else {
      remote.delete(peer);
    }
    editor.remote_cursors = [...remote.values()];
  };
  const onSelection = (): void => {
    publish();
  };

  editor.addEventListener("editor-change", onSelection);
  editor.addEventListener("editor-selection", onSelection);
  const stopAwareness = client.onAwareness(receive);
  const stopChanges = client.onChange(({ id }) => {
    if (id === modelId) publish();
  });
  for (const [peer, state] of client.awareness?.(modelId) ?? [])
    receive({ id: modelId, peer, state });
  publish();

  return {
    publish,
    disconnect() {
      if (!active) return;
      active = false;
      editor.removeEventListener("editor-change", onSelection);
      editor.removeEventListener("editor-selection", onSelection);
      stopAwareness();
      stopChanges();
      client.setAwareness(modelId, null);
      editor.remote_cursors = [];
    },
  };
}

if (!customElements.get("spaday-codemirror")) {
  customElements.define("spaday-codemirror", SpadayCodeMirror);
}

declare global {
  interface HTMLElementTagNameMap {
    "spaday-codemirror": SpadayCodeMirror;
  }
}
