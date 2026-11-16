"use strict";

const byId = (id) => document.getElementById(id);
const scope = byId("scope");
const review = byId("review");
let key = "";
let scopes = [];
let current = null;

async function post(route, body, base = "/v1/memory/") {
  const response = await fetch(base + route, {
    method: "POST",
    headers: {"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error("HTTP " + response.status + " · " + (data.error ?? "Sikertelen kérés"));
  return data;
}

async function loadReview() {
  review.hidden = true;
  current = null;
  const selected = scopes[Number(scope.value)];
  if (!selected) {
    byId("status").textContent = "Nincs jóváhagyásra váró emlék.";
    return;
  }
  const {user_id, model_id} = selected;
  const {total, next} = await post("reviews", {user_id, model_id});
  byId("status").textContent = total ? total + " jóváhagyásra vár ebben a hatókörben." : "Ez a várólista üres.";
  if (!next) return;
  current = {user_id, model_id, job_id: next.job_id};
  byId("source").textContent = next.source;
  byId("text").value = next.proposal.text;
  byId("kind").value = next.proposal.kind;
  const replace = next.proposal.action === "supersede" && next.previous !== null;
  byId("previous-panel").hidden = !replace;
  byId("previous").textContent = next.previous ?? "";
  byId("mode").hidden = !replace;
  byId("mode-label").hidden = !replace;
  byId("mode").value = replace ? "supersede" : "add";
  review.hidden = false;
}

async function loadQueue(keep) {
  const result = await post("review-scopes", {});
  scopes = result.scopes;
  scope.replaceChildren(...scopes.map((item, i) =>
    new Option(item.user_id + " / " + item.model_id + " (" + item.total + ")", i)));
  const selected = scopes.findIndex((item) => item.user_id === keep?.user_id && item.model_id === keep?.model_id);
  if (selected >= 0) scope.value = String(selected);
  byId("queue").hidden = !scopes.length;
  await loadReview();
}

async function run(task) {
  const controls = [scope, ...document.querySelectorAll("button")];
  const enabled = controls.filter((element) => !element.disabled);
  enabled.forEach((element) => { element.disabled = true; });
  try {
    await task();
  } catch (error) {
    byId("status").textContent = error.message;
  } finally {
    enabled.forEach((element) => { element.disabled = false; });
    updatePages();
  }
}

byId("connect").addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    key = byId("key").value.trim();
    byId("log-output").textContent = "";
    byId("log-output").hidden = true;
    byId("log-status").textContent = "";
    byId("memory-list").replaceChildren();
    byId("memory-pages").hidden = true;
    byId("filters").hidden = true;
    memoryStatus("");
    byId("queue").hidden = true;
    await loadMemories();
    byId("filters").hidden = false;
    byId("key").value = "";
    byId("refresh-reviews").hidden = false;
    byId("status").textContent = "Csatlakozva.";
    if (!byId("reviews").hidden) await loadQueue();
    else reviewsLoaded = false;
    if (!byId("logs").hidden) await loadLogs();
  });
});

scope.addEventListener("change", () => run(loadReview));

review.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!current || !event.submitter) return;
  const decision = event.submitter.value;
  const payload = {...current, decision};
  if (decision === "approve") {
    Object.assign(payload, {text: byId("text").value.trim(),
      kind: byId("kind").value, mode: byId("mode").value});
  }
  run(async () => {
    await post("review", payload);
    review.hidden = true;
    current = null;
    await loadQueue(payload);
    byId("status").textContent = (decision === "approve" ? "Emlék mentve. " : "Javaslat elvetve. ") + byId("status").textContent;
  });
});

let reviewsLoaded = false;
let memoryOffset = 0;
let hasMore = false;
let memoryFilters = {};
const drafts = new Map();

function updatePages() {
  byId("memory-back").disabled = memoryOffset === 0;
  byId("memory-next").disabled = !hasMore;
}

