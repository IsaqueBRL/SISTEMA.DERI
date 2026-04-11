import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, push, onValue, remove, set, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyCaVDJ4LtJu-dlvSi4QrDygfhx1hBGSdDM",
    authDomain: "banco-de-dados-invest.firebaseapp.com",
    databaseURL: "https://banco-de-dados-invest-default-rtdb.firebaseio.com",
    projectId: "banco-de-dados-invest"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const BRAPI_TOKEN = "1EG6ybrvNVpDimcMwbtYwn";

// --- CONFIGURAÇÕES FIXAS ---
const CATEGORIAS_DEFINIDAS = [
    "AÇÕES", "FIIS", "FIAGRO", "STOKS", "REITS", 
    "ETF BRASIL", "ETF EXTERIOR", "CRIPTOMOEDAS", "TESOURO DIRETO"
];

const CATEGORIAS_INTERNACIONAIS = ["STOKS", "REITS", "ETF EXTERIOR", "CRIPTOMOEDAS"];

let todosDados = {}, todasMetas = {}, planejamSetores = {}, categoriaAtiva = null, pendingAction = null;
let cotacaoDolar = 0;

// Estado de ordenação por tabela
const sortState = {
    categorias: { col: -1, asc: true },
    ativos: { col: -1, asc: true },
    planejamento: { col: -1, asc: true }
};

// Ordena array de linhas por coluna
function sortRows(rows, colIndex, asc) {
    return [...rows].sort((a, b) => {
        const va = a.children[colIndex]?.innerText.trim() || '';
        const vb = b.children[colIndex]?.innerText.trim() || '';
        const na = parseFloat(va.replace(/[^\d,.-]/g, '').replace(',', '.'));
        const nb = parseFloat(vb.replace(/[^\d,.-]/g, '').replace(',', '.'));
        const isNum = !isNaN(na) && !isNaN(nb);
        if (isNum) return asc ? na - nb : nb - na;
        return asc ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR');
    });
}

window.sortTable = (tbodyId, stateKey, colIndex) => {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const state = sortState[stateKey];
    if (state.col === colIndex) { state.asc = !state.asc; }
    else { state.col = colIndex; state.asc = true; }
    const sorted = sortRows([...tbody.rows], colIndex, state.asc);
    sorted.forEach(r => tbody.appendChild(r));
    // Atualiza ícones nos headers
    const thead = tbody.closest('table').querySelector('thead');
    if (thead) {
        [...thead.querySelectorAll('th')].forEach((th, i) => {
            th.dataset.sortIdx = i;
            const base = th.innerText.replace(/ [▲▼↕]$/, '');
            if (i === colIndex) { th.innerText = base + (state.asc ? ' ▲' : ' ▼'); }
            else { th.innerText = base.replace(/ ⇅$/, '') + ' ⇅'; }
        });
    }
};

const fmtCur = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtUSD = (v) => '$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseReal = (s) => typeof s === 'number' ? s : parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;

// --- BUSCA COTAÇÃO DO DÓLAR ---
// Usa o par USDBRL=X que retorna quantos BRL valem 1 USD
async function buscarCotacaoDolar() {
    try {
        const r = await fetch(`https://brapi.dev/api/quote/USDBRL=X?token=${BRAPI_TOKEN}`);
        const d = await r.json();
        if (d.results && d.results[0]) {
            cotacaoDolar = d.results[0].regularMarketPrice || 0;
        }
    } catch(e) { console.error("Erro ao buscar dólar:", e); }
}

// --- ATUALIZAÇÃO AUTOMÁTICA DE PREÇOS E DÓLAR ---
const INTERVALO_ATUALIZACAO = 10 * 60 * 1000; // 10 minutos

async function atualizarTodosOsPrecos() {
    const indicator = document.getElementById('sync-indicator');
    const statusEl = document.getElementById('update-status');
    if (indicator) indicator.classList.add('updating');

    // 1. Atualiza dólar PRIMEIRO (sempre, mesmo sem ativos internacionais)
    if (statusEl) statusEl.innerText = 'Atualizando câmbio...';
    await buscarCotacaoDolar();

    // 2. Atualiza ativos ativo por ativo
    const ativos = Object.entries(todosDados);
    if (ativos.length > 0) {
        const tickersUnicos = [...new Set(ativos.map(([, a]) => a.ticker))];
        const precos = {};
        const total = tickersUnicos.length;

        for (let i = 0; i < tickersUnicos.length; i++) {
            const ticker = tickersUnicos[i];
            if (statusEl) statusEl.innerText = `Atualizando ${i + 1}/${total}: ${ticker}`;
            try {
                const r = await fetch(`https://brapi.dev/api/quote/${ticker}?token=${BRAPI_TOKEN}`);
                const d = await r.json();
                if (d.results && d.results[0]) {
                    precos[d.results[0].symbol] = d.results[0].regularMarketPrice;
                }
            } catch(e) { console.error(`Erro ao buscar ${ticker}:`, e); }

            if (i < tickersUnicos.length - 1) {
                await new Promise(res => setTimeout(res, 800));
            }
        }

        const updates = {};
        ativos.forEach(([id, a]) => {
            if (precos[a.ticker] !== undefined) {
                updates[`investimentos/${id}/valorUnitario`] = precos[a.ticker];
            }
        });
        if (Object.keys(updates).length > 0) {
            try { await update(ref(db), updates); }
            catch(e) { console.error("Erro ao salvar preços:", e); }
        }
    }

    // Atualiza interface com cotação nova (re-render)
    renderizarInterface();

    const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (indicator) indicator.classList.remove('updating');
    if (statusEl) statusEl.innerText = `Atualizado às ${agora}`;
    setTimeout(() => { if (statusEl) statusEl.innerText = 'Sistema Online'; }, 5000);
}

