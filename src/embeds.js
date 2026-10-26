
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const ORANGE = 0xF97316;
const GREEN = 0x22C55E;
const RED = 0xEF4444;
const BLUE = 0x3B82F6;
const GRAY = 0x64748B;
const BRAND = 'SADEAN STUDIO';

function panelEmbed() {
  return new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle('🧡 SADEAN STUDIO • TESTIMONI PEMBELIAN')
    .setDescription([
      'Terima kasih sudah mempercayai **Sadean Studio**! ✨',
      '',
      'Punya pengalaman setelah membeli map atau asset Roblox kami? Ceritakan pengalamanmu supaya calon pembeli lain bisa melihat ulasan asli dari pelanggan.',
      '',
      '📝 **Cara mengirim testimoni**',
      '› Tekan tombol **Send Testimoni** di bawah.',
      '› Isi pesan testimoni dan pilih rating bintang.',
      '› Tunggu staff memeriksa dan menyetujui testimoni kamu.'
    ].join('\n'))
    .setFooter({
      text: `${BRAND} • Ulasan pelanggan, pengalaman nyata`
    })
    .setTimestamp();
}

function panelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('testimonial_panel_open')
        .setLabel('Send Testimoni')
        .setEmoji('📝')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function ticketWelcomeEmbed(ticket, user) {
  return new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle(`🎟️ Ticket Testimoni #${ticket.number}`)
    .setDescription([
      `Halo <@${user.id}>! Selamat datang di ticket testimoni kamu. 🧡`,
      '',
      'Tekan **Send Testimoni** untuk membuka formulir. Isi ulasan dan rating bintangmu dengan jujur.',
      '',
      '📌 **Alur ticket**',
      '1. Isi formulir testimoni.',
      '2. Staff akan memeriksa dan memutuskan untuk menerima atau menolak testimoni.',
      '',
      '🔐 Ticket ini hanya bisa dilihat oleh kamu, staff, dan bot.'
    ].join('\n'))
    .addFields(
      {
        name: '👤 Pemilik',
        value: `<@${user.id}>`,
        inline: true
      },
      {
        name: '📍 Status',
        value: 'Menunggu formulir',
        inline: true
      },
    )
    .setFooter({
      text: `${BRAND} • Ticket privat`
    })
    .setTimestamp();
}

function ticketActionRow(channelId, options = {}) {
  const {
    sendDisabled = false,
    closeDisabled = false
  } = options;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_close:${channelId}`)
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(closeDisabled),

    new ButtonBuilder()
      .setCustomId(`ticket_send:${channelId}`)
      .setLabel('Send Testimoni')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(sendDisabled),
  );
}

function staffReviewEmbed(ticket, user) {
  return new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle(`🔎 Review Testimoni #${ticket.number}`)
    .setDescription(
      'Formulir testimoni sudah diterima. Staff akan menentukan accept atau reject.'
    )
    .addFields(
      {
        name: '👤 Pengirim',
        value: `<@${user.id}>\n${escapeMarkdown(user.tag || user.username)}`,
        inline: true
      },
      {
        name: '⭐ Rating',
        value: `${'⭐'.repeat(ticket.rating)} (${ticket.rating}/5)`,
        inline: true
      },
      {
        name: '📝 Pesan Testimoni',
        value: truncate(ticket.reviewText, 1000),
        inline: false
      },
    )
    .setFooter({
      text: `Ticket #${ticket.number} • Pemilik ticket sudah dikunci dari mengirim pesan`
    })
    .setTimestamp();
}

function staffReviewComponents(channelId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`testimonial_accept:${channelId}`)
        .setLabel('ACCEPT')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),

      new ButtonBuilder()
        .setCustomId(`testimonial_reject:${channelId}`)
        .setLabel('REJECT')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    ),
  ];
}

