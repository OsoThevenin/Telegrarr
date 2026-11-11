import { useState, type FormEvent } from "react";

import { useMutation } from "@tanstack/react-query";

import { SelectField } from "@/components/SelectField";
import { StatusLine } from "@/components/StatusLine";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { useI18n } from "@/i18n/use-i18n";
import { api } from "@/lib/api";
import { RADARR_DEFAULTS_PATH, useRadarrDefaults, type RadarrDefaultChoices } from "@/screens/connect/connect-api";

export function RadarrDefaults() {
  const { t, errorText } = useI18n();
  const choices = useRadarrDefaults();

  function body() {
    if (choices.data) return <DefaultsForm choices={choices.data} />;
    if (choices.isError) {
      return (
        <StatusLine tone="error">
          {t("connect.radarr_defaults.unavailable", { error: errorText(choices.error) })}
        </StatusLine>
      );
    }
    return <StatusLine tone="neutral">{t("common.loading")}</StatusLine>;
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>{t("connect.radarr_defaults.intro")}</CardDescription>
      </CardHeader>
      <CardContent>{body()}</CardContent>
    </Card>
  );
}

function DefaultsForm({ choices }: { choices: RadarrDefaultChoices }) {
  const { t, errorText } = useI18n();
  const { quality_profiles: profiles, root_folders: folders, selected } = choices;
  const [profile, setProfile] = useState(String(selected.quality_profile_id ?? ""));
  const [folder, setFolder] = useState(selected.root_folder ?? "");

  const save = useMutation({
    mutationFn: () => api.put(RADARR_DEFAULTS_PATH, { quality_profile_id: Number(profile), root_folder: folder }),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form className="flex flex-col items-start gap-3" onSubmit={handleSubmit}>
      <div className="flex w-full max-w-md flex-col gap-3">
        <SelectField
          label={t("connect.radarr_defaults.profile")}
          value={profile}
          onChange={(event) => {
            save.reset();
            setProfile(event.target.value);
          }}
        >
          <option value="" disabled hidden />
          {profiles.map(({ id, name }) => (
            <option key={id} value={String(id)}>
              {name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t("connect.radarr_defaults.root_folder")}
          value={folder}
          onChange={(event) => {
            save.reset();
            setFolder(event.target.value);
          }}
        >
          <option value="" disabled hidden />
          {folders.map(({ path }) => (
            <option key={path} value={path}>
              {path}
            </option>
          ))}
        </SelectField>
      </div>
      <Button type="submit" size="sm" variant="outline" className="h-11 sm:h-7" disabled={!profile || !folder || save.isPending}>
        {t("connect.radarr_defaults.save")}
      </Button>
      {save.isSuccess && <StatusLine tone="success">{t("connect.radarr_defaults.saved")}</StatusLine>}
      {save.isError && <StatusLine tone="error">{errorText(save.error)}</StatusLine>}
    </form>
  );
}