function memoryCard(item) {
  const card = document.createElement("article");
  card.className = "panel memory-card";
  const meta = document.createElement("p");
  const kinds = {project: "Projekt", profile: "Profil", context: "Kontextus"};
  meta.className = "memory-meta";
  meta.textContent = [kinds[item.kind] ?? item.kind, item.active ? "Aktív" : "Korábbi",
    item.user_id, item.model_id, item.conversation_id].filter(Boolean).join(" · ");
  card.append(meta);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "memory-delete";
  remove.textContent = "Emlék törlése";
  remove.addEventListener("click", () => {
    if (!window.confirm("Végleg törlöd ezt az emlékváltozatot?")) return;
    run(async () => {
      try {
        await post("delete", {id: item.id});
        drafts.delete(item.id);
        await loadMemories(memoryOffset);
        if (!byId("memory-list").children.length && memoryOffset > 0) {
          await loadMemories(memoryOffset - 25);
        }
        memoryStatus("Emlék törölve. " + byId("memory-status").textContent);
      } catch (error) {
        memoryStatus(error.message);
      }
    });
  });


  if (!item.active) {
    const content = document.createElement("p");
    content.textContent = item.text;
    card.append(content, remove);
    return card;
  }
  const form = document.createElement("form");
  const text = document.createElement("textarea");
  text.setAttribute("aria-label", "Emlék szövege");
  text.rows = 2;
  text.maxLength = 500;
  text.required = true;
  text.value = drafts.get(item.id) ?? item.text;
  text.addEventListener("input", () => drafts.set(item.id, text.value));
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Módosítás mentése";
  form.append(text, save, remove);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run(async () => {
      await post("edit", {id: item.id, text: text.value.trim()});
      drafts.delete(item.id);
      await loadMemories();
      memoryStatus("Emlék mentve. " + byId("memory-status").textContent);
    });
  });
  card.append(form);
  return card;
}

function memoryStatus(text) {
  byId("memory-status").textContent = text;
}

async function loadMemories(offset = 0) {
  const result = await post("list", {...memoryFilters, offset});
  memoryOffset = offset;
  hasMore = result.more;
  byId("memory-list").replaceChildren(...result.memories.map(memoryCard));
  byId("memory-pages").hidden = !offset && !hasMore;
  updatePages();
  memoryStatus(result.memories.length
    ? (offset + 1) + "–" + (offset + result.memories.length) + ". emlék"
    : "Nincs találat.");
}

byId("filters").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  memoryFilters = Object.fromEntries(new FormData(form));
  memoryFilters.include_inactive = form.elements.include_inactive.checked;
  run(() => loadMemories());
});

byId("memory-back").addEventListener("click", () => run(() => loadMemories(memoryOffset - 25)));
byId("memory-next").addEventListener("click", () => run(() => loadMemories(memoryOffset + 25)));

function showTab(name) {
  for (const tab of ["memories", "reviews", "logs", "settings"]) {
    const visible = tab === name;
    byId(tab).hidden = !visible;
    byId("show-" + tab).setAttribute("aria-pressed", String(visible));
  }
  if (name === "reviews" && key && (!reviewsLoaded || !current)) {
    run(async () => {
      await loadQueue();
      reviewsLoaded = true;
    });
  }
}
byId("show-memories").addEventListener("click", () => showTab("memories"));
byId("show-reviews").addEventListener("click", () => showTab("reviews"));

byId("refresh-reviews").addEventListener("click", () => run(async () => {
  const draft = current && {
    job: current.job_id, text: byId("text").value,
    kind: byId("kind").value, mode: byId("mode").value,
  };
  await loadQueue(current);
  reviewsLoaded = true;
  if (draft && current?.job_id === draft.job) {
    byId("text").value = draft.text;
    byId("kind").value = draft.kind;
    if (!byId("mode").hidden) byId("mode").value = draft.mode;
  }
}));

function logStyle(line) {
  if (/\b(?:ERROR|CRITICAL) memgine\b|\b(?:failed|failure|traceback)\b/i.test(line)) return "log-error";
  if (/\bWARNING memgine\b|\b(?:warn(?:ing)?|search_fallback)\b/i.test(line)) return "log-warning";
  if (/\b(?:Starting|Started|listening|startup complete)\b/i.test(line)) return "log-start";
  if (/\b(?:matches=[1-9]\d*|status=approved|decision=approve|memory_edited|memory_deleted)\b/.test(line)) return "log-important";
  return "";
}

async function loadLogs() {
  const status = byId("log-status");
  const output = byId("log-output");
  output.hidden = true;
  output.textContent = "";
  if (!key) {
    status.textContent = "A napló megnyitásához add meg az API-kulcsot.";
    return;
  }
  status.textContent = "Napló betöltése…";
  try {
    const {lines} = await post("logs", {
      source: byId("log-source").value,
      level: byId("log-level").value,
    }, "/v1/admin/");
    status.textContent = lines.length ? lines.length + " naplósor" : "Nincs bejegyzés ehhez a szűréshez.";
    output.replaceChildren(...lines.map((line) => {
      const row = document.createElement("span");
      row.className = logStyle(line);
      row.textContent = line + "\n";
      return row;
    }));
    output.hidden = !lines.length;
  } catch (error) {
    status.textContent = error.message;
  }
}

