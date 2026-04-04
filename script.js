import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, push, onValue, remove, set } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyCaVDJ4LtJu-dlvSi4QrDygfhx1hBGSdDM",
    authDomain: "banco-de-dados-invest.firebaseapp.com",
    databaseURL: "https://banco-de-dados-invest-default-rtdb.firebaseio.com",
    projectId: "banco-de-dados-invest"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const BRAPI_TOKEN = "1EG6ybrvNVpDimcMwbtYwn";

const CATEGORIAS_DEFINIDAS = ["AÇÕES", "FIIS", "FIAGRO", "STOKS", "REITS", "ETF BRASIL", "ETF EXTERIOR", "CRIPTOMOEDAS", "TESOURO DIRETO"];
const CATEGORIAS_INTERNACIONAIS = ["STOKS", "REITS", "ETF EXTERIOR", "CRIPTOMOEDAS"];

let todosDados = {}, todasMetas = {};

// --- CONTROLE DE MODAL ---
window.toggleModal = (id) => {
    const el = document.getElementById(id);
    el.classList.toggle('pointer-events-none');
    el.classList.toggle('opacity-0');
};

// --- FUNÇÕES DA TABELA ---
window.editarMeta = (cat) => {
    const nova = prompt(`Meta % para ${cat}:`, todasMetas[cat] || 0);
    if (nova !== null) set(ref(db, `metas/${cat}`), parseFloat(nova.replace(',', '.')));
};

window.verDetalhes = (cat) => {
    const corpo = document.getElementById('corpoDetalhes');
    document.getElementById('tituloDetalhe').innerText = cat;
    corpo.innerHTML = "";
    Object.entries(todosDados).forEach(([id, a]) => {
        if (a.categoria === cat) {
            corpo.innerHTML += `
                <div class="flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border-l-4 border-blue-600">
                    <div><p class="font-black text-blue-600">${a.ticker}</p><p class="text-[10px] text-slate-400">${a.quantidade} UN</p></div>
                    <button onclick="excluirAtivo('${id}')" class="text-rose-500 font-bold px-2">✕</button>
                </div>`;
        }
    });
    toggleModal('modalDetalhes');
};

window.excluirAtivo = (id) => { if(confirm("Excluir?")) remove(ref(db, `investimentos/${id}`)); };

// --- RENDERIZAÇÃO ---
onValue(ref(db), s => {
    const d = s.val() || {};
    todosDados = d.investimentos || {};
    todasMetas = d.metas || {};
    
    let totalGeral = 0;
    const resumo = {};
    Object.values(todosDados).forEach(a => {
        const v = (a.quantidade || 0) * (a.valorUnitario || 0);
        totalGeral += v;
        resumo[a.categoria] = (resumo[a.categoria] || 0) + v;
    });

    document.getElementById('patrimonio-exibido').innerText = totalGeral.toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
    const corpo = document.getElementById('tabelaCorpo');
    corpo.innerHTML = "";

    CATEGORIAS_DEFINIDAS.forEach(cat => {
        const val = resumo[cat] || 0;
        const meta = todasMetas[cat] || 0;
        const pct = totalGeral > 0 ? (val / totalGeral * 100) : 0;
        corpo.innerHTML += `
            <tr>
                <td class="p-5 text-center"><button onclick="verDetalhes('${cat}')" class="bg-blue-100 text-blue-600 w-9 h-9 rounded-xl hover:bg-blue-600 hover:text-white transition-all">🔍</button></td>
                <td class="p-5 text-slate-700">${cat}</td>
                <td class="p-5 text-center"><button onclick="editarMeta('${cat}')" class="bg-slate-50 px-3 py-1 rounded-lg text-blue-600 border">${meta}%</button></td>
                <td class="p-5 text-center ${pct < meta ? 'text-rose-500' : 'text-emerald-500'}">${pct.toFixed(1)}%</td>
                <td class="p-5 text-right font-black">${val.toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}</td>
            </tr>`;
    });
    
    const catSel = document.getElementById('categoria_select');
    const cur = catSel.value;
    catSel.innerHTML = '<option value="" disabled selected>Selecionar...</option>' + CATEGORIAS_DEFINIDAS.map(c => `<option value="${c}" ${c === cur ? 'selected' : ''}>${c}</option>`).join("");
});

// --- BUSCA E SALVAMENTO DE ATIVOS (COM AJUSTES DO POP-UP) ---
document.getElementById('ticker').addEventListener('input', async (e) => {
    const q = e.target.value.toUpperCase().trim();
    const box = document.getElementById('suggestions');
    const cat = document.getElementById('categoria_select').value;
    const ehInter = CATEGORIAS_INTERNACIONAIS.includes(cat);

    if (q.length < 2) { box.style.display = 'none'; return; }
    
    try {
        const res = await fetch(`https://brapi.dev/api/quote/list?search=${q}&token=${BRAPI_TOKEN}`);
        const data = await res.json();
        
        // Inicia o HTML. Se for internacional, coloca o "BUSCAR GLOBAL" em azul no topo
        let h = ehInter ? `
            <div class="suggestion-item suggestion-global text-blue-600 bg-blue-50" onclick="selectAsset('${q}')">
                <span class="ticker-name italic font-black">BUSCAR GLOBAL: ${q}</span>
            </div>` : "";
        
        if (data.stocks) {
            data.stocks.slice(0, 5).forEach(s => {
                // Filtro para não mostrar BDRs (terminam em número) quando for busca internacional
                if (ehInter && /\d$/.test(s.stock)) return;
                
                // Filtro para mostrar ativos BR (com números) se não for internacional
                if (!ehInter && !/\d$/.test(s.stock) && cat !== "CRIPTOMOEDAS") return;

                h += `
                    <div class="suggestion-item" onclick="selectAsset('${s.stock}')">
                        <span class="ticker-name font-black">${s.stock}</span>
                        <span class="company-name text-[9px] text-slate-400 font-bold ml-2">${s.name || ''}</span>
                    </div>`;
            });
        }
        
        box.innerHTML = h;
        box.style.display = h ? 'block' : 'none';
    } catch (err) {
        console.error("Erro na busca:", err);
    }
});

window.selectAsset = async (t) => {
    document.getElementById('ticker').value = t;
    document.getElementById('suggestions').style.display = 'none';
    const r = await fetch(`https://brapi.dev/api/quote/${t}?token=${BRAPI_TOKEN}`);
    const d = await r.json();
    if (d.results?.[0]) {
        const preco = d.results[0].regularMarketPrice;
        document.getElementById('valor_unit_input').value = preco.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    }
};

document.getElementById('formInvestimento').onsubmit = (e) => {
    e.preventDefault();
    push(ref(db, 'investimentos'), {
        ticker: document.getElementById('ticker').value.toUpperCase(),
        categoria: document.getElementById('categoria_select').value,
        quantidade: parseFloat(document.getElementById('quantidade_input').value),
        valorUnitario: parseFloat(document.getElementById('valor_unit_input').value.replace(/\./g, '').replace(',', '.'))
    });
    toggleModal('modalAtivo');
    e.target.reset(); // Limpa o formulário após salvar
};

// Fecha sugestões ao clicar fora
document.addEventListener('click', (e) => {
    const tickerInput = document.getElementById('ticker');
    const suggestionsBox = document.getElementById('suggestions');
    if (!tickerInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
        suggestionsBox.style.display = 'none';
    }
});