// Busca o dólar imediatamente ao carregar, sem esperar Firebase
buscarCotacaoDolar();

let primeiroSyncFeito = false;
setInterval(atualizarTodosOsPrecos, INTERVALO_ATUALIZACAO);

// --- NAVEGAÇÃO ---
// toggleModal definido abaixo junto com o sistema de transações

window.closeConfirm = () => { window.toggleModal('confirmModal'); pendingAction = null; };

window.desbloquearFormulario = () => {
    const cat = document.getElementById('categoria_select').value;
    const overlay = document.getElementById('lock-overlay');
    const btn = document.getElementById('btn-salvar-ativo');
    if (cat) {
        overlay.style.display = 'none';
        btn.disabled = false;
        btn.className = 'w-full bg-blue-600 text-white py-4 rounded-xl font-black uppercase mt-4 shadow-lg cursor-pointer transition-all';
    } else {
        overlay.style.display = 'flex';
        btn.disabled = true;
        btn.className = 'w-full bg-slate-300 text-slate-500 py-4 rounded-xl font-black uppercase mt-4 shadow-lg cursor-not-allowed transition-all';
    }
    atualizarStepQtd();
};

window.atualizarStepQtd = () => {
    const cat = document.getElementById('categoria_select').value;
    const qtdInput = document.getElementById('quantidade_input');
    const ehInternacional = CATEGORIAS_INTERNACIONAIS.includes(cat);
    if (ehInternacional) {
        qtdInput.step = "any";
        qtdInput.placeholder = "0,00000";
    } else {
        qtdInput.step = "1";
        qtdInput.placeholder = "0";
    }
    calcularTotal();
};

window.calcularTotal = () => {
    const qtd = parseFloat(document.getElementById('quantidade_input').value) || 0;
    const preco = parseReal(document.getElementById('valor_unit_input').value || '0');
    const total = qtd * preco;
    document.getElementById('total_calculado').innerText = fmtCur(total);
};

window.toggleSlot = () => {
    const slot = document.getElementById('slot-planejamento');
    const chevron = document.getElementById('chevron-icon');
    if (!slot) return;
    slot.classList.toggle('slot-open');
    chevron?.classList.toggle('chevron-rotate');
};

window.voltarParaCategorias = () => {
    categoriaAtiva = null;
    document.getElementById('visao-estrategica').classList.remove('hidden-view');
    document.getElementById('visao-detalhada').classList.add('hidden-view');
    renderizarInterface();
};

// --- FIREBASE SYNC ---
onValue(ref(db), s => {
    const d = s.val() || {};
    todosDados = d.investimentos || {};
    todasMetas = d.metas || {};
    planejamSetores = d.planejamento_setores || {};
    renderizarInterface();
    popularSelectCategorias();

    // Regra: atualiza preços assim que o site abre (apenas na primeira sincronização)
    if (!primeiroSyncFeito) {
        primeiroSyncFeito = true;
        atualizarTodosOsPrecos();
    }
});

// --- BUSCA BRAPI ---
const tickerIn = document.getElementById('ticker');
const catSelect = document.getElementById('categoria_select');

// Debounce para não disparar a cada tecla
let searchDebounce = null;

