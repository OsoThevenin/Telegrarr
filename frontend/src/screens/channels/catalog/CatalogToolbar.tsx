import { SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { useI18n } from "@/i18n/use-i18n";
import { cn } from "@/lib/utils";
import { chipStates, type FilterId } from "@/screens/channels/catalog/catalog";

/** A solid fill, so the chosen filter stands out from the outlined ones in either theme. */
const PRESSED_CHIP =
  "border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background " +
  "dark:border-foreground dark:bg-foreground dark:hover:bg-foreground/90";

type Props = {
  searchText: string;
  chips: ReturnType<typeof chipStates>;
  total: number;
  onSearch: (text: string) => void;
  onFilter: (filter: FilterId) => void;
};

export function CatalogToolbar({ searchText, chips, total, onSearch, onFilter }: Props) {
  const { t, tn } = useI18n();

  return (
    <div className="flex flex-col gap-2">
      <InputGroup>
        <InputGroupInput
          type="search"
          aria-label={t("cat.search_label")}
          placeholder={tn("cat.search_placeholder", total)}
          value={searchText}
          onChange={(event) => onSearch(event.target.value)}
        />
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
      </InputGroup>
      <div role="group" aria-label={t("cat.filter_aria")} className="flex flex-wrap gap-1.5">
        {chips.map(({ id, labelKey, count, isPressed, isDisabled }) => (
          <Button
            key={id}
            size="sm"
            variant="outline"
            className={cn(isPressed && PRESSED_CHIP)}
            aria-pressed={isPressed}
            disabled={isDisabled}
            onClick={() => onFilter(id)}
          >
            {t(labelKey)}
            <span className={cn("tabular-nums", isPressed ? "opacity-70" : "text-muted-foreground")}>{count}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
