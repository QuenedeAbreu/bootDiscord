require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const realtime = require('./realtime');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

const CHANNEL = process.env.STREAM_ANNOUNCE_CHANNEL;
const STREAMER_ROLE = process.env.STREAMER_ROLE;

client.once('ready', () => {
  console.log(`Bot online como ${client.user.tag}`);
});

function isStreaming(presence) {
  return presence?.activities?.some(a => a.type === ActivityType.Streaming || a.type === 1);
}

client.on('presenceUpdate', async (oldP, newP) => {
  try {
    if (!newP || !newP.member) return;
    const member = newP.member;
    const guild = newP.guild;
    const was = isStreaming(oldP);
    const now = isStreaming(newP);

    if (!was && now) {
      const channel = client.channels.cache.get(CHANNEL) || guild.channels.cache.get(CHANNEL);
      const embed = new EmbedBuilder()
        .setColor(process.env.EMBED_COLOR || '#9146ff')
        .setTitle(process.env.EMBED_TITLE || '🎥 Live AO VIVO!')
        .setDescription(`**${member.displayName}** começou a transmitir!`)
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: process.env.EMBED_FOOTER || 'Alerta de Streaming' })
        .setTimestamp();

      // Add role if configured
      if (STREAMER_ROLE) {
        try { await member.roles.add(STREAMER_ROLE); } catch(e){}
      }

      if (channel && channel.isTextBased && channel.permissionsFor(client.user)?.has('SendMessages')) {
        channel.send({ content: STREAMER_ROLE ? `<@&${STREAMER_ROLE}>` : undefined, embeds: [embed] }).catch(()=>{});
      }

      realtime.emit('streamStart', {
        userId: member.user.id,
        username: member.user.username,
        displayName: member.displayName,
        avatar: member.user.displayAvatarURL(),
        startedAt: new Date().toISOString()
      });
    }

    if (was && !now) {
      if (STREAMER_ROLE) {
        try { await newP.member.roles.remove(STREAMER_ROLE); } catch(e){}
      }
      realtime.emit('streamStop', {
        userId: newP.member.user.id,
        username: newP.member.user.username,
        displayName: newP.member.displayName,
        stoppedAt: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error('presenceUpdate error', err);
  }
});

// export client for dashboard
module.exports = client;

if (require.main === module) {
  client.login(process.env.DISCORD_TOKEN).catch(console.error);
}
