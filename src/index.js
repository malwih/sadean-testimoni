require('dotenv').config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const path = require('node:path');
const store = require('./store');
const embeds = require('./embeds');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith('MASUKKAN_')) {
    throw new Error(`Konfigurasi ${name} belum diisi. Buka file .env dan isi nilainya.`);
  }
  return value;
}

const config = {
  token: requiredEnv('DISCORD_TOKEN'),
  clientId: requiredEnv('CLIENT_ID'),
  guildId: requiredEnv('GUILD_ID'),
  sendChannelId: requiredEnv('SEND_TESTIMONI_CHANNEL_ID'),
  publicChannelId: requiredEnv('TESTIMONI_ORDER_CHANNEL_ID'),
  staffRoleId: requiredEnv('STAFF_ROLE_ID'),
  testimoniRoleId: process.env.TESTIMONI_ROLE_ID?.trim() || null,
  openTicketChannelId: process.env.OPEN_TICKET_CHANNEL_ID?.trim() || null,
  ticketCategoryId: process.env.TICKET_CATEGORY_ID?.trim() || null,
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const ticketTimers = new Map();
const REJECTED_TIMEOUT_MS = 15 * 60 * 1000;
const ACCEPTED_TIMEOUT_MS = 15 * 60 * 1000;
const CLOSE_GRACE_MS = 5 * 1000;

const setupCommand = new SlashCommandBuilder()
  .setName('setup-testimoni')
  .setDescription('Pasang panel Send Testimoni di channel yang dikonfigurasi.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const testimoniCommand = new SlashCommandBuilder()
  .setName('testi')
  .setDescription('Berikan role testimoni ke user tertentu.')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('User yang akan diberikan role testimoni')
      .setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const untestimoniCommand = new SlashCommandBuilder()
  .setName('untesti')
  .setDescription('Hapus role testimoni dari user tertentu.')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('User yang akan dihapus role testimoni')
      .setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Login sebagai ${readyClient.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(config.token);
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body: [setupCommand.toJSON(), testimoniCommand.toJSON(), untestimoniCommand.toJSON()],
    });
    console.log('✅ Slash command berhasil didaftarkan.');
  } catch (error) {
    console.error('❌ Gagal mendaftarkan slash command:', error.message);
  }

  try {
    const guild = await client.guilds.fetch(config.guildId).catch(() => null);
    if (guild) {
      const panelChannel = await guild.channels.fetch(config.sendChannelId).catch(() => null);
      if (panelChannel && panelChannel.isTextBased() && panelChannel.send) {
        const panelMessage = await panelChannel.send({
          embeds: [embeds.panelEmbed()],
          components: embeds.panelComponents(),
        });
        console.log(`✅ Panel testimoni otomatis dipasang di <#${panelChannel.id}>. [Lihat panel](${panelMessage.url})`);
      } else {
        console.warn('⚠️ Channel SEND_TESTIMONI_CHANNEL_ID tidak ditemukan atau bukan channel teks. Panel tidak dipasang otomatis.');
      }
    }
  } catch (error) {
    console.error('❌ Gagal memasang panel otomatis:', error.message);
  }

  await restoreTicketTimers();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup-testimoni') {
        await handleSetupCommand(interaction);
      }
      if (interaction.commandName === 'testi') {
        await handleTestimoniCommand(interaction);
      }
      if (interaction.commandName === 'untesti') {
        await handleUntestimoniCommand(interaction);
      }
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
    }
  } catch (error) {
    console.error('Interaction error:', error);
    const errorMessage = 'Terjadi kesalahan saat memproses permintaan. Coba lagi atau hubungi admin.';
    try {
      if (interaction.deferred) {
        await interaction.editReply({ content: errorMessage, embeds: [], components: [] });
      } else if (interaction.replied) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else if (interaction.isRepliable()) {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    } catch (replyError) {
      console.error('Gagal mengirim pesan error ke Discord:', replyError.message);
    }
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    console.log(`[GuildMemberAdd] Member joined: ${member.user.tag} (${member.user.id}) in guild ${member.guildId}`);
    if (member.guildId !== config.guildId) {
      console.log(`[GuildMemberAdd] Guild ID mismatch. Expected: ${config.guildId}, Got: ${member.guildId}`);
      return;
    }
    if (!config.staffRoleId) {
      console.log(`[GuildMemberAdd] STAFF_ROLE_ID not configured`);
      return;
    }

    const staffRole = await member.guild.roles.fetch(config.staffRoleId).catch(() => null);
    if (!staffRole) {
      console.log(`[GuildMemberAdd] Staff role not found: ${config.staffRoleId}`);
      return;
    }

    const staffMembers = await member.guild.members.fetch({ force: true }).then(members => 
      members.filter(m => m.roles.cache.has(config.staffRoleId))
    );
    console.log(`[GuildMemberAdd] Found ${staffMembers.size} staff members to notify`);

    const joinEmbed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('👋 Member Baru Bergabung')
      .setDescription([
        `Member baru telah bergabung ke server!`,
        '',
        `**User:** ${member.user.tag}`,
        `**ID:** \`${member.user.id}\``,
        `**Joined:** ${member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : 'N/A'}`,
        `**Account Created:** ${member.user.createdAt ? `<t:${Math.floor(member.user.createdAt.getTime() / 1000)}:R>` : 'N/A'}`,
      ].join('\n'))
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setFooter({ text: `Server: ${member.guild.name}` })
      .setTimestamp();

    let notifiedCount = 0;
    for (const staff of staffMembers.values()) {
      try {
        await staff.send({ embeds: [joinEmbed] }).catch(() => null);
        notifiedCount++;
      } catch (error) {
        console.warn(`Gagal mengirim DM ke ${staff.user.tag}: ${error.message}`);
      }
    }

    console.log(`✅ Notifikasi member baru dikirim ke ${notifiedCount}/${staffMembers.size} staff. Member: ${member.user.tag}`);
  } catch (error) {
    console.error('GuildMemberAdd error:', error);
  }
});

