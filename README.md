Projeto: Bot Streaming + Dashboard
Estrutura:
- index.js (bot)
- realtime.js
- dashboard/server.js
- dashboard/views/*.ejs
- dashboard/public/css/themes.css
- dashboard/public/js/theme.js
- dashboard/public/js/socket-client.js
- Dockerfile-bot, Dockerfile-dashboard, docker-compose.yml
- .env (exemplo)

Instruções:
1) Preencha .env e dashboard/.env
2) npm install
3) npx pm2 start process.json
4) npm run dashboard
