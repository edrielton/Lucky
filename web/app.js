const authView = document.querySelector("#auth");
const appView = document.querySelector("#app");
const notice = document.querySelector("#notice");
const logoutButton = document.querySelector("#logout");
let csrfToken = "";

async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Solicitação falhou (${response.status}).`);
  return result;
}

function showNotice(message = "") { notice.textContent = message; }
function listText(id, entries, render) {
  const list = document.querySelector(id);
  list.replaceChildren();
  for (const entry of entries) {
    const item = document.createElement("li");
    render(item, entry);
    list.append(item);
  }
}

async function refresh() {
  const [chat, missions, memories, approvals, audit, experiences, learning, settings] = await Promise.all([
    api("/api/chat"), api("/api/missions"), api("/api/memories"), api("/api/approvals"),
    api("/api/audit"), api("/api/experiences"), api("/api/learning"), api("/api/settings"),
  ]);
  const chatBox = document.querySelector("#chat");
  chatBox.replaceChildren();
  for (const message of chat.messages) {
    const item = document.createElement("div");
    item.className = `message ${message.role}`;
    item.textContent = `${message.role === "user" ? "Você" : "Lucky"}: ${message.content}`;
    chatBox.append(item);
  }
  listText("#missions", missions.missions, (item, mission) => { item.textContent = `${mission.status} · ${mission.goal}`; });
  listText("#memories", memories.memories, (item, memory) => { item.textContent = `${memory.kind} · ${memory.content}`; });
  listText("#approvals", approvals.approvals.filter((approval) => approval.status === "pending"), (item, approval) => {
    item.append(document.createTextNode(`${approval.tool} · ${approval.context} `));
    for (const [decision, label] of [["approve", "Aprovar"], ["reject", "Rejeitar"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.textContent = label;
      button.addEventListener("click", async () => {
        try {
          await api(`/api/approvals/${approval.id}/${decision}`, { method: "POST", body: "{}" });
          await refresh();
        } catch (error) { showNotice(error.message); }
      });
      item.append(button);
    }
  });
  document.querySelector("#audit-status").textContent =
    `Cadeia ${audit.verification.ok ? "verificada" : `inválida no registro ${audit.verification.brokenAt}`} · ${audit.verification.count} registros`;
  listText("#audit", audit.entries.slice(0, 10), (item, entry) => { item.textContent = `${entry.created_at} · ${entry.kind} · ${entry.summary}`; });
  listText("#experiences", experiences.experiences, (item, entry) => { item.textContent = `${entry.kind} · ${entry.context}: ${entry.result}`; });
  listText("#learning", learning.insights, (item, entry) => { item.textContent = `Aprendizado observado · ${entry.summary}`; });
  document.querySelector("#settings-form").elements.provider.value = settings.settings.provider;
  document.querySelector("#settings-form").elements.model.value = settings.settings.model;
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function enter() {
  const session = await api("/api/auth/session");
  csrfToken = session.csrfToken;
  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  logoutButton.classList.remove("hidden");
  await refresh();
}

document.querySelector("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const form = new FormData(event.currentTarget);
  try {
    const result = await api(`/api/auth/${button.dataset.mode}`, {
      method: "POST",
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    csrfToken = result.csrfToken;
    await enter();
    showNotice("");
  } catch (error) { showNotice(error.message); }
});

document.querySelector("#logout").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST", body: "{}" }); location.reload(); }
  catch (error) { showNotice(error.message); }
});

document.querySelector("#mission-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const goal = new FormData(event.currentTarget).get("goal");
  try { await api("/api/missions", { method: "POST", body: JSON.stringify({ goal }) }); event.currentTarget.reset(); await refresh(); }
  catch (error) { showNotice(error.message); }
});

document.querySelector("#memory-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/memories", { method: "POST", body: JSON.stringify({
      content: form.get("content"), kind: form.get("kind"), confidence: "confirmed", source: "user",
    }) });
    event.currentTarget.reset();
    await refresh();
  } catch (error) { showNotice(error.message); }
});

document.querySelector("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = new FormData(event.currentTarget).get("content");
  try { await api("/api/chat", { method: "POST", body: JSON.stringify({ content }) }); event.currentTarget.reset(); await refresh(); }
  catch (error) { showNotice(error.message); }
});

document.querySelector("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ provider: form.get("provider"), model: form.get("model") }) });
    await refresh();
    showNotice("Configuração salva.");
  } catch (error) { showNotice(error.message); }
});

enter().catch((error) => {
  if (!String(error.message).includes("Autenticação necessária")) showNotice(error.message);
});
