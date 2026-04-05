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

const fmtCur = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const parseReal = (s) => typeof s === 'number' ? s : parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;

// --- NAVEGAÇÃO ---
window.toggleModal = (id) => {
    const m = document.getElementById(id);
    if(m) {
        m.classList.toggle('opacity-0');
        m.classList.toggle('pointer-events-none');
    }
};

window.closeConfirm = () => { window.toggleModal('confirmModal'); pendingAction = null; };

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
    popularSelectCategorias(); // Atualiza o select do modal de novo ativo
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

    // 1. Calcula totais por categoria
    Object.values(todosDados).forEach(a => {
        const v = (a.quantidade || 0) * (a.valorUnitario || 0);
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
    if(!tPlan || !tAtv) return;
    tPlan.innerHTML = ""; tAtv.innerHTML = "";
    
    const ativosDaCat = Object.entries(todosDados)
        .filter(([id, a]) => a.categoria === categoriaAtiva)
        .map(([id, a]) => ({ id, ...a, total: a.quantidade * a.valorUnitario }));
    
    ativosDaCat.forEach(atv => {
        const peso = totalCat > 0 ? (atv.total / totalCat * 100) : 0;
        let opt = `<option value="">ESCOLHER...</option>`;
        Object.values(planejamSetores[categoriaAtiva] || {}).forEach(s => {
            opt += `<option value="${s.nome}" ${atv.seguimento === s.nome ? 'selected' : ''}>${s.nome}</option>`;
        });

        tAtv.innerHTML += `<tr>
            <td class="p-4 font-black">${atv.ticker}</td>
            <td class="p-4"><select onchange="updateAtv('${atv.id}', 'seguimento', this.value)" class="bg-slate-100 p-1 rounded text-[10px] w-full font-bold outline-none">${opt}</select></td>
            <td class="p-4 text-center"><span contenteditable="true" onblur="updateAtv('${atv.id}', 'quantidade', this.innerText)" class="bg-slate-50 px-2 py-1 rounded font-black">${atv.quantidade}</span></td>
            <td class="p-4 text-center font-bold">${fmtCur(atv.valorUnitario)}</td>
            <td class="p-4 text-center text-blue-600">${peso.toFixed(1)}%</td>
            <td class="p-4 text-right font-black italic">${fmtCur(atv.total)}</td>
            <td class="p-4 text-center"><button onclick="askRmAtv('${atv.id}', '${atv.ticker}')" class="text-rose-400">✕</button></td>
        </tr>`;
    });

    Object.entries(planejamSetores[categoriaAtiva] || {}).forEach(([sid, s]) => {
        const val = ativosDaCat.filter(a => a.seguimento === s.nome).reduce((acc, a) => acc + a.total, 0);
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
    window.toggleModal('modalAtivo'); e.target.reset();
};

function popularSelectCategorias() {
    const sel = document.getElementById('categoria_select');
    if (!sel) return;
    // O select de novos ativos sempre mostra todas as opções para você poder começar uma nova categoria
    sel.innerHTML = CATEGORIAS_DEFINIDAS.map(c => `<option value="${c}">${c}</option>`).join("");
}