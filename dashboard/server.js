require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch'); // se estiver em Node >=18 pode usar global fetch
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const realtime = require('../realtime');
const bot = require('../index');
const db = require("./db");
const { readEnv, writeEnv } = require('./config');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
realtime.setIO(io);

app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false
  })
);

const ROOT_ENV_PATH = path.join(__dirname, '..', '.env');
const DASH_ENV_PATH = path.join(__dirname, '.env');

// Middleware - exige login
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// Middleware - exige aprovado
function requireApproved(req, res, next) {
  if (!req.session.user || req.session.approved !== true) {
    return res.redirect('/login');
  }
  next();
}

app.get('/login', (req, res) => {
  res.render('login', { client_id: process.env.CLIENT_ID });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// OAuth Discord (link)
app.get('/auth', (req, res) => {
  const redirectUri = encodeURIComponent(process.env.REDIRECT_URI || 'http://localhost:3000/callback');
  res.redirect(
    `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds`
  );
});

// Helpers para OAuth usando fetch
async function exchangeCodeForToken(code) {
  const data = new URLSearchParams();
  data.append('client_id', process.env.CLIENT_ID);
  data.append('client_secret', process.env.CLIENT_SECRET);
  data.append('grant_type', 'authorization_code');
  data.append('code', code);
  data.append('redirect_uri', process.env.REDIRECT_URI || 'http://localhost:3000/callback');

  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    body: data,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  if (!res.ok) {
    const txt = await res.text();
    const err = new Error(`Token exchange failed: ${res.status} ${txt}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

async function fetchDiscordUser(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const txt = await res.text();
    const err = new Error(`Fetch user failed: ${res.status} ${txt}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Callback OAuth
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('No code');

  try {
    const tokenJson = await exchangeCodeForToken(code);
    if (!tokenJson?.access_token) {
      console.error('No access_token in token response', tokenJson);
      return res.status(500).send('OAuth token error');
    }

    const userJson = await fetchDiscordUser(tokenJson.access_token);
    if (!userJson || !userJson.id) {
      console.error('Invalid user data', userJson);
      return res.status(500).send('OAuth user error');
    }

    // montar username com discriminator (mais informativo)
    const username = userJson.discriminator ? `${userJson.username}#${userJson.discriminator}` : userJson.username;
    const avatar = userJson.avatar
      ? `https://cdn.discordapp.com/avatars/${userJson.id}/${userJson.avatar}.png`
      : null;

    // Verifica no banco (sqlite3 assíncrono)
    db.get("SELECT * FROM users WHERE id = ?", [userJson.id], (err, row) => {
      if (err) {
        console.error('DB SELECT error:', err);
        return res.status(500).send("Erro ao consultar banco");
      }

      // Usuário novo → inserir como pendente
      if (!row) {
        db.run(
          "INSERT INTO users (id, username, avatar, approved) VALUES (?, ?, ?, ?)",
          [userJson.id, username, avatar, 0],
          function (insertErr) {
            if (insertErr) {
              console.error('DB INSERT error:', insertErr);
              return res.status(500).send("Erro ao salvar usuário");
            }

            // retorna página informando pendência
            return res.send(`
              <h1>Acesso Pendente</h1>
              <p>Seu usuário foi registrado, mas aguarda aprovação.</p>
              <a href="/login">Voltar</a>
            `);
          }
        );
        return;
      }

      // Usuário existe — verifica approved
      // note: approved é integer 0/1
      if (row.approved === 0) {
        return res.send(`
          <h1>Acesso negado</h1>
          <p>Aguarde um administrador aprovar.</p>
          <a href="/login">Voltar</a>
        `);
      }

      // Aprovado → cria sessão
      req.session.user = row;
      req.session.approved = true;
      return res.redirect('/');
    });

  } catch (e) {
    console.error('OAuth callback error:', e);
    return res.status(500).send('OAuth error');
  }
});

// Dashboard
app.get('/', requireApproved, (req, res) => {
  res.render('dashboard', { user: req.session.user, config: {} });
});

// Streamers (usa bot cache quando disponível)
app.get('/streamers', requireApproved, async (req, res) => {
  const guild = bot?.guilds?.cache?.first();
  let online = [], streaming = [];

  if (guild) {
    try {
      await guild.members.fetch();
      online = guild.members.cache
        .filter(m => m.presence && m.presence.status === 'online')
        .map(m => m.displayName || m.user.username);

      streaming = guild.members.cache
        .filter(m => m.presence?.activities?.some(a => a.type === 1))
        .map(m => m.displayName || m.user.username);
    } catch (err) {
      console.error('Erro ao buscar membros do guild:', err);
    }
  }

  res.render('streaming', { user: req.session.user, online, streaming });
});

// Admin: listar usuários
app.get("/admin/users", requireApproved, (req, res) => {
  const admins = (process.env.ADMIN_IDS || "").split(",").filter(Boolean);

  if (!admins.includes(String(req.session.user.id))) {
    return res.status(403).send("Sem permissão");
  }

  db.all("SELECT * FROM users", [], (err, rows) => {
    if (err) {
      console.error('DB ALL error:', err);
      return res.status(500).send("Erro ao consultar banco");
    }
    res.render("admin_users", { users: rows });
  });
});

// Admin Settings (.env)
app.get('/admin/settings', requireApproved, (req, res) => {
  const admins = (process.env.ADMIN_IDS || "").split(",").filter(Boolean);
  if (!admins.includes(String(req.session.user.id))) {
    return res.status(403).send("Sem permissão");
  }

  const root = readEnv(ROOT_ENV_PATH).map;
  const dash = readEnv(DASH_ENV_PATH).map;

  const entries = [
    { key: 'DISCORD_TOKEN', file: ROOT_ENV_PATH, fileLabel: 'Raiz .env', value: root.DISCORD_TOKEN || '', secret: true, requiresRestart: true },
    { key: 'STREAM_ANNOUNCE_CHANNEL', file: ROOT_ENV_PATH, fileLabel: 'Raiz .env', value: root.STREAM_ANNOUNCE_CHANNEL || '', secret: false, requiresRestart: false },
    { key: 'STREAMER_ROLE', file: ROOT_ENV_PATH, fileLabel: 'Raiz .env', value: root.STREAMER_ROLE || '', secret: false, requiresRestart: false },
    { key: 'EMBED_COLOR', file: ROOT_ENV_PATH, fileLabel: 'Raiz .env', value: root.EMBED_COLOR || '', secret: false, requiresRestart: false },
    { key: 'EMBED_TITLE', file: ROOT_ENV_PATH, fileLabel: 'Raiz .env', value: root.EMBED_TITLE || '', secret: false, requiresRestart: false },
    { key: 'EMBED_FOOTER', file: ROOT_ENV_PATH, fileLabel: 'Raiz .env', value: root.EMBED_FOOTER || '', secret: false, requiresRestart: false },
    { key: 'DASHBOARD_URL', file: ROOT_ENV_PATH, fileLabel: 'Raiz .env', value: root.DASHBOARD_URL || '', secret: false, requiresRestart: false },

    { key: 'CLIENT_ID', file: DASH_ENV_PATH, fileLabel: 'Dashboard .env', value: dash.CLIENT_ID || '', secret: false, requiresRestart: false },
    { key: 'CLIENT_SECRET', file: DASH_ENV_PATH, fileLabel: 'Dashboard .env', value: dash.CLIENT_SECRET || '', secret: true, requiresRestart: true },
    { key: 'REDIRECT_URI', file: DASH_ENV_PATH, fileLabel: 'Dashboard .env', value: dash.REDIRECT_URI || '', secret: false, requiresRestart: false },
    { key: 'SESSION_SECRET', file: DASH_ENV_PATH, fileLabel: 'Dashboard .env', value: dash.SESSION_SECRET || '', secret: true, requiresRestart: true },
    { key: 'ADMIN_IDS', file: DASH_ENV_PATH, fileLabel: 'Dashboard .env', value: dash.ADMIN_IDS || '', secret: false, requiresRestart: false },
    { key: 'PORT', file: DASH_ENV_PATH, fileLabel: 'Dashboard .env', value: dash.PORT || '', secret: false, requiresRestart: true },
  ].map(e => ({
    ...e,
    displayValue: e.secret && e.value ? `••••••${String(e.value).slice(-4)}` : e.value
  }));

  res.render('admin_settings', { entries });
});

// Salvar settings
app.post('/admin/settings/update', requireApproved, (req, res) => {
  const admins = (process.env.ADMIN_IDS || "").split(",").filter(Boolean);
  if (!admins.includes(String(req.session.user.id))) {
    return res.status(403).send("Sem permissão");
  }

  const updates = Array.isArray(req.body.updates) ? req.body.updates : [];

  try {
    const grouped = updates.reduce((acc, u) => {
      if (!u || !u.key || typeof u.value === 'undefined' || !u.file) return acc;
      if (!acc[u.file]) acc[u.file] = {};
      acc[u.file][u.key] = String(u.value);
      return acc;
    }, {});

    Object.entries(grouped).forEach(([file, up]) => writeEnv(file, up));

    updates.forEach(({ key, value }) => {
      process.env[key] = String(value);
    });

    const wantsJson = (req.headers.accept || "").includes("application/json");

    if (wantsJson) return res.json({ ok: true });
    res.redirect('/admin/settings');

  } catch (e) {
    console.error('Save settings error:', e);
    const wantsJson = (req.headers.accept || "").includes("application/json");
    if (wantsJson) return res.status(500).json({ ok: false });
    res.status(500).send('Falha ao atualizar .env');
  }
});

// Aprovar usuário
app.post("/admin/users/approve", requireApproved, (req, res) => {
  const admins = (process.env.ADMIN_IDS || "").split(",").filter(Boolean);
  if (!admins.includes(String(req.session.user.id))) {
    return res.status(403).send("Sem permissão");
  }

  const id = req.body.id;
  db.run("UPDATE users SET approved = 1 WHERE id = ?", [id], function (err) {
    if (err) {
      console.error('DB update approve error:', err);
      return res.status(500).send('Erro ao aprovar');
    }
    const wantsJson = (req.headers.accept || "").includes("application/json");
    if (wantsJson) return res.json({ ok: true });
    res.redirect("/admin/users");
  });
});

// Revogar usuário
app.post("/admin/users/revoke", requireApproved, (req, res) => {
  const admins = (process.env.ADMIN_IDS || "").split(",").filter(Boolean);
  if (!admins.includes(String(req.session.user.id))) {
    return res.status(403).send("Sem permissão");
  }

  const id = req.body.id;
  db.run("UPDATE users SET approved = 0 WHERE id = ?", [id], function (err) {
    if (err) {
      console.error('DB update revoke error:', err);
      return res.status(500).send('Erro ao revogar');
    }
    const wantsJson = (req.headers.accept || "").includes("application/json");
    if (wantsJson) return res.json({ ok: true });
    res.redirect("/admin/users");
  });
});

// Aprovar todos
app.post("/admin/users/approve-all", requireApproved, (req, res) => {
  const admins = (process.env.ADMIN_IDS || "").split(",").filter(Boolean);
  if (!admins.includes(String(req.session.user.id))) {
    return res.status(403).send("Sem permissão");
  }

  db.run("UPDATE users SET approved = 1 WHERE approved = 0", function (err) {
    if (err) {
      console.error('DB update approve-all error:', err);
      return res.status(500).send('Erro ao aprovar todos');
    }
    const wantsJson = (req.headers.accept || "").includes("application/json");
    if (wantsJson) return res.json({ ok: true });
    res.redirect("/admin/users");
  });
});

// Websocket
io.on('connection', socket => {
  console.log('socket connected', socket.id);

  const guild = bot?.guilds?.cache?.first();
  let online = [], streaming = [];

  if (guild) {
    online = guild.members.cache
      .filter(m => m.presence && m.presence.status === 'online')
      .map(m => m.displayName || m.user.username);

    streaming = guild.members.cache
      .filter(m => m.presence?.activities?.some(a => a.type === 1))
      .map(m => m.displayName || m.user.username);
  }

  socket.emit('initialState', { online, streaming });
});

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Dashboard running on http://localhost:${PORT}`)
);