function acceptedTicketEmbed(ticket, staffUser) {
  return new EmbedBuilder()
    .setColor(GREEN)
    .setTitle('✅ Testimoni Berhasil Disetujui!')
    .setDescription([
      `Testimoni untuk ticket **#${ticket.number}** telah **diterima** oleh staff ${staffUser ? `<@${staffUser.id}>` : ''}.`,
      '',
      'Testimoni sekarang sudah dipublikasikan di channel testimoni-order. Terima kasih sudah meluangkan waktu untuk memberikan ulasan! 🧡'
    ].join('\n'))
    .setFooter({
      text: `${BRAND} • Verifikasi selesai`
    })
    .setTimestamp();
}

function rejectedTicketEmbed(ticket, staffUser) {
  return new EmbedBuilder()
    .setColor(RED)
    .setTitle('❌ Testimoni Belum Dapat Disetujui')
    .setDescription([
      `Testimoni untuk ticket **#${ticket.number}** ditolak oleh staff ${staffUser ? `<@${staffUser.id}>` : ''}.`,
      '',
      'Ticket ini akan ditutup otomatis dalam **15 menit**.',
      'Jika kamu merasa terjadi kesalahan, silakan hubungi staff server melalui jalur bantuan yang tersedia.'
    ].join('\n'))
    .setFooter({
      text: `${BRAND} • Keputusan staff`
    })
    .setTimestamp();
}

function closingEmbed(reason = 'Ticket ditutup.') {
  return new EmbedBuilder()
    .setColor(GRAY)
    .setTitle('🔒 Ticket Ditutup')
    .setDescription(reason)
    .setFooter({
      text: BRAND
    })
    .setTimestamp();
}

