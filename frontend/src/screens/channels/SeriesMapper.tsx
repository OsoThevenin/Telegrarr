import type { KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import { Field, FIELD_CLASS } from "@/screens/channels/ChannelSettingsFields";
import { mappingIds, type Channel } from "@/screens/channels/channel";
import { isBareDigits, type SeriesHit } from "@/screens/channels/series-query";
import type { SeriesMapping } from "@/screens/channels/use-series-mapping";

type Props = {
  mapping: SeriesMapping;
  /** The source being edited, whose current mapping is spelled out. */
  source?: Channel;
};

function HitButton({ hit, onChoose }: { hit: SeriesHit; onChoose: () => void }) {
  const { title, year, original_title } = hit;
  const original = original_title && original_title !== title ? ` · ${original_title}` : "";

  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto w-full justify-start whitespace-normal text-left"
      onClick={onChoose}
    >
      {title}{" "}
      <span className="text-muted-foreground">
        {year ? `(${year})` : ""}
        {original}
      </span>
    </Button>
  );
}

function SearchResults({ mapping }: Pick<Props, "mapping">) {
  const { t, errorText } = useI18n();
  const { search, choose } = mapping;

  if (search.isPending) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (search.isError) {
    return (
      <p role="alert" className="text-destructive">
        {errorText(search.error)}
      </p>
    );
  }
  if (!search.data) return null;

  const { term, digitsAsId } = search.variables;

  return (
    <div className="flex flex-col gap-1">
      {!digitsAsId && isBareDigits(term) && (
        <p className="text-muted-foreground">{t("chm.digits_hint", { id: term })}</p>
      )}
      {search.data.length === 0 && <p className="text-muted-foreground">{t("chm.no_series")}</p>}
      {search.data.map((hit) => (
        <HitButton key={hit.tmdb_id} hit={hit} onChoose={() => choose(hit)} />
      ))}
    </div>
  );
}

function ChosenSeries({ mapping: { choice }, source }: Props) {
  const { t } = useI18n();
  const ids = source ? mappingIds(source) : "";

  if (choice) {
    return (
      <p>
        ✓ <strong>{choice.title}</strong>{" "}
        <span className="text-muted-foreground">{`(TMDB ${choice.tmdb_id})`}</span>
      </p>
    );
  }
  if (!ids) return null;

  return <p className="text-muted-foreground">{t("chm.current", { title: source?.imdb_title ?? "", ids })}</p>;
}

/** Which series a source feeds: a TMDB search, and a TVDB id that overrides what TMDB gives. */
export function SeriesMapper({ mapping, source }: Props) {
  const { t } = useI18n();

  const searchOnEnter = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    mapping.searchNow();
  };

  return (
    <>
      {mapping.isTmdbKeyMissing && <p className="text-destructive">{t("chm.tmdb_key_required")}</p>}
      <Field label={t("chm.series")}>
        <input
          className={FIELD_CLASS}
          autoComplete="off"
          placeholder={t("chm.tmdb_search_placeholder")}
          value={mapping.query}
          onChange={(event) => mapping.changeQuery(event.target.value)}
          onKeyDown={searchOnEnter}
        />
      </Field>
      <SearchResults mapping={mapping} />
      <Field label={t("chm.tvdb_id")}>
        <input
          className={FIELD_CLASS}
          inputMode="numeric"
          placeholder={t("chm.tvdb_placeholder")}
          value={mapping.tvdb}
          onChange={(event) => mapping.changeTvdb(event.target.value)}
        />
      </Field>
      <ChosenSeries mapping={mapping} source={source} />
    </>
  );
}
