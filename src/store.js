const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');
const storePath = path.join(dataDir, 'store.json');

function ensureStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify({ nextTicketNumber: 1, tickets: {} }, null, 2));
  }
}

function readStore() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('Format penyimpanan tidak valid.');
    if (!parsed.tickets || typeof parsed.tickets !== 'object') parsed.tickets = {};
    if (!Number.isInteger(parsed.nextTicketNumber) || parsed.nextTicketNumber < 1) parsed.nextTicketNumber = 1;
    return parsed;
  } catch (error) {
    throw new Error(`Gagal membaca ${storePath}: ${error.message}`);
  }
}

let data = readStore();

function writeStore() {
  ensureStore();
  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, storePath);
}

function nextTicketNumber() {
  const number = data.nextTicketNumber;
  data.nextTicketNumber += 1;
  writeStore();
  return String(number).padStart(4, '0');
}

function getTicket(channelId) {
  return data.tickets[channelId] || null;
}

function getAllTickets() {
  return Object.values(data.tickets);
}

function findTicketByUser(guildId, userId) {
  return getAllTickets().find((ticket) => ticket.guildId === guildId && ticket.userId === userId) || null;
}

function saveTicket(ticket) {
  data.tickets[ticket.channelId] = ticket;
  writeStore();
}

function removeTicket(channelId) {
  if (data.tickets[channelId]) {
    delete data.tickets[channelId];
    writeStore();
  }
}

module.exports = {
  nextTicketNumber,
  getTicket,
  getAllTickets,
  findTicketByUser,
  saveTicket,
  removeTicket,
};
