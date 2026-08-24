export type ClipboardWriter = Pick<Clipboard, "writeText">;

export async function copyDnsValue(
  value: string,
  clipboard: ClipboardWriter | undefined =
    typeof navigator === "undefined" ? undefined : navigator.clipboard,
) {
  if (!value) {
    return {
      ok: false as const,
      message: "Este registro não possui valor para copiar.",
    };
  }
  if (!clipboard) {
    return {
      ok: false as const,
      message: "A cópia não está disponível neste navegador.",
    };
  }
  try {
    await clipboard.writeText(value);
    return { ok: true as const, message: "Copiado" };
  } catch {
    return {
      ok: false as const,
      message: "Não foi possível copiar. Selecione o valor manualmente.",
    };
  }
}
