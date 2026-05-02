// ============================================================
//  BOT DE CONTROLE DE GASTOS — TELEGRAM
//  Dependências: npm install node-telegram-bot-api @supabase/supabase-js dotenv
// ============================================================

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ── Categorias e seus emojis ──────────────────────────────────
const CATEGORIES = {
  alimentacao: { label: 'Alimentação', emoji: '🍔', keywords: ['almoço', 'jantar', 'café', 'lanche', 'comida', 'ifood', 'restaurante', 'mercado', 'supermercado', 'padaria'] },
  transporte:  { label: 'Transporte',  emoji: '🚗', keywords: ['uber', 'taxi', 'gasolina', 'combustivel', 'onibus', 'metro', '99', 'passagem', 'estacionamento'] },
  casa:        { label: 'Casa',        emoji: '🏠', keywords: ['aluguel', 'condominio', 'luz', 'agua', 'gas', 'internet', 'conta', 'energia'] },
  saude:       { label: 'Saúde',       emoji: '💊', keywords: ['farmacia', 'remedio', 'medico', 'consulta', 'exame', 'academia', 'dentista'] },
  lazer:       { label: 'Lazer',       emoji: '🎮', keywords: ['netflix', 'spotify', 'cinema', 'bar', 'festa', 'viagem', 'jogo', 'streaming'] },
  roupas:      { label: 'Roupas',      emoji: '👕', keywords: ['roupa', 'sapato', 'camisa', 'calca', 'tenis', 'vestido', 'loja'] },
  receita:     { label: 'Receita',     emoji: '💰', keywords: ['salario', 'freelance', 'renda', 'pix recebido', 'transferencia recebida'] },
};

// ── Detecta categoria pela descrição ─────────────────────────
function detectCategory(desc) {
  const lower = desc.toLowerCase();
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    if (cat.keywords.some(k => lower.includes(k))) return key;
  }
  return 'outros';
}

// ── Parser de mensagem: "almoço 35" ou "35 almoço" ───────────
function parseMessage(text) {
  const cleaned = text.trim();

  // Padrão: número + descrição  OU  descrição + número
  const match = cleaned.match(/^(\d+[.,]?\d*)\s+(.+)$/) ||
                cleaned.match(/^(.+)\s+(\d+[.,]?\d*)$/);

  if (!match) return null;

  let amount, desc;
  if (/^\d/.test(match[1])) {
    amount = parseFloat(match[1].replace(',', '.'));
    desc   = match[2];
  } else {
    desc   = match[1];
    amount = parseFloat(match[2].replace(',', '.'));
  }

  if (isNaN(amount) || amount <= 0) return null;

  const isIncome = /^(\+|recebi|receita|salario|ganhei)/i.test(cleaned);
  const category = isIncome ? 'receita' : detectCategory(desc);

  return { amount, desc, category, type: isIncome ? 'income' : 'expense' };
}

