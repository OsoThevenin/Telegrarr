// topics.js — forum topics in the UI: the topic picker shown once a chat is
// chosen, and how a topic source is named ("Group › Topic").
// The server lists the topics (GET /api/telegram/topics) through the shared
// FloodWait gate; this module only renders them and reports what was ticked.
import { h, api, mount } from "./core.js";
import { t } from "./i18n.js";

/**
 * Display name of a source: its chat title, plus " › topic" for a topic source.
 * The one place the UI builds that label (channels, downloads, review entries).
 * @param {string|null|undefined} title chat (group or channel) title
 * @param {string|null|undefined} topicTitle forum topic title, for a topic source
 * @returns {string|null|undefined}
 */
export const sourceTitle = (title, topicTitle) => (topicTitle ? `${title} › ${topicTitle}` : title);

/** Whether channel row `c` is a whole forum group (not one of its topics). */
export const isWholeForum = (c) => Boolean(c.forum) && c.topic_id == null;

/**
 * Topic picker. `load(chatId)` asks the server for the chat's topics and, for a
 * forum group, shows one row per topic (every topic Telegram returns, General
 * included). Resolves to true for a forum group, false otherwise (nothing shown).
 *
 * @param {{ kinds?: [string, string][] | null, multiple?: boolean, hint?: string,
 *   onChange?: () => void }} [opts]
 *   kinds: [value, label] pairs for a per-topic kind selector (omit for none);
 *   multiple: checkboxes (true) or a single choice (false); hint: text above the list;
 *   onChange: called when a topic is ticked or unticked, or its kind changes.
 * @returns {{ node: HTMLElement, load: (chatId: string|number) => Promise<boolean>,
 *   isForum: () => boolean, picked: () => {topic_id: number, title: string, kind: string|null}[],
 *   clear: () => void }}
 */
export function topicPicker({ kinds = null, multiple = true, hint = t("chm.topics.hint"), onChange = () => {} } = {}) {
  const node = h("div", { class: "topic-picker" });
  const group = `topics-${Math.random().toString(36).slice(2)}`;   // radio group name (single choice)
  let state = { forum: false, rows: [] };
  let loadGeneration = 0;   // bumped by each load()/clear(): a newer load supersedes one in flight

  const row = (topic) => {
    const box = h("input", { type: multiple ? "checkbox" : "radio", name: multiple ? null : group, onChange });
    const kind = kinds ? h("select", { "aria-label": t("chm.topics.kind_aria", { topic: topic.title }), onChange },
      ...kinds.map(([value, label]) => h("option", { value }, label))) : null;
    return { topic, box, kind };
  };
  const render = () => {
    if (!state.forum) return mount(node);
    const list = state.rows.length
      ? h("div", { class: "topic-list" }, ...state.rows.map((r) => h("div", { class: "topic-row" },
        h("label", { class: "topic-name" }, r.box, h("span", {}, r.topic.title)), r.kind)))
      : h("div", { class: "muted small pad" }, t("chm.topics.empty"));
    return mount(node, h("div", { class: "card-h" }, t("chm.topics.title")),
      hint ? h("div", { class: "muted small" }, hint) : null, list);
  };
  const clear = () => { loadGeneration++; state = { forum: false, rows: [] }; render(); };

  const load = async (chatId) => {
    const mine = ++loadGeneration;
    state = { forum: false, rows: [] };
    mount(node, h("div", { class: "muted small pad" }, t("chm.topics.loading")));
    const res = await api(`/api/telegram/topics?chat_id=${encodeURIComponent(chatId)}`);
    if (mine !== loadGeneration) return state.forum;
    state = res && res.forum ? { forum: true, rows: (res.topics || []).map(row) } : { forum: false, rows: [] };
    render();
    return state.forum;
  };

  const picked = () => state.rows.filter((r) => r.box.checked)
    .map((r) => ({ topic_id: r.topic.topic_id, title: r.topic.title, kind: r.kind ? r.kind.value : null }));

  return { node, load, isForum: () => state.forum, picked, clear };
}
