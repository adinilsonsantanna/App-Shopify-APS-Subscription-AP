export function resolvePageState(contracts, loadError) {
  if (loadError) return "error";
  if (contracts === null) return "loading";
  if (contracts.length === 0) return "empty";
  return "ready";
}

export function contractActions(status) {
  if (status === "ACTIVE") return ["pause", "cancel"];
  if (status === "PAUSED") return ["activate", "cancel"];
  return [];
}

export function mutationErrorFeedback(error) {
  return {
    tone: "critical",
    message:
      error?.message ||
      "Não foi possível atualizar a assinatura. Tente novamente.",
  };
}