tickerIn?.addEventListener('input', async (e) => {
    const q = e.target.value.toUpperCase().trim();
    const categoriaSelecionada = catSelect.value;
    const ehInternacional = CATEGORIAS_INTERNACIONAIS.includes(categoriaSelecionada);

    // Mínimo 1 caractere (cobre tickers como "O", "V", "T")
    if (q.length < 1) {
        const suggBox = document.getElementById('suggestions');
        if (suggBox) suggBox.style.display = 'none';
        return;
    }

    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(async () => {
        let h = "";
        const suggBox = document.getElementById('suggestions');

        if (ehInternacional) {
            // Para internacionais: busca direta pelo ticker digitado + opção de forçar busca global
            h += `<div class="suggestion-item border-b-2 border-blue-100 bg-blue-50" onclick="selectAsset('${q}')">
                    <span class="font-black text-blue-600">🌍 USAR TICKER: ${q}</span>
                    <span class="text-[9px] text-slate-400 ml-2">Buscar cotação diretamente</span>
                 </div>`;

            // Tenta buscar pelo ticker exato na BRAPI (funciona para NYSE/NASDAQ)
            try {
                const r = await fetch(`https://brapi.dev/api/quote/${q}?token=${BRAPI_TOKEN}`);
                const d = await r.json();
                if (d.results && d.results[0] && d.results[0].regularMarketPrice) {
                    const item = d.results[0];
                    h += `<div class="suggestion-item bg-emerald-50 border-b border-emerald-100" onclick="selectAsset('${item.symbol}')">
                            <span class="font-black text-emerald-700">${item.symbol}</span>
                            <span class="text-[10px] text-slate-500 ml-2">${item.shortName || item.longName || ''}</span>
                            <span class="text-[10px] font-black text-blue-600 ml-2">$ ${item.regularMarketPrice}</span>
                          </div>`;
                }
            } catch(e) { /* silencia — o ticker pode não existir ainda */ }
        } else {
            // Para BR: busca na lista da BRAPI
            try {
                const res = await fetch(`https://brapi.dev/api/quote/list?search=${q}&token=${BRAPI_TOKEN}`);
                const data = await res.json();
                if (data.stocks) {
                    data.stocks.slice(0, 6).forEach(s => {
                        h += `<div class="suggestion-item" onclick="selectAsset('${s.stock}')">
                                <span class="font-black">${s.stock}</span>
                                <span class="text-[9px] text-slate-400 ml-2">${s.name || ''}</span>
                              </div>`;
                    });
                }
                // Se não achou nada, oferece usar o ticker digitado mesmo
                if (!data.stocks || data.stocks.length === 0) {
                    h += `<div class="suggestion-item bg-amber-50" onclick="selectAsset('${q}')">
                            <span class="font-black text-amber-600">Usar ticker: ${q}</span>
                            <span class="text-[9px] text-slate-400 ml-2">Não encontrado na lista — buscar mesmo assim</span>
                          </div>`;
                }
            } catch (err) { console.error("Erro na busca BR:", err); }
        }

        if (suggBox) { suggBox.innerHTML = h; suggBox.style.display = h ? 'block' : 'none'; }
    }, 350); // 350ms de debounce
});

window.selectAsset = async (t) => {
    document.getElementById('ticker').value = t;
    document.getElementById('suggestions').style.display = 'none';
    try {
        const r = await fetch(`https://brapi.dev/api/quote/${t}?token=${BRAPI_TOKEN}`);
        const d = await r.json();
        if (d.results && d.results[0]) {
            const preco = d.results[0].regularMarketPrice;
            document.getElementById('valor_unit_input').value = preco.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
        }
    } catch (e) { console.error("Erro na cotação:", e); }
};

// --- RENDERIZAÇÃO (COM FILTRO DE VISIBILIDADE) ---
window.renderizarInterface = () => {
    let totalGeral = 0, totalCatAtiva = 0;
    const resumo = {};

    // 1. Calcula totais por categoria — internacionais convertem USD→BRL
    Object.values(todosDados).forEach(a => {
        const ehIntl = CATEGORIAS_INTERNACIONAIS.includes(a.categoria);
        const valorUSD = (a.quantidade || 0) * (a.valorUnitario || 0);
        const v = ehIntl ? valorUSD * (cotacaoDolar || 1) : valorUSD;
        totalGeral += v;
        resumo[a.categoria] = (resumo[a.categoria] || 0) + v;
        if (categoriaAtiva && a.categoria === categoriaAtiva) totalCatAtiva += v;
    });

    document.getElementById('patrimonio-exibido').innerText = fmtCur(totalGeral);
    const corpo = document.getElementById('tabelaCorpo');
    if(!corpo) return;
    corpo.innerHTML = "";

    // 2. Filtra e Renderiza apenas categorias com ativos ou metas
    CATEGORIAS_DEFINIDAS.forEach(cat => {
        const valAtual = resumo[cat] || 0;
        const metaPct = todasMetas[cat] || 0;

        // REGRA: Só aparece se tiver dinheiro investido OU se você definiu uma meta > 0
        if (valAtual > 0 || metaPct > 0) {
            const atualPct = totalGeral > 0 ? (valAtual / totalGeral * 100) : 0;
            const objetivoVal = totalGeral * (metaPct / 100);
            const sugestao = Math.max(0, objetivoVal - valAtual);

            corpo.innerHTML += `<tr>
                <td class="p-4 text-center"><button onclick="openCat('${cat}')" class="bg-blue-600 text-white w-9 h-9 rounded-xl text-sm font-black shadow hover:bg-blue-700 transition-colors">🔍</button></td>
                <td class="p-4 font-black text-slate-800 text-sm">${cat}</td>
                <td class="p-4 text-center"><span contenteditable="true" onblur="svMeta('${cat}', this.innerText)" class="bg-blue-100 text-blue-700 px-3 py-1 rounded-lg font-black text-sm">${metaPct}</span><span class="text-slate-500 font-bold ml-1">%</span></td>
                <td class="p-4 text-center font-black text-base ${atualPct < metaPct ? 'text-rose-500' : 'text-emerald-600'}">${atualPct.toFixed(1)}%</td>
                <td class="p-4 text-right font-bold text-slate-700 text-sm">${fmtCur(valAtual)}</td>
                <td class="p-4 text-right font-black text-sm ${sugestao > 1 ? 'text-emerald-500' : 'text-slate-300'}">${sugestao > 1 ? fmtCur(sugestao) : '--'}</td>
            </tr>`;
        }
    });

    if (categoriaAtiva) renderizarDetalhes(totalCatAtiva);

    // Rodapé de soma de metas — tabela de categorias
    const tfoot = document.getElementById('tfoot-categorias');
    if (tfoot) {
        const somasMetas = CATEGORIAS_DEFINIDAS.reduce((acc, cat) => {
            return acc + (todasMetas[cat] || 0);
        }, 0);
        const falta = 100 - somasMetas;
        const cor = Math.abs(falta) < 0.01 ? 'text-emerald-600' : falta > 0 ? 'text-amber-500' : 'text-rose-500';
        const msg = Math.abs(falta) < 0.01 ? '✔ 100% alocado' : falta > 0 ? `⚠ Faltam ${falta.toFixed(1)}%` : `⚠ Excesso de ${Math.abs(falta).toFixed(1)}%`;
        tfoot.innerHTML = `<tr>
            <td colspan="2" class="p-3 text-xs font-black text-slate-400 uppercase tracking-wider">SOMA DAS METAS</td>
            <td class="p-3 text-center font-black text-sm ${cor}">${somasMetas.toFixed(1)}% <span class="text-xs ml-1">${msg}</span></td>
            <td colspan="3"></td>
        </tr>`;
    }
};

