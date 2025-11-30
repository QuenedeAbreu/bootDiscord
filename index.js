require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  SlashCommandBuilder,
  Routes
} = require('discord.js');
const { REST } = require('@discordjs/rest');
const fetch = require('node-fetch');
const realtime = require('./realtime');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.User]
});

// ENV
const CHANNEL = process.env.STREAM_ANNOUNCE_CHANNEL;
const STREAMER_ROLE = process.env.STREAMER_ROLE;
const GUILD_ID = process.env.GUILD_ID;

// Função para anunciar live
async function announceStream(username, guild, platform, streamUrl) {
  const channel = client.channels.cache.get(CHANNEL) || guild.channels.cache.get(CHANNEL);

  if (channel?.isTextBased()) {
    const embed = new EmbedBuilder()
      .setColor(process.env.EMBED_COLOR || '#9146ff')
      .setTitle(process.env.EMBED_TITLE || `🎬 Live AO VIVO!`)
      .setDescription(`**${username}** iniciou transmissão no **${platform}**!`)
      .setURL(streamUrl)
      .setFooter({ text: process.env.EMBED_FOOTER || 'Sistema Automático de Alertas' })
      .setTimestamp();

    await channel.send({
      content: STREAMER_ROLE ? `<@&${STREAMER_ROLE}>` : null,
      embeds: [embed]
    });
  }

  // Notificação realtime (opcional)
  if (realtime) {
    realtime.emit('streamStart', {
      username,
      platform,
      startedAt: new Date().toISOString(),
      streamUrl
    });
  }
}

// Verifica se o canal da Twitch está ao vivo
async function checkTwitchLive() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const username = process.env.TWITCH_USER;

  if (!clientId || !clientSecret || !username) return null;

  // Obter token
  const tokenRes = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`, { method: 'POST' });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return null;

  // Verificar live
  const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${username}`, {
    headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${tokenData.access_token}` }
  });
  const data = await res.json();

  if (data?.data?.length && data.data[0].type === 'live') {
    const streamUrl = `https://www.twitch.tv/${username}`;
    return { username, platform: 'Twitch', url: streamUrl };
  }
  return null;
}

// Verifica se o canal do YouTube está ao vivo
async function checkYouTubeLive() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL;

  if (!apiKey || !channelId) return null;

  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&eventType=live&key=${apiKey}`);
  const data = await res.json();

  if (data.items?.length) {
    const videoId = data.items[0].id.videoId;
    const username = data.items[0].snippet.channelTitle;
    const streamUrl = `https://www.youtube.com/watch?v=${videoId}`;
    return { username, platform: 'YouTube', url: streamUrl };
  }
  return null;
}

// Evento ready
client.once('ready', async () => {
  console.log(`✅ Bot iniciado como ${client.user.tag}`);

  try {
    const channel = client.channels.cache.get(CHANNEL) || await client.channels.fetch(CHANNEL).catch(() => null);
    if (channel?.isTextBased()) await channel.send("🔵 **Bot iniciado e pronto para uso!**");
  } catch (err) {
    console.error("❌ Erro ao enviar a mensagem inicial:", err);
  }

  // Registrar comandos slash
  const commands = [
    new SlashCommandBuilder().setName('varredura').setDescription('Verifica se os canais configurados estão ao vivo'),
    new SlashCommandBuilder().setName('teste').setDescription('Envia mensagem de teste')
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('✅ Comandos slash registrados');
  } catch (err) {
    console.error('❌ Erro ao registrar comandos slash:', err);
  }
});

// Comandos slash
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;
  const guild = interaction.guild;

  if (interaction.commandName === 'varredura') {
    await interaction.reply('🔎 Iniciando varredura de streams...');

    const twitchLive = await checkTwitchLive();
    const ytLive = await checkYouTubeLive();

    const allStreams = [];
    if (twitchLive) allStreams.push(twitchLive);
    if (ytLive) allStreams.push(ytLive);

    if (!allStreams.length) {
      await interaction.followUp('Nenhum canal está ao vivo agora.');
    } else {
      for (const stream of allStreams) {
        await announceStream(stream.username, guild, stream.platform, stream.url);
      }
      await interaction.followUp(`✅ Varredura concluída. ${allStreams.length} canal(es) notificado(s).`);
    }
  }

  if (interaction.commandName === 'teste') {
    const channel = client.channels.cache.get(CHANNEL) || guild.channels.cache.get(CHANNEL);
    if (channel?.isTextBased()) {
      await channel.send('🧪 Mensagem de teste enviada pelo comando /teste!');
      await interaction.reply({ content: '✅ Teste enviado!', ephemeral: true });
    } else {
      await interaction.reply({ content: '❌ Canal não encontrado.', ephemeral: true });
    }
  }
});

// Export e login
module.exports = client;

if (require.main === module) {
  client.login(process.env.DISCORD_TOKEN).catch(console.error);
}
