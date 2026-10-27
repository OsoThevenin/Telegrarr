// channel-topics.js — the add-channel dialog's forum-topic flow. Once a forum
// group is picked, its topics replace the chat-wide kind: each ticked topic is
// added as its own source with its own kind. When exactly one series topic is
// ticked, the dialog's series block stays visible and maps that topic's source.
import { h, mount, jpost, jput, toast } from "./core.js";
import { t, tn } from "./i18n.js";
import { topicPicker } from "./topics.js";

/**
 * @param {{ kinds: [string, string][], kindRow: HTMLElement, identity: HTMLElement,
 *   series: { node: HTMLElement, payload: () => object|null }, showIdentity: () => void }} dialog
 *   The dialog parts this flow takes over for a forum group: the chat-wide kind row
 *   (hidden), the identity area (the series block, or hidden) and how to restore it.
 * @returns {{ node: HTMLElement, load: (chatId: string|number) => void,
 *   isForum: () => Promise<boolean>,
 *   addSources: (chatId: string|number, fields: object) => Promise<{added: number, all: boolean}|null> }}
 */
export function channelTopics({ kinds, kindRow, identity, series, showIdentity }) {
  let ready = null;      // the pending topics load (resolves to "is a forum group")
  let forum = false;
  const seriesNote = h("div", { class: "muted small" }, t("chm.topics.series_hint"));
  const seriesTopics = () => picker.picked().filter((tp) => tp.kind === "tv");
  const sync = () => {
    kindRow.hidden = forum;
    identity.hidden = forum && seriesTopics().length !== 1;   // one series topic can carry a mapping
    if (forum) mount(identity, seriesNote, series.node);
    else showIdentity();
  };
  const picker = topicPicker({ kinds, onChange: sync });

  const load = (chatId) => {
    ready = picker.load(chatId).then((isForum) => { forum = isForum; sync(); return isForum; });
  };
  const isForum = async () => Boolean(ready && (await ready));

  // One POST per ticked topic (plus the series mapping of the one series topic).
  // A failure is shown by api(); saving again updates the topics already added.
  const addSources = async (chatId, fields) => {
    const ticked = picker.picked();
    if (!ticked.length) { toast(t("chm.topics.pick_first"), "err"); return null; }
    const mapping = seriesTopics().length === 1 ? series.payload() : null;
    let added = 0;
    for (const tp of ticked) {
      const ch = await jpost("/api/channels", { chat_id: chatId, ...fields, kind: tp.kind, topic_id: tp.topic_id, topic_title: tp.title });
      if (!ch) continue;
      if (mapping && tp.kind === "tv" && !(await jput(`/api/channels/${ch.id}/series`, mapping))) continue;
      added++;
    }
    if (added) toast(tn("chm.topics.added", added), "ok");
    return { added, all: added === ticked.length };
  };

  return { node: picker.node, load, isForum, addSources };
}
