// Keep this entry free of React dependencies so module-loading errors remain visible.
const root = document.getElementById("root")!;
const fallback = document.getElementById("startup-status")!;

function showStartupError(error: unknown): void {
  console.error("Avvio Archivio Flow fallito:", error);
  root.replaceChildren(fallback);
  const message = fallback.querySelector("#startup-message")!;
  message.textContent = "Impossibile caricare l’interfaccia. Premi Riprova caricamento. "
    + (error instanceof Error ? error.message : String(error));
  message.setAttribute("role", "alert");
}

void import("./main").then(({ mountApp }) => {
  mountApp(showStartupError);
}).catch(showStartupError);
