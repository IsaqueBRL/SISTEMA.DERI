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

const fmtCur = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtUSD = (v) => '$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseReal = (s) => typeof s === 'number' ? s : parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;

// --- BUSCA COTAÇÃO DO DÓLAR ---
async function buscarCotacaoDolar() {
    try {
        const r = await fetch(`https://brapi.dev/api/quote/USDBRL=X?token=${BRAPI_TOKEN}`);
        const d = await r.json();
        if (d.results && d.results[0]) {
            cotacaoDolar = d.results[0].regularMarketPrice || 0;
        }
    } catch(e) { console.error("Erro ao buscar dólar:", e); }
}
buscarCotacaoDolar();

// --- ATUALIZAÇÃO AUTOMÁTICA DE PREÇOS ---
// Regra 1: Executa ao abrir o site
// Regra 2: Repete a cada 10 minutos enquanto o site estiver aberto
const INTERVALO_ATUALIZACAO = 10 * 60 * 1000; // 10 minutos em ms

async function atualizarTodosOsPrecos() {
    const ativos = Object.entries(todosDados);
    if (ativos.length === 0) return;

    // Atualiza status na navbar
    const indicator = document.getElementById('sync-indicator');
    const statusEl = document.getElementById('update-status');
    if (indicator) indicator.classList.add('updating');
    if (statusEl) statusEl.innerText = 'Atualizando preços...';

    // Coleta tickers únicos por grupo (BR e Internacional)
    const tickersBR = [], tickersIntl = [];
    ativos.forEach(([, a]) => {
        const ehIntl = CATEGORIAS_INTERNACIONAIS.includes(a.categoria);
        if (ehIntl) { if (!tickersIntl.includes(a.ticker)) tickersIntl.push(a.ticker); }
        else { if (!tickersBR.includes(a.ticker)) tickersBR.push(a.ticker); }
    });

    const precos = {}; // { TICKER: preco }

    // Busca BR em lote
    if (tickersBR.length > 0) {
        try {
            const r = await fetch(`https://brapi.dev/api/quote/${tickersBR.join(',')}?token=${BRAPI_TOKEN}`);
            const d = await r.json();
            if (d.results) d.results.forEach(item => { precos[item.symbol] = item.regularMarketPrice; });
        } catch(e) { console.error("Erro ao atualizar preços BR:", e); }
    }

    // Busca Internacional em lote
    if (tickersIntl.length > 0) {
        try {
            const r = await fetch(`https://brapi.dev/api/quote/${tickersIntl.join(',')}?token=${BRAPI_TOKEN}`);
            const d = await r.json();
            if (d.results) d.results.forEach(item => { precos[item.symbol] = item.regularMarketPrice; });
        } catch(e) { console.error("Erro ao atualizar preços Intl:", e); }
    }

    // Atualiza o Firebase com os novos preços
    const updates = {};
    ativos.forEach(([id, a]) => {
        if (precos[a.ticker] !== undefined) {
            updates[`investimentos/${id}/valorUnitario`] = precos[a.ticker];
        }
    });

    if (Object.keys(updates).length > 0) {
        try {
            await update(ref(db), updates);
        } catch(e) { console.error("Erro ao salvar preços no Firebase:", e); }
    }

    // Atualiza também a cotação do dólar junto
    await buscarCotacaoDolar();

    // Restaura status
    const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (indicator) indicator.classList.remove('updating');
    if (statusEl) statusEl.innerText = `Atualizado às ${agora}`;

    // Volta ao texto padrão após 5 segundos
    setTimeout(() => { if (statusEl) statusEl.innerText = 'Sistema Online'; }, 5000);
}

// Executa ao carregar (aguarda Firebase sincronizar primeiro)
// O onValue já dispara ao conectar, então rodamos após o primeiro sync
let primeiroSyncFeito = false;

// Intervalo de 10 minutos
setInterval(atualizarTodosOsPrecos, INTERVALO_ATUALIZACAO);

