import { api, getToken, setToken } from './api.js';
import { createSaveQueue } from './save-queue.js';

const element = (id) => document.getElementById(id);
const text = element('text');
const status = element('status');
const encoder = new TextEncoder();
let queue;
let timer;
let loading = false;
element('token').value = getToken();

function render() {
  const size = encoder.encode(text.value).length;
  element('count').textContent = `${size} / 10000 bytes`;
  if (size > 10000) status.textContent = '超過 10000 bytes，尚未儲存。';
  else if (queue?.busy()) status.textContent = '儲存中…';
  else status.textContent = queue?.dirty() ? '有未儲存的修改。' : '已同步。';
}

async function save() {
  clearTimeout(timer);
  if (!queue || loading || encoder.encode(text.value).length > 10000) return;
  try { await queue.flush(); } catch (error) { status.textContent = `儲存失敗：${error.message}；可按儲存重試。`; }
}

async function load() {
  if (loading || queue?.busy()) return;
  if ((queue?.dirty() || encoder.encode(text.value).length > 10000) && !confirm('捨棄目前未儲存的修改並重新讀取？')) return;
  clearTimeout(timer);
  loading = true;
  text.disabled = true;
  status.textContent = '讀取中…';
  try {
    const result = await api('/api/v1/pb').catch((error) => {
      if (error.status === 404) return { data: { text: '' } };
      throw error;
    });
    text.value = result.data.text;
    queue = createSaveQueue(text.value, (value) => api('/api/v1/pb', { method: 'POST', body: { text: value } }), render);
    text.disabled = false;
    for (const id of ['save', 'reload', 'copy']) element(id).disabled = false;
    element('connect').hidden = true;
    render();
    text.focus();
  } catch (error) {
    status.textContent = error.message;
    element('connect').hidden = false;
    // Keep local edits available after a failed reload.
    text.disabled = !queue;
  } finally { loading = false; }
}

element('connect').addEventListener('submit', (event) => {
  event.preventDefault();
  setToken(element('token').value);
  void load();
});
text.addEventListener('input', () => {
  clearTimeout(timer);
  // Do not enqueue oversized values while another write is in flight.
  if (encoder.encode(text.value).length <= 10000) queue.set(text.value);
  render();
  if (element('autosave').checked) timer = setTimeout(save, 500);
});
element('autosave').addEventListener('change', () => {
  clearTimeout(timer);
  if (element('autosave').checked) void save();
});
element('save').addEventListener('click', save);
element('reload').addEventListener('click', load);
element('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(text.value); status.textContent = '已複製。'; }
  catch { status.textContent = '無法存取系統剪貼簿，請選取文字後手動複製。'; }
});
window.addEventListener('beforeunload', (event) => {
  if (queue?.dirty() || encoder.encode(text.value).length > 10000) {
    event.preventDefault();
    event.returnValue = '';
  }
});
