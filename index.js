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
const GUILD_ID = process.env.GUILD_ID; // necessario para comandos slash

// Detectar se o usuário está transmitindo
function isStreaming(presence) {
  if (!presence?.activities?.length) return false;
  return presence.activities.some(a => a.type === ActivityType.Streaming);
}

// Função para anunciar streaming
async function announceStream(member, guild) {
  const channel = client.channels.cache.get(CHANNEL) || guild.channels.cache.get(CHANNEL);

  if (STREAMER_ROLE) {
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

  // Notificação realtime
  realtime.emit('streamStart', {
    userId: member.user.id,
    username: member.user.username,
    displayName: member.displayName,
    avatar: member.user.displayAvatarURL(),
    startedAt: new Date().toISOString()
  });
}

// Quando o bot inicia
client.once('ready', async () => {
  console.log(`✅ Bot iniciado como ${client.user.tag}`);

  try {
    const channel =
      client.channels.cache.get(CHANNEL) ||
      (await client.channels.fetch(CHANNEL).catch(() => null));

    if (channel?.isTextBased()) {
      await channel.send("🔵 **Bot iniciado e pronto para uso!**");
      console.log("📢 Mensagem inicial enviada com sucesso.");
    }
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

// Evento principal
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
      if (STREAMER_ROLE) await member.roles.remove(STREAMER_ROLE).catch(() => {});
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

// Comandos slash
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  const guild = interaction.guild;

  if (interaction.commandName === 'varredura') {
    await interaction.reply('🔎 Iniciando varredura de membros...');
    await guild.members.fetch(); // garante que todos membros estão carregados

    const streamingMembers = guild.members.cache.filter(m => isStreaming(m.presence));
    if (!streamingMembers.size) {
      await interaction.followUp('Nenhum membro está transmitindo agora.');
    } else {
      for (const member of streamingMembers.values()) {
        await announceStream(member, guild);
      }
      await interaction.followUp(`✅ Varredura concluída. ${streamingMembers.size} membros notificados.`);
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

// EXPORT
module.exports = client;

// Executar diretamente
if (require.main === module) {
  client.login(process.env.DISCORD_TOKEN).catch(console.error);
}
