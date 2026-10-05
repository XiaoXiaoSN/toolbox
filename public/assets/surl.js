import { api, getToken, setToken } from './api.js';
const element = (id) => document.getElementById(id);
const status = element('status');
let cursor = '';
let busy = false;
element('token').value = getToken();

async function list(append = false) {
  const result = await api(`/api/v1/surl?limit=100${append && cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`);
  if (!append) element('links').replaceChildren();
  for (const link of result.data) {
    const item = document.createElement('li');
    const anchor = document.createElement('a');
    anchor.href = `/${link.shorten}`;
    anchor.textContent = `${location.origin}/${link.shorten}`;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    const remove = document.createElement('button');
    remove.textContent = '刪除';
    remove.addEventListener('click', () => run(async () => {
      await api(`/api/v1/surl/${encodeURIComponent(link.shorten)}`, { method: 'DELETE' });
      await list();
    }));
    item.append(anchor, document.createTextNode(` → ${link.url}`), remove);
    element('links').append(item);
  }
  cursor = result.next || '';
  element('more').hidden = !cursor;
}

async function connect() {
  await list();
  element('create').hidden = false;
  element('connect').hidden = true;
}

async function run(action) {
  if (busy) return;
  busy = true;
  status.textContent = '處理中…';
  try { await action(); status.textContent = '完成。'; }
  catch (error) { status.textContent = error.message; element('connect').hidden = false; }
  finally { busy = false; }
}
element('connect').addEventListener('submit', (event) => {
  event.preventDefault();
  setToken(element('token').value);
  void run(connect);
});
element('create').addEventListener('submit', (event) => {
  event.preventDefault();
  void run(async () => {
    const { data } = await api('/api/v1/surl', { method: 'POST', body: { url: element('url').value, shorten: element('code').value } });
    element('code').value = data.shorten;
    await list();
  });
});
element('more').addEventListener('click', () => run(() => list(true)));

void run(connect);