client.on(Events.ChannelDelete, (channel) => {
  clearTicketTimer(channel.id);
  if (store.getTicket(channel.id)) {
    store.removeTicket(channel.id);
    console.log(`🗑️ Data ticket untuk channel ${channel.id} dihapus karena channel dihapus.`);
  }
});

client.on(Events.Error, (error) => console.error('Discord client error:', error));

async function handleSetupCommand(interaction) {
  if (!interaction.inGuild() || interaction.guildId !== config.guildId) {
    return interaction.reply({ content: 'Command ini hanya dapat dipakai di server yang dikonfigurasi pada `.env`.', ephemeral: true });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Hanya administrator server yang boleh memasang panel ini.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const panelChannel = await interaction.guild.channels.fetch(config.sendChannelId).catch(() => null);
  if (!panelChannel || !panelChannel.isTextBased() || !panelChannel.send) {
    return interaction.editReply('Channel SEND_TESTIMONI_CHANNEL_ID tidak ditemukan atau bukan channel teks. Periksa `.env`.');
  }

  const panelMessage = await panelChannel.send({
    embeds: [embeds.panelEmbed()],
    components: embeds.panelComponents(),
  });
  return interaction.editReply(`✅ Panel testimoni berhasil dipasang di <#${panelChannel.id}>. [Lihat panel](${panelMessage.url})`);
}

async function handleTestimoniCommand(interaction) {
  if (!interaction.inGuild() || interaction.guildId !== config.guildId) {
    return interaction.reply({ content: 'Command ini hanya dapat dipakai di server yang dikonfigurasi pada `.env`.', ephemeral: true });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Hanya administrator server yang dapat menggunakan command ini.', ephemeral: true });
  }
  if (!config.testimoniRoleId) {
    return interaction.reply({ content: 'TESTIMONI_ROLE_ID belum dikonfigurasi di `.env`.', ephemeral: true });
  }

  const targetUser = interaction.options.getUser('user');
  if (!targetUser) {
    return interaction.reply({ content: 'User tidak ditemukan.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const role = await interaction.guild.roles.fetch(config.testimoniRoleId).catch(() => null);
  if (!role) {
    return interaction.editReply('Role testimoni tidak ditemukan. Periksa TESTIMONI_ROLE_ID di `.env`.');
  }

  const sendChannel = await interaction.guild.channels.fetch(config.sendChannelId).catch(() => null);
  const channelLink = sendChannel ? `https://discord.com/channels/${interaction.guildId}/${config.sendChannelId}` : null;

  try {
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      return interaction.editReply('User tidak ditemukan di server ini.');
    }

    await member.roles.add(role, 'Diberikan role testimoni oleh admin.');

    try {
      await targetUser.send({
        embeds: [new EmbedBuilder()
          .setColor(0xF97316)
          .setAuthor({
            name: 'SADEAN STUDIO',
            iconURL: interaction.guild.iconURL({ size: 128 }),
          })
          .setTitle('🧡 Terima Kasih Telah Membeli!')
          .setDescription([
            `Halo ${targetUser.globalName || targetUser.username}! 👋`,
            '',
            'Terima kasih sudah mempercayai **Sadean Studio** untuk kebutuhan map atau asset Roblox kamu! 🎉',
            '',
            'Kami sangat ingin mendengar pengalamanmu. Yuk, bagikan testimoni kamu!',
          ].join('\n'))
          .addFields(
            {
              name: '📝 Cara Mengirim Testimoni',
              value: channelLink
                ? [
                    `1. [Buka channel send-testimoni](${channelLink}) di server.`,
                    '2. Klik tombol **Send Testimoni** pada panel.',
                    '3. Isi formulir dan rating bintang.',
                    '4. Tunggu staff memeriksa dan menyetujui testimoni kamu.',
                  ].join('\n')
                : [
                    '1. Buka channel **send-testimoni** di server.',
                    '2. Klik tombol **Send Testimoni** pada panel.',
                    '3. Isi formulir dan rating bintang.',
                    '4. Tunggu staff memeriksa dan menyetujui testimoni kamu.',
                  ].join('\n'),
              inline: false,
            },
          )
          .setThumbnail(interaction.guild.iconURL({ size: 256 }))
          .setFooter({ text: 'Ulasan pelanggan, pengalaman nyata • SADEAN STUDIO' })
          .setTimestamp()],
      }).catch((error) => {
        console.error('Gagal mengirim DM ke user:', error.message);
      });
    } catch (error) {
      console.error('Gagal mengirim DM ke user:', error.message);
    }

    return interaction.editReply(`✅ Role testimoni berhasil diberikan kepada ${targetUser.tag}.`);
  } catch (error) {
    console.error('Gagal memberikan role testimoni:', error);
    return interaction.editReply(`❌ Gagal memberikan role testimoni: ${error.message}`);
  }
}

async function handleUntestimoniCommand(interaction) {
  if (!interaction.inGuild() || interaction.guildId !== config.guildId) {
    return interaction.reply({ content: 'Command ini hanya dapat dipakai di server yang dikonfigurasi pada `.env`.', ephemeral: true });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Hanya administrator server yang dapat menggunakan command ini.', ephemeral: true });
  }
  if (!config.testimoniRoleId) {
    return interaction.reply({ content: 'TESTIMONI_ROLE_ID belum dikonfigurasi di `.env`.', ephemeral: true });
  }

  const targetUser = interaction.options.getUser('user');
  if (!targetUser) {
    return interaction.reply({ content: 'User tidak ditemukan.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const role = await interaction.guild.roles.fetch(config.testimoniRoleId).catch(() => null);
  if (!role) {
    return interaction.editReply('Role testimoni tidak ditemukan. Periksa TESTIMONI_ROLE_ID di `.env`.');
  }

  try {
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      return interaction.editReply('User tidak ditemukan di server ini.');
    }

    if (!member.roles.cache.has(role.id)) {
      return interaction.editReply(`User ${targetUser.tag} tidak memiliki role testimoni.`);
    }

    await member.roles.remove(role, 'Dihapus role testimoni oleh admin.');
    return interaction.editReply(`✅ Role testimoni berhasil dihapus dari ${targetUser.tag}.`);
  } catch (error) {
    console.error('Gagal menghapus role testimoni:', error);
    return interaction.editReply(`❌ Gagal menghapus role testimoni: ${error.message}`);
  }
}

async function handleButton(interaction) {
  if (interaction.customId === 'testimonial_panel_open') {
    if (!config.testimoniRoleId) {
      return interaction.reply({ content: 'Role testimoni belum dikonfigurasi.', ephemeral: true });
    }
    if (!interaction.member.roles.cache.has(config.testimoniRoleId)) {
      const channelMention = config.openTicketChannelId ? `<#${config.openTicketChannelId}>` : 'channel open-ticket';
      return interaction.reply({ 
        content: `❌ Kamu belum memiliki transaksi baru. Silakan lakukan pembelian/transaksi terlebih dahulu di ${channelMention} untuk mendapatkan akses send testimoni.`, 
        ephemeral: true 
      });
    }
    return createTicket(interaction);
  }

  if (interaction.customId.startsWith('ticket_send:')) {
    const channelId = interaction.customId.split(':')[1];
    const ticket = getValidatedTicket(interaction, channelId);
    if (!ticket) return interaction.reply({ content: 'Ticket tidak ditemukan atau tombol ini tidak berlaku di channel ini.', ephemeral: true });
    const isStaff = hasStaffRole(interaction, config.staffRoleId);
    console.log(`[ticket_send] User: ${interaction.user.tag}, isStaff: ${isStaff}`);
    if (!isStaff && interaction.user.id !== ticket.userId) {
      return interaction.reply({ content: 'Hanya pemilik ticket yang dapat mengisi formulir testimoni.', ephemeral: true });
    }
    if (ticket.state !== 'awaiting_form') {
      return interaction.reply({ content: 'Formulir sudah dikirim atau ticket sedang diproses. Kamu tidak perlu mengirim ulang.', ephemeral: true });
    }
    const modal = buildTestimonialModal(ticket.channelId, isStaff);
    console.log(`[ticket_send] Modal built with isStaff: ${isStaff}`);
    return interaction.showModal(modal);
  }

  if (interaction.customId.startsWith('ticket_close:')) {
    const channelId = interaction.customId.split(':')[1];
    const ticket = getValidatedTicket(interaction, channelId);
    if (!ticket) return interaction.reply({ content: 'Ticket ini sudah ditutup atau tidak ditemukan.', ephemeral: true });
    const allowed = interaction.user.id === ticket.userId || hasStaffRole(interaction, config.staffRoleId);
    if (!allowed) return interaction.reply({ content: 'Hanya pemilik ticket atau staff yang ditentukan yang dapat menutup ticket ini.', ephemeral: true });
    await interaction.reply({ content: `Ticket #${ticket.number} akan ditutup dalam beberapa detik.`, ephemeral: true });
    await beginClosing(ticket, `Ticket ditutup oleh ${interaction.user.tag || interaction.user.username}.`);
    return;
  }

  if (interaction.customId.startsWith('testimonial_accept:')) {
    return handleStaffDecision(interaction, 'accept');
  }
  if (interaction.customId.startsWith('testimonial_reject:')) {
    return handleStaffDecision(interaction, 'reject');
  }
}

async function createTicket(interaction) {
  if (!interaction.inGuild() || interaction.guildId !== config.guildId) {
    return interaction.reply({ content: 'Panel ini tidak dikonfigurasi untuk server ini.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const previous = store.findTicketByUser(interaction.guildId, interaction.user.id);
  if (previous) {
    const previousChannel = await interaction.guild.channels.fetch(previous.channelId).catch(() => null);
    if (previousChannel) {
      return interaction.editReply(`Kamu masih memiliki ticket yang aktif: <#${previousChannel.id}>. Selesaikan atau tutup ticket itu terlebih dahulu.`);
    }
    store.removeTicket(previous.channelId);
  }

  const staffRole = await interaction.guild.roles.fetch(config.staffRoleId).catch(() => null);
  if (!staffRole) {
    return interaction.editReply('Role staff pada `STAFF_ROLE_ID` tidak ditemukan. Periksa ID role di `.env`.');
  }

  let parentId = null;
  if (config.ticketCategoryId) {
    const parent = await interaction.guild.channels.fetch(config.ticketCategoryId).catch(() => null);
    if (!parent || parent.type !== ChannelType.GuildCategory) {
      return interaction.editReply('Kategori ticket pada `TICKET_CATEGORY_ID` tidak ditemukan atau bukan kategori. Periksa `.env`, atau kosongkan nilainya.');
    }
    parentId = parent.id;
  }

  const number = store.nextTicketNumber();
  const channelName = `testimoni-${number}`;
  const channel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: parentId || undefined,
    topic: `Ticket Testimoni #${number} | Owner ID: ${interaction.user.id}`,
    permissionOverwrites: [
      { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: staffRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
    ],
    reason: `Ticket testimoni #${number} dibuat oleh ${interaction.user.tag || interaction.user.username}`,
  });

  const ticket = {
    number,
    channelId: channel.id,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    state: 'awaiting_form',
    createdAt: Date.now(),
    deadline: null,
    ticketMessageId: null,
    reviewMessageId: null,
    reviewText: null,
    rating: null,
  };
  store.saveTicket(ticket);

  try {
    const message = await channel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [embeds.ticketWelcomeEmbed(ticket, interaction.user)],
      components: [embeds.ticketActionRow(channel.id)],
      allowedMentions: { users: [interaction.user.id] },
    });
    ticket.ticketMessageId = message.id;
    store.saveTicket(ticket);
  } catch (error) {
    store.removeTicket(channel.id);
    await channel.delete('Gagal mengirim pesan awal ticket.').catch(() => null);
    throw error;
  }

  return interaction.editReply(`✅ Ticket testimoni kamu berhasil dibuat: <#${channel.id}>`);
}

function buildTestimonialModal(channelId, isStaff = false) {
  const reviewInput = new TextInputBuilder()
    .setCustomId('testimonial_text')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Ceritakan pengalaman kamu membeli map atau asset di Sadean Studio...')
    .setMinLength(5)
    .setMaxLength(1000)
    .setRequired(true);

  const ratingSelect = new StringSelectMenuBuilder()
    .setCustomId('testimonial_rating')
    .setPlaceholder('Pilih rating bintang (1–5)')
    .setRequired(true)
    .addOptions(
      { label: '⭐ 1 Bintang — Sangat Kurang', value: '1', description: 'Pengalaman sangat kurang memuaskan' },
      { label: '⭐⭐ 2 Bintang — Kurang', value: '2', description: 'Pengalaman kurang memuaskan' },
      { label: '⭐⭐⭐ 3 Bintang — Cukup', value: '3', description: 'Pengalaman cukup baik' },
      { label: '⭐⭐⭐⭐ 4 Bintang — Puas', value: '4', description: 'Pengalaman memuaskan' },
      { label: '⭐⭐⭐⭐⭐ 5 Bintang — Sangat Puas', value: '5', description: 'Pengalaman sangat memuaskan' },
    );

  const components = [
    new LabelBuilder()
      .setLabel('Pesan Testimoni')
      .setDescription('Tulis ulasan yang jujur (5–1000 karakter).')
      .setTextInputComponent(reviewInput),
    new LabelBuilder()
      .setLabel('Rating Bintang')
      .setDescription('Pilih satu nilai dari 1 sampai 5 bintang.')
      .setStringSelectMenuComponent(ratingSelect),
  ];

  if (isStaff) {
    const usernameInput = new TextInputBuilder()
      .setCustomId('testimonial_username')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Username atau User ID Discord pembeli (contoh: @username atau 123456789012345678)')
      .setMinLength(2)
      .setMaxLength(100)
      .setRequired(false);
    components.push(
      new LabelBuilder()
        .setLabel('Username Pembeli (Opsional - Staff Only)')
        .setDescription('Masukkan username atau User ID Discord pembeli asli. Kosongkan jika testimoni untuk diri sendiri.')
        .setTextInputComponent(usernameInput)
    );
  }

  return new ModalBuilder()
    .setCustomId(`testimonial_modal:${channelId}`)
    .setTitle('📝 Kirim Testimoni')
    .addLabelComponents(...components);
}

async function handleModalSubmit(interaction) {
  if (!interaction.customId.startsWith('testimonial_modal:')) return;
  const channelId = interaction.customId.split(':')[1];
  const ticket = store.getTicket(channelId);
  if (!ticket || interaction.channelId !== channelId || ticket.guildId !== interaction.guildId) {
    return interaction.reply({ content: 'Ticket tidak ditemukan atau sudah ditutup.', ephemeral: true });
  }
  const isStaff = hasStaffRole(interaction, config.staffRoleId);
  if (!isStaff && interaction.user.id !== ticket.userId) {
    return interaction.reply({ content: 'Formulir ini hanya dapat dikirim oleh pemilik ticket.', ephemeral: true });
  }
  if (ticket.state !== 'awaiting_form') {
    return interaction.reply({ content: 'Formulir sudah pernah dikirim. Silakan ikuti instruksi pada ticket.', ephemeral: true });
  }

  const reviewText = interaction.fields.getTextInputValue('testimonial_text').trim();
  const ratingValues = interaction.fields.getStringSelectValues('testimonial_rating');
  const rating = Number(ratingValues?.[0]);
  if (reviewText.length < 5 || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return interaction.reply({ content: 'Isi pesan testimoni dan pilih rating 1–5 yang valid.', ephemeral: true });
  }

  let actualUserId = ticket.userId;
  if (isStaff) {
    const usernameInput = interaction.fields.getTextInputValue('testimonial_username')?.trim();
    if (usernameInput) {
      try {
        let user = null;
        if (usernameInput.match(/^\d{17,20}$/)) {
          user = await client.users.fetch(usernameInput).catch(() => null);
        } else {
          const guild = await client.guilds.fetch(interaction.guildId);
          const member = await guild.members.fetch(usernameInput).catch(() => null);
          if (member) {
            user = member.user;
          }
        }
        if (user) {
          actualUserId = user.id;
        } else {
          return interaction.reply({ content: 'User tidak ditemukan. Pastikan username benar atau gunakan User ID (angka 17-20 digit).', ephemeral: true });
        }
      } catch (error) {
        return interaction.reply({ content: 'Gagal mencari user. Pastikan format username benar (contoh: @username atau User ID).', ephemeral: true });
      }
    }
  }

  ticket.reviewText = reviewText;
  ticket.rating = rating;
  ticket.actualUserId = actualUserId;
  ticket.state = 'awaiting_staff_review';
  ticket.deadline = null;
  ticket.formSubmittedAt = Date.now();
  store.saveTicket(ticket);

  try {
    await interaction.channel.permissionOverwrites.edit(ticket.userId, {
      SendMessages: false,
      AttachFiles: false,
    }, 'Formulir testimoni diterima; mengunci ticket sambil menunggu review staff.');
  } catch (permissionError) {
    console.error(`Gagal mengunci ticket ${ticket.number}:`, permissionError.message);
  }

  await interaction.deferReply({ ephemeral: true });
  const user = await client.users.fetch(actualUserId).catch(() => interaction.user);
  const reviewMessage = await interaction.channel.send({
    embeds: [embeds.staffReviewEmbed(ticket, user)],
    components: embeds.staffReviewComponents(ticket.channelId),
    allowedMentions: { parse: [] },
  });
  ticket.reviewMessageId = reviewMessage.id;
  store.saveTicket(ticket);

  const mainMessage = await fetchTicketMainMessage(ticket);
  if (mainMessage) {
    await mainMessage.edit({
      embeds: [new EmbedBuilder()
        .setColor(embeds.ORANGE)
        .setTitle(`🔐 Ticket #${ticket.number} • Menunggu Review Staff`)
        .setDescription([
          'Formulir testimoni telah diterima. Terima kasih!',
          '',
          '🔒 Chat ticket sekarang dikunci agar data tidak berubah selama staff memeriksa testimoni.',
          'Staff akan memilih **ACCEPT** atau **REJECT** pada panel review di bawah.',
        ].join('\n'))
        .addFields(
          { name: '⭐ Rating', value: `${'⭐'.repeat(ticket.rating)} (${ticket.rating}/5)`, inline: true },
        )
        .setFooter({ text: `Ticket #${ticket.number} • Status: menunggu staff` })
        .setTimestamp()],
      components: [closeOnlyRow(ticket.channelId)],
    });
  }
  await interaction.editReply('✅ Formulir tersimpan. Staff akan memeriksa testimoni kamu.');
}

async function handleStaffDecision(interaction, decision) {
  const channelId = interaction.customId.split(':')[1];
  const ticket = getValidatedTicket(interaction, channelId);
  if (!ticket) return interaction.reply({ content: 'Ticket tidak ditemukan atau tombol tidak berlaku di channel ini.', ephemeral: true });
  if (!hasStaffRole(interaction, config.staffRoleId)) {
    return interaction.reply({ content: '⛔ Tombol ini hanya dapat digunakan oleh staff dengan role yang telah ditentukan.', ephemeral: true });
  }
  if (ticket.state !== 'awaiting_staff_review') {
    return interaction.reply({ content: 'Testimoni ini sudah diproses atau belum siap direview.', ephemeral: true });
  }

  if (decision === 'accept') {
    // Kunci state sebelum await agar dua staff tidak memproses testimoni yang sama bersamaan.
    ticket.state = 'processing_accept';
    store.saveTicket(ticket);

    let publicMessage;
    let publicChannel;
    try {
      await interaction.deferReply({ ephemeral: true });
      publicChannel = await client.channels.fetch(config.publicChannelId).catch(() => null);
      if (!publicChannel || !publicChannel.isTextBased() || !publicChannel.send) {
        throw new Error('Channel TESTIMONI_ORDER_CHANNEL_ID tidak ditemukan atau bukan channel teks.');
      }
      if (publicChannel.guildId && publicChannel.guildId !== ticket.guildId) {
        throw new Error('Channel testimoni publik berada di server yang berbeda dengan ticket.');
      }

      const buyer = await client.users.fetch(ticket.actualUserId || ticket.userId);
      const publicEmbed = embeds.publicTestimonialEmbed(ticket, buyer, config.openTicketChannelId);
      publicMessage = await publicChannel.send({
        embeds: [publicEmbed],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(`Gagal mempublikasikan testimoni #${ticket.number}:`, error);
      ticket.state = 'awaiting_staff_review';
      ticket.deadline = null;
      store.saveTicket(ticket);
      const buyer = await client.users.fetch(ticket.actualUserId || ticket.userId).catch(() => ({ id: ticket.actualUserId || ticket.userId, username: 'Pembeli', tag: 'Pembeli' }));
      await safelyEditReviewMessage(ticket, embeds.staffReviewEmbed(ticket, buyer), false);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(`❌ Testimoni belum dipublikasikan. Periksa izin bot dan channel testimoni-order. Detail: ${String(error.message).slice(0, 500)}`).catch(() => null);
      }
      return;
    }

    // Setelah posting publik berhasil, jangan pernah mengembalikan ticket ke antrean review.
    ticket.state = 'accepted';
    ticket.acceptedAt = Date.now();
    ticket.acceptedBy = interaction.user.id;
    ticket.publicMessageId = publicMessage.id;
    ticket.deadline = Date.now() + ACCEPTED_TIMEOUT_MS;
    store.saveTicket(ticket);
    scheduleTicketTimeout(ticket);

    await safelyEditReviewMessage(ticket, embeds.acceptedReviewEmbed(ticket, interaction.user), true);
    const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
    if (channel?.isTextBased() && channel.send) {
      const mainMessage = await fetchTicketMainMessage(ticket);
      if (mainMessage) {
        await mainMessage.edit({
          embeds: [embeds.acceptedTicketEmbed(ticket, interaction.user)],
          components: [closeOnlyRow(ticket.channelId)],
        }).catch(() => null);
      } else {
        await channel.send({ embeds: [embeds.acceptedTicketEmbed(ticket, interaction.user)] }).catch(() => null);
      }
    }
    await interaction.editReply(`✅ Testimoni #${ticket.number} disetujui dan dipublikasikan di <#${config.publicChannelId}>.`).catch((error) => {
      console.warn('Testimoni berhasil dipublikasikan, tetapi balasan ephemeral tidak terkirim:', error.message);
    });
    return;
  }

  ticket.state = 'rejected';
  ticket.rejectedAt = Date.now();
  ticket.rejectedBy = interaction.user.id;
  ticket.deadline = Date.now() + REJECTED_TIMEOUT_MS;
  store.saveTicket(ticket);
  scheduleTicketTimeout(ticket);
  await interaction.deferReply({ ephemeral: true });
  await safelyEditReviewMessage(ticket, embeds.rejectedReviewEmbed(ticket, interaction.user), true);

  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (channel?.isTextBased() && channel.send) {
    const mainMessage = await fetchTicketMainMessage(ticket);
    if (mainMessage) {
      await mainMessage.edit({
        embeds: [embeds.rejectedTicketEmbed(ticket, interaction.user)],
        components: [closeOnlyRow(ticket.channelId)],
      }).catch(() => null);
    } else {
      await channel.send({ embeds: [embeds.rejectedTicketEmbed(ticket, interaction.user)] }).catch(() => null);
    }
  }
  await interaction.editReply(`❌ Testimoni #${ticket.number} ditolak. Ticket akan ditutup otomatis dalam 15 menit.`);
}

async function beginClosing(ticket, reason) {
  const latest = store.getTicket(ticket.channelId);
  if (!latest) return;
  latest.state = 'closing';
  latest.deadline = Date.now() + CLOSE_GRACE_MS;
  latest.closeReason = reason;
  store.saveTicket(latest);
  scheduleTicketTimeout(latest);

  const channel = await client.channels.fetch(latest.channelId).catch(() => null);
  if (channel?.isTextBased() && channel.send) {
    await channel.send({ embeds: [embeds.closingEmbed(reason)] }).catch(() => null);
  }
  const mainMessage = await fetchTicketMainMessage(latest);
  if (mainMessage) await mainMessage.edit({ components: [] }).catch(() => null);
}

function scheduleTicketTimeout(ticket) {
  clearTicketTimer(ticket.channelId);
  if (!['rejected', 'accepted', 'closing'].includes(ticket.state) || !ticket.deadline) return;

  const delay = Math.max(0, ticket.deadline - Date.now());
  const timer = setTimeout(() => handleTicketDeadline(ticket.channelId).catch((error) => {
    console.error(`Error handling ticket deadline for ${ticket.channelId}:`, error);
  }), delay);
  if (typeof timer.unref === 'function') timer.unref();
  ticketTimers.set(ticket.channelId, timer);
}

async function handleTicketDeadline(channelId) {
  clearTicketTimer(channelId);
  const ticket = store.getTicket(channelId);
  if (!ticket || !ticket.deadline) return;
  if (ticket.deadline > Date.now()) {
    scheduleTicketTimeout(ticket);
    return;
  }

  if (ticket.state === 'rejected') {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased() && channel.send) {
      await channel.send({ embeds: [embeds.closingEmbed('Ticket ditutup otomatis 15 menit setelah testimoni ditolak.')] }).catch(() => null);
    }
    ticket.state = 'closing';
    ticket.deadline = Date.now() + CLOSE_GRACE_MS;
    ticket.closeReason = 'Ticket ditutup otomatis 15 menit setelah penolakan.';
    store.saveTicket(ticket);
    scheduleTicketTimeout(ticket);
    return;
  }

  if (ticket.state === 'accepted') {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased() && channel.send) {
      await channel.send({ embeds: [embeds.closingEmbed('Ticket ditutup otomatis 15 menit setelah testimoni disetujui.')] }).catch(() => null);
    }
    ticket.state = 'closing';
    ticket.deadline = Date.now() + CLOSE_GRACE_MS;
    ticket.closeReason = 'Ticket ditutup otomatis 15 menit setelah persetujuan.';
    store.saveTicket(ticket);
    scheduleTicketTimeout(ticket);
    return;
  }

  if (ticket.state === 'closing') {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) {
      await channel.delete(ticket.closeReason || 'Ticket ditutup otomatis.').catch((error) => {
        console.error(`Gagal menghapus channel ticket ${ticket.number}:`, error.message);
      });
    }
    store.removeTicket(channelId);
  }
}

async function restoreTicketTimers() {
  for (const ticket of store.getAllTickets()) {
    const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
    if (!channel) {
      store.removeTicket(ticket.channelId);
      continue;
    }

    if (['rejected', 'accepted', 'closing'].includes(ticket.state) && ticket.deadline) {
      scheduleTicketTimeout(ticket);
    } else if (ticket.state === 'processing_accept') {
      // Jika proses bot mati setelah state dikunci, kembalikan agar staff bisa mencoba lagi.
      ticket.state = 'awaiting_staff_review';
      ticket.deadline = null;
      store.saveTicket(ticket);
    }

    if (ticket.state === 'awaiting_staff_review') {
      let reviewMessage = null;
      if (ticket.reviewMessageId && channel.messages) {
        reviewMessage = await channel.messages.fetch(ticket.reviewMessageId).catch(() => null);
      }
      if (!reviewMessage && channel.isTextBased() && channel.send) {
        const user = await client.users.fetch(ticket.actualUserId || ticket.userId).catch(() => ({ id: ticket.actualUserId || ticket.userId, username: 'Pembeli', tag: 'Pembeli' }));
        const restoredMessage = await channel.send({
          embeds: [embeds.staffReviewEmbed(ticket, user)],
          components: embeds.staffReviewComponents(ticket.channelId),
          allowedMentions: { parse: [] },
        }).catch((error) => {
          console.error(`Gagal memulihkan panel review ticket #${ticket.number}:`, error.message);
          return null;
        });
        if (restoredMessage) {
          ticket.reviewMessageId = restoredMessage.id;
          store.saveTicket(ticket);
        }
      }
    }
  }
  console.log('✅ Data ticket aktif diperiksa; timer tertunda dipulihkan bila diperlukan.');
}

function clearTicketTimer(channelId) {
  const timer = ticketTimers.get(channelId);
  if (timer) clearTimeout(timer);
  ticketTimers.delete(channelId);
}

function getValidatedTicket(interaction, channelId) {
  const ticket = store.getTicket(channelId);
  if (!ticket || interaction.channelId !== channelId || ticket.guildId !== interaction.guildId) return null;
  return ticket;
}

function hasStaffRole(interaction, roleId) {
  if (!interaction.member) return false;
  const roles = interaction.member.roles;
  if (roles?.cache?.has) {
    const hasRole = roles.cache.has(roleId);
    console.log(`[hasStaffRole] User: ${interaction.user.tag}, RoleID: ${roleId}, HasRole: ${hasRole}, UserRoles: ${Array.from(roles.cache.keys()).join(', ')}`);
    return hasRole;
  }
  if (Array.isArray(roles)) {
    const hasRole = roles.includes(roleId);
    console.log(`[hasStaffRole] User: ${interaction.user.tag}, RoleID: ${roleId}, HasRole: ${hasRole}, UserRoles: ${roles.join(', ')}`);
    return hasRole;
  }
  console.log(`[hasStaffRole] User: ${interaction.user.tag}, RoleID: ${roleId}, No roles found`);
  return false;
}

function closeOnlyRow(channelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_close:${channelId}`)
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  );
}

async function fetchTicketMainMessage(ticket) {
  if (!ticket.ticketMessageId) return null;
  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.messages) return null;
  return channel.messages.fetch(ticket.ticketMessageId).catch(() => null);
}

async function safelyEditReviewMessage(ticket, embed, disabled) {
  if (!ticket.reviewMessageId) return;
  const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.messages) return;
  const message = await channel.messages.fetch(ticket.reviewMessageId).catch(() => null);
  if (!message) return;
  await message.edit({
    embeds: [embed],
    components: embeds.staffReviewComponents(ticket.channelId, disabled),
  }).catch((error) => console.error(`Gagal memperbarui panel review ticket #${ticket.number}:`, error.message));
}

process.on('unhandledRejection', (error) => console.error('Unhandled promise rejection:', error));
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exitCode = 1;
});

client.login(config.token).catch((error) => {
  console.error('❌ Gagal login. Periksa DISCORD_TOKEN:', error.message);
  process.exit(1);
});
