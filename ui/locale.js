"use strict";

const english = {
  "Javaslat újranyitása": "Reopen proposal",
  "Archiválandó forrásemlékek": "Source memories to archive",
  "Csak azt jelöld be, amelynek minden fontos részletét megtartja az összegzés.": "Select only sources whose important details are all preserved in the summary.",
  "Dreaming indítása": "Run Dreaming",
  "Dreaming folyamatban…": "Dreaming in progress…",
  "Nincs alátámasztott új javaslat.": "No new supported proposal.",
  "Erről a javaslatról már döntöttél.": "This proposal has already been reviewed.",
  "Dreaming-emlék mentve.": "Dreaming memory saved.",
  "Dreaming-javaslat elvetve.": "Dreaming proposal dismissed.",
  "A javaslat jóváhagyásra vár.": "The proposal is awaiting approval.",
  "Mentés folyamatban…": "Saving…",
  "Döntés indoklása (opcionális)": "Reason for your decision (optional)",
  "Alátámasztottság (%)": "Confidence (%)",
  "Kivonatolás": "Extraction",
  "Visszakérdezés": "Recall",
  "Emlékkontextus": "Memory context",
  "Dreaming": "Dreaming",
  "Kritikus": "Critic",
  "Promptok": "Prompts",
  "Nincs értékelve": "Not scored",
  "Alátámasztottság": "Confidence",
  "Alapértelmezett visszaállítása": "Restore default",
  "A kivonatoló a következő futáskor, a chatproxy újraindításkor tölti be a mentett promptokat. A Dreaming és a Kritikus promptja előkészíthető.": "The extractor loads saved prompts on its next run and the chat proxy on restart. Dreaming and Critic prompts can be prepared now.",

  "Esemény dátuma": "Event date",
  "Lejárt": "Expired",
  "Az üzenetek helyi időzónája IANA formátumban. Újraindítás: Memória-API.": "Local message time zone in IANA format. Restart: Memory API.",
  "Az új emlékjavaslatok kézi jóváhagyásának alapértéke. Az időzített feldolgozó a következő futáskor tölti be.": "Default manual approval policy for new memory proposals. The scheduled worker loads the change on its next run.",
  "A Memgine API és kezelőfelület portja. A kliensek címét is igazítsd hozzá. Újraindítás: Memória-API.": "Port for the memory API and management UI. Update client addresses too. Restart: Memory API.",
  "Az SQLite-adatbázis útvonala. Másik fájl másik emléktárat jelent. Újraindítás: Memória-API. Az időzített feldolgozó a következő futáskor tölti be.": "SQLite database path. A different file selects a different memory store. Restart: Memory API. The scheduled worker loads the change on its next run.",
  "Az API-kulcshoz tartozó ügyfélnév. Megváltoztatása másik emlékhatókört választ. Újraindítás: Memória-API.": "Client name associated with the API key. Changing it selects a different memory scope. Restart: Memory API.",
  "A Memgine API és a felület hozzáférési kulcsa. Csere után frissítsd a klienseket is. Újraindítás: Memória-API, Chatproxy.": "Access key for the memory API and UI. Update clients after rotation. Restart: Memory API, Chat proxy.",
  "A helyi llama-server futtatható fájlja. Újraindítás: Helyi kivonatoló.": "Executable path for the local llama-server. Restart: Local extractor.",
  "A helyi kivonatoló GGUF modellfájlja. Újraindítás: Helyi kivonatoló.": "GGUF model file for the local extractor. Restart: Local extractor.",
  "A helyi kivonatoló CPU-szálainak száma. Újraindítás: Helyi kivonatoló.": "Number of CPU threads for the local extractor. Restart: Local extractor.",
  "A helyi kivonatoló kontextusablaka tokenben. Újraindítás: Helyi kivonatoló.": "Local extractor context window in tokens. Restart: Local extractor.",
  "A kivonatoló teljes chat completions végpontja. Helyi futtatónál a címet és a portot is ez adja. Újraindítás: Helyi kivonatoló. Az időzített feldolgozó a következő futáskor tölti be.": "Full chat completions endpoint for extraction. Also sets the local extractor address and port when used locally. Restart: Local extractor. The scheduled worker loads the change on its next run.",
  "A worker által kért modellnév. Helyi futtatónál ez a kiszolgált álnév. Újraindítás: Helyi kivonatoló. Az időzített feldolgozó a következő futáskor tölti be.": "Model requested by the worker. Also sets the served alias for the local extractor. Restart: Local extractor. The scheduled worker loads the change on its next run.",
  "A worker várakozási ideje a modellválaszra, másodpercben. Az időzített feldolgozó a következő futáskor tölti be.": "Maximum wait for the extractor response, in seconds. The scheduled worker loads the change on its next run.",
  "A kivonatolás mintavételi hőmérséklete. Alacsonyabb értéknél egyenletesebb a válasz. Az időzített feldolgozó a következő futáskor tölti be.": "Sampling temperature for extraction. Lower values make output more consistent. The scheduled worker loads the change on its next run.",
  "A kivonatoló válaszának felső tokenhatára. Az időzített feldolgozó a következő futáskor tölti be.": "Maximum number of tokens in the extractor response. The scheduled worker loads the change on its next run.",
  "A chatproxy helyi portja. A chatkliensek alapcímében is ezt használd. Újraindítás: Chatproxy.": "Local chat proxy port. Use it in the chat clients’ base URL too. Restart: Chat proxy.",
  "A chatkliensek hozzáférési kulcsa a proxyhoz. Újraindítás: Chatproxy.": "Access key used by chat clients to authenticate to the proxy. Restart: Chat proxy.",
  "A chatmodell OpenAI-kompatibilis alapcíme, általában /v1 végződéssel. Újraindítás: Chatproxy.": "OpenAI-compatible base URL for the chat model, typically ending in /v1. Restart: Chat proxy.",
  "Kulcs a modellkiszolgálóhoz, ha az hitelesítést kér. Újraindítás: Chatproxy.": "Key for the upstream model server if it requires authentication. Restart: Chat proxy.",
  "A proxy időkorlátja a modellkiszolgáló felé, másodpercben. Újraindítás: Chatproxy.": "Proxy timeout for the upstream model server, in seconds. Restart: Chat proxy.",
  "A memória-API alapcíme a proxy számára, /v1/memory végződéssel. Újraindítás: Chatproxy.": "Memory API base URL for the proxy, ending in /v1/memory. Restart: Chat proxy.",
  "Ennyi másodpercet vár a proxy a Memgine memória-API válaszára. Újraindítás: Chatproxy.": "Maximum wait for a response from the Memgine memory API, in seconds. Restart: Chat proxy.",
  "Rögzített felhasználói hatókör aláírt WebUI-azonosítás nélkül. Újraindítás: Chatproxy.": "Fixed user scope when signed WebUI identity is disabled. Restart: Chat proxy.",
  "Az Open WebUI-val közös aláírási titok a felhasználóazonosításhoz. Újraindítás: Chatproxy.": "Shared signing secret for verifying Open WebUI user identity. Restart: Chat proxy.",
  "Szavas keresés (lexical) vagy SPLADE-alapú rangsorolás (splade). Újraindítás: Memória-API. Az időzített feldolgozó a következő futáskor tölti be.": "Lexical search or SPLADE-based ranking. Restart: Memory API. The scheduled worker loads the change on its next run.",
  "A CrispEmbed futtatható fájlja. Újraindítás: Memória-API. Az időzített feldolgozó a következő futáskor tölti be.": "Path to the CrispEmbed executable. Restart: Memory API. The scheduled worker loads the change on its next run.",
  "A CrispEmbed által használt SPLADE GGUF fájl. Újraindítás: Memória-API. Az időzített feldolgozó a következő futáskor tölti be.": "SPLADE GGUF file used by CrispEmbed. Restart: Memory API. The scheduled worker loads the change on its next run.",
  "Egy CrispEmbed-futtatás időkorlátja másodpercben. Újraindítás: Memória-API. Az időzített feldolgozó a következő futáskor tölti be.": "Timeout in seconds for each CrispEmbed run. Restart: Memory API. The scheduled worker loads the change on its next run.",
  "A Memgine API és a worker által kiírt legalacsonyabb naplószint. Újraindítás: Memória-API. Az időzített feldolgozó a következő futáskor tölti be.": "Minimum log level emitted by the memory API and worker. Restart: Memory API. The scheduled worker loads the change on its next run.",

  "Szolgáltatások": "Services",
  "Állapot frissítése": "Refresh status",
  "Újraindítás": "Restart",
  "Újraindítás ütemezve. Várj néhány másodpercet, majd frissítsd az állapotot.": "Restart queued. Wait a few seconds, then refresh the status.",

  "Memgine nézetek": "Memgine views",
  "Emlékek": "Memories",
  "Jóváhagyások": "Approvals",
  "Naplók": "Logs",
  "Beállítások": "Settings",
  "Memgine API-kulcs": "Memgine API key",
  "Csatlakozás": "Connect",
  "Keresés": "Search",
  "Felhasználó": "User",
  "Modell": "Model",
  "Beszélgetés": "Conversation",
  "Típus": "Type",
  "Mind": "All",
  "Projekt": "Project",
  "Profil": "Profile",
  "Kontextus": "Context",
  "Korábbi emlékek is": "Include previous versions",
  "Szűrés": "Apply filters",
  "Előző oldal": "Previous page",
  "Következő oldal": "Next page",
  "Várólista frissítése": "Refresh queue",
  "Felhasználó és modell": "User and model",
  "Eredeti üzenet": "Original message",
  "Javasolt emlék": "Proposed memory",
  "Korábbi emlék": "Previous memory",
  "Emléktípus": "Memory type",
  "Mentés módja": "Save as",
  "Külön emlékként": "Separate memory",
  "Korábbi emlék lecserélése": "Replace previous memory",
  "Elvetés": "Dismiss",
  "Jóváhagyás": "Approve",
  "Szolgáltatás": "Service",
  "Memória-API": "Memory API",
  "Feldolgozó": "Worker",
  "Chatproxy": "Chat proxy",
  "Helyi kivonatoló": "Local extractor",
  "Naplószint": "Log level",
  "Minden szint": "All levels",
  "Információ és súlyosabb": "Info and above",
  "Figyelmeztetés és hiba": "Warnings and errors",
  "Hiba": "Errors",
  "Napló frissítése": "Refresh log",
  "Beállítások kezelőkulcsa": "Settings operator key",
  "Beállítások megnyitása": "Unlock settings",
  "Beállítások mentése": "Save settings",
  "Tallózás a Memgine szerveren": "Browse the Memgine server",
  "Feljebb": "Up",
  "Mappa kiválasztása": "Select folder",
  "Bezárás": "Close",
  "Sikertelen kérés": "Request failed",
  "Nincs jóváhagyásra váró emlék.": "No memories awaiting approval.",
  " jóváhagyásra vár ebben a hatókörben.": " awaiting approval for this user and model.",
  "Ez a várólista üres.": "This queue is empty.",
  "Csatlakozva.": "Connected.",
  "Emlék mentve. ": "Memory saved. ",
  "Javaslat elvetve. ": "Proposal dismissed. ",
  "Aktív": "Active",
  "Korábbi": "Previous",
  "Emlék törlése": "Delete memory",
  "Végleg törlöd ezt az emlékváltozatot?": "Permanently delete this memory version?",
  "Emlék törölve. ": "Memory deleted. ",
  "Emlék szövege": "Memory text",
  "Módosítás mentése": "Save changes",
  ". emlék": " memories",
  "Nincs találat.": "No matches.",
  "A napló megnyitásához add meg az API-kulcsot.": "Enter the API key to open the log.",
  "Napló betöltése…": "Loading log…",
  " naplósor": " log lines",
  "Nincs bejegyzés ehhez a szűréshez.": "No entries match these filters.",
  "Előbb csatlakozz a Memgine API-kulccsal.": "Connect with the Memgine API key first.",
  " (környezeti változó)": " (environment override)",
  "Beállítva · üresen hagyva megmarad": "Set · leave blank to keep it",
  "Nincs beállítva": "Not set",
  "Tallózás…": "Browse…",
  "Kezdőkönyvtárak": "Starting folders",
  "A mentett beállításokat a szolgáltatások újraindításkor töltik be.": "Services load saved settings when restarted.",
  "INI mentve. A futó szolgáltatások az új beállításokat újraindításkor töltik be.": "INI saved. Restart the affected services to apply changes.",
  "Kivonatoló": "Extractor",
  "Naplózás": "Logging"
};
let locale = "en";
try {
  if (localStorage.getItem("memgine-language") === "hu") locale = "hu";
} catch {
  // The selector still works when browser storage is unavailable.
}