// --- DETALHES DA CATEGORIA ---
function renderizarDetalhes(totalCat) {
    const tPlan = document.getElementById('tabelaPlanejamento'), tAtv = document.getElementById('tabelaAtivosDetalhe');
    const thead = document.getElementById('thead-ativos');
    const dolarBadge = document.getElementById('dolar-badge');
    if(!tPlan || !tAtv) return;
    tPlan.innerHTML = ""; tAtv.innerHTML = "";

    const ehIntl = CATEGORIAS_INTERNACIONAIS.includes(categoriaAtiva);

    // Atualiza cabeçalho e badge do dólar
    if (ehIntl) {
        dolarBadge.classList.remove('hidden');
        dolarBadge.innerText = cotacaoDolar > 0 ? `💵 USD = ${fmtCur(cotacaoDolar)}` : '💵 Cotação...';
        thead.innerHTML = `<tr>
            <th class="p-4 text-sm cursor-pointer hover:bg-blue-50 select-none" onclick="sortTable('tabelaAtivosDetalhe','ativos',0)">Ativo ⇅</th>
            <th class="p-4 text-sm cursor-pointer hover:bg-blue-50 select-none" onclick="sortTable('tabelaAtivosDetalhe','ativos',1)">Seguimento ⇅</th>
            <th class="p-4 text-center text-sm cursor-pointer hover:bg-blue-50 select-none" onclick="sortTable('tabelaAtivosDetalhe','ativos',2)">Qtd ⇅</th>
            <th class="p-4 text-center text-sm text-amber-600 cursor-pointer hover:bg-blue-50 select-none" onclick="sortTable('tabelaAtivosDetalhe','ativos',3)">Preço (USD) ⇅</th>
            <th class="p-4 text-center text-sm cursor-pointer hover:bg-blue-50 select-none" onclick="sortTable('tabelaAtivosDetalhe','ativos',4)">Peso % ⇅</th>
            <th class="p-4 text-right text-sm text-amber-600 cursor-pointer hover:bg-blue-50 select-none" onclick="sortTable('tabelaAtivosDetalhe','ativos',5)">Total USD ⇅</th>
            <th class="p-4 text-right text-sm text-emerald-600 cursor-pointer hover:bg-blue-50 select-none" onclick="sortTable('tabelaAtivosDetalhe','ativos',6)">Total BRL ⇅</th>
            <th class="p-4 text-center text-sm">Ação</th>
        </tr>`;
    } else {
        dolarBadge.classList.add('hidden');
        thead.innerHTML = `<tr>
            <th class="p-4 text-sm cursor-pointer hover:bg-blue-50 select-none" onclick="sortTable('tabelaAtivosDetalhe','ativos',0)">Ativo ⇅</th>
            <th class="p-4 text-sm cursor-pointer hover:bg-blue-50 select-none" onclick="sortTable('tabelaAtivosDetalhe','ativos',1)">Seguimento ⇅</th>
            <th class="p-4 text-center text-sm cursor-pointer hover:bg-blue-50 select-none" onclick="sortTable('tabelaAtivosDetalhe','ativos',2)">Qtd ⇅</th>
            <th class="p-4 text-center text-sm cursor-pointer hover:bg-blue-50 select-none" onclick="sortTable('tabelaAtivosDetalhe','ativos',3)">Preço ⇅</th>
            <th class="p-4 text-center text-sm cursor-pointer hover:bg-blue-50 select-none" onclick="sortTable('tabelaAtivosDetalhe','ativos',4)">Peso % ⇅</th>
            <th class="p-4 text-right text-sm cursor-pointer hover:bg-blue-50 select-none" onclick="sortTable('tabelaAtivosDetalhe','ativos',5)">Total ⇅</th>
            <th class="p-4 text-center text-sm">Ação</th>
        </tr>`;
    }

    const ativosDaCat = Object.entries(todosDados)
        .filter(([id, a]) => a.categoria === categoriaAtiva)
        .map(([id, a]) => {
            const totalUSD = a.quantidade * a.valorUnitario;
            const totalBRL = ehIntl ? totalUSD * (cotacaoDolar || 1) : totalUSD;
            return { id, ...a, totalUSD, totalBRL, total: totalBRL };
        });

    ativosDaCat.forEach(atv => {
        const peso = totalCat > 0 ? (atv.totalBRL / totalCat * 100) : 0;
        let opt = `<option value="">ESCOLHER...</option>`;
        Object.values(planejamSetores[categoriaAtiva] || {}).forEach(s => {
            opt += `<option value="${s.nome}" ${atv.seguimento === s.nome ? 'selected' : ''}>${s.nome}</option>`;
        });

        if (ehIntl) {
            tAtv.innerHTML += `<tr>
                <td class="p-4 font-black text-slate-800 text-sm">
                    <div class="flex items-center gap-2">
                        <span>${atv.ticker}</span>
                        <button onclick="verTransacoes('${atv.id}','${atv.ticker}')" title="Ver transações" class="text-blue-400 hover:text-blue-600 text-base transition-colors">📋</button>
                    </div>
                </td>
                <td class="p-4"><select onchange="updateAtv('${atv.id}', 'seguimento', this.value)" class="bg-slate-100 p-2 rounded-lg text-xs w-full font-bold outline-none border border-slate-200">${opt}</select></td>
                <td class="p-4 text-center"><span contenteditable="true" onblur="updateAtv('${atv.id}', 'quantidade', this.innerText)" class="bg-slate-100 px-2 py-1 rounded-lg font-black text-sm">${atv.quantidade}</span></td>
                <td class="p-4 text-center font-bold text-amber-600 text-sm">${fmtUSD(atv.valorUnitario)}</td>
                <td class="p-4 text-center text-blue-600 font-black text-sm">${peso.toFixed(1)}%</td>
                <td class="p-4 text-right font-bold text-amber-600 text-sm">${fmtUSD(atv.totalUSD)}</td>
                <td class="p-4 text-right font-black text-emerald-600 text-sm">${fmtCur(atv.totalBRL)}</td>
                <td class="p-4 text-center"><button onclick="askRmAtv('${atv.id}', '${atv.ticker}')" class="text-rose-400 hover:text-rose-600 font-black text-lg transition-colors">✕</button></td>
            </tr>`;
        } else {
            tAtv.innerHTML += `<tr>
                <td class="p-4 font-black text-slate-800 text-sm">
                    <div class="flex items-center gap-2">
                        <span>${atv.ticker}</span>
                        <button onclick="verTransacoes('${atv.id}','${atv.ticker}')" title="Ver transações" class="text-blue-400 hover:text-blue-600 text-base transition-colors">📋</button>
                    </div>
                </td>
                <td class="p-4"><select onchange="updateAtv('${atv.id}', 'seguimento', this.value)" class="bg-slate-100 p-2 rounded-lg text-xs w-full font-bold outline-none border border-slate-200">${opt}</select></td>
                <td class="p-4 text-center"><span contenteditable="true" onblur="updateAtv('${atv.id}', 'quantidade', this.innerText)" class="bg-slate-100 px-2 py-1 rounded-lg font-black text-sm">${atv.quantidade}</span></td>
                <td class="p-4 text-center font-bold text-slate-700 text-sm">${fmtCur(atv.valorUnitario)}</td>
                <td class="p-4 text-center text-blue-600 font-black text-sm">${peso.toFixed(1)}%</td>
                <td class="p-4 text-right font-black text-slate-800 text-sm">${fmtCur(atv.totalBRL)}</td>
                <td class="p-4 text-center"><button onclick="askRmAtv('${atv.id}', '${atv.ticker}')" class="text-rose-400 hover:text-rose-600 font-black text-lg transition-colors">✕</button></td>
            </tr>`;
        }
    });

    Object.entries(planejamSetores[categoriaAtiva] || {}).forEach(([sid, s]) => {
        const val = ativosDaCat.filter(a => a.seguimento === s.nome).reduce((acc, a) => acc + a.totalBRL, 0);
        const atual = totalCat > 0 ? (val / totalCat * 100) : 0;
        const sug = Math.max(0, (totalCat * (s.meta / 100)) - val);
        
        tPlan.innerHTML += `<tr>
            <td class="p-4 font-bold text-slate-800 text-sm"><span contenteditable="true" onblur="updateSeg('${sid}', 'nome', this.innerText)">${s.nome}</span></td>
            <td class="p-4 text-center"><span contenteditable="true" onblur="updateSeg('${sid}', 'meta', this.innerText)" class="bg-blue-100 text-blue-700 px-3 py-1 rounded-lg font-black text-sm">${s.meta}</span><span class="text-slate-500 font-bold ml-1">%</span></td>
            <td class="p-4 text-center font-black text-sm ${atual < s.meta ? 'text-rose-500' : 'text-emerald-600'}">${atual.toFixed(1)}%</td>
            <td class="p-4 text-right font-bold text-slate-700 text-sm">${fmtCur(val)}</td>
            <td class="p-4 text-right font-black text-sm ${sug > 1 ? 'text-emerald-500' : 'text-slate-300'}">${sug > 1 ? fmtCur(sug) : '--'}</td>
            <td class="p-4 text-center"><button onclick="askRmSeg('${sid}', '${s.nome}')" class="text-rose-400 hover:text-rose-600 font-black text-lg transition-colors">✕</button></td>
        </tr>`;
    });

    // Rodapé de soma de metas — tabela de seguimentos
    const tfootPlan = document.getElementById('tfoot-planejamento');
    if (tfootPlan) {
        const setores = Object.values(planejamSetores[categoriaAtiva] || {});
        const somaMetas = setores.reduce((acc, s) => acc + (s.meta || 0), 0);
        const falta = 100 - somaMetas;
        const cor = Math.abs(falta) < 0.01 ? 'text-emerald-600' : falta > 0 ? 'text-amber-500' : 'text-rose-500';
        const msg = Math.abs(falta) < 0.01 ? '✔ 100% alocado' : falta > 0 ? `⚠ Faltam ${falta.toFixed(1)}%` : `⚠ Excesso de ${Math.abs(falta).toFixed(1)}%`;
        tfootPlan.innerHTML = setores.length > 0 ? `<tr>
            <td class="p-3 text-xs font-black text-slate-400 uppercase tracking-wider">SOMA DAS METAS</td>
            <td class="p-3 text-center font-black text-sm ${cor}">${somaMetas.toFixed(1)}% <span class="text-xs ml-1">${msg}</span></td>
            <td colspan="4"></td>
        </tr>` : '';
    }
}