// --- NAVEGAÇÃO ---
window.toggleModal = (id) => {
    const m = document.getElementById(id);
    if(m) {
        m.classList.toggle('opacity-0');
        m.classList.toggle('pointer-events-none');
        // Ao abrir o modal de novo ativo, garante estado bloqueado
        if (id === 'modalAtivo' && !m.classList.contains('opacity-0')) {
            const overlay = document.getElementById('lock-overlay');
            const btn = document.getElementById('btn-salvar-ativo');
            if (overlay) overlay.style.display = 'flex';
            if (btn) {
                btn.disabled = true;
                btn.className = 'w-full bg-slate-300 text-slate-500 py-4 rounded-xl font-black uppercase mt-4 shadow-lg cursor-not-allowed transition-all';
            }
        }
    }
};

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

tickerIn?.addEventListener('input', async (e) => {
    const q = e.target.value.toUpperCase().trim();
    const categoriaSelecionada = catSelect.value;
    const ehInternacional = CATEGORIAS_INTERNACIONAIS.includes(categoriaSelecionada);

    if (q.length < 2) return;
    
    try {
        const res = await fetch(`https://brapi.dev/api/quote/list?search=${q}&token=${BRAPI_TOKEN}`);
        const data = await res.json();
        let h = "";
        
        if (ehInternacional) {
            h += `<div class="suggestion-item border-b-2 border-blue-100 bg-blue-50" onclick="selectAsset('${q}')">
                    <span class="font-black text-blue-600">BUSCAR ATIVO GLOBAL: ${q}</span>
                 </div>`;
        }

        if (data.stocks) {
            data.stocks.slice(0, 5).forEach(s => {
                h += `<div class="suggestion-item" onclick="selectAsset('${s.stock}')">
                        <span class="font-black">${s.stock}</span> 
                        <span class="text-[9px] text-slate-400 ml-2">${s.name || ''}</span>
                      </div>`;
            });
        }
        const suggBox = document.getElementById('suggestions');
        if(suggBox) { suggBox.innerHTML = h; suggBox.style.display = 'block'; }
    } catch (err) { console.error("Erro na busca:", err); }
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
                <td class="p-4 text-center"><button onclick="openCat('${cat}')" class="bg-blue-600 text-white w-8 h-8 rounded-lg text-xs">🔍</button></td>
                <td class="p-4">${cat}</td>
                <td class="p-4 text-center"><span contenteditable="true" onblur="svMeta('${cat}', this.innerText)" class="bg-blue-50 px-2 py-1 rounded font-black">${metaPct}</span>%</td>
                <td class="p-4 text-center ${atualPct < metaPct ? 'text-rose-500' : 'text-emerald-600'}">${atualPct.toFixed(1)}%</td>
                <td class="p-4 text-right font-bold">${fmtCur(valAtual)}</td>
                <td class="p-4 text-right font-black ${sugestao > 1 ? 'text-emerald-500' : 'text-slate-300'}">${sugestao > 1 ? fmtCur(sugestao) : '--'}</td>
            </tr>`;
        }
    });

    if (categoriaAtiva) renderizarDetalhes(totalCatAtiva);
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
            <th class="p-4">Ativo ⇅</th>
            <th class="p-4">Seguimento ⇅</th>
            <th class="p-4 text-center">Qtd ⇅</th>
            <th class="p-4 text-center text-amber-500">Preço (USD) ⇅</th>
            <th class="p-4 text-center">Peso % ⇅</th>
            <th class="p-4 text-right text-amber-500">Total USD ⇅</th>
            <th class="p-4 text-right text-emerald-600">Total BRL ⇅</th>
            <th class="p-4 text-center">Ação</th>
        </tr>`;
    } else {
        dolarBadge.classList.add('hidden');
        thead.innerHTML = `<tr>
            <th class="p-4">Ativo ⇅</th>
            <th class="p-4">Seguimento ⇅</th>
            <th class="p-4 text-center">Qtd ⇅</th>
            <th class="p-4 text-center">Preço ⇅</th>
            <th class="p-4 text-center">Peso % ⇅</th>
            <th class="p-4 text-right">Total ⇅</th>
            <th class="p-4 text-center">Ação</th>
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
                <td class="p-4 font-black">${atv.ticker}</td>
                <td class="p-4"><select onchange="updateAtv('${atv.id}', 'seguimento', this.value)" class="bg-slate-100 p-1 rounded text-[10px] w-full font-bold outline-none">${opt}</select></td>
                <td class="p-4 text-center"><span contenteditable="true" onblur="updateAtv('${atv.id}', 'quantidade', this.innerText)" class="bg-slate-50 px-2 py-1 rounded font-black">${atv.quantidade}</span></td>
                <td class="p-4 text-center font-bold text-amber-600">${fmtUSD(atv.valorUnitario)}</td>
                <td class="p-4 text-center text-blue-600">${peso.toFixed(1)}%</td>
                <td class="p-4 text-right font-bold text-amber-500">${fmtUSD(atv.totalUSD)}</td>
                <td class="p-4 text-right font-black italic text-emerald-600">${fmtCur(atv.totalBRL)}</td>
                <td class="p-4 text-center"><button onclick="askRmAtv('${atv.id}', '${atv.ticker}')" class="text-rose-400">✕</button></td>
            </tr>`;
        } else {
            tAtv.innerHTML += `<tr>
                <td class="p-4 font-black">${atv.ticker}</td>
                <td class="p-4"><select onchange="updateAtv('${atv.id}', 'seguimento', this.value)" class="bg-slate-100 p-1 rounded text-[10px] w-full font-bold outline-none">${opt}</select></td>
                <td class="p-4 text-center"><span contenteditable="true" onblur="updateAtv('${atv.id}', 'quantidade', this.innerText)" class="bg-slate-50 px-2 py-1 rounded font-black">${atv.quantidade}</span></td>
                <td class="p-4 text-center font-bold">${fmtCur(atv.valorUnitario)}</td>
                <td class="p-4 text-center text-blue-600">${peso.toFixed(1)}%</td>
                <td class="p-4 text-right font-black italic">${fmtCur(atv.totalBRL)}</td>
                <td class="p-4 text-center"><button onclick="askRmAtv('${atv.id}', '${atv.ticker}')" class="text-rose-400">✕</button></td>
            </tr>`;
        }
    });

    Object.entries(planejamSetores[categoriaAtiva] || {}).forEach(([sid, s]) => {
        const val = ativosDaCat.filter(a => a.seguimento === s.nome).reduce((acc, a) => acc + a.totalBRL, 0);
        const atual = totalCat > 0 ? (val / totalCat * 100) : 0;
        const sug = Math.max(0, (totalCat * (s.meta / 100)) - val);
        
        tPlan.innerHTML += `<tr>
            <td class="p-4 font-bold"><span contenteditable="true" onblur="updateSeg('${sid}', 'nome', this.innerText)">${s.nome}</span></td>
            <td class="p-4 text-center"><span contenteditable="true" onblur="updateSeg('${sid}', 'meta', this.innerText)" class="bg-blue-50 px-2 py-1 rounded font-black">${s.meta}</span>%</td>
            <td class="p-4 text-center">${atual.toFixed(1)}%</td>
            <td class="p-4 text-right">${fmtCur(val)}</td>
            <td class="p-4 text-right text-emerald-500 font-black">${sug > 1 ? fmtCur(sug) : '--'}</td>
            <td class="p-4 text-center"><button onclick="askRmSeg('${sid}', '${s.nome}')" class="text-rose-300 text-[10px]">✕</button></td>
        </tr>`;
    });
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
    sel.innerHTML = CATEGORIAS_DEFINIDAS.map(c => `<option value="${c}">${c}</option>`).join("");
    atualizarStepQtd();
}