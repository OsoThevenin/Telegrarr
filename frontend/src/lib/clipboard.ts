/** Copies text, also over plain HTTP, where `navigator.clipboard` does not exist. */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // A denied permission: the fallback below may still work.
    }
  }
  return copyWithSelection(text);
}

function copyWithSelection(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.className = "fixed opacity-0";
  document.body.append(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
