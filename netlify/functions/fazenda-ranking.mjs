import { getStore } from '@netlify/blobs';

const STORE = 'fazenda-ranking';
const KEY = 'top';
const MOSTRAR = 50;   // quantos aparecem no modal
const GUARDAR = 200;  // quantos ficam salvos (folga para quem cai e volta)

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });

// o token de 64 caracteres é segredo do navegador; no servidor só guardamos o SHA-256 dele
const sha256 = async (t) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

// nível maior primeiro; empate: mais moedas; empate: quem atualizou antes
const ordenar = (a, b) => b.lv - a.lv || b.moedas - a.moedas || a.ts - b.ts;

const publico = (lista) =>
  lista.map((e) => ({ id: e.id.slice(0, 16), nome: e.nome, lv: e.lv, moedas: e.moedas, conq: e.conq ?? null }));

export default async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true });

  const store = getStore({ name: STORE, consistency: 'strong' });

  if (req.method === 'GET') {
    const lista = (await store.get(KEY, { type: 'json' })) || [];
    return json({ ok: true, ranking: publico(lista.slice(0, MOSTRAR)) });
  }

  if (req.method !== 'POST') return json({ ok: false, erro: 'Método não permitido.' }, 405);

  let b;
  try {
    const txt = await req.text();
    if (txt.length > 2000) return json({ ok: false, erro: 'Requisição grande demais.' }, 413);
    b = JSON.parse(txt);
  } catch {
    return json({ ok: false, erro: 'JSON inválido.' }, 400);
  }

  const token = String(b.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return json({ ok: false, erro: 'Código inválido.' }, 400);

  const nome = String(b.nome || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
  if (!nome) return json({ ok: false, erro: 'Digite seu nome.' }, 400);

  const lv = Math.floor(Number(b.lv));
  const moedas = Math.floor(Number(b.moedas));
  if (!Number.isFinite(lv) || lv < 1 || lv > 1000) return json({ ok: false, erro: 'Nível inválido.' }, 400);
  if (!Number.isFinite(moedas) || moedas < 0 || moedas > 1e12) return json({ ok: false, erro: 'Moedas inválidas.' }, 400);

  // conquistas coletadas (opcional; clientes antigos não enviam)
  let conq = Math.floor(Number(b.conq));
  if (!Number.isFinite(conq) || conq < 0 || conq > 1000) conq = null;

  const id = await sha256(token);

  // ler -> alterar -> gravar; se outra pessoa gravou no meio, tenta de novo
  for (let i = 0; i < 5; i++) {
    const atual = await store.getWithMetadata(KEY, { type: 'json' });
    const lista = (atual && atual.data) || [];
    const reg = { id, nome, lv, moedas, conq, ts: Date.now() };
    const idx = lista.findIndex((e) => e.id === id);
    if (idx >= 0) lista[idx] = reg;
    else lista.push(reg); // hash novo = registro novo, mesmo que o nome já exista
    lista.sort(ordenar);
    lista.length = Math.min(lista.length, GUARDAR);

    const r = await store.setJSON(KEY, lista, atual ? { onlyIfMatch: atual.etag } : { onlyIfNew: true });
    if (r && r.modified === false) continue;

    const posicao = lista.findIndex((e) => e.id === id) + 1; // 0 = ficou fora
    return json({
      ok: true,
      id: id.slice(0, 16),
      posicao,
      ranking: publico(lista.slice(0, MOSTRAR)),
    });
  }
  return json({ ok: false, erro: 'Muita gente atualizando agora. Tente de novo.' }, 503);
};

export const config = { path: '/api/fazenda-ranking' };
