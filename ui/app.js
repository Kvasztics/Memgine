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
  if (!response.ok) throw new Error("HTTP " + response.status + " · " + (data.error ?? tr("Sikertelen kérés")));
  return data;
}

async function loadReview() {
  const previousJob = current?.job_id;
  review.hidden = true;
  current = null;
  const selected = scopes[Number(scope.value)];
  if (!selected) {
    byId("status").textContent = tr("Nincs jóváhagyásra váró emlék.");
    return;
  }
  const {user_id, model_id} = selected;
  const {total, next} = await post("reviews", {user_id, model_id});
  byId("status").textContent = total ? total + tr(" jóváhagyásra vár ebben a hatókörben.") : tr("Ez a várólista üres.");
  if (!next) return;
  current = {user_id, model_id, job_id: next.job_id};
  if (next.job_id !== previousJob) byId("review-reason").value = "";
  byId("source").textContent = next.source;
  byId("text").value = next.proposal.text;
  showConfidence(byId("review-confidence"), next.proposal.confidence);
  const eventDate = next.proposal.event_date;
  byId("review-event").hidden = !eventDate;
  byId("review-event-date").textContent = eventDate ?? "";
  byId("review-event-date").dateTime = eventDate ?? "";
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
    byId("dream-result").replaceChildren();
    byId("dream-status").textContent = "";
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
    byId("status").textContent = tr("Csatlakozva.");
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
  const reason = byId("review-reason").value.trim();
  if (decision === "approve") {
    payload.approval_reason = reason;
    Object.assign(payload, {text: byId("text").value.trim(),
      kind: byId("kind").value, mode: byId("mode").value});
  } else {
    payload.rejection_reason = reason;
  }
  run(async () => {
    await post("review", payload);
    review.hidden = true;
    current = null;
    await loadQueue(payload);
    byId("status").textContent = (decision === "approve" ? tr("Emlék mentve. ") : tr("Javaslat elvetve. ")) + byId("status").textContent;
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
  const kind = document.createElement("span");
  const state = document.createElement("span");
  localize(kind, kinds[item.kind] ?? item.kind);
  const expired = item.expires_at != null && item.expires_at * 1000 <= Date.now();
  localize(state, expired ? "Lejárt" : item.active ? "Aktív" : "Korábbi");
  meta.append(kind, " · ", state, " · ",
    [item.user_id, item.model_id, item.conversation_id].filter(Boolean).join(" · "));
  card.append(meta);
  const confidence = document.createElement("span");
  showConfidence(confidence, item.confidence);
  meta.append(" · ", confidence);
  if (item.event_date) {
    const label = document.createElement("span");
    const date = document.createElement("time");
    localize(label, "Esemény dátuma");
    date.dateTime = item.event_date;
    date.textContent = item.event_date;
    meta.append(" · ", label, " ", date);
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "memory-delete";
  localize(remove, "Emlék törlése");
  remove.addEventListener("click", () => {
    if (!window.confirm(tr("Végleg törlöd ezt az emlékváltozatot?"))) return;
    run(async () => {
      try {
        await post("delete", {id: item.id});
        drafts.delete(item.id);
        await loadMemories(memoryOffset);
        if (!byId("memory-list").children.length && memoryOffset > 0) {
          await loadMemories(memoryOffset - 25);
        }
        memoryStatus(tr("Emlék törölve. ") + byId("memory-status").textContent);
      } catch (error) {
        memoryStatus(error.message);
      }
    });
  });


  if (!item.active || expired) {
    const content = document.createElement("p");
    content.textContent = item.text;
    card.append(content, remove);
    return card;
  }
  const form = document.createElement("form");
  const text = document.createElement("textarea");
  text.dataset.localeAria = "Emlék szövege";
  text.setAttribute("aria-label", tr(text.dataset.localeAria));
  text.rows = 2;
  text.maxLength = 500;
  text.required = true;
  const draft = drafts.get(item.id);
  text.value = draft?.text ?? item.text;
  const kindSelect = document.createElement("select");
  const kindLabel = document.createElement("label");
  kindSelect.id = "memory-kind-" + item.id;
  kindLabel.htmlFor = kindSelect.id;
  localize(kindLabel, "Emléktípus");
  for (const [value, label] of Object.entries(kinds)) {
    const option = new Option("", value);
    localize(option, label);
    option.disabled = value === "project" && !item.conversation_id;
    kindSelect.append(option);
  }
  kindSelect.value = draft?.kind ?? item.kind;
  const confidenceInput = document.createElement("input");
  confidenceInput.id = "memory-confidence-" + item.id;
  confidenceInput.type = "number";
  confidenceInput.min = "0";
  confidenceInput.max = "100";
  confidenceInput.step = "any";
  confidenceInput.placeholder = tr("Nincs értékelve");
  const initialConfidence = item.confidence == null ? "" : String(item.confidence * 100);
  confidenceInput.value = draft?.confidence ?? initialConfidence;
  const confidenceLabel = document.createElement("label");
  confidenceLabel.htmlFor = confidenceInput.id;
  localize(confidenceLabel, "Alátámasztottság (%)");
  const saveDraft = () => drafts.set(item.id, {
    text: text.value, kind: kindSelect.value, confidence: confidenceInput.value,
  });
  confidenceInput.addEventListener("input", saveDraft);
  text.addEventListener("input", saveDraft);
  kindSelect.addEventListener("change", saveDraft);
  const save = document.createElement("button");
  save.type = "submit";
  localize(save, "Módosítás mentése");
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(kindLabel, kindSelect, confidenceLabel, confidenceInput, save, remove);
  form.append(text, actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run(async () => {
      const payload = {id: item.id, text: text.value.trim(), kind: kindSelect.value};
      if (confidenceInput.value !== initialConfidence) {
        payload.confidence = confidenceInput.value === "" ? null : confidenceInput.valueAsNumber / 100;
      }
      await post("edit", payload);
      drafts.delete(item.id);
      await loadMemories();
      memoryStatus(tr("Emlék mentve. ") + byId("memory-status").textContent);
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
    ? (offset + 1) + "–" + (offset + result.memories.length) + tr(". emlék")
    : tr("Nincs találat."));
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
  for (const tab of ["memories", "reviews", "dreaming", "logs", "settings"]) {
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

byId("show-dreaming").addEventListener("click", () => showTab("dreaming"));
byId("dream-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = byId("dream-status");
  const result = byId("dream-result");
  const button = event.submitter;
  if (!key) {
    localize(status, "Előbb csatlakozz a Memgine API-kulccsal.");
    return;
  }
  result.replaceChildren();
  const requestKey = key;
  const scope = Object.fromEntries(new FormData(event.currentTarget));
  button.disabled = true;
  localize(status, "Dreaming folyamatban…");
  try {
    const {job} = await post("dream", scope);
    if (key !== requestKey) return;
    if (!job) {
      localize(status, "Nincs alátámasztott új javaslat.");
      return;
    }
    if (job.status !== "review" && job.status !== "dismissed") {
      localize(status, "Erről a javaslatról már döntöttél.");
      return;
    }
    const card = document.createElement("article");
    card.className = "panel";
    const text = document.createElement("p");
    text.textContent = job.proposal.text;
    const confidence = document.createElement("p");
    showConfidence(confidence, job.proposal.confidence);
    const sources = document.createElement("fieldset");
    const sourceTitle = document.createElement("legend");
    localize(sourceTitle, "Archiválandó forrásemlékek");
    const hint = document.createElement("p");
    localize(hint, "Csak azt jelöld be, amelynek minden fontos részletét megtartja az összegzés.");
    sources.append(sourceTitle, hint);
    for (const source of job.sources) {
      const row = document.createElement("p");
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = source.id;
      label.append(checkbox, " " + source.text);
      row.append(label);
      sources.append(row);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    for (const [decision, label] of [["approve", "Jóváhagyás"], ["dismiss", "Elvetés"]]) {
      const control = document.createElement("button");
      localize(control, label);
      control.addEventListener("click", async () => {
        for (const action of actions.children) action.disabled = true;
        try {
          const payload = {...scope, job_id: job.job_id, decision};
          if (decision === "approve") {
            payload.archive_source_ids = Array.from(sources.querySelectorAll("input:checked"), (input) => input.value);
          }
          await post("review", payload);
          reviewsLoaded = false;
          card.remove();
          localize(status, decision === "approve" ? "Dreaming-emlék mentve." : "Dreaming-javaslat elvetve.");
        } catch (error) {
          delete status.dataset.locale;
          status.textContent = error.message;
        } finally {
          for (const action of actions.children) action.disabled = false;
        }
      });
      actions.append(control);
    }
    card.append(text, confidence, sources, actions);
    if (job.status === "dismissed") {
      sources.hidden = true;
      actions.hidden = true;
      const reopen = document.createElement("button");
      localize(reopen, "Javaslat újranyitása");
      reopen.addEventListener("click", async () => {
        reopen.disabled = true;
        try {
          await post("review", {...scope, job_id: job.job_id, decision: "reopen"});
          reopen.remove();
          sources.hidden = false;
          actions.hidden = false;
          reviewsLoaded = false;
          localize(status, "A javaslat jóváhagyásra vár.");
        } catch (error) {
          delete status.dataset.locale;
          status.textContent = error.message;
          reopen.disabled = false;
        }
      });
      card.append(reopen);
    }

    result.append(card);
    reviewsLoaded = false;
    localize(status, job.status === "dismissed" ? "Erről a javaslatról már döntöttél." : "A javaslat jóváhagyásra vár.");
  } catch (error) {
    if (key === requestKey) {
      delete status.dataset.locale;
      status.textContent = error.message;
    }
  } finally {
    button.disabled = false;
  }
});

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
    status.textContent = tr("A napló megnyitásához add meg az API-kulcsot.");
    return;
  }
  status.textContent = tr("Napló betöltése…");
  try {
    const {lines} = await post("logs", {
      source: byId("log-source").value,
      level: byId("log-level").value,
    }, "/v1/admin/");
    status.textContent = lines.length ? lines.length + tr(" naplósor") : tr("Nincs bejegyzés ehhez a szűréshez.");
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
  if (!key) throw new Error(tr("Előbb csatlakozz a Memgine API-kulccsal."));
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
  label.textContent = field.name + (field.overridden ? tr(" (környezeti változó)") : "");
  if (field.choices) {
    input.append(...field.choices.map((value) => new Option(value)));
  } else {
    input.type = field.secret ? "password" : "text";
    if (field.secret) {
      input.autocomplete = "new-password";
      input.placeholder = field.configured ? tr("Beállítva · üresen hagyva megmarad") : tr("Nincs beállítva");
    }
  }
  input.value = field.value;
  const row = document.createElement("div");
  row.className = "setting-row";
  row.append(label, input);
  if (field.path_type && !field.overridden) {
    const button = document.createElement("button");
    button.type = "button";
    localize(button, "Tallózás…");
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
  const explanation = settingHelp[section + "." + field.name];
  if (explanation) {
    const hint = document.createElement("small");
    hint.className = "setting-help";
    hint.id = input.id + "-help";
    localize(hint, explanation);
    input.setAttribute("aria-describedby", hint.id);
    row.append(hint);
  }
  return row;
}

async function browsePath(path) {
  try {
    const target = pathInput;
    const result = await settingsRequest("/browse", {path, kind: target.kind});
    if (target !== pathInput || !pathDialog.open) return;
    pathState = result;
    byId("path-current").textContent = result.path || tr("Kezdőkönyvtárak");
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
    const {sections, prompts} = await settingsRequest("");
    renderPrompts(prompts);
    byId("settings-key").value = "";
    byId("settings-fields").replaceChildren(...sections.map((section) => {
      const panel = document.createElement("fieldset");
      panel.className = "panel";
      const title = document.createElement("legend");
      localize(title, section.title);
      panel.append(title, ...section.fields.map((field) => settingControl(section.name, field)));
      return panel;
    }));
    settingsForm.hidden = false;
    void refreshServices();
    settingsStatus.textContent = tr("A mentett beállításokat a szolgáltatások újraindításkor töltik be.");
  });
});
settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const status = byId("settings-save-status");
  const button = event.submitter;
  if (button) button.disabled = true;
  localize(status, "Mentés folyamatban…");
  void (async () => {
    try {
      const changes = {};
      for (const input of settingsForm.querySelectorAll("[data-section]:enabled")) {
        (changes[input.dataset.section] ??= {})[input.name] = input.value;
      }
      await settingsRequest("/save", {changes});
      settingsForm.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ""; });
      localize(status, "INI mentve. A futó szolgáltatások az új beállításokat újraindításkor töltik be.");
    } catch (error) {
      delete status.dataset.locale;
      status.textContent = error.message;
    } finally {
      if (button) button.disabled = false;
    }
  })();
});

async function refreshServices() {
  const status = byId("service-status");
  try {
    const {states} = await settingsRequest("/services", {action: "status"});
    const names = {api: "Memória-API", proxy: "Chatproxy", extractor: "Helyi kivonatoló", worker: "Feldolgozó"};
    byId("service-list").replaceChildren(...Object.entries(states).map(([service, state]) => {
      const row = document.createElement("p");
      const name = document.createElement("strong");
      localize(name, names[service]);
      row.append(name, " · ", state, " ");
      if (service !== "worker" && state !== "unavailable") {
        const button = document.createElement("button");
        button.type = "button";
        localize(button, "Újraindítás");
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await settingsRequest("/services", {action: "restart", service});
            status.textContent = tr("Újraindítás ütemezve. Várj néhány másodpercet, majd frissítsd az állapotot.");
          } catch (error) {
            status.textContent = error.message;
          } finally {
            button.disabled = false;
          }
        });
        row.append(button);
      }
      return row;
    }));
  } catch (error) {
    status.textContent = error.message;
  }
}

