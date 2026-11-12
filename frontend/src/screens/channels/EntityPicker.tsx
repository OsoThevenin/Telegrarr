import { useState } from "react";

import { Check, Link as LinkIcon, Megaphone, Users } from "lucide-react";
import { toast } from "sonner";

import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useI18n } from "@/i18n/use-i18n";
import {
  useDialogs,
  useResolveChat,
  type PickedChat,
  type TelegramChat,
} from "@/screens/channels/telegram-queries";

/** How many chats the list renders; the search reaches the rest. */
const MAX_LISTED_CHATS = 80;
/** A t.me link, an invite or an @username: what only the server can turn into a chat. */
const LINK_PATTERN = /t\.me\/|joinchat|^@|^\+|^https?:/i;
const RESOLVE_ITEM = "resolve";

type Props = {
  selected: PickedChat | null;
  onSelect: (chat: PickedChat) => void;
};

const matches = ({ title, username }: TelegramChat, query: string) =>
  `${title} ${username}`.toLowerCase().includes(query);

function ChatItem({ chat, isSelected, onSelect }: { chat: TelegramChat; isSelected: boolean; onSelect: () => void }) {
  const { t } = useI18n();
  const Icon = chat.kind === "channel" ? Megaphone : Users;
  const kind = chat.kind === "channel" ? t("chm.dialog.channel") : t("chm.dialog.group");

  return (
    <CommandItem value={String(chat.chat_id)} data-checked={isSelected} onSelect={onSelect}>
      <Icon aria-hidden />
      <span className="min-w-0">
        <span className="block truncate">{chat.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {chat.username ? `@${chat.username} · ${kind}` : kind}
        </span>
      </span>
    </CommandItem>
  );
}

/** Searches the account's chats, or resolves a pasted link to a chat outside them. */
export function EntityPicker({ selected, onSelect }: Props) {
  const { t, errorText } = useI18n();
  const dialogs = useDialogs();
  const resolver = useResolveChat();
  const [query, setQuery] = useState("");

  const typed = query.trim();
  const needle = typed.toLowerCase();
  const listed = (dialogs.data ?? []).filter((chat) => matches(chat, needle)).slice(0, MAX_LISTED_CHATS);
  const emptyText = (() => {
    if (dialogs.isPending) return t("chm.loading_chats");
    return needle ? t("chm.no_matches") : t("chm.no_chats");
  })();

  const changeQuery = (next: string) => {
    setQuery(next);
    resolver.reset();
  };

  const pick = (chat: PickedChat) => {
    resolver.reset();
    onSelect(chat);
  };

  const resolve = () =>
    resolver.mutate(typed, {
      onSuccess: (chat) => {
        setQuery("");
        onSelect(chat);
        toast.success(chat.username ? `${t("chm.resolved")} @${chat.username}` : t("chm.resolved"));
      },
    });

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {/* cmdk names the input with its own hidden label; this is the same text, for the eye. */}
      <span aria-hidden className="font-medium">
        {t("chm.tg_channel")}
      </span>
      <Command shouldFilter={false} label={t("chm.tg_channel")} className="size-auto rounded-lg! border">
        <CommandInput
          className="min-w-0 text-ellipsis placeholder:text-ellipsis"
          value={query}
          onValueChange={changeQuery}
          placeholder={t("chm.chan_search_placeholder")}
        />
        <CommandList className="max-h-48">
          <CommandEmpty className="px-2">{dialogs.isError ? null : emptyText}</CommandEmpty>
          {LINK_PATTERN.test(typed) && (
            <CommandItem value={RESOLVE_ITEM} disabled={resolver.isPending} onSelect={resolve}>
              <LinkIcon aria-hidden />
              <span className="truncate">
                {resolver.isPending ? t("chm.resolving") : t("chm.resolve", { query: typed })}
              </span>
            </CommandItem>
          )}
          {listed.map((chat) => (
            <ChatItem
              key={chat.chat_id}
              chat={chat}
              isSelected={chat.chat_id === selected?.chat_id}
              onSelect={() => pick(chat)}
            />
          ))}
        </CommandList>
      </Command>
      {dialogs.isError && (
        <p role="alert" className="text-destructive">
          {errorText(dialogs.error)}
        </p>
      )}
      {resolver.isError && (
        <p role="alert" className="text-destructive">
          {errorText(resolver.error)}
        </p>
      )}
      <p role="status" className="flex min-w-0 items-center gap-1.5">
        {selected && <Check aria-hidden className="size-4 shrink-0" />}
        {selected && <span className="truncate">{`${selected.title} · ${selected.chat_id}`}</span>}
      </p>
    </div>
  );
}