// EMBED TESTIMONI PUBLIK
// Rating dan Isi Testimoni dibuat berdampingan.
// Nilai keduanya menggunakan inline code agar tampil
// dalam kotak abu-abu seperti User ID.
function publicTestimonialEmbed(
  ticket,
  user,
  openTicketChannelId = null
) {
  const displayName = user.globalName || user.username;

  const reviewText = truncate(
    String(ticket.reviewText || '—')
      .replace(/\s+/g, ' ')
      .replace(/`/g, 'ˋ'),
    900
  );

  const orderViaValue = openTicketChannelId
    ? `<#${openTicketChannelId}>`
    : 'Channel open-ticket';

  return new EmbedBuilder()
    .setColor(ORANGE)
    .setTitle('🌟 TESTIMONI — SADEAN STUDIO')
    .setDescription([
      'Terima kasih telah membagikan pengalamanmu bersama kami! 🧡'
    ].join('\n'))
    .addFields(
      // Baris pertama: Pembeli, User ID, Order Via
      {
        name: '👤 Pembeli',
        value: escapeMarkdown(displayName),
        inline: true
      },
      {
        name: '🆔 User ID',
        value: `\`${user.id}\``,
        inline: true
      },
      {
        name: '🛒 Order Via',
        value: orderViaValue,
        inline: true
      },

      // Baris kedua: Rating dan Isi Testimoni
      {
        name: '⭐ Rating',
        value: `\`${'⭐'.repeat(ticket.rating)} ${ticket.rating}/5\``,
        inline: true
      },
      {
        name: '📝 Isi Testimoni',
        value: `\`${reviewText}\``,
        inline: true
      },
    )
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setFooter({
      text: `Terverifikasi oleh staff • ${BRAND}`
    })
    .setTimestamp();
}

function acceptedReviewEmbed(ticket, staffUser) {
  return new EmbedBuilder()
    .setColor(GREEN)
    .setTitle(`✅ Testimoni #${ticket.number} Disetujui`)
    .setDescription(
      `Testimoni dari <@${ticket.userId}> telah berhasil dikirim ke channel publik oleh bot. Keputusan: ACCEPT oleh <@${staffUser.id}>.`
    )
    .setTimestamp();
}

function rejectedReviewEmbed(ticket, staffUser) {
  return new EmbedBuilder()
    .setColor(RED)
    .setTitle(`❌ Testimoni #${ticket.number} Ditolak`)
    .setDescription(
      `Keputusan REJECT diberikan oleh <@${staffUser.id}>. Ticket ditutup otomatis 15 menit sejak keputusan ini.`
    )
    .setTimestamp();
}

function truncate(value, max) {
  const text = String(value || '—');

  return text.length > max
    ? `${text.slice(0, max - 1)}…`
    : text;
}

function escapeMarkdown(value) {
  return String(value || '')
    .replace(/([\\`*_{}[\]()#+\-.!|>~])/g, '\\$1')
    .slice(0, 180);
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


// SHOWCASE EMBEDS
function showcasePanelEmbed() {
  return new EmbedBuilder()
    .setColor(BLUE)
    .setTitle('🎮 SADEAN STUDIO • SHOWCASE MAP ROBLOX')
    .setDescription([
      'P produk map Roblox kamu di sini! ✨',
      '',
      'Bagikan deskripsi produk map Roblox kamu ke forum showcase agar calon pembeli bisa melihat detail produk.',
      '',
      '📝 **Cara mengirim showcase**',
      '› Tekan tombol **Send Showcase** di bawah.',
      '› Masukkan judul produk.',
      '› Tulis deskripsi produk di ticket.',
      '› Upload gambar produk (maksimal 10 gambar).',
      '› Showcase akan otomatis diposting ke forum.'
    ].join('\n'))
    .setFooter({
      text: `${BRAND} • Showcase produk map Roblox`
    })
    .setTimestamp();
}

function showcasePanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('showcase_panel_open')
        .setLabel('Send Showcase')
        .setEmoji('🎮')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function showcaseTicketWelcomeEmbed(showcase, user) {
  return new EmbedBuilder()
    .setColor(BLUE)
    .setTitle(`🎟️ Ticket Showcase #${showcase.number}`)
    .setDescription([
      `Halo <@${user.id}>! Selamat datang di ticket showcase kamu. 🎮`,
      '',
      'Tekan **Submit Title** untuk memulai. Masukkan judul produk map Roblox kamu.',
      '',
      '📌 **Alur ticket**',
      '1. Masukkan judul produk.',
      '2. Tulis deskripsi lengkap produk.',
      '3. Upload gambar produk (maksimal 10 gambar).',
      '4. Showcase akan otomatis diposting ke forum.',
      '',
      '🔐 Ticket ini hanya bisa dilihat oleh kamu, staff, dan bot.'
    ].join('\n'))
    .addFields(
      {
        name: '👤 Pemilik',
        value: `<@${user.id}>`,
        inline: true
      },
      {
        name: '📍 Status',
        value: 'Menunggu judul',
        inline: true
      },
    )
    .setFooter({
      text: `${BRAND} • Ticket privat`
    })
    .setTimestamp();
}

function showcaseTicketActionRow(channelId, options = {}) {
  const {
    titleDisabled = false,
    descriptionDisabled = true,
    imagesDisabled = true,
    closeDisabled = false
  } = options;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`showcase_close:${channelId}`)
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(closeDisabled),

    new ButtonBuilder()
      .setCustomId(`showcase_title:${channelId}`)
      .setLabel('Submit Title')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(titleDisabled),

    new ButtonBuilder()
      .setCustomId(`showcase_description:${channelId}`)
      .setLabel('Submit Description')
      .setEmoji('📄')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(descriptionDisabled),

    new ButtonBuilder()
      .setCustomId(`showcase_images:${channelId}`)
      .setLabel('Submit Images')
      .setEmoji('🖼️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(imagesDisabled),
  );
}

function showcaseTitleModal(channelId) {
  const titleInput = new TextInputBuilder()
    .setCustomId('showcase_title_input')
    .setLabel('Judul Produk')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Masukkan judul produk map Roblox...')
    .setMinLength(3)
    .setMaxLength(100)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(`showcase_title_modal:${channelId}`)
    .setTitle('Judul Produk')
    .setComponents(
      new ActionRowBuilder().addComponents(titleInput)
    );
}

function showcaseDescriptionModal(channelId) {
  const descInput = new TextInputBuilder()
    .setCustomId('showcase_description_input')
    .setLabel('Deskripsi Produk')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Tulis deskripsi lengkap produk map Roblox kamu...')
    .setMinLength(10)
    .setMaxLength(2000)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(`showcase_description_modal:${channelId}`)
    .setTitle('Deskripsi Produk')
    .setComponents(
      new ActionRowBuilder().addComponents(descInput)
    );
}

function showcaseForumPostEmbed(showcase, user) {
  const displayName = user.globalName || user.username;
  const description = truncate(
    String(showcase.description || '—')
      .replace(/\s+/g, ' ')
      .replace(/`/g, 'ˋ'),
    1900
  );

  return new EmbedBuilder()
    .setColor(BLUE)
    .setTitle(showcase.title || 'Showcase Produk')
    .setDescription(description)
    .setAuthor({
      name: displayName,
      iconURL: user.displayAvatarURL({ size: 128 }),
    })
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setFooter({
      text: `Showcase #${showcase.number} • ${BRAND}`
    })
    .setTimestamp();
}

function showcaseSubmittedEmbed(showcase) {
  return new EmbedBuilder()
    .setColor(GREEN)
    .setTitle('✅ Showcase Berhasil Dikirim!')
    .setDescription([
      `Showcase untuk ticket **#${showcase.number}** telah berhasil diposting ke forum.`,
      '',
      'Terima kasih sudah membagikan produk map Roblox kamu! 🎮'
    ].join('\n'))
    .setFooter({
      text: `${BRAND} • Showcase selesai`
    })
    .setTimestamp();
}

function showcaseWaitingTitleEmbed(showcase) {
  return new EmbedBuilder()
    .setColor(BLUE)
    .setTitle(`🎟️ Ticket Showcase #${showcase.number} • Menunggu Judul`)
    .setDescription([
      'Tekan tombol **Submit Title** untuk memasukkan judul produk map Roblox kamu.',
      '',
      'Judul akan menjadi judul postingan di forum showcase.'
    ].join('\n'))
    .setFooter({
      text: `${BRAND} • Ticket privat`
    })
    .setTimestamp();
}

function showcaseWaitingDescriptionEmbed(showcase) {
  return new EmbedBuilder()
    .setColor(BLUE)
    .setTitle(`🎟️ Ticket Showcase #${showcase.number} • Menunggu Deskripsi`)
    .setDescription([
      `Judul: **${showcase.title}**`,
      '',
      'Tekan tombol **Submit Description** untuk menulis deskripsi lengkap produk.',
      '',
      'Deskripsi akan menjadi isi postingan di forum showcase.'
    ].join('\n'))
    .setFooter({
      text: `${BRAND} • Ticket privat`
    })
    .setTimestamp();
}

function showcaseWaitingImagesEmbed(showcase) {
  return new EmbedBuilder()
    .setColor(BLUE)
    .setTitle(`🎟️ Ticket Showcase #${showcase.number} • Menunggu Gambar`)
    .setDescription([
      `Judul: **${showcase.title}**`,
      `Deskripsi: ${truncate(showcase.description, 50)}...`,
      '',
      'Upload gambar produk di channel ini (maksimal 10 gambar).',
      'Setelah selesai, tekan tombol **Submit Images** untuk memposting showcase ke forum.'
    ].join('\n'))
    .setFooter({
      text: `${BRAND} • Ticket privat`
    })
    .setTimestamp();
}

module.exports = {
  ORANGE,
  panelEmbed,
  panelComponents,
  ticketWelcomeEmbed,
  ticketActionRow,
  staffReviewEmbed,
  staffReviewComponents,
  acceptedTicketEmbed,
  rejectedTicketEmbed,
  closingEmbed,
  publicTestimonialEmbed,
  acceptedReviewEmbed,
  rejectedReviewEmbed,
  showcasePanelEmbed,
  showcasePanelComponents,
  showcaseTicketWelcomeEmbed,
  showcaseTicketActionRow,
  showcaseTitleModal,
  showcaseDescriptionModal,
  showcaseForumPostEmbed,
  showcaseSubmittedEmbed,
  showcaseWaitingTitleEmbed,
  showcaseWaitingDescriptionEmbed,
  showcaseWaitingImagesEmbed,
};
