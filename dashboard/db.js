const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Caminho correto para o banco (na raiz do projeto)
const dbPath = path.join(__dirname, '../data.db');

// Conecta ao SQLite
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Erro ao abrir o banco SQLite:", err);
  } else {
    console.log("Banco SQLite carregado com sucesso:", dbPath);
  }
});

// Cria tabela se não existir (com avatar + approved)
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT,
      avatar TEXT,
      approved INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

module.exports = db;
