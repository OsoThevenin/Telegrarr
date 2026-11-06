import { useI18n } from "@/i18n/use-i18n";
import type { Channel } from "@/screens/channels/channel";

type Props = {
  channel: Channel;
};

/** The slot for #69, which replaces this body with the movie channel's Catalog. */
export function CatalogSection({ channel: _channel }: Props) {
  const { t } = useI18n();

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">{t("cat.title")}</h3>
      <p className="text-muted-foreground">{t("ch.catalog_soon")}</p>
    </section>
  );
}
