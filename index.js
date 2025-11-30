require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActivityType
} = require('discord.js');

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

// Quando o bot inicia
client.once('ready', async () => {
  console.log(`✅ Bot iniciado como ${client.user.tag}`);

  try {
    const channel =
      client.channels.cache.get(CHANNEL) ||
      (await client.channels.fetch(CHANNEL).catch(() => null));

    if (channel && channel.isTextBased()) {
      await channel.send("🔵 **Bot iniciado e pronto para uso!**");
      console.log("📢 Mensagem inicial enviada com sucesso.");
    } else {
      console.log("⚠ Canal inicial não encontrado ou não é de texto.");
    }
  } catch (err) {
    console.error("❌ Erro ao enviar a mensagem inicial:", err);
  }
});

// Detectar streaming
function isStreaming(presence) {
  if (!presence || !presence.activities) return false;

  return presence.activities.some(a =>
    a?.type === ActivityType.Streaming ||
    a?.type === 1 ||
    (a?.url && a.url.includes("twitch.tv")) ||
    (a?.url && a.url.includes("youtube.com"))
  );
}

// Evento principal
client.on('presenceUpdate', async (oldP, newP) => {
  try {
    if (!newP || !newP.member || !newP.guild) return;

    const member = newP.member;
    const guild = newP.guild;

    const wasStreaming = isStreaming(oldP);
    const isNowStreaming = isStreaming(newP);

    console.log(`👀 Atualização de presença: ${member.user.tag} | Was: ${wasStreaming} | Now: ${isNowStreaming}`);

    // --- COMEÇOU A STREAMAR ---
    if (!wasStreaming && isNowStreaming) {
      console.log(`🎥 ${member.user.tag} começou a streamar.`);

      const channel =
        client.channels.cache.get(CHANNEL) ||
        guild.channels.cache.get(CHANNEL);

      const embed = new EmbedBuilder()
        .setColor(process.env.EMBED_COLOR || '#9146ff')
        .setTitle(process.env.EMBED_TITLE || '🎬 Live AO VIVO!')
        .setDescription(`**${member.displayName}** iniciou uma transmissão!`)
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({
          text: process.env.EMBED_FOOTER || 'Sistema Automático de Alertas'
        })
        .setTimestamp();

      // Adicionar cargo
      if (STREAMER_ROLE) {
        try {
          await member.roles.add(STREAMER_ROLE);
          console.log(`+ Cargo adicionado a ${member.user.tag}`);
        } catch (err) {
          console.warn(`⚠ Não consegui adicionar o cargo:`, err.message);
        }
      }
 
      // Enviar mensagem
      if (channel && channel.isTextBased()) {
        await channel.send({
          content: STREAMER_ROLE ? `<@&${STREAMER_ROLE}>` : null,
          embeds: [embed]
        });
      }

      // Notificação realtime
      realtime.emit('streamStart', {
        userId: member.user.id,
        username: member.user.username,
        displayName: member.displayName,
        avatar: member.user.displayAvatarURL(),
        startedAt: new Date().toISOString()
      });

      return;
    }

    // --- PAROU DE STREAMAR ---
    if (wasStreaming && !isNowStreaming) {
      console.log(`📴 ${member.user.tag} parou a transmissão.`);

      if (STREAMER_ROLE) {
        try {
          await member.roles.remove(STREAMER_ROLE);
        } catch (err) {
          console.warn(`⚠ Não consegui remover o cargo:`, err.message);
        }
      }

      realtime.emit('streamStop', {
        userId: member.user.id,
        username: member.user.username,
        displayName: member.displayName,
        stoppedAt: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error("❌ Erro no presenceUpdate:", err);
  }
});

// EXPORT
module.exports = client;

// Executar diretamente
if (require.main === module) {
  client.login(process.env.DISCORD_TOKEN).catch(console.error);
}