// --- PERSISTÊNCIA ---
window.openCat = (cat) => {
    categoriaAtiva = cat;
    document.getElementById('visao-estrategica').classList.add('hidden-view');
    document.getElementById('visao-detalhada').classList.remove('hidden-view');
    document.getElementById('titulo-categoria-detalhe').innerText = cat;
    document.getElementById('span-cat-name').innerText = cat;
    renderizarInterface();
};

window.svMeta = (cat, v) => set(ref(db, `metas/${cat}`), parseFloat(v) || 0);
window.updateAtv = (id, f, v) => update(ref(db, `investimentos/${id}`), { [f]: (f === 'quantidade' || f === 'valorUnitario') ? parseReal(v) : v });
window.updateSeg = (id, f, v) => update(ref(db, `planejamento_setores/${categoriaAtiva}/${id}`), { [f]: f === 'meta' ? parseFloat(v) || 0 : v.toUpperCase() });
window.addSeguimento = () => categoriaAtiva && push(ref(db, `planejamento_setores/${categoriaAtiva}`), { nome: "NOVO SEGUIMENTO", meta: 0 });

window.askRmAtv = (id, t) => { 
    document.getElementById('confirmMessage').innerText = `Ativo: ${t}`; 
    pendingAction = () => remove(ref(db, `investimentos/${id}`)); 
    window.toggleModal('confirmModal'); 
};

