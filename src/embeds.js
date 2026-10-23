
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
};
