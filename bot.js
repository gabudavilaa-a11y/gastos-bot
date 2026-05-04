const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

// ── Configuração ─────────────────────────────────────────────
const TOKEN = process.env.TELEGRAM_TOKEN;
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_KEY;

console.log('TOKEN:', TOKEN ? 'OK' : 'FALTANDO');
console.log('SUPABASE_URL:', SUPA_URL ? SUPA_URL : 'FALTANDO');
console.log('SUPABASE_KEY:', SUPA_KEY ? 'OK' : 'FALTANDO');

const bot = new TelegramBot(TOKEN, { polling: true });
const supabase = createClient(SUPA_URL, SUPA_KEY);

function parseMessage(text) {
  const cleaned = text.trim();
  const match = cleaned.match(/^(\d+[.,]?\d*)\s+(.+)$/) ||
                cleaned.match(/^(.+)\s+(\d+[.,]?\d*)$/);
  if (!match) return null;

  let amount, desc;
  if (/^\d/.test(match[1])) {
    amount = parseFloat(match[1].replace(',', '.'));
    desc = match[2];
  } else {
    desc = match[1];
    amount = parseFloat(match[2].replace(',', '.'));
  }

  if (isNaN(amount) || amount <= 0) return null;

  const isIncome = /^(\+|recebi|receita|salario|ganhei)/i.test(cleaned);
  return {
    amount, desc,
    type: isIncome ? 'income' : 'expense',
    category: isIncome ? 'receita' : 'outros',
    category_label: isIncome ? 'Receita' : 'Outros',
    category_emoji: isIncome ? '💰' : '📦',
  };
}

function fmt(n) {
  return 'R$ ' + parseFloat(n).toFixed(2).replace('.', ',');
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `👋 Olá! Sou seu bot de gastos.\n\nDigite algo como:\n*Almoço 35*\n*50 gasolina*\n*+3000 salário*\n\nComandos: /resumo /ultimos /desfazer`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/resumo/, async (msg) => {
  const start = new Date();
  start.setDate(1); start.setHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('chat_id', String(msg.chat.id))
    .gte('created_at', start.toISOString());
  if (error) { console.log('ERRO RESUMO:', JSON.stringify(error)); return bot.sendMessage(msg.chat.id, '❌ Erro ao buscar dados.'); }
  if (!data || data.length === 0) return bot.sendMessage(msg.chat.id, '📭 Nenhum lançamento este mês.');
  const income = data.filter(t => t.type === 'income').reduce((s, t) => s + +t.amount, 0);
  const expense = data.filter(t => t.type === 'expense').reduce((s, t) => s + +t.amount, 0);
  bot.sendMessage(msg.chat.id, `📊 *Resumo*\n\n💚 Receitas: *${fmt(income)}*\n🔴 Gastos: *${fmt(expense)}*\n${income-expense >= 0 ? '✅' : '⚠️'} Saldo: *${fmt(income-expense)}*`, { parse_mode: 'Markdown' });
});

bot.onText(/\/ultimos/, async (msg) => {
  const { data } = await supabase.from('transactions').select('*').eq('chat_id', String(msg.chat.id)).order('created_at', { ascending: false }).limit(5);
  if (!data || data.length === 0) return bot.sendMessage(msg.chat.id, '📭 Nenhum lançamento ainda.');
  let lines = '*Últimos:*\n\n';
  data.forEach(tx => { lines += `${tx.category_emoji} ${tx.description} — *${tx.type === 'income' ? '+' : '−'}${fmt(tx.amount)}*\n`; });
  bot.sendMessage(msg.chat.id, lines, { parse_mode: 'Markdown' });
});

bot.onText(/\/desfazer/, async (msg) => {
  const { data } = await supabase.from('transactions').select('id').eq('chat_id', String(msg.chat.id)).order('created_at', { ascending: false }).limit(1);
  if (!data || data.length === 0) return bot.sendMessage(msg.chat.id, '❌ Nenhum lançamento para apagar.');
  await supabase.from('transactions').delete().eq('id', data[0].id);
  bot.sendMessage(msg.chat.id, '✅ Último lançamento apagado!');
});

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const parsed = parseMessage(msg.text);
  if (!parsed) return bot.sendMessage(msg.chat.id, `🤔 Não entendi. Tente: *Almoço 35*`, { parse_mode: 'Markdown' });

  console.log('Salvando:', JSON.stringify({ ...parsed, chat_id: msg.chat.id }));

  const { error } = await supabase.from('transactions').insert({
    chat_id: String(msg.chat.id),
    amount: parsed.amount,
    description: parsed.desc,
    category: parsed.category,
    category_label: parsed.category_label,
    category_emoji: parsed.category_emoji,
    type: parsed.type,
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.log('ERRO AO SALVAR:', JSON.stringify(error));
    return bot.sendMessage(msg.chat.id, `❌ Erro: ${error.message}`);
  }

  bot.sendMessage(msg.chat.id,
    `${parsed.category_emoji} *${parsed.type === 'income' ? 'Receita' : 'Gasto'} registrado!*\n\n📝 ${parsed.desc}\n💵 *${parsed.type === 'income' ? '+' : '−'}${fmt(parsed.amount)}*`,
    { parse_mode: 'Markdown' }
  );
});

console.log('🤖 Bot de gastos rodando...');