window.askRmSeg = (id, n) => { 
    document.getElementById('confirmMessage').innerText = `Seguimento: ${n}`; 
    pendingAction = () => remove(ref(db, `planejamento_setores/${categoriaAtiva}/${id}`)); 
    window.toggleModal('confirmModal'); 
};

document.getElementById('btnConfirmAction').onclick = () => { pendingAction?.(); window.closeConfirm(); };

document.getElementById('formInvestimento').onsubmit = (e) => {
    e.preventDefault();
    push(ref(db, 'investimentos'), {
        ticker: document.getElementById('ticker').value.toUpperCase(),
        categoria: document.getElementById('categoria_select').value,
        quantidade: parseFloat(document.getElementById('quantidade_input').value) || 0,
        valorUnitario: parseReal(document.getElementById('valor_unit_input').value),
        seguimento: ""
    });
    window.toggleModal('modalAtivo'); 
    e.target.reset();
    document.getElementById('total_calculado').innerText = 'R$ 0,00';
    document.getElementById('lock-overlay').style.display = 'flex';
    const btn = document.getElementById('btn-salvar-ativo');
    btn.disabled = true;
    btn.className = 'w-full bg-slate-300 text-slate-500 py-4 rounded-xl font-black uppercase mt-4 shadow-lg cursor-not-allowed transition-all';
    atualizarStepQtd();
};

function popularSelectCategorias() {
    const sel = document.getElementById('categoria_select');
    if (!sel) return;
    sel.innerHTML = `<option value="">— SELECIONAR CATEGORIA —</option>` + 
        CATEGORIAS_DEFINIDAS.map(c => `<option value="${c}">${c}</option>`).join("");
    atualizarStepQtd();
}

// ============================================================
// SISTEMA DE TRANSAÇÕES
// ============================================================

let todasTransacoes = {};

// Popula select de ativos no modal de transação
function popularSelectAtivos() {
    const sel = document.getElementById('trans_ativo_select');
    if (!sel) return;
    const ativos = Object.entries(todosDados);
    sel.innerHTML = `<option value="">— SELECIONAR ATIVO —</option>` +
        ativos.map(([id, a]) => `<option value="${id}">${a.ticker} (${a.categoria})</option>`).join('');
}