// ── Formata valor em reais ────────────────────────────────────
function fmt(n) {
  return `R$ ${n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

// ── Salva transação no Supabase ───────────────────────────────
async function saveTransaction(chatId, { amount, desc, category, type }) {
  const cat = CATEGORIES[category] || { label: 'Outros', emoji: '📦' };
  const { error } = await supabase.from('transactions').insert({
    chat_id:   String(chatId),
    amount,
    description: desc,
    category,
    category_label: cat.label,
    category_emoji: cat.emoji,
    type,
    created_at: new Date().toISOString(),
  });
  return !error;
}

// ── Busca resumo do mês ───────────────────────────────────────
async function getMonthlySummary(chatId) {
  const start = new Date();
  start.setDate(1); start.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('chat_id', String(chatId))
    .gte('created_at', start.toISOString())
    .order('created_at', { ascending: false });

  if (error || !data) return null;

  const income  = data.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = data.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  // Agrupa por categoria
  const bycat = {};
  data.filter(t => t.type === 'expense').forEach(t => {
    const key = `${t.category_emoji} ${t.category_label}`;
    bycat[key] = (bycat[key] || 0) + t.amount;
  });

  return { income, expense, balance: income - expense, bycat, total: data.length };
}

// ── Busca últimas transações ──────────────────────────────────
async function getRecent(chatId, limit = 5) {
  const { data } = await supabase
    .from('transactions')
    .select('*')
    .eq('chat_id', String(chatId))
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

// ── Deleta última transação ───────────────────────────────────
async function deleteLastTransaction(chatId) {
  const { data } = await supabase
    .from('transactions')
    .select('id')
    .eq('chat_id', String(chatId))
    .order('created_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return false;

  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', data[0].id);

  return !error;
}

// ════════════════════════════════════════════════════════════
//  HANDLERS
// ════════════════════════════════════════════════════════════

bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || 'você';
  bot.sendMessage(msg.chat.id,
    `👋 Olá, *${name}!* Sou seu bot de controle de gastos.\n\n` +
    `*Como registrar um gasto:*\n` +
    `➜ \`Almoço 35\`\n` +
    `➜ \`50 gasolina\`\n` +
    `➜ \`Netflix 45,90\`\n\n` +
    `*Como registrar uma receita:*\n` +
    `➜ \`+3000 salário\`\n` +
    `➜ \`recebi 500 freelance\`\n\n` +
    `*Comandos:*\n` +
    `/resumo — resumo do mês\n` +
    `/ultimos — últimos 5 lançamentos\n` +
    `/desfazer — apaga o último lançamento\n` +
    `/ajuda — esta mensagem`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/ajuda/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `*📖 Como usar:*\n\n` +
    `Basta digitar o valor e a descrição em qualquer ordem:\n` +
    `\`Almoço 35\` ou \`35 almoço\`\n\n` +
    `Para receitas, comece com \`+\` ou \`recebi\`:\n` +
    `\`+3000 salário\`\n\n` +
    `*Categorias detectadas automaticamente:*\n` +
    `🍔 Alimentação · 🚗 Transporte · 🏠 Casa\n` +
    `💊 Saúde · 🎮 Lazer · 👕 Roupas`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/resumo/, async (msg) => {
  const summary = await getMonthlySummary(msg.chat.id);
  if (!summary) {
    return bot.sendMessage(msg.chat.id, '❌ Erro ao buscar dados. Tente novamente.');
  }
  if (summary.total === 0) {
    return bot.sendMessage(msg.chat.id, '📭 Nenhum lançamento este mês ainda.\n\nDigite algo como `Almoço 35` para começar!', { parse_mode: 'Markdown' });
  }

  const now = new Date();
  const mes = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  let catLines = '';
  const sorted = Object.entries(summary.bycat).sort((a, b) => b[1] - a[1]);
  sorted.forEach(([cat, val]) => {
    catLines += `  ${cat}: *${fmt(val)}*\n`;
  });

  const balSign = summary.balance >= 0 ? '+' : '';

  bot.sendMessage(msg.chat.id,
    `📊 *Resumo de ${mes}*\n\n` +
    `💚 Receitas: *${fmt(summary.income)}*\n` +
    `🔴 Gastos: *${fmt(summary.expense)}*\n` +
    `${summary.balance >= 0 ? '✅' : '⚠️'} Saldo: *${balSign}${fmt(summary.balance)}*\n\n` +
    (catLines ? `*Por categoria:*\n${catLines}` : ''),
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/ultimos/, async (msg) => {
  const txs = await getRecent(msg.chat.id, 5);
  if (txs.length === 0) {
    return bot.sendMessage(msg.chat.id, '📭 Nenhum lançamento ainda.');
  }

  let lines = '*🕐 Últimos lançamentos:*\n\n';
  txs.forEach(tx => {
    const signal = tx.type === 'income' ? '+' : '−';
    const date = new Date(tx.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    lines += `${tx.category_emoji} ${tx.description} — *${signal}${fmt(tx.amount)}*\n`;
    lines += `   _${date}_\n\n`;
  });

  bot.sendMessage(msg.chat.id, lines, { parse_mode: 'Markdown' });
});

bot.onText(/\/desfazer/, async (msg) => {
  const ok = await deleteLastTransaction(msg.chat.id);
  if (ok) {
    bot.sendMessage(msg.chat.id, '✅ Último lançamento apagado!');
  } else {
    bot.sendMessage(msg.chat.id, '❌ Nenhum lançamento para apagar.');
  }
});

// ── Handler principal: registra gastos ───────────────────────
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const parsed = parseMessage(msg.text);

  if (!parsed) {
    // Mensagem não reconhecida
    return bot.sendMessage(msg.chat.id,
      `🤔 Não entendi. Tente assim:\n\`Almoço 35\` ou \`35 gasolina\`\n\nDigite /ajuda para ver como usar.`,
      { parse_mode: 'Markdown' }
    );
  }

  const ok = await saveTransaction(msg.chat.id, parsed);

  if (!ok) {
    return bot.sendMessage(msg.chat.id, '❌ Erro ao salvar. Tente novamente.');
  }

  const cat = CATEGORIES[parsed.category] || { label: 'Outros', emoji: '📦' };
  const signal = parsed.type === 'income' ? '+' : '−';
  const typeLabel = parsed.type === 'income' ? 'Receita' : 'Gasto';

  bot.sendMessage(msg.chat.id,
    `${cat.emoji} *${typeLabel} registrado!*\n\n` +
    `📝 ${parsed.desc}\n` +
    `💵 *${signal}${fmt(parsed.amount)}*\n` +
    `🏷 ${cat.label}\n\n` +
    `_Digite /resumo para ver o mês._`,
    { parse_mode: 'Markdown' }
  );
});

console.log('🤖 Bot de gastos rodando...');
