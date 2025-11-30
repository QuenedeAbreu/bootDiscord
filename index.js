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

// Bot online
client.once('ready', () => {
  console.log(`✅ Bot online como ${client.user.tag}`);
});

// Detectar streaming
function isStreaming(presence) {
  if (!presence || !presence.activities) return false;

  return presence.activities.some(
    (a) => a.type === ActivityType.Streaming || a.type === 1
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

    // → COMEÇOU A STREAMAR
    if (!wasStreaming && isNowStreaming) {
      console.log(`🎥 ${member.user.tag} começou a streamar.`);

      // Pegar canal
      const channel =
        client.channels.cache.get(CHANNEL) ||
        guild.channels.cache.get(CHANNEL);

      // Embed
      const embed = new EmbedBuilder()
        .setColor(process.env.EMBED_COLOR || '#9146ff')
        .setTitle(process.env.EMBED_TITLE || '🎬 Live AO VIVO!')
        .setDescription(`**${member.displayName}** começou uma transmissão!`)
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({
          text: process.env.EMBED_FOOTER || 'Sistema de Alertas de Stream'
        })
        .setTimestamp();

      // Adicionar cargo
      if (STREAMER_ROLE) {
        try {
          await member.roles.add(STREAMER_ROLE);
        } catch (err) {
          console.warn(
            `⚠ Não consegui adicionar o cargo ${STREAMER_ROLE} ao usuário ${member.user.tag}`
          );
        }
      }

      // Enviar mensagem no canal
      if (channel && channel.isTextBased()) {
        channel
          .send({
            content: STREAMER_ROLE ? `<@&${STREAMER_ROLE}>` : null,
            embeds: [embed]
          })
          .catch(() => {});
      }

      // Emitir evento realtime
      realtime.emit('streamStart', {
        userId: member.user.id,
        username: member.user.username,
        displayName: member.displayName,
        avatar: member.user.displayAvatarURL(),
        startedAt: new Date().toISOString()
      });

      return;
    }

    // → PAROU DE STREAMAR
    if (wasStreaming && !isNowStreaming) {
      console.log(`📴 ${member.user.tag} parou de streamar.`);

      if (STREAMER_ROLE) {
        try {
          await member.roles.remove(STREAMER_ROLE);
        } catch (err) {
          console.warn(
            `⚠ Não consegui remover o cargo ${STREAMER_ROLE} do usuário ${member.user.tag}`
          );
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
    console.error('❌ Erro no presenceUpdate:', err);
  }
});

// Export
module.exports = client;

// Se executar diretamente
if (require.main === module) {
  client.login(process.env.DISCORD_TOKEN).catch(console.error);
}