// Lê transações do Firebase
onValue(ref(db, 'transacoes'), snap => {
    todasTransacoes = snap.val() || {};
    desenharGrafico('7d');
});

// Salvar nova transação
document.getElementById('formTransacao').onsubmit = async (e) => {
    e.preventDefault();
    const tipo = document.querySelector('input[name="tipo_transacao"]:checked').value;
    const ativoId = document.getElementById('trans_ativo_select').value;
    const data = document.getElementById('trans_data').value;
    const qtd = parseFloat(document.getElementById('trans_qtd').value) || 0;
    const preco = parseReal(document.getElementById('trans_preco').value);
    const obs = document.getElementById('trans_obs').value;

    if (!ativoId || !data || !qtd || !preco) return alert('Preencha todos os campos obrigatórios.');

    const ativo = todosDados[ativoId];
    await push(ref(db, 'transacoes'), {
        tipo, ativoId, ticker: ativo.ticker, categoria: ativo.categoria,
        seguimento: ativo.seguimento || '', data, quantidade: qtd,
        preco, total: qtd * preco, obs, criadoEm: Date.now()
    });

    // Grava snapshot do patrimônio atual
    await gravarSnapshot();

    toggleModal('modalTransacao');
    e.target.reset();
};

// Grava snapshot diário do patrimônio no Firebase
async function gravarSnapshot() {
    let totalGeral = 0;
    Object.values(todosDados).forEach(a => {
        const ehIntl = CATEGORIAS_INTERNACIONAIS.includes(a.categoria);
        const v = (a.quantidade || 0) * (a.valorUnitario || 0);
        totalGeral += ehIntl ? v * (cotacaoDolar || 1) : v;
    });
    const hoje = new Date().toISOString().split('T')[0];
    await set(ref(db, `snapshots/${hoje}`), { valor: totalGeral, ts: Date.now() });
}

// Ver transações de um ativo específico
window.verTransacoes = (ativoId, ticker) => {
    const modal = document.getElementById('modalVerTransacoes');
    document.getElementById('titulo-ver-trans').innerText = `Transações: ${ticker}`;
    const tbody = document.getElementById('tbody-ver-trans');
    tbody.innerHTML = '';

    const trans = Object.entries(todasTransacoes)
        .filter(([, t]) => t.ativoId === ativoId)
        .sort(([, a], [, b]) => new Date(b.data) - new Date(a.data));

    if (trans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400 font-bold text-xs uppercase">Nenhuma transação registrada para este ativo.</td></tr>`;
    } else {
        trans.forEach(([tid, t]) => {
            const corTipo = t.tipo === 'COMPRA' ? 'text-emerald-600 bg-emerald-50' : 'text-rose-600 bg-rose-50';
            tbody.innerHTML += `<tr class="hover:bg-slate-50 transition-colors">
                <td class="p-3 font-bold text-slate-700 text-xs">${t.data}</td>
                <td class="p-3 text-center"><span class="px-2 py-1 rounded-lg font-black text-[10px] uppercase ${corTipo}">${t.tipo}</span></td>
                <td class="p-3 text-center font-black text-xs text-slate-800">${t.quantidade}</td>
                <td class="p-3 text-center font-bold text-xs text-blue-600">${fmtCur(t.preco)}</td>
                <td class="p-3 text-right font-black text-xs text-slate-800">${fmtCur(t.total)}</td>
                <td class="p-3 text-xs text-slate-400">${t.obs || '--'}</td>
                <td class="p-3 text-center">
                    <button onclick="abrirEditTrans('${tid}')" class="text-blue-400 hover:text-blue-600 font-black text-sm mr-2 transition-colors">✏️</button>
                    <button onclick="deletarTrans('${tid}')" class="text-rose-400 hover:text-rose-600 font-black text-sm transition-colors">✕</button>
                </td>
            </tr>`;
        });
    }

    modal.classList.remove('opacity-0', 'pointer-events-none');
};

window.fecharVerTransacoes = () => {
    document.getElementById('modalVerTransacoes').classList.add('opacity-0', 'pointer-events-none');
};

// Abrir edição de transação
window.abrirEditTrans = (tid) => {
    const t = todasTransacoes[tid];
    if (!t) return;
    document.getElementById('edit_trans_id').value = tid;
    document.getElementById('edit_trans_data').value = t.data;
    document.getElementById('edit_trans_qtd').value = t.quantidade;
    document.getElementById('edit_trans_preco').value = t.preco.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    document.getElementById('edit_trans_obs').value = t.obs || '';
    document.getElementById('modalEditTrans').classList.remove('opacity-0', 'pointer-events-none');
};

window.fecharEditTrans = () => {
    document.getElementById('modalEditTrans').classList.add('opacity-0', 'pointer-events-none');
};

window.salvarEdicaoTrans = async () => {
    const tid = document.getElementById('edit_trans_id').value;
    const data = document.getElementById('edit_trans_data').value;
    const qtd = parseFloat(document.getElementById('edit_trans_qtd').value) || 0;
    const preco = parseReal(document.getElementById('edit_trans_preco').value);
    const obs = document.getElementById('edit_trans_obs').value;
    await update(ref(db, `transacoes/${tid}`), { data, quantidade: qtd, preco, total: qtd * preco, obs });
    fecharEditTrans();
};