byId("show-logs").addEventListener("click", () => {
  showTab("logs");
  run(loadLogs);
});
byId("log-filters").addEventListener("submit", (event) => {
  event.preventDefault();
  run(loadLogs);
});

const settingsForm = byId("settings-form");
const settingsStatus = byId("settings-status");
const pathDialog = byId("path-browser");
let settingsKey = "";
let pathInput = null;
let pathState = null;

async function settingsRequest(action, body = {}) {
  if (!key) throw new Error("Előbb csatlakozz a Memgine API-kulccsal.");
  const response = await fetch("/v1/admin/settings" + action, {
    method: "POST",
    headers: {"Authorization": "Bearer " + key, "Content-Type": "application/json",
      "X-Memgine-Settings-Key": settingsKey},
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "HTTP " + response.status);
  return result;
}

async function settingsAction(action) {
  try {
    await action();
  } catch (error) {
    settingsStatus.textContent = error.message;
  }
}

function settingControl(section, field) {
  const label = document.createElement("label");
  const input = document.createElement(field.choices ? "select" : "input");
  input.id = "cfg-" + section + "-" + field.name;
  input.dataset.section = section;
  input.name = field.name;
  input.disabled = field.overridden;
  label.htmlFor = input.id;
  label.textContent = field.name + (field.overridden ? " (környezeti változó)" : "");
  if (field.choices) {
    input.append(...field.choices.map((value) => new Option(value)));
  } else {
    input.type = field.secret ? "password" : "text";
    if (field.secret) {
      input.autocomplete = "new-password";
      input.placeholder = field.configured ? "Beállítva · üresen hagyva megmarad" : "Nincs beállítva";
    }
  }
  input.value = field.value;
  const row = document.createElement("div");
  row.className = "setting-row";
  row.append(label, input);
  if (field.path_type && !field.overridden) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Tallózás…";
    button.addEventListener("click", () => {
      pathInput = {input, kind: field.path_type};
      pathState = null;
      byId("path-entries").replaceChildren();
      byId("path-current").textContent = "";
      pathDialog.showModal();
      void browsePath("");
    });
    row.append(button);
  }
  return row;
}

async function browsePath(path) {
  try {
    const target = pathInput;
    const result = await settingsRequest("/browse", {path, kind: target.kind});
    if (target !== pathInput || !pathDialog.open) return;
    pathState = result;
    byId("path-current").textContent = result.path || "Kezdőkönyvtárak";
    byId("path-up").disabled = result.parent === null;
    byId("path-select").hidden = target.kind !== "directory" || !result.path;
    byId("path-entries").replaceChildren(...result.entries.map((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = entry.name + (entry.directory ? "/" : "");
      button.addEventListener("click", () => {
        if (entry.directory) void browsePath(entry.path);
        else {
          target.input.value = entry.path;
          pathDialog.close();
        }
      });
      return button;
    }));
  } catch (error) {
    byId("path-current").textContent = error.message;
  }
}

byId("path-up").addEventListener("click", () => {
  if (pathState?.parent != null) void browsePath(pathState.parent);
});
byId("path-select").addEventListener("click", () => {
  if (pathState?.path) pathInput.input.value = pathState.path;
  pathDialog.close();
});
byId("show-settings").addEventListener("click", () => showTab("settings"));
byId("settings-connect").addEventListener("submit", (event) => {
  event.preventDefault();
  void settingsAction(async () => {
    settingsForm.hidden = true;
    settingsKey = byId("settings-key").value;
    const {sections} = await settingsRequest("");
    byId("settings-key").value = "";
    byId("settings-fields").replaceChildren(...sections.map((section) => {
      const panel = document.createElement("fieldset");
      panel.className = "panel";
      const title = document.createElement("legend");
      title.textContent = section.title;
      panel.append(title, ...section.fields.map((field) => settingControl(section.name, field)));
      return panel;
    }));
    settingsForm.hidden = false;
    settingsStatus.textContent = "A mentett beállításokat a szolgáltatások újraindításkor töltik be.";
  });
});
settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void settingsAction(async () => {
    const changes = {};
    for (const input of settingsForm.querySelectorAll("[data-section]:enabled")) {
      (changes[input.dataset.section] ??= {})[input.name] = input.value;
    }
    await settingsRequest("/save", {changes});
    settingsForm.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ""; });
    settingsStatus.textContent = "INI mentve. A futó szolgáltatások az új beállításokat újraindításkor töltik be.";
  });
});
