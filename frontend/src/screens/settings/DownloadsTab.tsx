import { useId, useState, type FormEvent } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SaveOutcomeLine } from "@/components/SaveOutcomeLine";
import { TextField } from "@/components/TextField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n/use-i18n";
import { useSaveSettings, useSettingsForm, type LibraryPaths, type Settings } from "@/lib/settings";
import { BUTTON } from "@/lib/touch";

// The ranges the backend clamps to, so the browser can refuse them first.
const MAX_WORKERS = 32;
const MAX_CONCURRENT = 8;

type Props = {
  settings: Settings;
  paths: LibraryPaths;
};

export function DownloadsTab({ settings, paths }: Props) {
  return (
    <>
      <ModeCard mode={settings.operating_mode} />
      <PerformanceCard settings={settings} />
      <FoldersCard settings={settings} paths={paths} />
    </>
  );
}

function ModeCard({ mode }: { mode: Settings["operating_mode"] }) {
  const { t } = useI18n();
  const save = useSaveSettings();
  const [isConfirming, setIsConfirming] = useState(false);
  const isAutonomous = mode === "standalone";
  const stateId = useId();

  const experimental = <Badge variant="outline">{t("set.experimental")}</Badge>;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex flex-wrap items-center gap-2">
          {t("set.mode")}
          {experimental}
        </CardTitle>
        <CardDescription id={stateId}>{isAutonomous ? t("set.autonomous.state_on") : t("set.autonomous.state_off")}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <Label htmlFor="settings-autonomous">{t("set.standalone")}</Label>
        {/* Bound to the server's value: the dialog decides, the click alone changes nothing. */}
        <Switch
          id="settings-autonomous"
          aria-describedby={stateId}
          checked={isAutonomous}
          onCheckedChange={() => setIsConfirming(true)}
        />
      </CardContent>
      <ConfirmDialog
        isOpen={isConfirming}
        onOpenChange={setIsConfirming}
        title={isAutonomous ? t("set.autonomous.title_off") : t("set.autonomous.title_on")}
        badge={experimental}
        description={isAutonomous ? t("set.autonomous.body_off") : t("set.autonomous.body_on")}
        confirmLabel={isAutonomous ? t("common.disable") : t("common.enable")}
        onConfirm={async () => {
          await save.mutateAsync({ operating_mode: isAutonomous ? "arr" : "standalone" });
        }}
      />
    </Card>
  );
}

const PERFORMANCE_KEYS = [
  "dl_workers",
  "max_concurrent",
  "min_free_gb",
  "daily_budget_gb",
  "default_poll_minutes",
  "history_limit_per_show",
] as const;

function PerformanceCard({ settings }: { settings: Settings }) {
  const { t } = useI18n();
  const { form, setField, isDirty, isSaving, outcome, submit } = useSettingsForm(settings, PERFORMANCE_KEYS);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("set.performance")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t("set.dl_workers")}
              hint={t("set.dl_workers_hint")}
              type="number"
              min={1}
              max={MAX_WORKERS}
              value={form.dl_workers}
              onChange={(event) => setField("dl_workers", event.target.value)}
            />
            <TextField
              label={t("set.max_concurrent")}
              type="number"
              min={1}
              max={MAX_CONCURRENT}
              value={form.max_concurrent}
              onChange={(event) => setField("max_concurrent", event.target.value)}
            />
            <TextField
              label={t("set.min_free_gb")}
              type="number"
              min={0}
              value={form.min_free_gb}
              onChange={(event) => setField("min_free_gb", event.target.value)}
            />
            <TextField
              label={t("set.daily_budget")}
              hint={t("set.daily_budget_hint")}
              type="number"
              min={0}
              step="any"
              value={form.daily_budget_gb}
              onChange={(event) => setField("daily_budget_gb", event.target.value)}
            />
            <TextField
              label={t("set.default_poll")}
              hint={t("set.default_poll_hint", { floor: settings.poll_floor_minutes })}
              type="number"
              min={settings.poll_floor_minutes}
              value={form.default_poll_minutes}
              onChange={(event) => setField("default_poll_minutes", event.target.value)}
            />
            <TextField
              label={t("set.history_limit")}
              hint={t("set.history_limit_hint")}
              type="number"
              min={0}
              value={form.history_limit_per_show}
              onChange={(event) => setField("history_limit_per_show", event.target.value)}
            />
          </div>
          <div className="flex flex-col items-start gap-2">
            <Button type="submit" className={BUTTON} disabled={!isDirty || isSaving}>
              {t("set.save_performance")}
            </Button>
            <SaveOutcomeLine outcome={outcome} savedText={t("set.performance_saved")} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

const FOLDER_KEYS = ["downloads_dir"] as const;

function FoldersCard({ settings, paths }: Props) {
  const { t } = useI18n();
  const { form, setField, isDirty, isSaving, outcome, submit } = useSettingsForm(settings, FOLDER_KEYS);

  const libraryPaths = [
    { labelKey: "set.paths.tv", path: paths.tv_dir },
    { labelKey: "set.paths.tv_4k", path: paths.tv_dir_4k },
    { labelKey: "set.paths.movies", path: paths.movies_dir },
    { labelKey: "set.paths.other", path: paths.other_dir },
  ];

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("set.paths")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-col items-start gap-2" onSubmit={handleSubmit}>
          <div className="w-full max-w-md">
            <TextField
              label={t("set.downloads_dir")}
              hint={t("set.downloads_dir_hint")}
              className="font-mono"
              value={form.downloads_dir}
              onChange={(event) => setField("downloads_dir", event.target.value)}
            />
          </div>
          <Button type="submit" className={BUTTON} disabled={!isDirty || isSaving}>
            {t("set.save_folder")}
          </Button>
          <SaveOutcomeLine outcome={outcome} savedText={t("set.downloads_dir_saved")} />
        </form>
        {/* A path keeps to one line and scrolls on a phone, rather than breaking mid-name. */}
        <div
          role="region"
          aria-label={t("set.paths")}
          tabIndex={0}
          className="overflow-x-auto rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <dl className="grid w-max min-w-full grid-cols-[auto_auto] justify-start gap-x-4 gap-y-1 text-sm">
            {libraryPaths.map(({ labelKey, path }) => (
              <div key={labelKey} className="contents">
                <dt className="text-muted-foreground">{t(labelKey)}</dt>
                <dd className="font-mono whitespace-nowrap">{path}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-xs text-muted-foreground">{t("set.paths_hint")}</p>
      </CardContent>
    </Card>
  );
}
