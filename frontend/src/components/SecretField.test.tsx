import { useState } from "react";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SecretField, type SecretState } from "@/components/SecretField";
import { ApiError } from "@/lib/api";

const SAVED: SecretState = { kind: "saved" };
const EMPTY: SecretState = { kind: "empty" };
const LOCKED: SecretState = { kind: "locked" };

type HarnessProps = {
  state: SecretState;
  onClear?: () => Promise<void>;
  onDraft?: (draft: string | null) => void;
};

/** The field inside a form, which owns the draft as a screen does. */
function Harness({ state, onClear = async () => {}, onDraft }: HarnessProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <SecretField
      label="Clau de l’API"
      state={state}
      draft={draft}
      onDraftChange={(next) => {
        setDraft(next);
        onDraft?.(next);
      }}
      onClear={onClear}
    />
  );
}

describe("a saved secret", () => {
  it("says it is saved, offers Replace and Clear, and has no input", () => {
    render(<Harness state={SAVED} />);

    expect(screen.getByText("Desat ••••")).toBeVisible();
    expect(screen.getByRole("button", { name: "Substitueix Clau de l’API" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Esborra Clau de l’API" })).toBeVisible();
    expect(screen.queryByLabelText("Clau de l’API")).not.toBeInTheDocument();
  });

  it("shows the masked preview it is given", () => {
    render(<Harness state={{ kind: "saved", preview: "socks5://host:1080" }} />);

    expect(screen.getByText("Desat socks5://host:1080")).toBeVisible();
  });

  it("Replace opens an empty masked input, and the draft follows typing", async () => {
    const user = userEvent.setup();
    const onDraft = vi.fn();
    render(<Harness state={SAVED} onDraft={onDraft} />);

    await user.click(screen.getByRole("button", { name: "Substitueix Clau de l’API" }));
    const input = screen.getByLabelText("Clau de l’API");

    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveFocus();

    await user.type(input, "new");

    expect(onDraft).toHaveBeenLastCalledWith("new");
  });

  it("keeping the saved value drops the draft and returns to the badge", async () => {
    const user = userEvent.setup();
    const onDraft = vi.fn();
    render(<Harness state={SAVED} onDraft={onDraft} />);

    await user.click(screen.getByRole("button", { name: "Substitueix Clau de l’API" }));
    await user.type(screen.getByLabelText("Clau de l’API"), "typo");
    await user.click(screen.getByRole("button", { name: "Mantén el valor desat" }));

    expect(onDraft).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("Desat ••••")).toBeVisible();
    expect(screen.queryByLabelText("Clau de l’API")).not.toBeInTheDocument();
  });

  it("Clear asks first, and Cancel keeps the secret", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn(async () => {});
    render(<Harness state={SAVED} onClear={onClear} />);

    await user.click(screen.getByRole("button", { name: "Esborra Clau de l’API" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel·la" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onClear).not.toHaveBeenCalled();
  });

  it("Clear runs once confirmed, and the dialog closes", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn(async () => {});
    render(<Harness state={SAVED} onClear={onClear} />);

    await user.click(screen.getByRole("button", { name: "Esborra Clau de l’API" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Esborra" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("a refused Clear stays in the dialog and says why", async () => {
    const user = userEvent.setup();
    const onClear = async () => {
      throw new ApiError(400, { key: "err.settings.env_locked", params: { env: "PLEX_TOKEN" } });
    };
    render(<Harness state={SAVED} onClear={onClear} />);

    await user.click(screen.getByRole("button", { name: "Esborra Clau de l’API" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Esborra" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("PLEX_TOKEN");
    expect(screen.getByRole("alertdialog")).toBeVisible();
  });
});

describe("an empty secret", () => {
  it("is a masked input with no saved badge or actions", () => {
    render(<Harness state={EMPTY} />);

    expect(screen.getByLabelText("Clau de l’API")).toHaveAttribute("type", "password");
    expect(screen.queryByText("Desat ••••")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps a typed value after the secret it replaced is gone", async () => {
    const user = userEvent.setup();
    render(<Harness state={EMPTY} />);

    await user.type(screen.getByLabelText("Clau de l’API"), "abc");

    expect(screen.getByLabelText("Clau de l’API")).toHaveValue("abc");
  });

  it("does not offer password managers a saved login", () => {
    render(<Harness state={EMPTY} />);

    expect(screen.getByLabelText("Clau de l’API")).toHaveAttribute("autocomplete", "off");
  });
});

describe("a secret set by an environment variable", () => {
  it("says where it comes from, and cannot be edited, replaced or cleared", () => {
    render(<Harness state={LOCKED} />);

    expect(screen.getByText("Definit per variable d’entorn")).toBeVisible();
    expect(screen.getByText("Clau de l’API")).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Clau de l’API")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the masked preview it is given", () => {
    render(<Harness state={{ kind: "locked", preview: "socks5://host:1080" }} />);

    expect(screen.getByText("socks5://host:1080")).toBeVisible();
  });

  it("does not offer a draft left over from before it was locked", () => {
    render(
      <SecretField
        label="Clau de l’API"
        state={LOCKED}
        draft="typed earlier"
        onDraftChange={() => {}}
        onClear={async () => {}}
      />,
    );

    expect(screen.queryByDisplayValue("typed earlier")).not.toBeInTheDocument();
    expect(screen.getByText("Definit per variable d’entorn")).toBeVisible();
  });
});