window.deletarTrans = async (tid) => {
    if (!confirm('Excluir esta transação?')) return;
    await remove(ref(db, `transacoes/${tid}`));
    // Recarrega o modal de ver transações
    const t = todasTransacoes[tid];
    if (t) verTransacoes(t.ativoId, t.ticker);
};

// Abre modal de transação e pré-seleciona ativo se em visão detalhada
window.toggleModal = (id) => {
    const m = document.getElementById(id);
    if(m) {
        m.classList.toggle('opacity-0');
        m.classList.toggle('pointer-events-none');
        if (id === 'modalAtivo') {
            const overlay = document.getElementById('lock-overlay');
            const btn = document.getElementById('btn-salvar-ativo');
            const sel = document.getElementById('categoria_select');
            const form = document.getElementById('formInvestimento');
            if (overlay) overlay.style.display = 'flex';
            if (btn) { btn.disabled = true; btn.className = 'w-full bg-slate-300 text-slate-500 py-4 rounded-xl font-black uppercase mt-4 shadow-lg cursor-not-allowed transition-all'; }
            if (sel) sel.value = '';
            if (form) form.reset();
            const totalEl = document.getElementById('total_calculado');
            if (totalEl) totalEl.innerText = 'R$ 0,00';
            const suggBox = document.getElementById('suggestions');
            if (suggBox) suggBox.style.display = 'none';
            atualizarStepQtd();
        }
        if (id === 'modalTransacao' && !m.classList.contains('opacity-0')) {
            popularSelectAtivos();
            // Define hoje como data padrão
            document.getElementById('trans_data').value = new Date().toISOString().split('T')[0];
            // Se há categoria ativa, pré-seleciona primeiro ativo dela
            if (categoriaAtiva) {
                const sel = document.getElementById('trans_ativo_select');
                const ativosDaCat = Object.entries(todosDados).filter(([, a]) => a.categoria === categoriaAtiva);
                if (ativosDaCat.length > 0) sel.value = ativosDaCat[0][0];
            }
        }
    }
};

// ============================================================
// GRÁFICO DE EVOLUÇÃO
// ============================================================

let chartInstance = null;
let filtroAtual = '7d';

function filtrarPontos(snapshots, filtro) {
    const agora = new Date();
    const dias = filtro === '7d' ? 7 : filtro === '30d' ? 30 : 9999;
    const limite = new Date(agora);
    limite.setDate(limite.getDate() - dias);
    return Object.entries(snapshots)
        .filter(([data]) => new Date(data) >= limite)
        .sort(([a], [b]) => new Date(a) - new Date(b));
}

window.filtrarGrafico = (filtro) => {
    filtroAtual = filtro;
    document.querySelectorAll('.chart-filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.chart-filter-btn[onclick="filtrarGrafico('${filtro}')"]`)?.classList.add('active');
    desenharGrafico(filtro);
};

function desenharGrafico(filtro = filtroAtual) {
    const canvas = document.getElementById('graficoEvolucao');
    if (!canvas) return;

    // Junta snapshots salvos com o valor atual
    const snapshotsCompletos = { ...((window._snapshotsFirebase) || {}) };
    const hoje = new Date().toISOString().split('T')[0];
    let totalAtual = 0;
    Object.values(todosDados).forEach(a => {
        const ehIntl = CATEGORIAS_INTERNACIONAIS.includes(a.categoria);
        const v = (a.quantidade || 0) * (a.valorUnitario || 0);
        totalAtual += ehIntl ? v * (cotacaoDolar || 1) : v;
    });
    if (totalAtual > 0) snapshotsCompletos[hoje] = { valor: totalAtual };

    const pontos = filtrarPontos(snapshotsCompletos, filtro);

    if (pontos.length === 0) {
        if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Sem dados ainda. Registre transações para ver a evolução.', canvas.width / 2, canvas.height / 2);
        return;
    }

    const labels = pontos.map(([d]) => {
        const [y, m, dia] = d.split('-');
        return `${dia}/${m}`;
    });
    const valores = pontos.map(([, v]) => v.valor);
    const primeiro = valores[0] || 0;
    const ultimo = valores[valores.length - 1] || 0;
    const subindo = ultimo >= primeiro;
    const cor = subindo ? '#10b981' : '#f43f5e';

    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: valores,
                borderColor: cor,
                backgroundColor: subindo ? 'rgba(16,185,129,0.08)' : 'rgba(244,63,94,0.08)',
                borderWidth: 2.5,
                pointRadius: pontos.length > 15 ? 0 : 3,
                pointHoverRadius: 5,
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => fmtCur(ctx.parsed.y)
                    }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 9, weight: '700' }, color: '#94a3b8' } },
                y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 9 }, color: '#94a3b8', callback: v => 'R$' + (v >= 1000 ? (v/1000).toFixed(1)+'k' : v.toFixed(0)) } }
            }
        }
    });
}

// Lê snapshots do Firebase para o gráfico
onValue(ref(db, 'snapshots'), snap => {
    window._snapshotsFirebase = snap.val() || {};
    desenharGrafico(filtroAtual);
});