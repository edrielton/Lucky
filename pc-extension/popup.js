const status = document.getElementById('status');
const tokenInput = document.getElementById('token');
chrome.storage.local.get(['luckyToken'], v => { tokenInput.value = v.luckyToken || ''; });
document.getElementById('save').addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (token.length < 32) { status.textContent = 'Token inválido: copie o token completo do arquivo bridge.token.'; return; }
  await chrome.storage.local.set({ luckyToken: token });
  status.textContent = 'Token salvo no armazenamento local desta extensão.';
});
document.getElementById('send').addEventListener('click', async () => {
  status.textContent = 'Lendo a página ativa…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('Abra uma página HTTP ou HTTPS.');
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ title: document.title.slice(0, 300), url: location.href, text: (document.body?.innerText || '').slice(0, 20000) })
    });
    const { luckyToken } = await chrome.storage.local.get(['luckyToken']);
    if (!luckyToken) throw new Error('Configure e salve o token antes de enviar.');
    const response = await fetch('http://127.0.0.1:43127/v1/capture', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${luckyToken}` }, body: JSON.stringify(result)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Lucky respondeu HTTP ${response.status}`);
    status.textContent = `Enviado ao Lucky. Referência: ${data.id}`;
  } catch (e) { status.textContent = `Não enviado: ${e.message}`; }
});
