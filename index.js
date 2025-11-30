require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActivityType,
  SlashCommandBuilder,
  Routes
} = require('discord.js');
const { REST } = require('@discordjs/rest');
const fetch = require('node-fetch'); // npm install node-fetch
const realtime = require('./realtime');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ],
  partials: [Partials.GuildMember, Partials.User]
});

// ENV
const CHANNEL = process.env.STREAM_ANNOUNCE_CHANNEL;
const STREAMER_ROLE = process.env.STREAMER_ROLE;
const GUILD_ID = process.env.GUILD_ID;

// ---------------------- Funções auxiliares ----------------------

// Detecta streaming no Discord
function isStreaming(presence) {
  if (!presence?.activities?.length) return false;
  const streamingActivity = presence.activities.find(a => a.type === ActivityType.Streaming);
  if (streamingActivity) {
    console.log(`👀 Streaming detectado: ${presence.user?.tag || 'unknown'} | ${streamingActivity.name}`);
    return true;
  }
  return false;
}

// Anunciar streaming no canal e adicionar cargo
async function announceStream(member, guild) {
  const channel = client.channels.cache.get(CHANNEL) || guild.channels.cache.get(CHANNEL);

  if (STREAMER_ROLE && !member.roles.cache.has(STREAMER_ROLE)) {
    try {
      await member.roles.add(STREAMER_ROLE);
      console.log(`+ Cargo adicionado a ${member.user.tag}`);
    } catch (err) {
      console.warn(`⚠ Não consegui adicionar o cargo:`, err.message);
    }
  }

  if (channel?.isTextBased()) {
    const embed = new EmbedBuilder()
      .setColor(process.env.EMBED_COLOR || '#9146ff')
      .setTitle(process.env.EMBED_TITLE || '🎬 Live AO VIVO!')
      .setDescription(`**${member.displayName}** iniciou a transmissão!`)
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({ text: process.env.EMBED_FOOTER || 'Sistema Automático de Alertas' })
      .setTimestamp();

    await channel.send({
      content: STREAMER_ROLE ? `<@&${STREAMER_ROLE}>` : null,
      embeds: [embed]
    });
  }

  if (realtime) {
    realtime.emit('streamStart', {
      userId: member.user.id,
      username: member.user.username,
      displayName: member.displayName,
      avatar: member.user.displayAvatarURL(),
      startedAt: new Date().toISOString()
    });
  }
}

// ---------------------- Twitch ----------------------
async function checkTwitchLiveForVarredura(guild) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const users = process.env.TWITCH_USERS?.split(',').map(u => u.trim());
  if (!clientId || !clientSecret || !users?.length) return [];

  const tokenRes = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return [];

  const query = users.map(u => `user_login=${u}`).join('&');
  const res = await fetch(`https://api.twitch.tv/helix/streams?${query}`, {
    headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${tokenData.access_token}` }
  });
  const data = await res.json();
  if (!data?.data?.length) return [];

  const streamingMembers = [];
  data.data.forEach(stream => {
    const member = guild.members.cache.find(
      m => m.user.username.toLowerCase() === stream.user_name.toLowerCase()
    );
    if (member) streamingMembers.push(member);
  });
  return streamingMembers;
}

// ---------------------- YouTube ----------------------
async function checkYouTubeLiveForVarredura(guild) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const channels = process.env.YOUTUBE_CHANNELS?.split(',').map(c => c.trim());
  if (!apiKey || !channels?.length) return [];

  const streamingMembers = [];
  for (const channelId of channels) {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&eventType=live&key=${apiKey}`
    );
    const data = await res.json();
    if (data.items?.length) {
      // Para YouTube, você precisa mapear channelId -> membro
      const member = guild.members.cache.find(
        m => m.user.username.toLowerCase() === channelId.toLowerCase()
      );
      if (member) streamingMembers.push(member);
    }
  }
  return streamingMembers;
}

// ---------------------- Eventos ----------------------

// Ready
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
    new SlashCommandBuilder().setName('varredura').setDescription('Verifica membros que estão transmitindo'),
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

// PresenceUpdate
client.on('presenceUpdate', async (oldP, newP) => {
  try {
    if (!newP?.member || !newP.guild) return;
    const member = newP.member;
    const guild = newP.guild;

    const wasStreaming = isStreaming(oldP);
    const isNowStreaming = isStreaming(newP);

    if (!wasStreaming && isNowStreaming) {
      console.log(`🎥 ${member.user.tag} começou a streamar.`);
      await announceStream(member, guild);
    }

    if (wasStreaming && !isNowStreaming) {
      console.log(`📴 ${member.user.tag} parou a transmissão.`);
      if (STREAMER_ROLE && member.roles.cache.has(STREAMER_ROLE)) {
        await member.roles.remove(STREAMER_ROLE).catch(err => console.warn(err.message));
      }
      if (realtime) {
        realtime.emit('streamStop', {
          userId: member.user.id,
          username: member.user.username,
          displayName: member.displayName,
          stoppedAt: new Date().toISOString()
        });
      }
    }
  } catch (err) {
    console.error("❌ Erro no presenceUpdate:", err);
  }
});

// Interações (comandos slash)
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;
  const guild = interaction.guild;

  if (interaction.commandName === 'varredura') {
    await interaction.reply('🔎 Iniciando varredura completa de membros...');
    await guild.members.fetch(); // Só rodar no comando, sob demanda

    const discordStreaming = guild.members.cache.filter(m => isStreaming(m.presence));
    const twitchStreaming = await checkTwitchLiveForVarredura(guild);
    const youtubeStreaming = await checkYouTubeLiveForVarredura(guild);

    const allStreamingMembers = new Map();
    [...discordStreaming.values(), ...twitchStreaming, ...youtubeStreaming].forEach(m => allStreamingMembers.set(m.id, m));

    if (!allStreamingMembers.size) {
      await interaction.followUp('Nenhum membro está transmitindo agora.');
    } else {
      for (const member of allStreamingMembers.values()) announceStream(member, guild);
      await interaction.followUp(`✅ Varredura completa concluída. ${allStreamingMembers.size} membros notificados.`);
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

// Export
module.exports = client;

// Executar diretamente
if (require.main === module) {
  client.login(process.env.DISCORD_TOKEN).catch(console.error);
}
