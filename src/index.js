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
  ticketCategoryId: process.env.TICKET_CATEGORY_ID?.trim() || null,
  uploadCopyLimitBytes: (() => {
    const value = Number(process.env.PUBLIC_UPLOAD_COPY_LIMIT_MB || 8);
    return (Number.isFinite(value) && value >= 0 ? value : 8) * 1024 * 1024;
  })(),
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const ticketTimers = new Map();
const EVIDENCE_TIMEOUT_MS = 15 * 60 * 1000;
const REJECTED_TIMEOUT_MS = 15 * 60 * 1000;
const CLOSE_GRACE_MS = 5 * 1000;

const setupCommand = new SlashCommandBuilder()
  .setName('setup-testimoni')
  .setDescription('Pasang panel Send Testimoni di channel yang dikonfigurasi.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Login sebagai ${readyClient.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(config.token);
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body: [setupCommand.toJSON()],
    });
    console.log('✅ Slash command /setup-testimoni berhasil didaftarkan.');
  } catch (error) {
    console.error('❌ Gagal mendaftarkan slash command:', error.message);
  }

  await restoreTicketTimers();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup-testimoni') {
        await handleSetupCommand(interaction);
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

client.on(Events.MessageCreate, async (message) => {
  try {
    if (!message.guild || message.author.bot || message.attachments.size === 0) return;

    const ticket = store.getTicket(message.channelId);
    if (!ticket || ticket.state !== 'awaiting_evidence') return;
    if (message.author.id !== ticket.userId) return;

    // Ubah state secara sinkron sebelum operasi async agar unggahan ganda tidak diproses dua kali.
    ticket.evidence = [...message.attachments.values()].map((attachment) => ({
      name: attachment.name || 'lampiran',
      url: attachment.url,
      contentType: attachment.contentType || null,
      size: attachment.size || 0,
    }));
    ticket.state = 'awaiting_staff_review';
    ticket.deadline = null;
    ticket.evidenceMessageId = message.id;
    store.saveTicket(ticket);
    clearTicketTimer(ticket.channelId);

    try {
      await message.channel.permissionOverwrites.edit(ticket.userId, {
        SendMessages: false,
        AttachFiles: false,
      }, 'Bukti testimoni diterima; mengunci ticket sambil menunggu review staff.');
    } catch (permissionError) {
      console.error(`Gagal mengunci ticket ${ticket.number}:`, permissionError.message);
    }

    const user = await client.users.fetch(ticket.userId).catch(() => message.author);
    const reviewMessage = await message.channel.send({
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
            'Bukti pembayaran telah diterima. Terima kasih!',
            '',
            '🔒 Chat ticket sekarang dikunci agar data tidak berubah selama staff memeriksa testimoni.',
            'Staff akan memilih **ACCEPT** atau **REJECT** pada panel review di bawah.',
          ].join('\n'))
          .addFields(
            { name: '⭐ Rating', value: `${'⭐'.repeat(ticket.rating)} (${ticket.rating}/5)`, inline: true },
            { name: '📎 Jumlah lampiran', value: String(ticket.evidence.length), inline: true },
          )
          .setFooter({ text: `Ticket #${ticket.number} • Status: menunggu staff` })
          .setTimestamp()],
        components: [closeOnlyRow(ticket.channelId)],
      });
    }
    console.log(`📎 Bukti diterima untuk ticket #${ticket.number}.`);
  } catch (error) {
    console.error('MessageCreate error:', error);
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

async function handleButton(interaction) {
  if (interaction.customId === 'testimonial_panel_open') {
    return createTicket(interaction);
  }

  if (interaction.customId.startsWith('ticket_send:')) {
    const channelId = interaction.customId.split(':')[1];
    const ticket = getValidatedTicket(interaction, channelId);
    if (!ticket) return interaction.reply({ content: 'Ticket tidak ditemukan atau tombol ini tidak berlaku di channel ini.', ephemeral: true });
    if (interaction.user.id !== ticket.userId) {
      return interaction.reply({ content: 'Hanya pemilik ticket yang dapat mengisi formulir testimoni.', ephemeral: true });
    }
    if (ticket.state !== 'awaiting_form') {
      return interaction.reply({ content: 'Formulir sudah dikirim atau ticket sedang diproses. Kamu tidak perlu mengirim ulang.', ephemeral: true });
    }
    return interaction.showModal(buildTestimonialModal(ticket.channelId));
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
    evidence: [],
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

function buildTestimonialModal(channelId) {
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

  return new ModalBuilder()
    .setCustomId(`testimonial_modal:${channelId}`)
    .setTitle('📝 Kirim Testimoni')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Pesan Testimoni')
        .setDescription('Tulis ulasan yang jujur (5–1000 karakter).')
        .setTextInputComponent(reviewInput),
      new LabelBuilder()
        .setLabel('Rating Bintang')
        .setDescription('Pilih satu nilai dari 1 sampai 5 bintang.')
        .setStringSelectMenuComponent(ratingSelect),
    );
}

async function handleModalSubmit(interaction) {
  if (!interaction.customId.startsWith('testimonial_modal:')) return;
  const channelId = interaction.customId.split(':')[1];
  const ticket = store.getTicket(channelId);
  if (!ticket || interaction.channelId !== channelId || ticket.guildId !== interaction.guildId) {
    return interaction.reply({ content: 'Ticket tidak ditemukan atau sudah ditutup.', ephemeral: true });
  }
  if (interaction.user.id !== ticket.userId) {
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

  ticket.reviewText = reviewText;
  ticket.rating = rating;
  ticket.state = 'awaiting_evidence';
  ticket.deadline = Date.now() + EVIDENCE_TIMEOUT_MS;
  ticket.formSubmittedAt = Date.now();
  store.saveTicket(ticket);
  scheduleTicketTimeout(ticket);

  await interaction.deferReply({ ephemeral: true });
  const mainMessage = await fetchTicketMainMessage(ticket);
  if (mainMessage) {
    await mainMessage.edit({
      embeds: [embeds.evidenceInstructionEmbed(ticket)],
      components: [closeOnlyRow(ticket.channelId)],
    });
  }
  await interaction.editReply('✅ Formulir tersimpan. Sekarang upload bukti transfer langsung di channel ticket dalam waktu 15 menit.');
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
    let fallbackLinks = [];
    try {
      await interaction.deferReply({ ephemeral: true });
      publicChannel = await client.channels.fetch(config.publicChannelId).catch(() => null);
      if (!publicChannel || !publicChannel.isTextBased() || !publicChannel.send) {
        throw new Error('Channel TESTIMONI_ORDER_CHANNEL_ID tidak ditemukan atau bukan channel teks.');
      }
      if (publicChannel.guildId && publicChannel.guildId !== ticket.guildId) {
        throw new Error('Channel testimoni publik berada di server yang berbeda dengan ticket.');
      }

      const buyer = await client.users.fetch(ticket.userId);
      const { files, copiedNames, fallbackLinks: linksNeedingFallback } = await prepareEvidenceFiles(ticket.evidence || [], config.uploadCopyLimitBytes);
      fallbackLinks = linksNeedingFallback;
      const publicEmbed = embeds.publicTestimonialEmbed(ticket, buyer, copiedNames, fallbackLinks);
      publicMessage = await publicChannel.send({
        embeds: [publicEmbed],
        files,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(`Gagal mempublikasikan testimoni #${ticket.number}:`, error);
      ticket.state = 'awaiting_staff_review';
      ticket.deadline = null;
      store.saveTicket(ticket);
      const buyer = await client.users.fetch(ticket.userId).catch(() => ({ id: ticket.userId, username: 'Pembeli', tag: 'Pembeli' }));
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
    ticket.deadline = null;
    store.saveTicket(ticket);
    clearTicketTimer(ticket.channelId);

    if (fallbackLinks.length && publicChannel) {
      const proofLinkMessages = buildFallbackProofMessages(ticket, fallbackLinks);
      for (const content of proofLinkMessages) {
        await publicChannel.send({ content, allowedMentions: { parse: [] } }).catch((error) => {
          console.error(`Gagal mengirim tautan bukti tambahan ticket #${ticket.number}:`, error.message);
        });
      }
    }

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

function buildFallbackProofMessages(ticket, evidence) {
  const prefix = `🧾 **Bukti pembayaran tambahan — Testimoni #${ticket.number}**\n`;
  const chunks = [];
  let current = prefix;
  evidence.forEach((file, index) => {
    const line = `• **${String(file.name || `Lampiran ${index + 1}`).replace(/[\`*_{}\[\]()#+\-.!|>]/g, '').slice(0, 100)}**: <${file.url}>\n`;
    if (current.length + line.length > 1750 && current !== prefix) {
      chunks.push(current.trimEnd());
      current = prefix;
    }
    current += line;
  });
  if (current !== prefix) chunks.push(current.trimEnd());
  return chunks;
}

async function prepareEvidenceFiles(evidence, maxCopyBytes) {
  const files = [];
  const copiedNames = [];
  const fallbackLinks = [];
  let copiedBytes = 0;
  const maxFileBytes = Math.max(0, maxCopyBytes);

  for (const item of evidence) {
    const itemSize = Number(item.size) || 0;
    if (maxFileBytes === 0 || itemSize > maxFileBytes || copiedBytes + itemSize > maxFileBytes) {
      fallbackLinks.push(item);
      continue;
    }

    try {
      const response = await fetch(item.url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Download lampiran gagal (${response.status})`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (copiedBytes + buffer.length > maxFileBytes) {
        fallbackLinks.push(item);
        continue;
      }
      const name = path.basename(item.name || 'bukti-transfer').replace(/[\\/]/g, '_').slice(0, 180) || 'bukti-transfer';
      files.push({ attachment: buffer, name });
      copiedNames.push(name);
      copiedBytes += buffer.length;
    } catch (error) {
      console.warn(`Tidak dapat menyalin bukti ${item.name}: ${error.message}`);
      fallbackLinks.push(item);
    }
  }

  return { files, copiedNames, fallbackLinks };
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
  if (!['awaiting_evidence', 'rejected', 'closing'].includes(ticket.state) || !ticket.deadline) return;

  const delay = Math.max(0, ticket.deadline - Date.now());
  const timer = setTimeout(() => handleTicketDeadline(ticket.channelId).catch((error) => {
    console.error(`Timer ticket ${ticket.number} error:`, error);
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

  if (ticket.state === 'awaiting_evidence') {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased() && channel.send) {
      await channel.send({ embeds: [embeds.evidenceTimeoutEmbed(ticket)] }).catch(() => null);
    }
    ticket.state = 'closing';
    ticket.deadline = Date.now() + CLOSE_GRACE_MS;
    ticket.closeReason = 'Ticket ditutup otomatis karena bukti transfer tidak diunggah selama 15 menit.';
    store.saveTicket(ticket);
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

    if (['awaiting_evidence', 'rejected', 'closing'].includes(ticket.state) && ticket.deadline) {
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
        const user = await client.users.fetch(ticket.userId).catch(() => ({ id: ticket.userId, username: 'Pembeli', tag: 'Pembeli' }));
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
  const roles = interaction.member?.roles;
  if (roles?.cache?.has) return roles.cache.has(roleId);
  if (Array.isArray(roles)) return roles.includes(roleId);
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