function tr(text) {
  return locale === "hu" ? text : (Object.hasOwn(english, text) ? english[text] : text);
}

function localize(element, text) {
  element.dataset.locale = text;
  element.textContent = tr(text);
}

function applyLocale() {
  document.documentElement.lang = locale;
  document.querySelectorAll("[data-locale]").forEach((element) => {
    element.textContent = tr(element.dataset.locale);
  });
  document.querySelectorAll("[data-locale-aria]").forEach((element) => {
    element.setAttribute("aria-label", tr(element.dataset.localeAria));
  });
}

const language = document.getElementById("language");
language.value = locale;
language.addEventListener("change", () => {
  locale = language.value;
  try { localStorage.setItem("memgine-language", locale); } catch {}
  applyLocale();
});
applyLocale();

const settingHelp = {
  "api.timezone": "Az üzenetek helyi időzónája IANA formátumban. Újraindítás: Memória-API.",
  "api.review_required": "Az új emlékjavaslatok kézi jóváhagyásának alapértéke. Az időzített feldolgozó a következő futáskor tölti be.",
  "api.port": "A Memgine API és kezelőfelület portja. A kliensek címét is igazítsd hozzá. Újraindítás: Memória-API.",
  "api.database": "Az SQLite-adatbázis útvonala. Másik fájl másik emléktárat jelent. Újraindítás: Memória-API. Az időzített feldolgozó a következő futáskor tölti be.",
  "api.client": "Az API-kulcshoz tartozó ügyfélnév. Megváltoztatása másik emlékhatókört választ. Újraindítás: Memória-API.",
  "api.key": "A Memgine API és a felület hozzáférési kulcsa. Csere után frissítsd a klienseket is. Újraindítás: Memória-API, Chatproxy.",
  "extractor.llama_server": "A helyi llama-server futtatható fájlja. Újraindítás: Helyi kivonatoló.",
  "extractor.gguf": "A helyi kivonatoló GGUF modellfájlja. Újraindítás: Helyi kivonatoló.",
  "extractor.threads": "A helyi kivonatoló CPU-szálainak száma. Újraindítás: Helyi kivonatoló.",
  "extractor.context_size": "A helyi kivonatoló kontextusablaka tokenben. Újraindítás: Helyi kivonatoló.",
  "extractor.url": "A kivonatoló teljes chat completions végpontja. Helyi futtatónál a címet és a portot is ez adja. Újraindítás: Helyi kivonatoló. Az időzített feldolgozó a következő futáskor tölti be.",
  "extractor.model": "A worker által kért modellnév. Helyi futtatónál ez a kiszolgált álnév. Újraindítás: Helyi kivonatoló. Az időzített feldolgozó a következő futáskor tölti be.",
  "extractor.timeout": "A worker várakozási ideje a modellválaszra, másodpercben. Az időzített feldolgozó a következő futáskor tölti be.",
  "extractor.temperature": "A kivonatolás mintavételi hőmérséklete. Alacsonyabb értéknél egyenletesebb a válasz. Az időzített feldolgozó a következő futáskor tölti be.",
  "extractor.max_tokens": "A kivonatoló válaszának felső tokenhatára. Az időzített feldolgozó a következő futáskor tölti be.",
  "proxy.port": "A chatproxy helyi portja. A chatkliensek alapcímében is ezt használd. Újraindítás: Chatproxy.",
  "proxy.key": "A chatkliensek hozzáférési kulcsa a proxyhoz. Újraindítás: Chatproxy.",
  "proxy.upstream_url": "A chatmodell OpenAI-kompatibilis alapcíme, általában /v1 végződéssel. Újraindítás: Chatproxy.",
  "proxy.upstream_key": "Kulcs a modellkiszolgálóhoz, ha az hitelesítést kér. Újraindítás: Chatproxy.",
  "proxy.upstream_timeout": "A proxy időkorlátja a modellkiszolgáló felé, másodpercben. Újraindítás: Chatproxy.",
  "proxy.memory_url": "A memória-API alapcíme a proxy számára, /v1/memory végződéssel. Újraindítás: Chatproxy.",
  "proxy.memory_timeout": "Ennyi másodpercet vár a proxy a Memgine memória-API válaszára. Újraindítás: Chatproxy.",
  "proxy.memory_user": "Rögzített felhasználói hatókör aláírt WebUI-azonosítás nélkül. Újraindítás: Chatproxy.",
  "proxy.webui_jwt_secret": "Az Open WebUI-val közös aláírási titok a felhasználóazonosításhoz. Újraindítás: Chatproxy.",
  "search.engine": "Szavas keresés (lexical) vagy SPLADE-alapú rangsorolás (splade). Újraindítás: Memória-API. Az időzített feldolgozó a következő futáskor tölti be.",
  "search.splade_binary": "A CrispEmbed futtatható fájlja. Újraindítás: Memória-API. Az időzített feldolgozó a következő futáskor tölti be.",
  "search.splade_model": "A CrispEmbed által használt SPLADE GGUF fájl. Újraindítás: Memória-API. Az időzített feldolgozó a következő futáskor tölti be.",
  "search.splade_timeout": "Egy CrispEmbed-futtatás időkorlátja másodpercben. Újraindítás: Memória-API. Az időzített feldolgozó a következő futáskor tölti be.",
  "logging.level": "A Memgine API és a worker által kiírt legalacsonyabb naplószint. Újraindítás: Memória-API. Az időzített feldolgozó a következő futáskor tölti be."
};