byId("refresh-services").addEventListener("click", refreshServices);


function showConfidence(element, score) {
  const label = document.createElement("span");
  localize(label, "Alátámasztottság");
  const value = document.createElement("span");
  if (typeof score === "number") value.textContent = Math.round(score * 100) + "%";
  else localize(value, "Nincs értékelve");
  element.replaceChildren(label, " · ", value);
}

function renderPrompts(prompts) {
  const names = {
    extraction: "Kivonatolás", recall: "Visszakérdezés", context: "Emlékkontextus",
    dreaming: "Dreaming", critic: "Kritikus",
  };
  const panel = document.createElement("fieldset");
  panel.className = "panel";
  const legend = document.createElement("legend");
  localize(legend, "Promptok");
  panel.append(legend);
  for (const prompt of prompts) {
    const group = document.createElement("div");
    const label = document.createElement("label");
    const input = document.createElement("textarea");
    input.id = "prompt-" + prompt.name;
    input.name = prompt.name;
    input.dataset.section = "prompts";
    input.value = prompt.value;
    input.rows = 5;
    input.maxLength = 16000;
    input.required = true;
    label.htmlFor = input.id;
    localize(label, names[prompt.name]);
    const reset = document.createElement("button");
    reset.type = "button";
    localize(reset, "Alapértelmezett visszaállítása");
    reset.addEventListener("click", () => { input.value = prompt.default; });
    group.append(label, input, reset);
    panel.append(group);
  }
  const hint = document.createElement("p");
  localize(hint, "A kivonatoló a következő futáskor, a chatproxy újraindításkor tölti be a mentett promptokat. A Dreaming és a Kritikus promptja előkészíthető.");
  panel.append(hint);
  byId("prompt-fields").replaceChildren(panel);
}
